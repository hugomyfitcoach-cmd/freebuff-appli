/**
 * Tests CORRECTIF PRODUCTION — CHECKOUT STRIPE SUR iPHONE (bugs UX réels).
 *
 * Deux bugs corrigés :
 *  - Bug 1 : `window.open` appelé APRÈS le `await fetch` perdait l'activation
 *    transitoire du user gesture Safari/iOS → ouverture bloquée comme popup,
 *    Stripe ne s'ouvrait jamais (bouton figé). Correctif : pattern
 *    « open blank now, redirect later » — la fenêtre externe vide est ouverte
 *    de façon SYNCHRONIQUE dans la pile du clic, puis redirigée vers l'URL
 *    Checkout (contrôleur pur : src/lib/stripeWindowController.ts).
 *  - Bug 2 : le `return` après ouverture sautait le reset du loading →
 *    « Redirection… » figé après un retour sans paiement, cartes Mortes.
 *    Correctif : loading remis à zéro dans un `finally` (ne survit jamais ni
 *    à l'ouverture ni à un échec) + reset explicite au retour de focus via
 *    startBillingFocusRevalidate (reset AVANT revalidation entitlement).
 *
 * Scénarios de la mission (8) :
 *  1 · clic → création session → ouverture URL ............ T1 + S1
 *  2 · échec création → loading reset ..................... T2 + S2
 *  3 · retour fenêtre/PWA sans paiement → loading reset ... T3 + S3
 *  4 · retour sans paiement → Mensuel→Annuel possible ..... S4
 *  5 · nouveau clic → plan annuel envoyé .................. S5
 *  6 · double-clic rapide → pas de double création ........ S6
 *  7 · entitlement confirmé → déblocage actuel intact ..... S7
 *  8 · coaching toujours interdit ......................... S8
 *
 * Garde-fous vérifiés inchangés : priceId 100 % serveur, 403 coaching,
 * 503 fail-closed, webhook source de vérité, verrou serveur intact
 * (matrice complète : tests/mission-billing-autonomie.test.mjs).
 *
 * Exécution : npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** Charge un module TS du projet (même technique que mission-billing-autonomie). */
async function loadTs(relPath) {
	return import(new URL('..' + relPath.slice(1), import.meta.url).href);
}

/** Lit une source du projet (analyse statique). */
function src(relPath) {
	return readFileSync(new URL('..' + relPath.slice(1), import.meta.url), 'utf8');
}

const ctrl = await loadTs('./src/lib/stripeWindowController.ts');
const billing = await loadTs('./src/convex/billing.ts');

const refresh = src('./src/lib/billingRefresh.ts');
const facturation = src('./src/routes/espace/facturation/+page.svelte');
const checkout = src('./src/routes/api/billing/checkout/+server.ts');

const NOW = 1_800_000_000_000;

/** Extrait le corps d'une fonction du script Svelte (jusqu'au prochain bloc de haut niveau). */
function functionBody(source, signature) {
	const start = source.indexOf(signature);
	assert.ok(start !== -1, `fonction introuvable : ${signature}`);
	const next = source.slice(start + 1).search(/\n\t(async function|function|\$effect|<\/script>)/);
	const end = next === -1 ? source.length : start + 1 + next;
	return source.slice(start, end);
}

/* ────────────── helpers fenêtre factice + scheduler déterministe ────────────── */

/** Window minimal (structure compatible avec StripeWindowLike). */
function fakeWin({ blocked = false, closedAtOpen = false } = {}) {
	if (blocked) return null;
	const win = {
		closed: closedAtOpen,
		location: { href: '' },
		_closeCalls: 0,
		close() {
			win._closeCalls += 1;
			win.closed = true;
		},
	};
	return win;
}

/** Scheduler manuel : les jobs ne partent QUE quand le test les déclenche. */
function manualScheduler() {
	const jobs = [];
	return {
		jobs,
		schedule: (fn, ms) => {
			jobs.push({ fn, ms });
			return () => {};
		},
		runAll() {
			while (jobs.length) jobs.shift().fn();
		},
	};
}

/* ═════════ CONTRÔLEUR PUR (logique réelle de la fenêtre externe) ═════════ */

test('T1 · scénario 1 : complete() redirige la fenêtre pré-ouverte vers l’URL Stripe', () => {
	const win = fakeWin();
	const { schedule, runAll } = manualScheduler();
	const c = ctrl.createStripeWindowController(win, schedule);
	assert.equal(c.complete('https://checkout.stripe.com/c/pay/cs_test_123'), true);
	assert.equal(win.location.href, 'https://checkout.stripe.com/c/pay/cs_test_123');
	assert.equal(win._closeCalls, 0, 'la fenêtre n’est PAS refermée après la redirection');
	runAll();
	assert.equal(win._closeCalls, 0, 'le filet de sécurité est neutralisé après succès');
});

