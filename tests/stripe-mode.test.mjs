/**
 * Tests MODE STRIPE (TEST vs LIVE) — préparation production (mission §2).
 *
 * Règle : le mode attendu dépend du CONTEXTE SERVEUR RÉEL (Netlify CONTEXT +
 * override STRIPE_EXPECTED_MODE), JAMAIS du navigateur, JAMAIS « test ou live
 * accepté indifféremment » :
 *  - Deploy Preview / hors production → TEST uniquement (sk_live_/rk_live_ refusés) ;
 *  - Production → LIVE uniquement (sk_test_/rk_test_ refusés) ;
 *  - ressources (Price, Événement webhook) : livemode revérifié, fail closed.
 *
 * La logique vit dans src/lib/server/stripeMode.ts (module PUR, sans import
 * SvelteKit) — importée directement ici (node --experimental-strip-types).
 * Aucune clé n'apparaît jamais dans un message d'erreur ni dans un log.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	assertLivemodeForMode,
	assertSecretKeyForMode,
	expectedStripeMode,
	StripeModeError,
} from '../src/lib/server/stripeMode.ts';

/** Lit une source du projet (analyse statique). */
function src(relPath) {
	return readFileSync(new URL('..' + relPath.slice(1), import.meta.url), 'utf8');
}

/* ═══════ Mode attendu selon le contexte serveur ═══════ */

test('mode attendu : Preview/dev → TEST, Production → LIVE (override explicite prioritaire)', () => {
	assert.equal(expectedStripeMode({ context: 'deploy-preview' }), 'test');
	assert.equal(expectedStripeMode({ context: 'branch-deploy' }), 'test');
	assert.equal(expectedStripeMode({ context: 'production' }), 'live');
	// dev local hors Netlify : défaut sûr → TEST (refuse toute clé LIVE)
	assert.equal(expectedStripeMode({}), 'test');
	// override explicite (Netlify Production pose STRIPE_EXPECTED_MODE=live)
	assert.equal(expectedStripeMode({ context: 'production', override: 'test' }), 'test');
	assert.equal(expectedStripeMode({ context: 'deploy-preview', override: 'live' }), 'live');
	assert.equal(expectedStripeMode({ context: 'production', override: '  LIVE  ' }), 'live');
	assert.equal(expectedStripeMode({ context: 'nimporte-quoi' }), 'test');
});

/* ═══════ Les 4 cas requis par la mission ═══════ */

test('Preview + sk_test_ → OK', () => {
	assert.equal(assertSecretKeyForMode('test', 'sk_test_ABC'), 'sk_test_ABC');
});

test('Preview + sk_live_ → REFUS (fail closed)', () => {
	assert.throws(() => assertSecretKeyForMode('test', 'sk_live_ABC'), (e) => {
		assert.ok(e instanceof StripeModeError);
		assert.equal(e.code, 'stripe_live_key_forbidden');
		// JAMAIS la clé dans le message
		assert.ok(!e.message.includes('sk_live_ABC'));
		return true;
	});
});

test('Production + sk_live_ → OK', () => {
	assert.equal(assertSecretKeyForMode('live', 'sk_live_XYZ'), 'sk_live_XYZ');
});

test('Production + sk_test_ → REFUS (fail closed)', () => {
	assert.throws(() => assertSecretKeyForMode('live', 'sk_test_XYZ'), (e) => {
		assert.ok(e instanceof StripeModeError);
		assert.equal(e.code, 'stripe_test_key_forbidden');
		assert.ok(!e.message.includes('sk_test_XYZ'));
		return true;
	});
});

/* ═══════ Variantes rk_ / préfixe inconnu / clé absente / trim ═══════ */

test('variantes restricted (rk_) : mêmes règles strictes que sk_', () => {
	assert.equal(assertSecretKeyForMode('test', 'rk_test_R'), 'rk_test_R');
	assert.throws(() => assertSecretKeyForMode('test', 'rk_live_R'), (e) => e.code === 'stripe_live_key_forbidden');
	assert.equal(assertSecretKeyForMode('live', 'rk_live_R'), 'rk_live_R');
	assert.throws(() => assertSecretKeyForMode('live', 'rk_test_R'), (e) => e.code === 'stripe_test_key_forbidden');
});

test('préfixe inconnu → refus ; clé absente → non configuré (sans exception) ; trim appliqué', () => {
	assert.throws(() => assertSecretKeyForMode('test', 'sk_mystere_X'), (e) => e.code === 'stripe_key_invalid');
	assert.throws(() => assertSecretKeyForMode('live', 'sk_mystere_X'), (e) => e.code === 'stripe_key_invalid');
	assert.equal(assertSecretKeyForMode('test', null), '');
	assert.equal(assertSecretKeyForMode('test', '   '), '');
	assert.equal(assertSecretKeyForMode('live', undefined), '');
	assert.equal(assertSecretKeyForMode('test', '  sk_test_T  '), 'sk_test_T');
});

/* ═══════ Ressources : livemode revérifié (Price LIVE en preview, etc.) ═══════ */

test('ressources : livemode incohérent refusé (fail closed)', () => {
	assert.throws(() => assertLivemodeForMode('test', true, 'Price Stripe'), (e) => e.code === 'stripe_live_resource_forbidden');
	assert.doesNotThrow(() => assertLivemodeForMode('test', false, 'Price Stripe'));
	assert.throws(() => assertLivemodeForMode('live', false, 'Price Stripe'), (e) => e.code === 'stripe_test_resource_forbidden');
	assert.doesNotThrow(() => assertLivemodeForMode('live', true, 'Price Stripe'));
	assert.throws(() => assertLivemodeForMode('test', true, 'Événement Stripe'), (e) => e.code === 'stripe_live_resource_forbidden');
});

/* ═══════ Câblage BFF (analyse statique) ═══════ */

test('câblage : stripe.ts décide via contexte serveur, checkout/webhook revérifient le mode', () => {
	const stripe = src('./src/lib/server/stripe.ts');
	// le mode vient du contexte serveur réel (Netlify CONTEXT) + override env
	assert.match(stripe, /expectedStripeMode/);
	assert.match(stripe, /process\.env\.CONTEXT/);
	assert.match(stripe, /STRIPE_EXPECTED_MODE/);
	assert.match(stripe, /assertSecretKeyForMode/);
	// les préfixes de clés ne vivent QUE dans stripeMode.ts (exécutable) —
	// dans stripe.ts ils n'apparaissent qu'en commentaires de documentation :
	// on exclut les lignes de commentaires de la recherche de hardcode
	assert.doesNotMatch(stripe, /^(?!\s*\*|\/\/).*sk_(test|live)_/m);
	// aucune clé ni valeur secrète loggée
	assert.doesNotMatch(stripe, /console\./);
	// Checkout : le mode du Price est revérifié AVANT création de Session
	const checkout = src('./src/routes/api/billing/checkout/+server.ts');
	assert.match(checkout, /assertPriceMode\(priceId\)/);
	// Webhook : le mode de l'Événement est revérifié après la signature
	const webhook = src('./src/routes/api/billing/webhook/+server.ts');
	assert.match(webhook, /assertEventMode\(stripeEvent\)/);
	// jamais de clé côté navigateur (aucun import public, aucun PUBLIC_)
	assert.doesNotMatch(stripe, /PUBLIC_[A-Z]/);
});
