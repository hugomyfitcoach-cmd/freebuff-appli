/**
 * Tests CORRECTIF PRODUCTION — CHECKOUT STRIPE SUR iPHONE (V3, PR #15).
 *
 * Historique des stratégies :
 *  - V1 : window.open(url) APRÈS le await fetch → gesture perdu → popup bloqué.
 *  - V2 (abandonnée) : open blank synchrone puis navigation du WindowProxy —
 *    INVALIDÉE sur iPhone réel (fenêtre fantôme / about:blank non présenté en
 *    PWA standalone : Stripe ne s'ouvrait pas).
 *  - V3 (courante) : ouverture DIRECTE de l'URL Stripe (`window.open(url,
 *    '_blank')`) en PWA, fallback navigation même contexte (`location.assign`)
 *    si refusée, filet anti « fenêtre fantôme » one-shot 2,5 s (PWA uniquement,
 *    décision pure : src/lib/stripeOpenFallback.ts). Web classique : navigation
 *    même contexte directe (comportement historique).
 *
 * Scénarios de la mission (8) : ouverture fiable (1, T1–T4 + S1), échec →
 * loading reset (2, S2), retour sans paiement → reset (3, S3), Mensuel→Annuel
 * possible (4, S4), plan courant renvoyé (5, S5), pas de double création
 * (6, S6), déblocage intact (7, S7), coaching interdit (8, S8).
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

const fb = await loadTs('./src/lib/stripeOpenFallback.ts');
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

/* ═════════ DÉCISION PURE DU FILET ANTI FENÊTRE FANTÔME ═════════ */

test('T1 · filet : fenêtre fantôme détectée (app jamais masquée, toujours visible) → fallback', () => {
	assert.equal(
		fb.shouldFallbackToSameContext({ proxyOpened: true, proxyClosed: false, appWasHiddenSinceOpen: false, appCurrentlyVisible: true }),
		true
	);
});

test('T2 · filet : ouverture RÉELLE (app masquée depuis le open) → ne rien faire', () => {
	assert.equal(
		fb.shouldFallbackToSameContext({ proxyOpened: true, proxyClosed: false, appWasHiddenSinceOpen: true, appCurrentlyVisible: false }),
		false
	);
	assert.equal(
		fb.shouldFallbackToSameContext({ proxyOpened: true, proxyClosed: false, appWasHiddenSinceOpen: true, appCurrentlyVisible: true }),
		false,
		'retour dans l’app après une ouverture réussie → jamais de re-navigation parasite'
	);
});

test('T3 · filet : proxy null ou déjà refermé → pas de fallback ici (géré par l’appelant / rien à faire)', () => {
	assert.equal(
		fb.shouldFallbackToSameContext({ proxyOpened: false, proxyClosed: false, appWasHiddenSinceOpen: false, appCurrentlyVisible: true }),
		false
	);
	assert.equal(
		fb.shouldFallbackToSameContext({ proxyOpened: true, proxyClosed: true, appWasHiddenSinceOpen: false, appCurrentlyVisible: true }),
		false
	);
});

test('T4 · filet : délai de grâce court (one-shot), jamais un polling', () => {
	assert.ok(fb.STRIPE_GHOST_WINDOW_GRACE_MS >= 1000, 'assez long pour un handoff iOS lent');
	assert.ok(fb.STRIPE_GHOST_WINDOW_GRACE_MS <= 5000, 'assez court pour ne pas laisser l’utilisatrice bloquée');
});

/* ═════════ HELPER CENTRAL — STRATÉGIE V3 (analyse statique) ═════════ */

