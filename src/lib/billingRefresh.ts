/**
 * REVALIDATION DE L'ENTITLEMENT FACTURATION AU RETOUR DE FOCUS — V1 UX.
 *
 * Parcours : la cliente part chez Stripe (Checkout ou Customer Portal), puis
 * revient dans G-FLUX. Pendant son absence, le webhook Stripe a pu écrire la
 * décision DÉRIVÉE côté base — la page affichée peut donc être périmée
 * (paywall affiché alors que l'abonnement est actif, ou l'inverse).
 *
 * Règle produit : au retour de focus, on revalide AUTOMATIQUEMENT l'état
 * côté serveur (invalidateAll → re-run des load functions SvelteKit →
 * re-lecture de la base via accessState/resolveSession). Si l'accès est
 * confirmé, la page courante se déverrouille d'elle-même (le load d'une page
 * verrouillée re-exécute aussi le garde serveur requireClientAccess, qui
 * laisse passer) — aucun refresh manuel, aucun redémarrage de PWA.
 *
 * Garde-fous :
 * - AUCUN polling : on n'écoute QUE le vrai retour de l'utilisatrice
 *   (visibilitychange/pageshow/focus), jamais un timer.
 * - Anti-rafale : au moins 1 500 ms entre deux revalidations (le focus et le
 *   pageshow de la même reprise arrivent souvent ensemble).
 * - Ignoré pendant une navigation SvelteKit en cours.
 * - Le refresh visible de la version (bandeau « nouvelle version », swUpdate)
 *   n'est PAS touché : cette revalidation ne re-fetch que les données.
 *
 * Utilisé par : /espace/facturation, /espace/parametres et /facturation/retour.
 */

import { invalidateAll } from '$app/navigation';
import { navigating } from '$app/state';
import { isStandalone } from './pwa';
import { shouldFallbackToSameContext, STRIPE_GHOST_WINDOW_GRACE_MS } from './stripeOpenFallback';

/** Revalide une seule fois les données de la page (et du layout). */
export async function revalidateBilling(): Promise<void> {
	await invalidateAll();
}

/**
 * Branche les écouteurs de retour de focus. Retourne la fonction de nettoyage
 * (à renvoyer depuis un $effect).
 *
 * Écoute (dans cet ordre de déclenchement habituel à la reprise) :
 * - `pageshow` avec `event.persisted` (restauration depuis le cache historique
 *   — cas classique du retour depuis Stripe sur iOS) ;
 * - `visibilitychange` → visible (retour depuis un onglet/une app externe) ;
 * - `focus` (filet pour les plateformes qui ne tirent ni l'un ni l'autre).
 */
export function onBillingFocusReturn(handler: () => void): () => void {
	if (typeof window === 'undefined') return () => {};

	let last = 0;
	const fire = () => {
		const now = Date.now();
		if (now - last < 1500) return; // anti-rafale : un seul passage par reprise
		last = now;
		handler();
	};

	const onVisible = () => {
		if (document.visibilityState === 'visible') fire();
	};
	const onPageShow = (e: PageTransitionEvent) => {
		// persisted = page restaurée du cache (back/forward) : reprendre la main
		if (e.persisted) fire();
	};

	window.addEventListener('pageshow', onPageShow);
	document.addEventListener('visibilitychange', onVisible);
	window.addEventListener('focus', fire);
	return () => {
		window.removeEventListener('pageshow', onPageShow);
		document.removeEventListener('visibilitychange', onVisible);
		window.removeEventListener('focus', fire);
	};
}

/**
 * Compose les deux briques : branche les écouteurs de focus ET revalide à
 * chaque reprise — sauf pendant une navigation SvelteKit en cours (les load
 * functions tournent déjà). Aucun appel au montage : la donnée vient d'être
 * servie côté serveur, la revalider aussitôt n'apporterait rien.
 *
 * `onReturn` (optionnel) est exécuté AVANT la revalidation : la page
 * facturation s'en sert pour remettre à zéro l'état UI du checkout au retour
 * dans G-FLUX. Ordre imposé au retour : 1) reset état redirection →
 * 2) revalidation entitlement → 3) déblocage si le webhook a confirmé.
 */
