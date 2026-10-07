/**
 * Tests MISSION G-FLUX BILLING / STRIPE AUTONOMIE V1 — verrouillage serveur.
 *
 * Couvre les 17 cas de la mission :
 *  1-9   : matrice canAccessApp (coaching, autonomie nue, complimentary,
 *          active, trialing, past_due en grâce, grâce expirée, canceled
 *          expiré, cancel_at_period_end)
 *  10    : un doublon invoice.payment_failed ne repousse PAS la grâce
 *  11    : invoice.paid efface la grâce (état dérivé)
 *  12-13 : guard serveur central (redirection paywall + routes ouvertes)
 *  14-15 : Customer Portal / Checkout — le priceId ne vient JAMAIS du client
 *  16    : webhook Stripe — signature obligatoire (constructEventAsync)
 *  17    : coaching + past_due → accès inclus (règle 1 prioritaire)
 *
 * Les fonctions pures sont importées directement depuis src/convex/billing.ts
 * (node >= 22.6, --experimental-strip-types) ; les comportements côté BFF
 * (layout, routes API) sont vérifiés par analyse statique des sources.
 *
 * Exécution : npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** Charge un module TS du projet (même technique que mission.test.mjs). */
async function loadTs(relPath) {
	const mod = await import(new URL('..' + relPath.slice(1), import.meta.url).href);
	return mod;
}

const billing = await loadTs('./src/convex/billing.ts');

/** Lit une source du projet (analyse statique). */
function src(relPath) {
	return readFileSync(new URL('..' + relPath.slice(1), import.meta.url), 'utf8');
}

/* ────────────── helpers ────────────── */

const DAY = 24 * 3600 * 1000;
const NOW = 1_800_000_000_000; // horloge figée : tout test est déterministe

/** État users minimal (autonomie par défaut, aucun accès). */
function state(overrides = {}) {
	return { coachingMode: 'autonomy', ...overrides };
}

/* ═══════════════ MATRICE D'ACCÈS (canAccessApp) ═══════════════ */

test('1 · coaching → accès inclus, indépendamment de Stripe', () => {
	assert.equal(billing.canAccessApp(state({ coachingMode: 'coaching' }), NOW), 'allow');
	// même avec un abonnement cassé derrière
	assert.equal(
		billing.canAccessApp(state({ coachingMode: 'coaching', stripeSubscriptionStatus: 'canceled' }), NOW),
		'allow'
	);
});

test('2 · autonomie sans abonnement ni offre → bloquée (HARD LOCK immédiat)', () => {
	assert.equal(billing.canAccessApp(state(), NOW), 'block');
	assert.equal(billing.canAccessApp(state({ stripeSubscriptionStatus: 'incomplete' }), NOW), 'block');
	// Décision produit : une cliente qui vient d'être passée de coaching à
	// autonomie SANS abonnement est hard-lockée à l'instant même — aucune
	// grâce ne s'applique (la grâce ne concerne qu'un abonnement actif dont
	// le RENOUVELLEMENT échoue, cf. webhook).
	assert.equal(
		billing.canAccessApp(state({ billingAccessOverride: undefined, stripeSubscriptionStatus: undefined }), NOW),
		'block'
	);
});

test('3 · accès offert par le coach (complimentary) → accès', () => {
	assert.equal(billing.canAccessApp(state({ billingAccessOverride: 'complimentary' }), NOW), 'allow');
});

test('4 · abonnement active → accès', () => {
	assert.equal(billing.canAccessApp(state({ stripeSubscriptionStatus: 'active' }), NOW), 'allow');
});

test('5 · abonnement trialing → accès', () => {
	assert.equal(billing.canAccessApp(state({ stripeSubscriptionStatus: 'trialing' }), NOW), 'allow');
});

