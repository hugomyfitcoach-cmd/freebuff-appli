/**
 * FUSION PHOTO × TEXTE — Repas IA multimodal.
 *
 * Module PUR (aucune dépendance Convex, aucun réseau) : partagé par l'action
 * Convex (aiAnalysis.analyzeMeal) et testable hors Convex (npm test) — même
 * discipline que src/lib/foodText.ts.
 *
 * HIÉRARCHIE DES QUANTITÉS (règle produit, appliquée DÉTERMINISTEMENT —
 * jamais confiée au seul prompt du modèle) :
 *   1. quantité explicitement écrite par l'utilisatrice (« 150 g de riz ») ;
 *   2. information lisible et fiable depuis la photo (estimation visuelle) ;
 *   3. estimation IA de portion réaliste — UNIQUEMENT si rien d'autre
 *      n'existe, toujours affichée comme incertaine.
 *
 * Principe : la photo et le texte sont extraits SÉPARÉMENT (deux prompts
 * spécialisés), puis fusionnés ICI par rapprochement nominal (nameMatchScore,
 * même moteur que le matching base G-FLUX) avec associativité un-à-un.
 * « 150 g de riz » gagne TOUJOURS sur « 220 g de riz estimés depuis la
 * photo » : le texte remplace la quantité, jamais l'inverse.
 */

import { nameMatchScore } from './foodText';

/** Source d'une quantité affichée dans le récap Repas IA. */
export type MealQtySource =
	/** Écrite par l'utilisatrice (texte ou correction manuelle) — jamais remplacée. */
	| 'user'
	/** Lue/reconnue sur la photo (estimation visuelle fiable du contexte). */
	| 'photo'
	/** Estimée faute d'information (texte flou ou sans photo) — à vérifier. */
	| 'estimated';

/** Composant extrait du TEXTE (parseur openai.analyzeMealText). */
export type MealTextItem = {
	name: string;
	qtyGrams: number;
	/** Quantité explicitement donnée par l'utilisatrice (g/kg/ml/pièce fiable/cuillère). */
	qtyExplicit: boolean;
	brand?: string;
	variant?: string;
	packaged?: boolean;
	kcal100?: number;
	carbs100?: number;
	protein100?: number;
	fat100?: number;
	note?: string;
};

/** Composant extrait de la PHOTO (parseur openai.parseMealComponents — shape identique). */
export type MealPhotoItem = {
	name: string;
	qtyGrams: number;
	brand?: string;
	variant?: string;
	barcode?: string;
	packaged?: boolean;
	kcal100?: number;
	carbs100?: number;
	protein100?: number;
	fat100?: number;
	note?: string;
};

/** Composant fusionné transmis au matching base G-FLUX (+ méta quantité). */
export type FusedMealItem = MealPhotoItem & {
	/** Absent sur le chemin photo seul (comportement historique strictement préservé). */
	qtySource?: MealQtySource;
	/** true si la quantité vient d'une écriture explicite de l'utilisatrice. */
	qtyExplicit?: boolean;
};

/** Seuil de rapprochement nominal photo ⇄ texte (aligné sur MIN_MATCH_SCORE du matcher). */
export const FUSION_MIN_SCORE = 0.55;

/** Quantité bornée (1–2000 g) — même borne que le matching repas IA. */
function clampQty(n: number | undefined): number {
	if (n === undefined || !isFinite(n) || n <= 0) return 100;
	return Math.min(2000, Math.max(1, Math.round(n)));
}

/** Longueur de nom « significative » (même normalisation que foodText). */
function tokenCount(name: string): number {
	return name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.split(' ')
		.filter((w) => w.length >= 3).length;
}

/**
 * Nom affiché après fusion : le PLUS PRÉCIS des deux (plus de tokens
 * significatifs) — « riz complet » (texte) sur « riz » (photo), mais
 * « riz basmati cuit » (photo) sur « riz » (texte). Égalité → nom photo.
 */
export function fusionDisplayName(textName: string, photoName: string): string {
	return tokenCount(textName) > tokenCount(photoName) ? textName : photoName;
}