test('T2 · scénario 2 : échec → abort referme la fenêtre vide et complete() devient sans effet', () => {
	const win = fakeWin();
	const { schedule } = manualScheduler();
	const c = ctrl.createStripeWindowController(win, schedule);
	c.abort();
	assert.equal(win._closeCalls, 1, 'abort referme la fenêtre vide (jamais de blanc définitif)');
	assert.equal(c.complete('https://checkout.stripe.com/c/pay/cs_test_123'), false, 'complete après abort = échec → l’UI affichera l’erreur');
});

test('T3 · scénario 3 : filet one-shot — sans URL reçue sous le délai, la fenêtre vide se referme', () => {
	const win = fakeWin();
	const sched = manualScheduler();
	const c = ctrl.createStripeWindowController(win, sched.schedule);
	assert.equal(sched.jobs.length, 1, 'un unique filet ONE-SHOT (jamais du polling)');
	assert.equal(sched.jobs[0].ms, ctrl.STRIPE_WINDOW_SAFETY_TIMEOUT_MS);
	sched.runAll(); // le délai expire sans URL
	assert.equal(win._closeCalls, 1);
	assert.equal(c.complete('https://checkout.stripe.com/c/pay/trop_tard'), false);
});

test('T4 · idempotence et cas dégradés : popup bloqué, fenêtre déjà fermée, doubles appels', () => {
	// popup bloqué : window.open a renvoyé null → échec propre, aucun throw
	const c0 = ctrl.createStripeWindowController(null, () => () => {});
	assert.equal(c0.complete('https://checkout.stripe.com/x'), false);
	assert.doesNotThrow(() => c0.abort());
	// aucun filet schedulé sans fenêtre
	const schedNull = manualScheduler();
	ctrl.createStripeWindowController(null, schedNull.schedule);
	assert.equal(schedNull.jobs.length, 0);

	// fenêtre déjà fermée par l'utilisatrice
	const winClosed = fakeWin({ closedAtOpen: true });
	const c1 = ctrl.createStripeWindowController(winClosed, () => () => {});
	assert.equal(c1.complete('https://checkout.stripe.com/x'), false);

	// double complete : un seul chargement ; abort après succès : fenêtre Stripe intacte
	const win = fakeWin();
	const c2 = ctrl.createStripeWindowController(win, () => () => {});
	assert.equal(c2.complete('https://checkout.stripe.com/a'), true);
	assert.equal(c2.complete('https://checkout.stripe.com/b'), false, 'le 2e complete est un no-op');
	assert.equal(win.location.href, 'https://checkout.stripe.com/a');
	c2.abort();
	assert.equal(win._closeCalls, 0, 'abort après succès ne ferme PAS la fenêtre Stripe');
});

/* ═════════ PAGE FACTURATION — analyse statique des scénarios ═════════ */

test('S1 · scénario 1 : ouverture SYNCHRONIQUE dans le user gesture (avant tout await)', () => {
	const body = functionBody(facturation, 'async function startCheckout');
	const openIdx = body.indexOf('beginStripeExternalWindow()');
	const awaitIdx = body.indexOf('await fetch');
	assert.ok(openIdx !== -1, 'la fenêtre externe est pré-ouverte dans startCheckout');
	assert.ok(awaitIdx !== -1);
	assert.ok(openIdx < awaitIdx, 'window.open doit être appelé AVANT le await fetch (activation Safari/iOS)');	assert.match(body, /external\.complete\(json\.url\)/, 'la fenêtre pré-ouverte est redirigée vers l’URL reçue');
	// la fenêtre vide est bien créée côté billingRefresh, en standalone uniquement
	assert.match(refresh, /export function beginStripeExternalWindow/);
	assert.match(refresh, /window\.open\('', '_blank'\)/);
});