test('6 · past_due à +23h59 → accès avec alerte paiement (grâce 24 h)', () => {
	const failedAt = NOW - DAY;
	const grace = failedAt + billing.GRACE_PERIOD_MS; // +24 h
	assert.equal(grace, failedAt + 24 * 3600 * 1000, 'la grâce couvre exactement 24 heures');
	// 1 minute avant l'expiration : encore couvert
	assert.equal(
		billing.canAccessApp(
			state({ stripeSubscriptionStatus: 'past_due', stripeGraceUntil: failedAt + 24 * 3600 * 1000 }),
			failedAt + 23 * 3600 * 1000 + 59 * 60 * 1000
		),
		'allow_with_payment_warning'
	);
	assert.equal(
		billing.canAccessApp(state({ stripeSubscriptionStatus: 'past_due', stripeGraceUntil: grace }), NOW - 60 * 1000),
		'allow_with_payment_warning'
	);
});

test('7 · past_due à +24h01 (grâce EXPIRÉE) → bloquée (et past_due sans grâce aussi)', () => {
	const expired = NOW - 1000;
	assert.equal(
		billing.canAccessApp(state({ stripeSubscriptionStatus: 'past_due', stripeGraceUntil: expired }), NOW),
		'block'
	);
	assert.equal(billing.canAccessApp(state({ stripeSubscriptionStatus: 'past_due' }), NOW), 'block');
	// borne exacte : now == graceUntil → grâce terminée (strict)
	assert.equal(
		billing.canAccessApp(state({ stripeSubscriptionStatus: 'past_due', stripeGraceUntil: NOW }), NOW),
		'block'
	);
	// 1 minute APRÈS les 24 h : hard lock
	const failedAt = NOW - 25 * 3600 * 1000;
	assert.equal(
		billing.canAccessApp(
			state({ stripeSubscriptionStatus: 'past_due', stripeGraceUntil: failedAt + 24 * 3600 * 1000 }),
			failedAt + 24 * 3600 * 1000 + 60 * 1000
		),
		'block'
	);
});

test('8 · canceled avec fin de période payée ATTEINTE → bloquée', () => {
	assert.equal(
		billing.canAccessApp(state({ stripeSubscriptionStatus: 'canceled', stripeCurrentPeriodEnd: NOW - 1000 }), NOW),
		'block'
	);
	assert.equal(billing.canAccessApp(state({ stripeSubscriptionStatus: 'canceled' }), NOW), 'block');
});

test('9 · résiliation programmée : période payée non écoulée → accès conservé', () => {
	assert.equal(
		billing.canAccessApp(
			state({ stripeSubscriptionStatus: 'active', stripeCancelAtPeriodEnd: true, stripeCurrentPeriodEnd: NOW + 3 * DAY }),
			NOW
		),
		'allow'
	);
	// certains flux Stripe renvoient `canceled` avec une période déjà payée en cours
	assert.equal(
		billing.canAccessApp(state({ stripeSubscriptionStatus: 'canceled', stripeCurrentPeriodEnd: NOW + 3 * DAY }), NOW),
		'allow'
	);
});

test('10 · grâce plafonnée : un payment_failed en double ne la repousse pas', () => {
	const t1 = NOW; // premier échec
	const grace1 = billing.nextGraceUntil(undefined, t1);
	assert.equal(grace1, t1 + 24 * 3600 * 1000, 'grâce = échec + 24 h exactes');

	// VRAI doublon : le même événement re-livré (même instant d'échec, le webhook
	// utilise stripeEvent.created) donne le MÊME graceUntil → la mutation le
	// plafonne au max de l'existant : strictement aucune prolongation.
	assert.equal(billing.nextGraceUntil(grace1, t1), grace1);

	// une NOUVELLE tentative Stripe échouée (nouvel événement, failedAt postérieur)
	// relance un dunning normal : la grâce repart de CE nouvel échec…
	const t2 = t1 + 3600 * 1000; // +1 h (dans la fenêtre 24 h)
	assert.equal(billing.nextGraceUntil(grace1, t2), t2 + 24 * 3600 * 1000);

	// …mais JAMAIS en arrière : un événement ancien reçu en retard ne réduit
	// pas la grâce déjà posée.
	const stale = t1 - DAY;
	assert.equal(billing.nextGraceUntil(grace1, stale), grace1);

	// plafonnement appliqué DANS la mutation syncFromStripe (état réel de la base)
	const syncSrc = src('./src/convex/billing.ts');
	assert.match(syncSrc, /existing\s*>\s*graceUntilMs\s*\?\s*existing\s*:\s*graceUntilMs/);
});

