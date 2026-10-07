/**
 * FILET ANTI « FENÊTRE FANTÔME » STRIPE — logique PURE, testable sans DOM.
 *
 * Contexte (bug production iPhone réel, PR #15) : en PWA iOS standalone,
 * `window.open(url, '_blank')` peut renvoyer un WindowProxy NON-NULL alors
 * qu'AUCUNE fenêtre ne s'affiche réellement (le contexte standalone ne
 * présente pas de fenêtre secondaire pour ce open, ou la popup est avalée
 * silencieusement). Le proxy est alors une fenêtre fantôme : l'utilisatrice
 * reste sur le paywall et Stripe ne s'ouvre jamais.
 *
 * Signal de détection FIABLE en app installée : une ouverture réellement
 * réussie (Safari externe ou vue interne plein écran) MASQUE la page —
 * `visibilitychange` passe à `hidden`. Si, après un court délai de grâce,
 * l'app n'a JAMAIS été masquée et est toujours visible, la fenêtre est
 * fantôme → on referme le proxy et on navigue le MÊME contexte
 * (`location.assign`) : une navigation top-level n'est jamais bloquée.
 *
 * Le module est sans effet hors app installée : sur desktop, une ouverture
 * réussie (nouvel onglet) laisse la page visible — le filet ne doit jamais
 * s'y déclencher.
 *
 * Déterministe : le host (billingRefresh) fournit l'instant d'échéance —
 * aucun timer ici, décision pure à partir d'un instantané d'état.
 */

/** Délai de grâce avant de déclarer la fenêtre fantôme (one-shot, jamais du polling). */
export const STRIPE_GHOST_WINDOW_GRACE_MS = 2_500;

/** Instantané d'état à l'échéance du filet (host : timers + listeners réels). */
export type StripeGhostWindowSnapshot = {
	/** window.open a renvoyé un proxy non-null (sinon le fallback est déjà fait). */
	proxyOpened: boolean;
	/** proxy.closed à l'échéance (fenêtre refermée par l'utilisatrice ou le système). */
	proxyClosed: boolean;
	/** la page a été masquée au moins une fois depuis la tentative → ouverture réelle. */
	appWasHiddenSinceOpen: boolean;
	/** la page est visible à l'échéance. */
	appCurrentlyVisible: boolean;
};

/**
 * Faut-il abandonner la fenêtre externe et naviguer le même contexte ?
 *
 * - proxy null → le fallback est déjà déclenché par l'appelant (false ici) ;
 * - proxy refermé → rien à faire (false) ;
 * - app masquée depuis le open → la fenêtre s'est réellement ouverte (false) ;
 * - app toujours visible après le délai de grâce → fenêtre fantôme (true).
 */
export function shouldFallbackToSameContext(s: StripeGhostWindowSnapshot): boolean {
	if (!s.proxyOpened) return false;
	if (s.proxyClosed) return false;
	if (s.appWasHiddenSinceOpen) return false;
	return s.appCurrentlyVisible;
}
