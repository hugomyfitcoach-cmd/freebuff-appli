/**
 * MODE STRIPE (TEST vs LIVE) — logique PURE, testable, décidée CÔTÉ SERVEUR.
 *
 * RÈGLE PRODUIT (préparation production) :
 * - Deploy Preview / tout environnement NON production → Stripe TEST uniquement :
 *   clés `sk_live_` / `rk_live_` REFUSÉES, ressources LIVE refusées, fail closed.
 * - Production → Stripe LIVE uniquement : clés `sk_test_` / `rk_test_` REFUSÉES,
 *   ressources TEST refusées, fail closed.
 * - JAMAIS de comportement « test ou live accepté indifféremment ».
 *
 * Le mode attendu vient du CONTEXTE SERVEUR RÉEL — jamais du navigateur :
 * 1. `STRIPE_EXPECTED_MODE` (optionnel, « test » | « live ») — override explicite
 *    posé par l'environnement (ex. Netlify Production : STRIPE_EXPECTED_MODE=live,
 *    filet si CONTEXT manquait) ;
 * 2. sinon `CONTEXT` Netlify : « production » → live, tout le reste → test ;
 * 3. sinon (dev local hors Netlify) → test (défaut sûr : refuse toute clé LIVE).
 *
 * Ce module n'importe RIEN de SvelteKit : il est directement importable par les
 * tests (node --test) et par `src/lib/server/stripe.ts` qui fournit l'env.
 * Aucune valeur de clé n'est jamais loggée ni incluse dans un message d'erreur.
 */

export type StripeMode = 'test' | 'live';

/** Erreur de mode Stripe (préfixe de clé / ressource incohérents) — fail closed. */
export class StripeModeError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = 'StripeModeError';
		this.code = code;
	}
}

/**
 * Mode Stripe attendu pour cet environnement serveur (voir règles ci-dessus).
 * Fonction pure : `context` = CONTEXT Netlify, `override` = STRIPE_EXPECTED_MODE.
 */
export function expectedStripeMode(ctx: { context?: string | null; override?: string | null }): StripeMode {
	const override = ctx.override?.trim().toLowerCase();
	if (override === 'live') return 'live';
	if (override === 'test') return 'test';
	return ctx.context?.trim() === 'production' ? 'live' : 'test';
}

/**
 * Valide une clé secrète Stripe contre le mode attendu — FAIL CLOSED :
 * - clé absente → chaîne vide (l'appelant décide « non configuré » → 503) ;
 * - mode test : `sk_test_` / `rk_test_` exigés, toute clé `*_live_` refusée ;
 * - mode live : `sk_live_` / `rk_live_` exigés, toute clé `*_test_` refusée ;
 * - tout autre préfixe → refus (mystère = jamais fiable).
 * Retourne la clé trimée (JAMAIS loggée, JAMAIS exposée).
 */
export function assertSecretKeyForMode(mode: StripeMode, rawKey: string | null | undefined): string {
	const key = rawKey?.trim() ?? '';
	if (!key) return '';
	const isLive = /^(sk|rk)_live_/.test(key);
	const isTest = /^(sk|rk)_test_/.test(key);
	if (mode === 'live') {
		if (isTest) {
			throw new StripeModeError(
				'stripe_test_key_forbidden',
				'Une clé Stripe TEST est interdite en production (clé LIVE attendue).'
			);
		}
		if (!isLive) {
			throw new StripeModeError('stripe_key_invalid', 'Clé Stripe non reconnue (sk_live_ attendu en production).');
		}
		return key;
	}
	if (isLive) {
		throw new StripeModeError(
			'stripe_live_key_forbidden',
			'Une clé Stripe LIVE est interdite sur cet environnement (clé TEST attendue).'
		);
	}
	if (!isTest) {
		throw new StripeModeError('stripe_key_invalid', 'Clé Stripe non reconnue (sk_test_ attendu).');
	}
	return key;
}

/**
 * Valide le `livemode` d'une ressource Stripe (Price, Event…) contre le mode
 * attendu — « refuser un Price LIVE si détectable » : l'API Stripe expose
 * `livemode` sur chaque objet, on refuse toute incohérence, fail closed.
 * `what` sert uniquement au message (« Price Stripe », « Événement Stripe »…).
 */
export function assertLivemodeForMode(mode: StripeMode, livemode: boolean, what: string): void {
	if (mode === 'live' && livemode !== true) {
		throw new StripeModeError(
			'stripe_test_resource_forbidden',
			`${what} en mode TEST refusé sur un environnement production.`
		);
	}
	if (mode === 'test' && livemode === true) {
		throw new StripeModeError(
			'stripe_live_resource_forbidden',
			`${what} en mode LIVE refusé hors production.`
		);
	}
}