test('S1 · ouverture DIRECTE de l’URL Stripe (jamais de about:blank, jamais de WindowProxy navigué)', () => {
	assert.match(refresh, /window\.open\(url, '_blank'\)/, 'window.open avec l’URL réelle (seul appel qui déclenche le handoff iOS)');
	assert.doesNotMatch(refresh, /window\.open\('', '_blank'\)/, 'stratégie open-blank abandonnée');
	assert.doesNotMatch(refresh, /beginStripeExternalWindow/);
	assert.doesNotMatch(refresh, /win\.location\.href\s*=/, 'jamais de navigation de WindowProxy');
	// fallback même contexte : sur null ET au filet (≥ 2 occurrences)
	const assigns = refresh.match(/window\.location\.assign\(url\)/g) ?? [];
	assert.ok(assigns.length >= 2, 'fallback assign présent pour l’ouverture refusée et la fenêtre fantôme');
	// le filet ne s’arme qu’en PWA (après le return non-standalone)
	const webIdx = refresh.indexOf('if (!isStandalone())');
	const ghostIdx = refresh.indexOf('shouldFallbackToSameContext(');
	assert.ok(webIdx !== -1 && ghostIdx !== -1 && webIdx < ghostIdx, 'filet fantôme PWA-only (desktop jamais affecté)');
	assert.match(refresh, /appWasHiddenSinceOpen/);
	assert.match(refresh, /removeEventListener\('visibilitychange', onHidden\)/, 'nettoyage one-shot du listener');
});

test('S2 · page : les deux flux passent par le helper central, loading reset dans un finally', () => {
	const startBody = functionBody(facturation, 'async function startCheckout');
	assert.match(startBody, /openStripeUrl\(json\.url\)/);
	const portalBody = functionBody(facturation, 'async function openPortal');
	assert.match(portalBody, /openStripeUrl\(json\.url\)/);
	assert.match(startBody, /finally\s*\{[\s\S]*?loading = false/, 'loading remis à zéro dans un finally');
	assert.match(portalBody, /finally\s*\{[\s\S]*?portalLoading = false/);
	// erreurs affichées sur échec serveur / réseau (reset loading garanti par le finally)
	assert.match(startBody, /json\.error \?\? /);
	assert.match(startBody, /Connexion impossible/);
	// plus aucun vestige de la stratégie abandonnée
	assert.doesNotMatch(facturation, /beginStripeExternalWindow|externalWindow|StripeExternalWindow/);
});

test('S3 · scénario 3 : retour fenêtre/PWA → reset UI branché sur le focus, AVANT la revalidation', () => {
	assert.match(facturation, /startBillingFocusRevalidate\(resetCheckoutUi\)/);
	const reset = functionBody(facturation, 'function resetCheckoutUi');
	assert.match(reset, /loading = false/);
	assert.match(reset, /portalLoading = false/);
	// ordre imposé : 1) reset état redirection → 2) revalidation entitlement
	const start = refresh.indexOf('export function startBillingFocusRevalidate');
	const end = refresh.indexOf('/* ═════════ OUVERTURE', start);
	const composed = refresh.slice(start, end);
	const onReturnIdx = composed.indexOf('onReturn?.()');
	const revalidateIdx = composed.indexOf('void revalidateBilling()');
	assert.ok(onReturnIdx !== -1 && revalidateIdx !== -1);
	assert.ok(onReturnIdx < revalidateIdx, 'reset AVANT revalidation entitlement');
});

test('S4 · scénario 4 : retour sans paiement → cartes Mensuel/Annuel de nouveau interactives', () => {
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
	assert.equal(billing.canAccessApp({ coachingMode: 'autonomy', stripeSubscriptionStatus: 'active' }, NOW), 'allow');
});

test('S8 · scénario 8 : coaching toujours interdit (403 serveur, priceId serveur, accès inclus)', () => {
	assert.equal(billing.canAccessApp({ coachingMode: 'coaching' }, NOW), 'allow');
	assert.match(checkout, /coachingMode !== 'autonomy'/);
	assert.match(checkout, /status: 403/);
	assert.match(checkout, /priceIdForPlan\(plan\)/, 'priceId 100 % serveur (jamais du client)');
});

test('S9 · label stable + spinner bref ; plus aucun « Redirection… » visible', () => {
	const template = facturation.slice(facturation.indexOf('</script>'));
	assert.doesNotMatch(template, /Redirection…/);
	const ctaIdx = facturation.indexOf('aria-busy={loading}');
	assert.ok(ctaIdx !== -1);
	const cta = facturation.slice(ctaIdx, ctaIdx + 700);
	assert.match(cta, /animate-spin/, 'spinner bref pendant la création de session');
	assert.match(cta, /Réactiver mon accès/);
});