/**
 * Fusionne les composants TEXTE sur les composants PHOTO.
 *
 * RÈGLES (une passe de paires triées par score → appariement un-à-un glouton) :
 *  - texte à quantité EXPLICITE ↔ composant photo : la quantité de
 *    l'utilisatrice REMPLACE celle de la photo (qtySource 'user') — le
 *    libellé reste le plus précis des deux ;
 *  - texte SANS quantité ↔ composant photo : la photo reste maître
 *    (information fiable > estimation) — composant photo inchangé ;
 *  - texte sans correspondance photo : ajouté (qtySource 'user' ou
 *    'estimated' selon qtyExplicit) ;
 *  - composants photo non concernés : inchangés (qtySource 'photo').
 *
 * L'ordre photo est préservé ; les apports du texte suivent.
 */
export function mergeTextOverPhoto(
	textItems: MealTextItem[],
	photoItems: MealPhotoItem[],
	{ minScore = FUSION_MIN_SCORE }: { minScore?: number } = {}
): FusedMealItem[] {
	const photo = photoItems.map((p) => ({ ...p, qtySource: 'photo' as const }));
	const consumedText = new Set<number>();
	const replaced = new Map<number, FusedMealItem>();

	// Toutes les paires crédibles, triées du meilleur rapprochement au moins bon.
	const pairs: { t: number; p: number; s: number }[] = [];
	for (let t = 0; t < textItems.length; t++) {
		for (let p = 0; p < photo.length; p++) {
			const s = nameMatchScore(textItems[t].name, photo[p].name);
			if (s >= minScore) pairs.push({ t, p, s });
		}
	}
	pairs.sort((a, b) => b.s - a.s);

	for (const { t, p } of pairs) {
		if (consumedText.has(t) || replaced.has(p)) continue; // un-à-un strict
		consumedText.add(t);
		const ti = textItems[t];
		if (ti.qtyExplicit) {
			// 1) La quantité écrite par l'utilisatrice GAGNE — jamais remplacée
			//    par l'estimation visuelle (« 150 g de riz » ≠ « 220 g estimés »).
			const ph = photo[p];
			replaced.set(p, {
				...ph,
				name: fusionDisplayName(ti.name, ph.name),
				qtyGrams: clampQty(ti.qtyGrams),
				brand: ph.brand ?? ti.brand,
				variant: ph.variant ?? ti.variant,
				packaged: ph.packaged === true || ti.packaged === true,
				kcal100: ph.kcal100 ?? ti.kcal100,
				carbs100: ph.carbs100 ?? ti.carbs100,
				protein100: ph.protein100 ?? ti.protein100,
				fat100: ph.fat100 ?? ti.fat100,
				note: ph.note ?? ti.note,
				qtySource: 'user',
				qtyExplicit: true,
			});
		}
		// Texte sans quantité : la PHOTO fournit la quantité (fiable) → rien à
		// remplacer, le composant photo garde qtySource 'photo'.
	}

	// Ordre photo préservé, puis apports du texte (dans l'ordre d'écriture).
	const out: FusedMealItem[] = [];
	for (let p = 0; p < photo.length; p++) out.push(replaced.get(p) ?? photo[p]);
	for (let t = 0; t < textItems.length; t++) {
		if (consumedText.has(t)) continue;
		const ti = textItems[t];
		out.push({
			name: ti.name,
			qtyGrams: clampQty(ti.qtyGrams),
			brand: ti.brand,
			variant: ti.variant,
			packaged: ti.packaged === true || !!ti.brand,
			kcal100: ti.kcal100,
			carbs100: ti.carbs100,
			protein100: ti.protein100,
			fat100: ti.fat100,
			note: ti.note,
			qtySource: ti.qtyExplicit ? 'user' : 'estimated',
			qtyExplicit: ti.qtyExplicit,
		});
	}
	return out;
}

/**
 * TEXTE SEUL : chaque composant porte sa source de quantité — explicite
 * ('user') ou estimée ('estimated', jamais présentée comme certaine).
 */
export function applyTextQtySource(textItems: MealTextItem[]): FusedMealItem[] {
	return textItems.map((ti) => ({
		name: ti.name,
		qtyGrams: clampQty(ti.qtyGrams),
		brand: ti.brand,
		variant: ti.variant,
		packaged: ti.packaged === true || !!ti.brand,
		kcal100: ti.kcal100,
		carbs100: ti.carbs100,
		protein100: ti.protein100,
		fat100: ti.fat100,
		note: ti.note,
		qtySource: ti.qtyExplicit ? ('user' as const) : ('estimated' as const),
		qtyExplicit: ti.qtyExplicit,
	}));
}
