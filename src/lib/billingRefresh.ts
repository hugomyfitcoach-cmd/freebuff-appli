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
import { createStripeWindowController, type StripeWindowLike } from './stripeWindowController';

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

/* ═════════ OUVERTURE DE STRIPE DEPUIS LA PWA ═════════ */

/**
 * Stripe doit s'ouvrir dans le NAVIGATEUR EXTERNE quand G-FLUX tourne comme
 * app installée (PWA) :
 * - iOS : `window.open(url, '_blank')` depuis la webview WKWebView sort
 *   automatiquement dans Safari — l'app reste ouverte derrière, et le retour
 *   se fait par le swipe d'app (sans fermer G-FLUX) ;
 * - Android : l'onglet Custom Tab / navigateur s'ouvre au-dessus de l'app,
 *   même bénéfice.
 * En navigateur classique (desktop, mobile web) : même contexte, navigation
 * identique au comportement historique — rien ne change.
 */
export function openStripeUrl(url: string): void {
	if (typeof window === 'undefined') return;
	if (isStandalone()) {
		window.open(url, '_blank');
		return;
	}
	window.location.href = url;
}

/* ── Ouverture robuste iOS/PWA : open blank MAINTENANT, redirect ensuite ── */

/** Handle d'une fenêtre externe pré-ouverte depuis le user gesture. */
export type StripeExternalWindow = {
	/** Redirige la fenêtre pré-ouverte vers l'URL Stripe (false = échec). */
	complete(url: string): boolean;
	/** Ferme la fenêtre vide éventuelle et neutralise le handle (idempotent). */
	abort(): void;
};

/**
 * BUG PRODUCTION iPHONE (corrigé) : l'ancien flow appelait `openStripeUrl`
 * APRÈS le `await fetch` de création de session — l'activation transitoire du
 * user gesture avait expiré, Safari/iOS bloquait `window.open` comme popup et
 * Stripe ne s'ouvrait jamais (bouton resté sur « Redirection… »).
 *
 * Correctif (pattern « open blank now, redirect later ») : en PWA standalone,
 * la fenêtre externe VIDE est ouverte ICI, de façon SYNCHRONIQUE — appelant
 * direct du user gesture, activation Safari intacte — puis redirigée vers
 * l'URL Checkout quand la session est créée (`complete`), ou refermée en cas
 * d'échec (`abort`) : jamais d'ouverture bloquée, jamais d'onglet blanc
 * définitif (filet de sécurité 20 s côté contrôleur).
 *
 * En navigateur classique (desktop, web mobile) : retourne null — l'URL
 * Stripe est suivie dans le MÊME contexte après la réponse (navigation
 * top-level, jamais bloquée par le popup blocker), comportement historique
 * inchangé et comportement PWA déjà validé préservé.
 */
export function beginStripeExternalWindow(): StripeExternalWindow | null {
	if (typeof window === 'undefined') return null;
	if (!isStandalone()) return null;
	let win: Window | null = null;
	try {
		win = window.open('', '_blank');
	} catch {
		win = null; // ouverture refusée → la page affichera une erreur propre
	}
	const controller = createStripeWindowController(win as StripeWindowLike | null, (fn, ms) => {
		// Filet ONE-SHOT (jamais du polling) : referme la fenêtre si l'URL
		// Stripe ne finit pas par arriver.
		const t = setTimeout(fn, ms);
		return () => clearTimeout(t);
	});
	return {
		complete: (url) => controller.complete(url),
		abort: () => controller.abort(),
	};
}
