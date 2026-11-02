/**
 * MODE PORTRAIT UNIQUEMENT — écran « Tourne ton téléphone » (MISSION PORTRAIT).
 *
 * Constat : iOS ne permet pas de verrouiller l'orientation d'une PWA. En
 * paysage, l'app restait utilisable mais la mise en page du Journal restait
 * « réduite » après le retour en portrait (saisie d'un code-barres à la main
 * puis rotation). Décision produit : l'app n'est PAS utilisable en paysage sur
 * téléphone — une couche plein écran couvre l'app tant que l'appareil est
 * couché.
 *
 * DÉTECTION — volontairement basée sur l'APPAREIL, jamais sur la fenêtre :
 *  1. appareil tactile (maxTouchPoints > 0 ou pointeur grossier) ;
 *  2. petit côté de l'écran (screen, PAS window) < 500 px → téléphone ; iPad,
 *     tablettes et ordinateurs sont exclus (petit côté ≥ 500 px) ;
 *  3. orientation de l'APPAREIL en paysage : `screen.orientation` (angle/type),
 *     sinon `window.orientation`, sinon comparaison screen.width/screen.height.
 *
 * Pourquoi jamais la fenêtre : le clavier Android REDIMENSIONNE la fenêtre
 * (innerHeight/innerWidth) sans rotation. Une détection par la fenêtre
 * afficherait la couche au simple fait d'ouvrir le clavier. Ici, ouvrir le
 * clavier en portrait ne change ni screen.* ni l'orientation → aucune couche.
 *
 * ÉTAT PRÉSERVÉ : la couche est un overlay (aucun démontage, aucune
 * navigation) — journal, saisie en cours et feuille ouverte gardent leur état.
 */

import { rebaseScrollLock, scrollLockCount } from './scrollLock';
import { syncKeyboardOpen } from './keyboardViewport.svelte';

/** Petit côté maximal d'un téléphone (px, écran physique). */
export const PHONE_SHORT_SIDE_MAX = 500;

/** État partagé lu par la couche (une seule source de vérité). */
export const portraitLock = $state<{ active: boolean }>({ active: false });

/** Appareil tactile ? (téléphones, tablettes, écrans tactiles) */
function isTouchDevice(): boolean {
	if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) return true;
	const nav = typeof navigator !== 'undefined' ? navigator : undefined;
	return (nav?.maxTouchPoints ?? 0) > 0;
}

/**
 * Orientation de l'APPAREIL (et non de la fenêtre).
 * `screen.orientation.angle` est la source la plus fiable (iOS 16.4+,
 * Android) ; on retombe sur le type, puis sur `window.orientation`, puis sur
 * la géométrie de l'écran (iOS ancien inverse screen.width/height).
 */
function deviceIsLandscape(): boolean {
	const scr = typeof screen !== 'undefined' ? screen : undefined;
	if (!scr) return false;
	const so = scr.orientation as (ScreenOrientation & { angle?: number; type?: string }) | undefined;
	if (so && typeof so.angle === 'number') return so.angle === 90 || so.angle === 270;
	if (so && typeof so.type === 'string' && so.type) {
		if (so.type.startsWith('landscape')) return true;
		if (so.type.startsWith('portrait')) return false;
	}
	const legacy = (typeof window !== 'undefined' ? (window as unknown as { orientation?: number }).orientation : undefined);
	if (typeof legacy === 'number' && legacy !== 0) return Math.abs(legacy) === 90;
	return (scr.width || 0) > (scr.height || 0);
}

/** Téléphone (petit écran tactile) actuellement tenu en paysage ? */
export function isPhoneLandscape(): boolean {
	if (typeof window === 'undefined' || typeof screen === 'undefined') return false;
	if (!isTouchDevice()) return false;
	const shortSide = Math.min(screen.width || 0, screen.height || 0);
	if (!(shortSide > 0 && shortSide < PHONE_SHORT_SIDE_MAX)) return false;
	return deviceIsLandscape();
}

/** Retire le focus du champ actif : le clavier se referme en paysage. */
function blurActiveField(): void {
	if (typeof document === 'undefined') return;
	const active = document.activeElement as (HTMLElement & { tagName?: string }) | null;
	if (!active || typeof active.blur !== 'function') return;
	const tag = String(active.tagName ?? '').toUpperCase();
	const field = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable === true;
	if (field) active.blur();
}

/**
 * Retour en portrait : on remet la page à zéro comme après une rotation.
 *
 * - verrou de défilement actif (feuille ouverte) : on le ré-affirme et on
 *   ramène le document à zéro (iOS laisse sinon un décalage hérité) ;
 * - hauteurs clavier : référence de mise en page recalculée, mesure invalidée ;
 * - scanner : sa reconstruction existante écoute `orientationchange` /
 *   `resize` et relance la caméra au retour en portrait (voir Journal).
 */
function resetAfterLandscape(): void {
	if (typeof window === 'undefined') return;
	if (scrollLockCount() > 0) {
		rebaseScrollLock();
		window.scrollTo(0, 0);
	}
	/* Recalcul au tick suivant, une fois la nouvelle mise en page stabilisée
	   (même logique que les gestionnaires de rotation existants). */
	syncKeyboardOpen();
	window.requestAnimationFrame?.(() => syncKeyboardOpen());
}

/**
 * Applique l'état courant. Idempotent : ne fait rien si rien ne change, donc
 * peut être appelé à chaque `resize` / `orientationchange` sans effet de bord.
 */
export function refreshPortraitLock(): boolean {
	if (typeof window === 'undefined') return false;
	const next = isPhoneLandscape();
	if (next === portraitLock.active) return next;
	portraitLock.active = next;
	/* Signal DOM de l'état (le Journal y lit la pause caméra sans dépendre
	   d'un import : sa reconstruction relance au retour en portrait). */
	try {
		if (next) document.documentElement?.setAttribute?.('data-portrait-lock', '');
		else document.documentElement?.removeAttribute?.('data-portrait-lock');
	} catch {
		// Aucun DOM exploitable (tests, SSR) : seul l'état partagé compte.
	}
	if (next) {
		/* Paysage téléphone : clavier fermé, aucune perte d'état (overlay). */
		blurActiveField();
	} else {
		resetAfterLandscape();
	}
	return next;
}

let stopListeners: (() => void) | null = null;

/**
 * Branche l'écoute (une seule fois pour toute l'app) ; renvoie le
 * désabonnement. `orientationchange` reste l'événement universel ; `resize`
 * couvre les navigateurs qui ne l'émettent pas (et les bascules sans
 * événement fiable) — la source de vérité reste `screen`, jamais la fenêtre.
 */
export function startPortraitOnlyWatch(): () => void {
	if (typeof window === 'undefined') return () => {};
	if (stopListeners) return stopListeners;

	const onChange = () => refreshPortraitLock();
	const onVisibility = () => {
		if (!document.hidden) refreshPortraitLock();
	};
	window.addEventListener('resize', onChange);
	window.addEventListener('orientationchange', onChange);
	window.addEventListener('pageshow', onChange);
	document.addEventListener('visibilitychange', onVisibility);
	const orientation = screen.orientation as ScreenOrientation | undefined;
	orientation?.addEventListener?.('change', onChange);
	refreshPortraitLock();

	stopListeners = () => {
		window.removeEventListener('resize', onChange);
		window.removeEventListener('orientationchange', onChange);
		window.removeEventListener('pageshow', onChange);
		document.removeEventListener('visibilitychange', onVisibility);
		orientation?.removeEventListener?.('change', onChange);
		stopListeners = null;
	};
	return stopListeners;
}
