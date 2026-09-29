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

/* ── Familles de variantes MUTUELLEMENT EXCLUSIVES (produits emballés) ──
 *
 * Une requête demandant une variante ne doit JAMAIS accepter une fiche
 * portant une variante rivale du même axe : « stracciatella » ≠ « nature »,
 * « fraise » ≠ « vanille », « écrémé » ≠ « demi-écrémé », « Zero » ≠
 * « classique ». Map volontairement petite (axes goût / matière grasse /
 * sucre), symétrique à la lecture : le conflit est détecté dans les DEUX
 * sens (demandé vs candidat). Extensible : ajouter une entrée par rival
 * réel observé — jamais un filtrage large qui casserait des fiches légitimes.
 */
const FLAVOR_CONFLICTS: Record<string, string[]> = {
	// Axe goût / parfum (yaourts, desserts, jus, biscuits…)
	nature: ["fraise", "vanille", "chocolat", "stracciatella", "myrtille", "peche", "abricot", "cacao", "cafe", "caramel", "citron"],
	fraise: ["vanille", "chocolat", "nature", "myrtille", "peche", "abricot", "citron", "caramel"],
	vanille: ["fraise", "chocolat", "nature", "myrtille", "pistache", "caramel", "citron"],
	chocolat: ["fraise", "vanille", "nature", "cafe", "citron", "myrtille"],
	stracciatella: ["nature", "fraise", "vanille", "myrtille", "citron"],
	citron: ["fraise", "vanille", "chocolat", "nature", "orange"],
	orange: ["citron", "pomme", "ananas", "abricot"],
	pomme: ["orange", "ananas", "abricot"],
	// Axe matière grasse (lait, crème, yaourt)
	ecreme: ["demi", "entier"],
	demi: ["entier", "ecreme"],
	entier: ["demi", "ecreme"],
	// Axe sucre (sodas, desserts)
	zero: ["classic", "classique", "original", "normal", "sucre"],
	classic: ["zero", "light"],
	light: ["classic", "classique", "zero"],
};

/** Tous les tokens de rivalité connus (axes goût / matière grasse / sucre). */
const FLAVOR_AXES: ReadonlySet<string> = new Set([
	...Object.keys(FLAVOR_CONFLICTS),
	...Object.values(FLAVOR_CONFLICTS).flat(),
]);

/**
 * true si une variante DEMANDÉE entre en conflit avec les variantes d'un
 * candidat (rivalité directe dans une famille ci-dessus, dans les deux
 * sens). Les tokens de variante DEMANDÉS et présents chez le candidat sont
 * neutres (« lait demi-écrémé » demandé vs candidat « Lait demi-écrémé » :
 * ses tokens demi+écrémé sont ceux demandés → PAS un conflit) — seul un
 * token rival NON demandé chez le candidat rejette.
 */
export function flavorConflict(requiredTokens: string[], candidateTokens: string[]): boolean {
	const required = new Set(requiredTokens);
	const candidateVariants = candidateTokens.filter((t) => FLAVOR_AXES.has(t) && !required.has(t));
	for (const r of requiredTokens) {
		for (const c of candidateVariants) {
			if (FLAVOR_CONFLICTS[r]?.includes(c) || FLAVOR_CONFLICTS[c]?.includes(r)) return true;
		}
	}
	return false;
}
