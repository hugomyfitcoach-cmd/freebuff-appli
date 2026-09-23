/**
 * Formatage du poids (espace cliente) — partagé Accueil ↔ pages métriques.
 *
 * `68.3` → `« 68,3 »` (virgule française, sans unité : l'unité « kg » reste
 * posée par le gabarit appelant).
 */
export function fmtWeightKg(kg: number): string {
	return kg.toFixed(1).replace('.', ',');
}
