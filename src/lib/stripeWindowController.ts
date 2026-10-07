/**
 * CONTRÔLEUR DE FENÊTRE EXTERNE STRIPE — logique PURE, testable sans DOM.
 *
 * Pattern « open blank now, redirect later » (correctif bug production iOS) :
 * sur iPhone, `window.open` appelé APRÈS un `await` (réponse réseau de création
 * de session) perd l'activation transitoire du user gesture Safari/iOS et est
 * bloqué comme popup — Stripe ne s'ouvrait jamais, le bouton restait bloqué.
 * On ouvre donc la fenêtre VIDE de façon SYNCHRONIQUE dans la pile d'appels du
 * clic, puis on la redirige vers l'URL Checkout quand la session est créée.
 *
 * Garanties :
 * - `complete(url)` redirige la fenêtre pré-ouverte (permis cross-origin :
 *   c'est une fenêtre que l'on a soi-même ouverte — relation opener) et
 *   retourne false si la fenêtre n'a pas pu être utilisée ;
 * - `abort()` referme la fenêtre vide (échec de création, timeout, retour
 *   dans l'app) — JAMAIS d'onglet blanc définitif ;
 * - filet de sécurité : si `complete()` n'intervient pas sous
 *   STRIPE_WINDOW_SAFETY_TIMEOUT_MS, la fenêtre vide est fermée d'elle-même ;
 * - idempotent : complete/abort après coup sont des no-op sûrs.
 *
 * Le module ne connaît ni `window` ni aucun timer réel : le host
 * (billingRefresh) fournit la fenêtre ouverte et un scheduler injecté —
 * les tests sont déterministes (tests/stripe-checkout-ios.test.mjs).
 */

/** Surface minimale d'une fenêtre ouverte par le host (Window du DOM compatible). */
export type StripeWindowLike = {
	readonly closed: boolean;
	location: { href: string };
	close(): void;
};

export type StripeWindowController = {
	/** Redirige vers l'URL Stripe. false = fenêtre inutilisable (absente/fermée/abort). */
	complete(url: string): boolean;
	/** Ferme la fenêtre vide et neutralise le contrôleur (idempotent). */
	abort(): void;
};

/** Délai max avant fermeture automatique d'une fenêtre externe restée vide. */
export const STRIPE_WINDOW_SAFETY_TIMEOUT_MS = 20_000;

/** Scheduler injecté (setTimeout en production, horloge manuelle en test). */
export type ScheduleTimeout = (fn: () => void, ms: number) => () => void;

export function createStripeWindowController(
	win: StripeWindowLike | null,
	schedule: ScheduleTimeout
): StripeWindowController {
	let done = false;
	let cancelSafety: (() => void) | undefined;
	const clearSafety = () => {
		cancelSafety?.();
		cancelSafety = undefined;
	};

	const controller: StripeWindowController = {
		complete(url: string): boolean {
			if (done) return false;
			done = true;
			clearSafety();
			if (!win || win.closed) return false;
			try {
				// Naviguer une fenêtre qu'on a ouverte soi-même est permis
				// cross-origin (relation opener) — le pattern officiel du secteur.
				win.location.href = url;
				return true;
			} catch {
				return false;
			}
		},
		abort(): void {
			if (done) return;
			done = true;
			clearSafety();
			try {
				win?.close();
			} catch {
				/* fenêtre déjà indisponible : aucun impact */
			}
		},
	};

	if (win) {
		// Filet anti « onglet blanc définitif » : si l'URL Stripe n'arrive jamais
		// (réseau en rade, requête perdue), la fenêtre vide est refermée.
		cancelSafety = schedule(() => controller.abort(), STRIPE_WINDOW_SAFETY_TIMEOUT_MS);
		if (done) cancelSafety(); // déjà neutralisé entre-temps (par sûreté)
	}

	return controller;
}
