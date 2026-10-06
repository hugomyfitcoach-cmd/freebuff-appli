import Stripe from 'stripe';
import { env } from '$env/dynamic/private';

/**
 * FACTURATION AUTONOMIE — couche Stripe SERVEUR (BFF), MODE TEST UNIQUEMENT.
 *
 * RÈGLES ABSOLUES (mission §14/§15) :
 * - AUCUNE clé secrète n'est jamais exposée au navigateur (pas de PUBLIC_).
 * - FAIL-CLOSED : sans configuration Stripe TEST complète, les routes
 *   checkout/portal/webhook renvoient une erreur propre (503) — JAMAIS de
 *   fallback, et surtout JAMAIS de repli vers du LIVE.
 * - Garde anti-LIVE explicite : toute clé `sk_live_` / `rk_live_` est refusée
 *   par le garde-fou ci-dessous, même si quelqu'un la collait un jour dans
 *   une variable d'environnement preview.
 * - Le navigateur n'envoie JAMAIS un priceId libre : il envoie `plan`
 *   ("monthly" | "yearly") et le serveur mappe vers SES variables d'env.
 *
 * Variables attendues (Netlify deploy preview / .env.local dev — TEST uniquement) :
 *   STRIPE_SECRET_KEY              → sk_test_…
 *   STRIPE_WEBHOOK_SECRET          → whsec_… (endpoint Netlify preview)
 *   STRIPE_PRICE_AUTONOMY_MONTHLY  → price_… (15,90 € / mois)
 *   STRIPE_PRICE_AUTONOMY_YEARLY   → price_… (129 € / an)
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

function secretKey(): string | null {
	const key = env.STRIPE_SECRET_KEY?.trim() || null;
	if (!key) return null;
	// Garde anti-LIVE (mission §15) : on refuse explicitement toute clé live —
	// la mission interdit sk_live_ ; rk_live_ est la variante « restricted ».
	if (/^(sk|rk)_live_/.test(key)) {
		throw new BillingUnavailableError(
			'stripe_live_key_forbidden',
			'Une clé Stripe LIVE est interdite sur cet environnement.'
		);
	}
	// Sans être strictement exigée, une clé test évidente est la seule voie
	// officielle ; tout autre préfixe serait un mystère → on refuse.
	if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) {
		throw new BillingUnavailableError('stripe_key_invalid', 'Clé Stripe non reconnue (sk_test_ attendu).');
	}
	return key;
}

/** Client Stripe configuré — ou erreur propre si l'environnement n'est pas prêt. */
export function getStripe(): Stripe {
	const key = secretKey();
	if (!key) {
		throw new BillingUnavailableError('stripe_not_configured', 'Stripe TEST n\u2019est pas configuré sur cet environnement.');
	}
	return new Stripe(key, {
		// Version d'API livrée avec le SDK (épinglée par le lockfile) —
		// comportement Checkout/webhooks stable tant que la dépendance ne bouge pas.
		apiVersion: Stripe.API_VERSION,
		appInfo: { name: 'G-FLUX Autonomie', version: 'v1' },
	});
}

/** Stripe TEST est-il utilisable ici ? (affichage conditionnel côté UI.) */
export function billingConfigured(): boolean {
	try {
		return secretKey() !== null;
	} catch {
		return false;
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

/** Secret de signature webhook — requis pour traiter le moindre événement. */
export function webhookSecret(): string | null {
	const wh = env.STRIPE_WEBHOOK_SECRET?.trim() || null;
	if (!wh) return null;
	// Même logique fail-closed : un secret LIVE n'a rien à faire ici.
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
