import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import {
	assertLivemodeForMode,
	assertSecretKeyForMode,
	expectedStripeMode,
	StripeModeError,
	type StripeMode,
} from './stripeMode';

/**
 * FACTURATION AUTONOMIE — couche Stripe SERVEUR (BFF), mode TEST/LIVE explicite.
 *
 * RÈGLES ABSOLUES (mission §14/§15 + préparation production) :
 * - AUCUNE clé secrète n'est jamais exposée au navigateur (pas de PUBLIC_).
 * - FAIL-CLOSED : sans configuration Stripe complète ET COHÉRENTE avec le mode
 *   attendu, les routes checkout/portal/webhook renvoient une erreur propre
 *   (503) — JAMAIS de fallback, JAMAIS un comportement « test ou live accepté
 *   indifféremment ».
 * - MODE STRICT (src/lib/server/stripeMode.ts — logique pure, testée) :
 *   · Deploy Preview / hors production → TEST uniquement : `sk_live_`/`rk_live_`
 *     et toute ressource LIVE sont REFUSÉES ;
 *   · Production (CONTEXT=production ou STRIPE_EXPECTED_MODE=live) → LIVE
 *     uniquement : `sk_test_`/`rk_test_` et toute ressource TEST sont REFUSÉES.
 *   Le navigateur ne décide JAMAIS du mode : la décision vient du contexte
 *   serveur réel (Netlify CONTEXT + override d'environnement).
 * - Le navigateur n'envoie JAMAIS un priceId libre : il envoie `plan`
 *   ("monthly" | "yearly") et le serveur mappe vers SES variables d'env.
 *
 * Variables attendues (mêmes NOMS en Preview et Production, valeurs différentes) :
 *   STRIPE_SECRET_KEY              → sk_test_… (preview) / sk_live_… (production)
 *   STRIPE_WEBHOOK_SECRET          → whsec_… (endpoint du mode correspondant)
 *   STRIPE_PRICE_AUTONOMY_MONTHLY  → price_… (15,90 € / mois, mode du contexte)
 *   STRIPE_PRICE_AUTONOMY_YEARLY   → price_… (129 € / an, mode du contexte)
 *   STRIPE_EXPECTED_MODE           → optionnel ("test"|"live"), override explicite
 * Pas de publishable key : Hosted Checkout n'en a pas besoin.
 */

/** Erreur « Stripe non configuré / indisponible » — jamais une clé LIVE. */
export class BillingUnavailableError extends Error {
	reason: string;
	constructor(reason: string, message?: string) {
		super(message ?? reason);
		this.reason = reason;
	}
}

/** Un priceId Stripe a toujours cette forme (aucune injection possible). */
const PRICE_RE = /^price_[A-Za-z0-9]+$/;

/**
 * Mode Stripe attendu ICI (contexte serveur réel — jamais le navigateur) :
 * Netlify CONTEXT (production → LIVE) ou STRIPE_EXPECTED_MODE explicite.
 */
export function stripeMode(): StripeMode {
	return expectedStripeMode({ context: process.env.CONTEXT ?? null, override: env.STRIPE_EXPECTED_MODE ?? null });
}

function secretKey(): string | null {
	const key = env.STRIPE_SECRET_KEY?.trim() || null;
	if (!key) return null;
	try {
		return assertSecretKeyForMode(stripeMode(), key);
	} catch (e) {
		// Une clé du mauvais mode = configuration incohérente → 503 fail-closed.
		if (e instanceof StripeModeError) throw new BillingUnavailableError(e.code, e.message);
		throw e;
	}
}

/** Client Stripe configuré — ou erreur propre si l'environnement n'est pas prêt. */
export function getStripe(): Stripe {
	const key = secretKey();
	if (!key) {
		throw new BillingUnavailableError('stripe_not_configured', 'Stripe n\u2019est pas configuré sur cet environnement.');
	}
	return new Stripe(key, {
		// Version d'API livrée avec le SDK (épinglée par le lockfile) —
		// comportement Checkout/webhooks stable tant que la dépendance ne bouge pas.
		apiVersion: Stripe.API_VERSION,
		appInfo: { name: 'G-FLUX Autonomie', version: 'v1' },
	});
}