test('11 · invoice.paid efface la grâce → accès normal sans alerte', () => {
	// après régularisation : status actif + grâce absente (le webhook passe graceUntilMs: null)
	const s = billing.accessStateForUser(state({ stripeSubscriptionStatus: 'active' }), NOW);
	assert.equal(s.decision, 'allow');
	assert.equal(s.subscription?.graceUntil, null);
	// la chaîne webhook efface bien la grâce sur paid/deleted
	const billingSrc = src('./src/convex/billing.ts');
	assert.match(billingSrc, /graceUntilMs === null/);
});

test('17 · coaching + past_due → règle 1 prioritaire : accès inclus', () => {
	assert.equal(
		billing.canAccessApp(state({ coachingMode: 'coaching', stripeSubscriptionStatus: 'past_due' }), NOW),
		'allow'
	);
});

/* ═══════════════ ÉTAT SÉRIALISABLE (accessStateForUser) ═══════════════ */

test('accessStateForUser : état dérivé sérialisable pour le BFF', () => {
	const s = billing.accessStateForUser(
		state({ stripeSubscriptionStatus: 'active', stripeCurrentPeriodEnd: NOW + DAY, stripePriceId: 'price_x' }),
		NOW
	);
	assert.deepEqual(s, {
		decision: 'allow',
		coachingMode: 'autonomy',
		billingAccessOverride: null,
		subscription: {
			status: 'active',
			cancelAtPeriodEnd: false,
			currentPeriodEnd: NOW + DAY,
			graceUntil: null,
			priceId: 'price_x',
		},
	});
	// aucune donnée Stripe → subscription null (page facturation : paywall)
	const empty = billing.accessStateForUser(state(), NOW);
	assert.equal(empty.subscription, null);
	assert.equal(empty.decision, 'block');
});

test('subscriptionPatchFromStripe : mapping Subscription → patch users (sec → ms)', () => {
	const patch = billing.subscriptionPatchFromStripe({
		status: 'active',
		current_period_end: 1_800_000_000,
		cancel_at_period_end: true,
		items: { data: [{ price: { id: 'price_test_123' } }] },
	});
	assert.deepEqual(patch, {
		stripeSubscriptionStatus: 'active',
		stripeCurrentPeriodEnd: 1_800_000_000_000,
		stripeCancelAtPeriodEnd: true,
		stripePriceId: 'price_test_123',
	});
});

/* ═══════════════ GUARD SERVEUR CENTRAL (analyse statique) ═══════════════ */

