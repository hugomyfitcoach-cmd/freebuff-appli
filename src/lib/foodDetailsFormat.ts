/**
 * FICHE NUTRITIONNELLE DÉTAILLÉE (Mission R5b) — formatage pur, partagé par
 * la fiche aliment (`QuantitySheet.svelte`) et les tests unitaires.
 *
 * Aucune donnée n'est calculée ici : les valeurs viennent de la requête
 * Convex `foodDetails` (pour 100 g) et sont seulement mises à l'échelle de la
 * quantité choisie, puis formatées à la française :
 *  - virgule décimale, jamais de point ;
 *  - une décimale sous 10 g, entier au-delà ;
 *  - sel : deux décimales sous 1 g (une pincée reste lisible) ;
 *  - énergie : entier (kcal) ;
 *  - micros (mg / µg) : une décimale sous 10, entier au-delà ;
 *  - valeur inconnue (`null`) → « — », jamais un 0 inventé.
 */

/** Provenance d'une fiche détaillée (miroir de `convex/foodDetails.ts`). */
export type FoodDetailsSource = 'ciqual' | 'food' | 'custom' | 'reference';

export type FoodMicros = {
	calcium: number | null;
	iron: number | null;
	magnesium: number | null;
	potassium: number | null;
	vitaminC: number | null;
	vitaminD: number | null;
};

/** Fiche /100 g — `null` = valeur inconnue. */
export type FoodDetails = {
	kcal: number | null;
	protein: number | null;
	carbs: number | null;
	fat: number | null;
	sugars: number | null;
	fiber: number | null;
	saturatedFat: number | null;
	salt: number | null;
	micros?: FoodMicros;
	source: FoodDetailsSource;
};

/** Unité de formatage : l'énergie est arrondie à l'entier, le sel à 2 déc. */
export type DetailKind = 'kcal' | 'g' | 'salt' | 'mg' | 'ug';

/** Valeur inconnue affichée telle quelle (jamais 0). */
export const UNKNOWN_VALUE = '—';

const isKnown = (n: number | null | undefined): n is number =>
	typeof n === 'number' && Number.isFinite(n);

/** Arrondi décimal robuste aux artefacts binaires (0,045 × 100 ≠ 4,5 exact). */
function roundTo(n: number, decimals: number): number {
	const f = 10 ** decimals;
	return Math.round(Number((n * f).toFixed(6))) / f;
}

/** Nombre → texte français (virgule, décimales fixes). */
function decimal(n: number, decimals: number): string {
	return roundTo(n, decimals).toFixed(decimals).replace('.', ',');
}

/**
 * Formate une valeur nutritionnelle (à l'échelle demandée) :
 * `formatDetailValue(0.045, 'salt')` → « 0,05 », `formatDetailValue(48, 'kcal')`
 * → « 48 », `formatDetailValue(null, 'g')` → « — ».
 */
export function formatDetailValue(value: number | null | undefined, kind: DetailKind): string {
	if (!isKnown(value)) return UNKNOWN_VALUE;
	if (kind === 'kcal') return String(Math.round(value));
	if (kind === 'salt') {
		if (value < 1) return decimal(value, 2);
		if (value < 10) return decimal(value, 1);
		return String(Math.round(value));
	}
	// g / mg / µg : une décimale sous 10, entier au-delà.
	if (value < 10) return decimal(value, 1);
	return String(Math.round(value));
}

/**
 * Formate une valeur /100 g pour la quantité choisie (recalcul à l'affichage).
 * Quantité absente ou invalide → « — » (aucune valeur inventée).
 */
export function formatDetailForQty(
	value100: number | null | undefined,
	qtyGrams: number | null | undefined,
	kind: DetailKind
): string {
	if (!isKnown(value100) || !isKnown(qtyGrams) || qtyGrams <= 0) return UNKNOWN_VALUE;
	return formatDetailValue((value100 * qtyGrams) / 100, kind);
}

/** Mention de source affichée sous la section. */
export function detailSourceLabel(source: FoodDetailsSource): string {
	switch (source) {
		case 'ciqual':
			return 'Valeurs Ciqual – ANSES';
		case 'food':
			return 'Valeurs Open Food Facts';
		case 'reference':
			return 'Valeurs Référence G-Flux';
		default:
			return 'Valeurs de ton aliment personnalisé';
	}
}

