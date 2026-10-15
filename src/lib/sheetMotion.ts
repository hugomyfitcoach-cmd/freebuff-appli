/* Animation commune des feuilles de saisie (poids, mensurations, taille).
   Mêmes réglages que la saisie rapide de l'Accueil : fondu du fond (160 ms)
   et glissement de la feuille (48 px, 240 ms). Respecte prefers-reduced-motion. */

export function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Fond de la feuille (transition:fade). */
export function sheetFade() {
	return { duration: prefersReducedMotion() ? 0 : 160 };
}

/** Panneau de la feuille (transition:fly). */
export function sheetFly() {
	return { y: 48, duration: prefersReducedMotion() ? 0 : 240 };
}
