/**
 * ÉTAT PARTAGÉ « CLAVIER OUVERT » (Mission NAV-FIX).
 *
 * Constat (production, iPhone) : après des manipulations dans « Ajouter un
 * aliment » (recherche, scan code-barres, fiche aliment, fermetures), la barre
 * de navigation du bas ET le bouton flottant « + » disparaissaient, Journal
 * affiché normalement — seule la réouverture de l'app les rendait.
 *
 * Cause : la barre (AppShell) et le « + » (Journal) cachaient leur UI sur DEUX
 * booléens `keyboardOpen` locaux, chacun déduit d'un RÉTRÉCISSEMENT du
 * `visualViewport` (`innerHeight - vv.height > ~140 px`). iOS garde parfois
 * cette métrique AMPUTÉE après la fermeture d'un volet (l'input focalisé est
 * retiré du DOM avant la fin du repli du clavier) et n'émet alors AUCUN
 * `resize` : les deux booléens restaient à `true` pour toujours.
 *
 * Correctif : UNE seule source de vérité (`keyboard.open`), alimentée par une
 * mesure en direct (champ éditable focalisé, sinon viewport rétréci) et par un
 * garde-fou (`settleNavVisibility`) appelé à chaque navigation, à chaque retour
 * au premier plan, à la fermeture d'un volet et à son démontage : sans volet
 * réellement ouvert, une mesure restée figée après stabilisation est ignorée,
 * et tout verrou de défilement restant est libéré.
 *
 * Aucune modification visuelle : mêmes seuils, même rendu, mêmes transitions.
 */
import { resetScrollLock, scrollLockCount } from './scrollLock';

/** Écart minimal (px) entre la fenêtre et le viewport visible = clavier. */
const KEYBOARD_SHRINK_PX = 140;
/** Laisser au clavier iOS le temps de se replier avant d'ignorer une mesure figée. */
const KEYBOARD_SETTLE_MS = 1000;
let viewportStale = false;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

/** UNE SEULE source de vérité, lue par AppShell ET par le Journal. */
export const keyboard = $state<{ open: boolean }>({ open: false });