/** Stripe (mode attendu) est-il utilisable ici ? (affichage conditionnel côté UI.) */
export function billingConfigured(): boolean {
	try {
		return secretKey() !== null;
	} catch {
		return false;
	}
}

/**
 * VÉRIFIE le mode d'un Price AVANT tout paiement : l'API Stripe expose
 * `livemode` sur chaque objet — un priceId du MAUVAIS mode (ex. Price LIVE
 * collé en preview, ou Price TEST resté en production) est REFUSÉ, fail
 * closed. Prix introuvable/indéchiffrable → 503 également (fail closed).
 */
export async function assertPriceMode(priceId: string): Promise<void> {
	try {
		const price = await getStripe().prices.retrieve(priceId);
		assertLivemodeForMode(stripeMode(), price.livemode === true, 'Price Stripe');
	} catch (e) {
		if (e instanceof StripeModeError) throw new BillingUnavailableError(e.code, e.message);
		if (e instanceof BillingUnavailableError) throw e;
		throw new BillingUnavailableError('stripe_price_unreachable', 'Offre indisponible pour le moment. Reviens plus tard.');
	}
}

/**
 * VÉRIFIE le mode d'un ÉVÉNEMENT webhook (event.livemode) : un événement du
 * mauvais mode (mauvais endpoint collé) est rejeté, fail closed.
 */
export function assertEventMode(event: { livemode: boolean }): void {
	try {
		assertLivemodeForMode(stripeMode(), event.livemode === true, 'Événement Stripe');
	} catch (e) {
		if (e instanceof StripeModeError) throw new BillingUnavailableError(e.code, e.message);
		throw e;
	}
}

/** Map plan → priceId STRICTEMENT depuis les variables serveur. */
export function priceIdForPlan(plan: 'monthly' | 'yearly'): string | null {
	const id = (plan === 'monthly' ? env.STRIPE_PRICE_AUTONOMY_MONTHLY : env.STRIPE_PRICE_AUTONOMY_YEARLY)?.trim();
	if (!id || !PRICE_RE.test(id)) return null;
	return id;
}

/** priceId → plan (affichage « 15,90 €/mois » vs « 129 €/an » côté cliente). */
export function planForPriceId(priceId: string | null | undefined): 'monthly' | 'yearly' | null {
	if (!priceId) return null;
	const monthly = env.STRIPE_PRICE_AUTONOMY_MONTHLY?.trim();
	const yearly = env.STRIPE_PRICE_AUTONOMY_YEARLY?.trim();
	if (monthly && priceId === monthly) return 'monthly';
	if (yearly && priceId === yearly) return 'yearly';
	return null;
}

/** Secret de signature webhook — requis pour traiter le moindre événement.
 *  Le préfixe whsec_ est identique dans les deux modes : c'est la SIGNATURE
 *  (constructEventAsync) qui fait foi, et le mode de l'événement est ensuite
 *  revérifié par assertEventMode (fail closed). */
export function webhookSecret(): string | null {
	const wh = env.STRIPE_WEBHOOK_SECRET?.trim() || null;
	if (!wh) return null;
	if (wh.startsWith('whsec_') === false) return null;
	return wh;
}

/**
 * Secret partagé Convex ↔ BFF (CONVEX_BILLING_WEBHOOK_SECRET) : protège les
 * fonctions Convex de synchro webhook contre tout appelant non autorisé.
 * Il DOIT être identique côté Convex (`npx convex env set --preview`) et côté
 * BFF (variable Netlify / .env.local) — sans lui, la synchro est impossible
 * (fail-closed, aucune écriture d'état Stripe).
 */
export function convexBillingSecret(): string | null {
	return env.CONVEX_BILLING_WEBHOOK_SECRET?.trim() || null;
}

/** Variante « configuré ? » pour l'affichage UI (jamais la valeur). */
export function webhookSecretConfigured(): boolean {
	return webhookSecret() !== null;
}
