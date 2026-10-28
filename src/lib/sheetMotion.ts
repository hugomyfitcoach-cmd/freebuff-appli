/* Animation commune des feuilles de saisie (poids, hydratation, mensurations,
   taille, bilan du jour, fiche aliment).

   OUVERTURE (inchangée) : fondu du fond 160 ms + glissement du panneau
   (48 px, 240 ms).

   FERMETURE : UN SEUL fondu. Le fond et le panneau sortent sur la même durée
   (240 ms). Avant, le fond finissait à 160 ms alors que le panneau glissait
   encore jusqu'à 240 ms : pendant les 80 dernières millisecondes, la page
   réapparaissait sans assombrissement sous un volet encore visible — c'est le
   clignotement constaté sur un iPhone 60 Hz.

   Respecte prefers-reduced-motion. */

export const SHEET_FADE_MS = 160;
export const SHEET_PANEL_MS = 240;
/** Sortie : une seule durée pour le fond ET le panneau (fondu unique). */
export const SHEET_EXIT_MS = SHEET_PANEL_MS;
/** Marge du délai de secours quand `transitionend` ne vient pas. */
export const SHEET_EXIT_FALLBACK_MS = 140;

export function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Fondu du fond à l'OUVERTURE — 160 ms, réglage de référence. */
export function sheetFade() {
	return { duration: prefersReducedMotion() ? 0 : SHEET_FADE_MS };
}

/** Fondu du fond à la FERMETURE — aligné sur le panneau : un seul fondu. */
export function sheetFadeOut() {
	return { duration: prefersReducedMotion() ? 0 : SHEET_EXIT_MS };
}

/** Glissement du panneau (48 px, 240 ms) — identique à l'ouverture. */
export function sheetFly() {
	return { y: 48, duration: prefersReducedMotion() ? 0 : SHEET_PANEL_MS };
}

/** Glissement de sortie : même trajectoire, fin alignée sur le fond. */
export function sheetFlyOut() {
	return { y: 48, duration: prefersReducedMotion() ? 0 : SHEET_EXIT_MS };
}

/** Durée réelle de la sortie (0 sous prefers-reduced-motion). */
export function sheetExitMs(): number {
	return prefersReducedMotion() ? 0 : SHEET_EXIT_MS;
}

/**
 * Appelle `cb` à la FIN de la sortie du volet — jamais pendant.
 *
 * Deux déclencheurs : `transitionend` du panneau (opacité / transformation)
 * et un délai de secours (durée de sortie + marge) si l'événement ne vient
 * pas (transition interrompue, onglet en arrière-plan, navigateur qui la
 * saute). C'est ce qui autorise la libération du verrou de défilement, la
 * restauration de la position et le démontage sans jamais toucher au layout
 * au milieu du fondu.
 *
 * `node === null` : seul le délai de secours est utilisé (volet dont on n'a
 * pas la référence DOM) — jamais moins que la durée de sortie.
 *
 * Retourne une fonction d'annulation (réouverture du volet entre-temps).
 */
export function onSheetExitEnd(node: HTMLElement | null, cb: () => void): () => void {
	const ms = sheetExitMs();
	let done = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	function cleanup() {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		node?.removeEventListener('transitionend', onEnd);
	}

	function finish() {
		if (done) return;
		done = true;
		cleanup();
		cb();
	}

	function onEnd(e: TransitionEvent) {
		if (e.target !== node) return;
		if (e.propertyName !== 'opacity' && e.propertyName !== 'transform') return;
		finish();
	}

	if (typeof setTimeout !== 'function') return () => {};
	if (node) node.addEventListener('transitionend', onEnd);
	timer = setTimeout(finish, ms > 0 ? ms + SHEET_EXIT_FALLBACK_MS : 0);

	return () => {
		done = true;
		cleanup();
	};
}

/**
 * Fige le volet au moment exact où la fermeture commence : hauteur du calque,
 * hauteur du panneau et marge basse (résolue en pixels, donc
 * `env(safe-area-inset-bottom)` n'est plus recalculée) sont posées en styles
 * inline. Pendant tout le fondu, plus aucune variation de hauteur de fenêtre,
 * de safe area ou de clavier ne peut déplacer le contenu du volet.
 *
 * Retourne la fonction qui rend les styles d'origine (après la sortie).
 */
export function freezeSheetForExit(sheet: HTMLElement | null): () => void {
	if (!sheet || typeof window === 'undefined' || !window.getComputedStyle) return () => {};

	const overlay = sheet.parentElement;
	const hauteur = sheet.offsetHeight;
	const margeBasse = window.getComputedStyle(sheet).paddingBottom;
	const hauteurCalque = overlay?.offsetHeight ?? 0;
	const avant = {
		height: sheet.style.height,
		paddingBottom: sheet.style.paddingBottom,
		overlayHeight: overlay ? overlay.style.height : '',
	};

	if (hauteur > 0) sheet.style.height = `${hauteur}px`;
	if (margeBasse) sheet.style.paddingBottom = margeBasse;
	if (overlay && hauteurCalque > 0) overlay.style.height = `${hauteurCalque}px`;

	return () => {
		sheet.style.height = avant.height;
		sheet.style.paddingBottom = avant.paddingBottom;
		if (overlay) overlay.style.height = avant.overlayHeight;
	};
}