test('12 · cliente bloquée + URL directe → redirect /espace/facturation (serveur)', () => {
	const layout = src('./src/routes/espace/+layout.server.ts');
	// le guard est côté serveur (layout.server.ts), pas seulement au front
	assert.match(layout, /requireClientAccess/);
	assert.match(layout, /requireRole\(event,\s*'client'/);
	// redirection vers le paywall, jamais un simple cachage d'UI
	// (la redirection est dans requireClientAccess, session.ts — utilisée par le layout)
	const sessionSrc = src('./src/lib/server/session.ts');
	assert.match(sessionSrc, /requireClientAccess/);
	assert.match(sessionSrc, /redirect\(303,\s*'\/espace\/facturation/);
});

test('12b · PARAMÈTRES ouverte à toutes + Facturation AUTONOMIE uniquement (UX V1)', () => {
	const layout = src('./src/routes/espace/+layout.server.ts');
	// La page Paramètres reste soumise au garde standard (requireClientAccess) :
	// accessible à toute cliente non bloquée — le hard lock la verrouille toujours.
	assert.match(layout, /requireClientAccess\(event/);
	assert.doesNotMatch(layout, /'\/espace\/parametres'/);
	// Page de retour Stripe : ouverte pendant le lock (matching EXACT, jamais un préfixe)
	assert.match(layout, /BILLING_OPEN_PATHS = \['\/espace\/facturation', '\/facturation\/retour'\]/);

	// UX V1 : la carte Facturation n'existe QU'en mode Autonomie — en Coaching,
	// aucun état billing, aucun lien Portal, aucun CTA abonnement dans Paramètres.
	const parametres = src('./src/routes/espace/parametres/+page.svelte');
	assert.match(parametres, /\{#if b\.coachingMode === 'autonomy'\}/);
	// l'ancienne branche « accès inclus en Coaching » de la carte Facturation a disparu
	assert.doesNotMatch(parametres, /inclus dans ton accompagnement/);
});

test('12c · HARD LOCK : déconnexion possible depuis la page facturation', () => {
	// la facturation est la seule page ouverte pendant le lock → la sortie de
	// session doit y rester possible (action serveur dédiée)
	const facturation = src('./src/routes/espace/facturation/+page.server.ts');
	assert.match(facturation, /export const actions/);
	assert.match(facturation, /logout/);
	assert.match(facturation, /clearSessionCookie/);
	const svelte = src('./src/routes/espace/facturation/+page.svelte');
	assert.match(svelte, /\?\/logout/);
});

test('13 · /espace/facturation reste accessible à une cliente bloquée', () => {
	const layout = src('./src/routes/espace/+layout.server.ts');
	assert.match(layout, /BILLING_OPEN_PATHS\.includes\(event\.url\.pathname\)/);
	// la page facturation charge l'état réel (accessState) même bloquée
	const facturation = src('./src/routes/espace/facturation/+page.server.ts');
	assert.match(facturation, /api\.billing\.accessState/);
	assert.match(facturation, /requireRole\(event,\s*'client'/);
});

test('coaching → page Facturation redirigée côté serveur (aucune page billing)', () => {
	const facturation = src('./src/routes/espace/facturation/+page.server.ts');
	// contrôle serveur (pas un simple masquage d'onglet) : coaching → redirect /espace
	assert.match(facturation, /coachingMode\) === 'coaching'/);
	assert.match(facturation, /redirect\(303, '\/espace'\)/);
});

/* ═══════════════ CHECKOUT / PORTAL (analyse statique) ═══════════════ */

test('14 · Customer Portal : AUTONOMIE uniquement, customer depuis la base', () => {
	const portal = src('./src/routes/api/billing/portal/+server.ts');
	assert.match(portal, /api\.billing\.myStripeCustomerId/);
	assert.match(portal, /400/, 'customer absent → erreur explicite');
	// décision produit : une cliente coaching n'a AUCUN accès Portal via G-FLUX
	// (vérifié côté serveur, pas seulement masqué dans l'UI)
	assert.match(portal, /coachingMode !== 'autonomy'/);
	assert.match(portal, /status: 403/);
	// aucune voie d'injection d'un customer id par le client
	assert.doesNotMatch(portal, /form\.get\(|json\(\)\.then|searchParams\.get\('(stripe)?[Cc]ustomer/);
});

test('15 · Checkout : priceId serveur + AUTONOMIE uniquement (appel direct rejeté)', () => {
	const checkout = src('./src/routes/api/billing/checkout/+server.ts');
	// mapping plan → priceId via env (priceIdForPlan), jamais une valeur du client
	assert.match(checkout, /priceIdForPlan/);
	assert.doesNotMatch(checkout, /body\.priceId|form\.get\('priceId'\)|form\.get\("priceId"\)/);
	assert.match(checkout, /subscription\s*:/, 'mode abonnement');
	assert.match(checkout, /503/, 'non configuré → échec explicite (fail-closed)');
	// décision produit : une cliente coaching ne doit pas créer accidentellement
	// un abonnement Autonomie via appel API direct → 403 serveur
	assert.match(checkout, /coachingMode !== 'autonomy'/);
	assert.match(checkout, /status: 403/);
	// Mode STRICT (préparation production) : la logique clés vit dans
	// stripeMode.ts (module pur, testé — tests/stripe-mode.test.mjs) et
	// stripe.ts s'y branche via le contexte serveur réel — jamais
	// « test ou live accepté indifféremment ».
	const mode = src('./src/lib/server/stripeMode.ts');
	assert.match(mode, /sk_test_|rk_test_/, 'clés TEST acceptées hors production');
	assert.match(mode, /sk_live_|rk_live_/, 'clés LIVE refusées hors production / exigées en production');
	const stripe = src('./src/lib/server/stripe.ts');
	assert.match(stripe, /expectedStripeMode/);
	assert.match(stripe, /process\.env\.CONTEXT/);
	// le mode du Price est revérifié côté serveur AVANT chaque paiement
	assert.match(checkout, /assertPriceMode\(priceId\)/);
});

/* ═══════════════ WEBHOOK STRIPE (analyse statique) ═══════════════ */

test('16 · webhook : signature Stripe OBLIGATOIRE, invalide → 400', () => {
	const webhook = src('./src/routes/api/billing/webhook/+server.ts');
	// vérification cryptographique via l'API officielle, jamais un flag on/off
	assert.match(webhook, /constructEventAsync/);
	assert.match(webhook, /stripe-signature/);
	assert.match(webhook, /400/, 'signature absente/invalide → 400');
	// la synchro relit l'état réel chez Stripe avant d'écrire (source de vérité)
	assert.match(webhook, /subscriptions\.retrieve|stripe\.subscriptions\.retrieve/);
	// grâce de 24 h posée à l'échec, effacée au paiement
	assert.match(webhook, /GRACE_PERIOD_MS/);
});

test('syncFromStripe : mutation Convex protégée par secret partagé', () => {
	const billingSrc = src('./src/convex/billing.ts');
	assert.match(billingSrc, /CONVEX_BILLING_WEBHOOK_SECRET/);
	// aucun appel sans secret : toutes les fonctions webhook exigent webhookSecret
	assert.match(billingSrc, /webhookSecret: v\.string\(\)/);
});

/* ═══════════════ COHÉRENCE PRIX / CONFIG ═══════════════ */

test('prix mission : 15,90 € / mois et 129 € / an', () => {
	assert.equal(billing.AUTONOMY_MONTHLY_PRICE_EUR, 15.9);
	assert.equal(billing.AUTONOMY_YEARLY_PRICE_EUR, 129);
	assert.equal(billing.GRACE_PERIOD_MS, 24 * 3600 * 1000, 'grâce = 24 HEURES exactes');
});

test('fail-closed : sans config Stripe, le BFF répond 503 et la page reste honnête', () => {
	const stripe = src('./src/lib/server/stripe.ts');
	assert.match(stripe, /BillingUnavailableError/);
	assert.match(stripe, /billingConfigured/);
	const checkout = src('./src/routes/api/billing/checkout/+server.ts');
	// deux verrous fail-closed : priceId absent → 503 sans appel Stripe,
	// et getStripe() indisponible → BillingUnavailableError → 503.
	assert.match(checkout, /status: 503/);
	assert.match(checkout, /BillingUnavailableError/);
});

/* ═══════════════ UX PWA / STRIPE (UX V1 — analyse statique) ═══════════════ */

test('UX · Checkout/Portal redirigent vers la page de retour G-FLUX', () => {
	const checkout = src('./src/routes/api/billing/checkout/+server.ts');
	assert.match(checkout, /success_url: `\$\{origin\}\/facturation\/retour\?checkout=success`/);
	// annulation : retour neutre sur le paywall, sans message de succès
	assert.match(checkout, /cancel_url: `\$\{origin\}\/espace\/facturation\?checkout=cancel`/);
	const portal = src('./src/routes/api/billing/portal/+server.ts');
	assert.match(portal, /return_url: `\$\{origin\}\/facturation\/retour`/);
});

test('UX · page de retour : état réel seulement, jamais « validé » sur la foi de l\'URL', () => {
	const server = src('./src/routes/facturation/retour/+page.server.ts');
	// la page lit l'état DÉRIVÉ de la base (webhook = source de vérité)
	assert.match(server, /api\.billing\.accessState/);
	assert.match(server, /requireRole\(event,\s*'client'/);
	// coaching → pas de page facturation (même décision que /espace/facturation)
	assert.match(server, /redirect\(303, '\/espace'\)/);
	const svelte = src('./src/routes/facturation/retour/+page.svelte');
	// textes produit demandés
	assert.match(svelte, /Tout est à jour/);
	assert.match(svelte, /Ton abonnement G-FLUX a bien été mis à jour\./);
	assert.match(svelte, /Tu peux maintenant revenir dans l'application\./);
	assert.match(svelte, /Retourner à G-FLUX/);
	assert.match(svelte, /Si l'application ne s'ouvre pas automatiquement, ferme cette page et reviens à G-FLUX\./);
	// l'état « confirmé » vient de la base (complimentary OU abonnement actif /
	// période payée), jamais d'un simple paramètre d'URL
	assert.match(svelte, /b\.decision !== 'block'/);
	assert.match(svelte, /b\.billingAccessOverride === 'complimentary'/);
	// cas non confirmé : message HONNÊTE (pas de « paiement validé » hors état réel)
	assert.match(svelte, /en cours de confirmation/);
});

test('UX · ouverture Stripe : tentative externe en PWA + fallback même contexte (web classique direct)', () => {
	const refresh = src('./src/lib/billingRefresh.ts');
	// V3 (bug iPhone réel PR #15) : web → même contexte d'abord (historique) ;
	// PWA → window.open DIRECT avec l'URL Stripe, fallback location.assign si
	// refusée ou fenêtre fantôme — JAMAIS de about:blank ni de WindowProxy navigué.
	assert.match(refresh, /if \(!isStandalone\(\)\)/);
	assert.match(refresh, /window\.open\(url, '_blank'\)/);
	assert.match(refresh, /window\.location\.assign\(url\)/);
	assert.doesNotMatch(refresh, /window\.open\('', '_blank'\)/);
	assert.doesNotMatch(refresh, /win\.location\.href\s*=/);
	// les deux pages billing passent par le helper (plus aucun href direct sur l'URL Stripe)
	const facturation = src('./src/routes/espace/facturation/+page.svelte');
	assert.match(facturation, /openStripeUrl\(json\.url\)/);
	assert.doesNotMatch(facturation, /window\.location\.href = json\.url/);
	const parametres = src('./src/routes/espace/parametres/+page.svelte');
	assert.match(parametres, /openStripeUrl\(json\.url\)/);
});

test('UX · revalidation entitlement au retour de focus (sans polling)', () => {
	const refresh = src('./src/lib/billingRefresh.ts');
	// visibilitychange + pageshow(persisted) + focus, anti-rafale, AUCUN timer
	assert.match(refresh, /visibilitychange/);
	assert.match(refresh, /pageshow/);
	assert.match(refresh, /e\.persisted/);
	assert.match(refresh, /invalidateAll/);
	// aucun mécanisme de POLLING : aucune répétition programmée (les seuls
	// timers du module sont des ONE-SHOT du flow d'ouverture Stripe : filet
	// anti fenêtre fantôme — pas du polling d'entitlement)
	assert.doesNotMatch(refresh, /setInterval\(/);
	// branchée sur les trois surfaces concernées
	const facturation = src('./src/routes/espace/facturation/+page.svelte');
	assert.match(facturation, /startBillingFocusRevalidate\(/);
	const parametres = src('./src/routes/espace/parametres/+page.svelte');
	assert.match(parametres, /startBillingFocusRevalidate\(\)/);
	const retour = src('./src/routes/facturation/retour/+page.svelte');
	assert.match(retour, /startBillingFocusRevalidate\(\)/);
});

test('UX · bandeau retour Checkout state-aware (jamais de succès déduit de l\'URL)', () => {
	const facturation = src('./src/routes/espace/facturation/+page.svelte');
	// tant que l'entitlement n'est pas confirmé serveur → message d'attente honnête
	assert.match(facturation, /Vérification de ton abonnement…/);
	assert.match(facturation, /Cette page se met à jour automatiquement\./);
	// dès que l'entitlement est actif (webhook → base) → confirmation + CTA
	assert.match(facturation, /C'est bon, ton abonnement est actif/);
	assert.match(facturation, /Tu peux maintenant profiter de G-FLUX\./);
	assert.match(facturation, /Retour à G-FLUX/);
	// l'état vient de la base (même définition que la page de retour), pas de l'URL
	assert.match(facturation, /b\.decision !== 'block'/);
	assert.match(facturation, /b\.billingAccessOverride === 'complimentary'/);
	// l'ancien message naïf a disparu
	assert.doesNotMatch(facturation, /Merci ! Ton paiement est en cours de confirmation/);
});

test('UX · paywall premium : fond statique sans données, modale centrée offres 15,90 / 129 €', () => {
	const facturation = src('./src/routes/espace/facturation/+page.svelte');
	// fond = shell G-FLUX ÉVOQUÉ (dashboard, calories/macros, Journal, Progression,
	// navigation basse) avec placeholders FICTIFS (aucun fetch, aucune donnée protégée)
	assert.match(facturation, /paywall-backdrop/);
	assert.match(facturation, /pb-shell/);
	assert.match(facturation, /pb-header/);
	assert.match(facturation, /pb-nav/);
	assert.match(facturation, /pb-ring/);
	assert.match(facturation, /pb-bar/);
	assert.match(facturation, /pb-sk/);
	assert.doesNotMatch(facturation, /aria-hidden="true"[\s\S]{0,6000}fetch\(/);
	// modale CENTRÉE : largeur ~91 %, max-height ~87vh, scroll interne, safe areas
	assert.match(facturation, /paywall-modal/);
	assert.match(facturation, /width: 91%/);
	assert.match(facturation, /max-height: 87vh/);
	assert.match(facturation, /overflow-y: auto/);
	assert.match(facturation, /safe-area-inset/);
	// copy premium : continuité, jamais culpabilisante — eyebrow + titre + sous-texte
	assert.match(facturation, /TON ACCÈS G-FLUX/);
	assert.match(facturation, /Retrouve ton accès à G-FLUX/);
	assert.match(facturation, /Ton historique, ton Journal, ta progression et tous tes outils sont toujours là\./);
	assert.match(facturation, /Reprends exactement là où tu t'es arrêté\(e\)\./);
	// CTA principal + ligne de réassurance (l'ancien CTA a disparu)
	assert.match(facturation, /Réactiver mon accès/);
	assert.doesNotMatch(facturation, /Continuer avec G-FLUX/);
	assert.match(facturation, /Paiement sécurisé par Stripe · Tes données restent conservées\./);
	// wording proscrit : aucun message « bloqué / paiement requis / débloque »
	assert.doesNotMatch(facturation, /accès bloqué|paiement requis|débloque/i);
	// offres : badge 32 %, mensuel « Sans engagement », déconnexion secondaire
	assert.match(facturation, /paywall-overlay/);
	assert.match(facturation, /Économise 32 %/);
	assert.match(facturation, /129 € <span class="text-sm font-bold text-mist">\/ an<\/span>/);
	assert.match(facturation, /15,90 € <span class="text-sm font-bold text-mist">\/ mois<\/span>/);
	assert.match(facturation, /Sans engagement/);
	assert.match(facturation, /action="\?\/logout"/);
	// verrou serveur STRICTEMENT inchangé (garde central + garde page)
	const layout = src('./src/routes/espace/+layout.server.ts');
	assert.match(layout, /requireClientAccess/);
	assert.match(layout, /BILLING_OPEN_PATHS = \['\/espace\/facturation', '\/facturation\/retour'\]/);
	const page = src('./src/routes/espace/facturation/+page.server.ts');
	assert.match(page, /requireRole\(event,\s*'client'/);
	assert.match(page, /api\.billing\.accessState/);
});

test('UX · la page de retour reste joignable à une cliente bloquée (hors /espace)', () => {
	// route racine = pas soumise au layout /espace ; le lock l'ajoute
	// explicitement à ses chemins ouverts (matching exact) — le verrou ne
	// s'élargit PAS à /espace/facturation/* pour autant.
	const layout = src('./src/routes/espace/+layout.server.ts');
	assert.match(layout, /'\/facturation\/retour'/);
	// une page de confirmation n'est pas une surface de sortie de session :
	// la déconnexion reste sur facturation/parametres (décision V1 inchangée)
	const retour = src('./src/routes/facturation/retour/+page.server.ts');
	assert.doesNotMatch(retour, /export const actions/);
});