/** Au moins une micro-valeur connue (sinon le bloc est masqué). */
export function hasAnyMicros(micros: FoodMicros | null | undefined): boolean {
	if (!micros) return false;
	return (
		isKnown(micros.calcium) ||
		isKnown(micros.iron) ||
		isKnown(micros.magnesium) ||
		isKnown(micros.potassium) ||
		isKnown(micros.vitaminC) ||
		isKnown(micros.vitaminD)
	);
}

/**
 * Bloc « Vitamines et minéraux » : Ciqual UNIQUEMENT, et seulement si au moins
 * une des 6 valeurs existe (OFF et Référence G-Flux n'en publient pas).
 */
export function showMicros(details: FoodDetails | null | undefined): boolean {
	if (!details || details.source !== 'ciqual') return false;
	return hasAnyMicros(details.micros);
}

/** Au moins un « — » affiché → légende « — = non renseigné par la source ». */
export function hasUnknownValue(details: FoodDetails | null | undefined): boolean {
	if (!details) return false;
	const values = [
		details.kcal,
		details.carbs,
		details.sugars,
		details.fiber,
		details.protein,
		details.fat,
		details.saturatedFat,
		details.salt,
	];
	if (values.some((v) => !isKnown(v))) return true;
	if (details.source !== 'ciqual' || !details.micros) return false;
	const m = details.micros;
	return [m.calcium, m.iron, m.magnesium, m.potassium, m.vitaminC, m.vitaminD].some((v) => !isKnown(v));
}

export type DetailRowTone = 'kcal' | 'carbs' | 'protein' | 'fat' | null;

/** Ligne de la fiche (macros et « dont … »). */
export type DetailRow = {
	key: string;
	label: string;
	value: string;
	unit: string;
	tone: DetailRowTone;
	indent: boolean;
};

/** Ligne de la grille des micros. */
export type MicroRow = {
	key: string;
	label: string;
	value: string;
	unit: string;
};

/**
 * Lignes de la fiche, valeurs recalculées pour `qtyGrams` (null = « — »).
 * Ordre fixe : énergie, glucides (dont sucres), fibres, protéines, lipides
 * (dont AGS), sel.
 */
export function detailRows(details: FoodDetails | null | undefined, qtyGrams: number | null): DetailRow[] {
	const v = (value: number | null | undefined, kind: DetailKind) =>
		details ? formatDetailForQty(value, qtyGrams, kind) : UNKNOWN_VALUE;
	return [
		{ key: 'kcal', label: 'Énergie', value: v(details?.kcal, 'kcal'), unit: 'kcal', tone: 'kcal', indent: false },
		{ key: 'carbs', label: 'Glucides', value: v(details?.carbs, 'g'), unit: 'g', tone: 'carbs', indent: false },
		{ key: 'sugars', label: 'dont sucres', value: v(details?.sugars, 'g'), unit: 'g', tone: null, indent: true },
		{ key: 'fiber', label: 'Fibres', value: v(details?.fiber, 'g'), unit: 'g', tone: null, indent: false },
		{ key: 'protein', label: 'Protéines', value: v(details?.protein, 'g'), unit: 'g', tone: 'protein', indent: false },
		{ key: 'fat', label: 'Lipides', value: v(details?.fat, 'g'), unit: 'g', tone: 'fat', indent: false },
		{
			key: 'saturatedFat',
			label: 'dont acides gras saturés',
			value: v(details?.saturatedFat, 'g'),
			unit: 'g',
			tone: null,
			indent: true,
		},
		{ key: 'salt', label: 'Sel', value: v(details?.salt, 'salt'), unit: 'g', tone: null, indent: false },
	];
}

/**
 * Grille « Vitamines et minéraux » (ordre de la maquette) — vide si le bloc
 * doit être masqué (source non Ciqual ou 6 valeurs inconnues).
 */
export function microRows(details: FoodDetails | null | undefined): MicroRow[] {
	if (!showMicros(details) || !details?.micros) return [];
	const m = details.micros;
	const row = (key: keyof FoodMicros, label: string, kind: DetailKind, unit: string): MicroRow => {
		const value = formatDetailValue(m[key], kind);
		return { key, label, value, unit: value === UNKNOWN_VALUE ? '' : unit };
	};
	return [
		row('vitaminC', 'Vitamine C', 'mg', 'mg'),
		row('potassium', 'Potassium', 'mg', 'mg'),
		row('iron', 'Fer', 'mg', 'mg'),
		row('calcium', 'Calcium', 'mg', 'mg'),
		row('vitaminD', 'Vitamine D', 'ug', 'µg'),
		row('magnesium', 'Magnésium', 'mg', 'mg'),
	];
}
