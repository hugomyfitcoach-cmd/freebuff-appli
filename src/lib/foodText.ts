/**
 * Score de rapprochement nominal partagé (matching repas IA).
 *
 * Historiquement défini dans src/convex/mealMatch.ts ; extrait ici pour être
 * testable hors Convex (tests de non-régression « état cuit » sur les vraies
 * fiches Ciqual) — le comportement est STRICTEMENT identique.
 *
 * Rapprochement nominal tolérant (tokens, sans accents, pluriels) :
 * - 1.0  : tous les mots de l'ingrédient sont dans le nom du candidat,
 *          et réciproquement ;
 * - 0.7+ : l'ingrédient est couvert par le nom (sous-ensemble de tokens) ;
 * - ~0.5 : au moins deux mots significatifs en commun ;
 * - 0.25 : un seul mot en commun.
 * La couverture du nom du candidat pondère le score (« Riz basmati » pour
 * « riz basmati » doit battre « Riz au lait »).
 */
export function nameMatchScore(ingredientName: string, candidateName: string): number {
	const t = (s: string) =>
		s
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.trim()
			.split(" ")
			.filter((w) => w.length >= 3)
			.map((w) => (w.length >= 5 && w.endsWith("s") ? w.slice(0, -1) : w));
	const a = t(ingredientName);
	const b = t(candidateName);
	if (a.length === 0 || b.length === 0) return 0;
	const setB = new Set(b);
	let covered = 0;
	for (const w of a) if (setB.has(w)) covered++;
	const coverageA = covered / a.length;
	const setA = new Set(a);
	let coveredB = 0;
	for (const w of b) if (setA.has(w)) coveredB++;
	const coverageB = b.length > 0 ? coveredB / b.length : 0;
	if (coverageA === 1 && coverageB === 1) return 1;
	if (coverageA === 1) return 0.7 + 0.15 * coverageB;
	if (coverageA >= 0.5 && covered >= 2) return 0.55 * coverageB + 0.15;
	if (coverageA >= 0.5) return 0.45 * coverageB + 0.1;
	return covered > 0 ? 0.25 : 0;
}
