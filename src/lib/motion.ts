/**
 * Motion G-FLUX — utilitaires partagés (page Accueil).
 *
 * Principe : les animations ne sont jamais nécessaires pour comprendre une
 * information. Elles se jouent une fois, ne touchent QUE transform/opacity
 * (GPU-friendly, zéro CLS) et se neutralisent sous prefers-reduced-motion.
 */

/** Vrai si l'utilisatrice demande moins d'animations (lu à la volée, sans listener). */
export function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