export function startBillingFocusRevalidate(onReturn?: () => void): () => void {
	return onBillingFocusReturn(() => {
		// navigation en cours → les load functions s'exécutent déjà, on s'abstient
		if (navigating?.to) return;
		onReturn?.();
		void revalidateBilling();
	});
}

/* ═════════ OUVERTURE DE STRIPE — FIABLE iOS / PWA ═════════ */

/**
 * Ouvre l'URL Stripe de façon FIABLE sur toutes les surfaces (iOS inclus).
 *
 * Historique production (PR #15) :
 * - V1 : `window.open(url)` appelé APRÈS le await fetch → activation
 *   transitoire expirée sur iOS → popup bloquée, rien ne s'ouvrait ;
 * - V2 (abandonnée) : « open blank now, redirect later » — ouverture d'un
 *   about:blank synchrone puis navigation du WindowProxy. INVALIDÉE sur
 *   iPhone réel : en PWA standalone, un about:blank ne présente pas de
 *   fenêtre (proxy fantôme ou null) et naviguer le proxy ne rend rien à
 *   l'écran ;
 * - V3 (courante) : tentative d'ouverture DIRECTE de l'URL Stripe via
 *   `window.open(url, '_blank')` — le seul appel qui déclenche le handoff
 *   Safari / la vue interne en app installée — puis FIABILISATION :
 *
 *   1. proxy null (popup refusée — très fréquent après un await sur iOS)
 *      → navigation IMMÉDIATE du même contexte (`location.assign`) : une
 *      navigation top-level n'est jamais bloquée ; Stripe s'ouvre dans la
 *      PWA même (webview) ou l'onglet courant, et le retour success/cancel
 *      recharge l'app — jamais d'utilisatrice bloquée ;
 *   2. proxy non-null mais « fenêtre fantôme » (rien ne s'est affiché : l'app
 *      n'a JAMAIS été masquée pendant le délai de grâce) → one-shot 2,5 s
 *      (PWA uniquement) → close() du proxy + assign du même contexte
 *      (décision pure : stripeOpenFallback.shouldFallbackToSameContext).
 *
 * Web classique (desktop, web mobile) : navigation du même contexte
 * directement — comportement historique, fiable, jamais popup-blocked.
 *
 * Le loading du bouton n'est JAMAIS lié à cette fonction : la page le reset
 * dans un finally, et le reset au retour (startBillingFocusRevalidate)
 * garantit un bouton réutilisable même si un fallback part en différé.
 */
export function openStripeUrl(url: string): void {
	if (typeof window === 'undefined') return;

	// 1) Web classique : même contexte (navigation top-level, jamais bloquée).
	if (!isStandalone()) {
		window.location.assign(url);
		return;
	}

	// 2) PWA standalone : tentative d'ouverture externe DIRECTE avec l'URL
	//    Stripe (jamais de about:blank — non présenté en standalone iOS).
	let opened: Window | null = null;
	try {
		opened = window.open(url, '_blank');
	} catch {
		opened = null;
	}
	if (!opened) {
		// Ouverture refusée → même contexte, fiable partout.
		window.location.assign(url);
		return;
	}

	// 3) Filet anti fenêtre fantôme (PWA uniquement — sur desktop une ouverture
	//    réussie laisse la page visible, le filet ne doit jamais s'y déclencher).
	const win = opened;
	let appWasHiddenSinceOpen = false;
	const onHidden = () => {
		if (document.visibilityState === 'hidden') appWasHiddenSinceOpen = true;
	};
	document.addEventListener('visibilitychange', onHidden);
	// One-SHOT (jamais du polling) : décision à l'échéance, puis nettoyage.
	setTimeout(() => {
		document.removeEventListener('visibilitychange', onHidden);
		const ghost = shouldFallbackToSameContext({
			proxyOpened: true,
			proxyClosed: win.closed,
			appWasHiddenSinceOpen,
			appCurrentlyVisible: document.visibilityState === 'visible',
		});
		if (!ghost) return;
		try {
			win.close();
		} catch {
			/* proxy déjà indisponible : aucun impact */
		}
		// Rien ne s'est ouvert visuellement → même contexte, fiable partout.
		window.location.assign(url);
	}, STRIPE_GHOST_WINDOW_GRACE_MS);
}