/** Champ de saisie réellement éditable (mêmes règles que l'historique AppShell). */
export function isEditableElement(active: Element | null): boolean {
	if (active instanceof HTMLInputElement) {
		return (
			!active.disabled &&
			!active.readOnly &&
			!['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'hidden'].includes(active.type)
		);
	}
	return (
		active instanceof HTMLTextAreaElement ||
		active instanceof HTMLSelectElement ||
		(active instanceof HTMLElement && active.isContentEditable)
	);
}

/** Le viewport visible est-il amputé de la hauteur d'un clavier ? */
function viewportShrunk(): boolean {
	if (typeof window === 'undefined') return false;
	const vv = window.visualViewport;
	if (!vv) return false;
	return window.innerHeight - vv.height > KEYBOARD_SHRINK_PX;
}

/**
 * Le clavier vient de se refermer complètement : force WebKit iOS à
 * réconcilier le layout viewport des éléments `position: fixed` (bottom: 0)
 * — sinon la barre et le « + » restent ancrés au-dessus de l'ancien clavier.
 */
function nudgeWebKitLayout(): void {
	window.requestAnimationFrame(() => {
		window.scrollTo(window.scrollX, window.scrollY);
	});
}

/**
 * Applique l'état courant du clavier.
 *
 * Un viewport rétréci reste pris en compte pendant le repli du clavier, même
 * après disparition du champ focalisé. Seule une mesure restée figée après le
 * délai de stabilisation peut être ignorée.
 */
export function syncKeyboardOpen(options: { trustViewport?: boolean } = {}): boolean {
	if (typeof document === 'undefined') return false;
	const trustViewport = options.trustViewport ?? true;
	const focused = isEditableElement(document.activeElement);
	const shrunk = viewportShrunk();
	if (focused || !shrunk) viewportStale = false;
	const next = focused || (trustViewport && !viewportStale && shrunk);
	const wasOpen = keyboard.open;
	keyboard.open = next;
	if (wasOpen && !next) nudgeWebKitLayout();
	return next;
}

/* ————— Registre des volets (source unique « un volet est-il ouvert ? ») ————— */

const sheetOwners = new Set<() => boolean>();

/** Déclare un volet ; renvoie la fonction de désinscription (démontage). */
export function registerSheetOwner(isOpen: () => boolean): () => void {
	sheetOwners.add(isOpen);
	return () => {
		sheetOwners.delete(isOpen);
	};
}

/** Au moins un volet est-il RÉELLEMENT ouvert (état métier, pas un restant) ? */
export function anySheetOpen(): boolean {
	for (const isOpen of sheetOwners) {
		try {
			if (isOpen()) return true;
		} catch {
			// un volet démonté ne doit jamais bloquer la navigation
		}
	}
	return false;
}

/* ————— Garde-fou : la navigation revient toujours, sans volet ouvert ————— */

export type NavSettleReason = 'navigate' | 'visible' | 'sheet-closed' | 'unmount';

/**
 * GARDE-FOU UNIQUE. Appelé à chaque navigation (`afterNavigate`), à chaque
 * retour de l'app au premier plan (`visibilitychange`/`pageshow`), à chaque
 * fermeture de volet et au démontage : si aucun volet n'est réellement ouvert,
 * le clavier résiduel n'est plus cru, la barre et le « + » sont réaffichés et
 * tout verrou de défilement orphelin est libéré.
 *//** Verrou restant sans volet pour le porter (fermeture avortée pendant un
 *  chargement, retour arrière iOS…) : le document doit redevenir défilable.
 *  Jamais pendant le fondu de sortie d'un volet : le Journal restaure lui-même
 *  la position à la fin de l'animation (sinon WebKit réancre les couches fixes
 *  au milieu du fondu — clignotement). */
function releaseOrphanLock(): void {
	if (anySheetOpen()) return;
	if (scrollLockCount() > 0) resetScrollLock();
}

export function settleNavVisibility(
	reason: NavSettleReason,
	options: { force?: boolean } = {}
): void {
	if (typeof document === 'undefined') return;
	clearTimeout(settleTimer);
	if (anySheetOpen()) {
		/* Tous les volets enregistrés gardent leur clavier et leur verrou. */
		syncKeyboardOpen();
		return;
	}
	syncKeyboardOpen();
	/* Le champ peut disparaître avant que le clavier ait fini de se replier.
	   N'abandonner une mesure rétrécie qu'après un délai de stabilisation. */
	settleTimer = setTimeout(() => {
		settleTimer = undefined;
		if (anySheetOpen() || isEditableElement(document.activeElement)) return;
		viewportStale = viewportShrunk();
		syncKeyboardOpen({ trustViewport: false });
	}, KEYBOARD_SETTLE_MS);
	if (reason === 'sheet-closed') {
		/* Fermeture : le volet a déjà rendu son verrou (ou va le faire à la fin de
		   son fondu) — on ne vérifie qu'après l'animation, sans jamais couper
		   l'effet de sortie. */
		setTimeout(releaseOrphanLock, 500);
		return;
	}
	releaseOrphanLock();
}

/* ————— Écoute globale (une seule fois pour toute l'app) ————— */

let watchers = 0;
let stopListeners: (() => void) | null = null;
let visibilityTimer: ReturnType<typeof setTimeout> | undefined;

function installListeners(): () => void {
	const onFocusIn = () => syncKeyboardOpen();
	const onFocusOut = () => window.requestAnimationFrame(() => syncKeyboardOpen());
	const onVv = () => {
		syncKeyboardOpen();
		if (settleTimer !== undefined && !anySheetOpen()) settleNavVisibility('visible');
	};
	const onVisibility = () => {
		clearTimeout(visibilityTimer);
		if (document.visibilityState === 'hidden') return;
		/* Au retour au premier plan, les métriques du visualViewport se
		   stabilisent après le premier tick : on remesure juste après. */
		visibilityTimer = setTimeout(() => settleNavVisibility('visible'), 120);
	};
	const onPageShow = () => settleNavVisibility('visible');

	document.addEventListener('focusin', onFocusIn);
	document.addEventListener('focusout', onFocusOut);
	window.visualViewport?.addEventListener('resize', onVv);
	window.visualViewport?.addEventListener('scroll', onVv);
	document.addEventListener('visibilitychange', onVisibility);
	window.addEventListener('pageshow', onPageShow);

	return () => {
		clearTimeout(visibilityTimer);
		clearTimeout(settleTimer);
		document.removeEventListener('focusin', onFocusIn);
		document.removeEventListener('focusout', onFocusOut);
		window.visualViewport?.removeEventListener('resize', onVv);
		window.visualViewport?.removeEventListener('scroll', onVv);
		document.removeEventListener('visibilitychange', onVisibility);
		window.removeEventListener('pageshow', onPageShow);
	};
}

/** Abonne l'app à l'état clavier ; renvoie la fonction de désabonnement. */
export function startKeyboardWatch(): () => void {
	if (typeof window === 'undefined') return () => {};
	watchers += 1;
	if (!stopListeners) {
		stopListeners = installListeners();
		syncKeyboardOpen();
	}
	return () => {
		watchers -= 1;
		if (watchers > 0) return;
		stopListeners?.();
		stopListeners = null;
	};
}
