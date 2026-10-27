/**
 * VALEURS CIQUAL — conversion des cellules texte du XLSX officiel (ANSES).
 *
 * Le fichier « Table Ciqual 2025 » exprime les valeurs /100 g en texte
 * français, avec plusieurs conventions :
 *  - virgule décimale (« 1,2 ») ;
 *  - valeurs manquantes : cellule vide ou « - » ;
 *  - traces : « traces » (valeur non nulle mais non quantifiée) ;
 *  - valeurs sous le seuil de quantification : « < 0,5 » (souvent encodé
 *    « &lt; 0,5 » dans les chaînes partagées du XLSX).
 *
 * Deux conversions coexistent volontairement :
 *  - `ciqualNumber` : conversion HISTORIQUE, utilisée par ciqualNutrients.ts
 *    (kcal + macros du classement). Inchangée pour ne pas modifier le module
 *    de recherche déjà embarqué ;
 *  - `ciqualDetailNumber` : conversion de la FICHE DÉTAILLÉE (R5a) —
 *    « - »/vide → null, « traces » → 0, « < x » → 0, virgule gérée.
 *
 * Module SANS dépendance Convex : utilisé par le générateur
 * (scripts/gen-ciqual.mjs) ET directement testable sous Node (`npm test`).
 */

/** Chaîne de cellule, sans espaces de bord (valeur absente → chaîne vide). */
function cellText(raw: unknown): string {
	return raw === undefined || raw === null ? "" : String(raw).trim();
}

/** Entités XML des chaînes partagées XLSX (« &lt; » → « < »). */
function unescapeXml(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
}

/**
 * Conversion HISTORIQUE (ciqualNutrients.ts) — ne pas modifier : le module
 * de recherche embarqué est généré avec ces règles. Valeur absente ou « - »
 * → undefined ; « < 0,2 » n'est pas interprété (undefined).
 */
export function ciqualNumber(raw: unknown): number | undefined {
	if (raw === undefined) return undefined;
	const t = String(raw).trim();
	if (!t || t === "-" || t === "") return undefined;
	const n = parseFloat(t.replace("<", "").replace(",", "."));
	return Number.isFinite(n) ? n : undefined;
}

/**
 * Conversion de la FICHE DÉTAILLÉE (R5a) :
 *  - « - », vide, non numérique → null (valeur inconnue) ;
 *  - « traces » → 0 ;
 *  - « < 0,5 » (ou « &lt; 0,5 ») → 0 (sous le seuil de quantification) ;
 *  - virgule décimale gérée (« 1,2 » → 1.2).
 */
export function ciqualDetailNumber(raw: unknown): number | null {
	const t = unescapeXml(cellText(raw)).toLowerCase();
	if (!t || t === "-") return null;
	if (t === "traces" || t === "trace") return 0;
	if (t.startsWith("<")) return 0;
	const n = parseFloat(t.replace(",", "."));
	return Number.isFinite(n) ? n : null;
}