test('S2 · scénario 2 : échec de création → loading reset (finally) + fenêtre refermée + erreur propre', () => {
	const body = functionBody(facturation, 'async function startCheckout');
	assert.match(body, /finally\s*\{[\s\S]*?loading = false/, 'loading remis à zéro dans un finally');
	assert.match(body, /external\?\.abort\(\)/, 'fenêtre vide refermée sur échec');
	assert.match(facturation, /Impossible d’ouvrir le paiement\. Réessaie dans quelques secondes\./, 'message court demandé par la mission');
});

test('S3 · scénario 3 : retour fenêtre/PWA → reset UI branché sur le focus, AVANT la revalidation', () => {
	assert.match(facturation, /startBillingFocusRevalidate\(resetCheckoutUi\)/);
	const reset = functionBody(facturation, 'function resetCheckoutUi');
	assert.match(reset, /externalWindow\?\.abort\(\)/, 'fenêtre externe restée en attente refermée');
	assert.match(reset, /loading = false/);
	assert.match(reset, /portalLoading = false/);
	// ordre imposé : 1) reset état redirection → 2) revalidation entitlement
	const start = refresh.indexOf('export function startBillingFocusRevalidate');
	const end = refresh.indexOf('/* ── Ouverture robuste', start);
	const composed = refresh.slice(start, end);
	const onReturnIdx = composed.indexOf('onReturn?.()');
	const revalidateIdx = composed.indexOf('void revalidateBilling()');
	assert.ok(onReturnIdx !== -1 && revalidateIdx !== -1);
	assert.ok(onReturnIdx < revalidateIdx, 'reset AVANT revalidation entitlement');
});

test('S4 · scénario 4 : retour sans paiement → cartes Mensuel/Annuel de nouveau interactives', () => {
	// un seul disabled={loading} dans la page : le CTA — jamais les cartes
	const hits = facturation.match(/disabled=\{loading\}/g) ?? [];
	assert.equal(hits.length, 1, 'seul le CTA est désactivé pendant la création de session');
	assert.match(facturation, /onclick=\{\(\) => \(plan = 'yearly'\)\}/);
	assert.match(facturation, /onclick=\{\(\) => \(plan = 'monthly'\)\}/);
});

test('S5 · scénario 5 : nouveau clic → nouvelle session avec le plan ALORS sélectionné', () => {
	assert.match(facturation, /onclick=\{\(\) => startCheckout\(plan\)\}/, 'le CTA envoie l’état courant des cartes');
	const body = functionBody(facturation, 'async function startCheckout');
	assert.match(body, /plan = p;/);
	assert.match(body, /JSON\.stringify\(\{ plan: p \}\)/, 'le plan sélectionné est envoyé au serveur');
});

test('S6 · scénario 6 : double-clic rapide → une seule création de session', () => {
	const body = functionBody(facturation, 'async function startCheckout');
	assert.match(body, /if \(loading\) return;/, 'garde explicite en tête de fonction');
	const ctaIdx = facturation.indexOf('onclick={() => startCheckout(plan)}');
	assert.ok(ctaIdx !== -1);
	const cta = facturation.slice(ctaIdx, ctaIdx + 400);
	assert.match(cta, /disabled=\{loading\}/, 'CTA désactivé pendant la création');
});

test('S7 · scénario 7 : entitlement confirmé → déblocage actuel intact (URL ne prouve jamais le succès)', () => {
	assert.match(facturation, /b\.decision !== 'block'/);
	assert.match(facturation, /b\.billingAccessOverride === 'complimentary'/);
	assert.match(facturation, /C'est bon, ton abonnement est actif/);
	// canAccessApp inchangé (matrice complète : suite mission-billing-autonomie)
	assert.equal(billing.canAccessApp({ coachingMode: 'autonomy', stripeSubscriptionStatus: 'active' }, NOW), 'allow');
});

test('S8 · scénario 8 : coaching toujours interdit (403 serveur, priceId serveur, accès inclus)', () => {
	assert.equal(billing.canAccessApp({ coachingMode: 'coaching' }, NOW), 'allow');
	assert.match(checkout, /coachingMode !== 'autonomy'/);
	assert.match(checkout, /status: 403/);
	assert.match(checkout, /priceIdForPlan\(plan\)/, 'priceId 100 % serveur (jamais du client)');
});

test('S9 · label stable + spinner bref ; plus aucun « Redirection… » visible ; PWA préservée', () => {
	const template = facturation.slice(facturation.indexOf('</script>'));
	assert.doesNotMatch(template, /Redirection…/, 'le label bloquant a disparu du rendu');
	const ctaIdx = facturation.indexOf('aria-busy={loading}');
	assert.ok(ctaIdx !== -1);
	const cta = facturation.slice(ctaIdx, ctaIdx + 700);
	assert.match(cta, /animate-spin/, 'spinner bref pendant la création de session');
	assert.match(cta, /Réactiver mon accès/);
	// le helper historique reste : standalone → navigateur externe ; web → même contexte
	assert.match(refresh, /if \(isStandalone\(\)\)/);
	assert.match(refresh, /window\.open\(url, '_blank'\)/);
	assert.match(refresh, /window\.location\.href = url/);
});
