/**
 * ALIMENTS DE RÉFÉRENCE G-FLUX (Mission R3) — règles PURES partagées.
 *
 * Le coach crée ses propres aliments de référence (valeurs pour 100 g). Ils
 * apparaissent dans la section « Aliments de référence » des recherches
 * (journal cliente, fiche cliente CRM, plans de repas) et sont soumis AUX
 * MÊMES règles de classement que les fiches Ciqual (tous les mots, mots
 * consécutifs, variété, cuisson) — à pertinence égale, G-Flux passe AVANT
 * Ciqual.
 *
 * Ce module ne contient aucune dépendance Convex runtime : il est importé par
 * les fonctions Convex (validation, classement) ET par les écrans (badge,
 * avertissement kcal), donc testable directement en Node (`npm test`).
 */

import {
	allWordsPresent,
	headTokenCount,
	norm,
	phrasePresent,
	queryCookState,
	sameCookFamily,
	tokenize,
} from '../convex/foodRanking';
import {
	cookingBadge,
	cookingRank,
	cookingStateOf,
	cookingVarietyOf,
	isCookingState,
} from './cookedState';
import type { CookingState } from './cookedState';

/* ─── Bornes de validation (serveur, ConvexError claire) ─── */
export const REFERENCE_NAME_MIN = 2;
export const REFERENCE_NAME_MAX = 120;
export const REFERENCE_KCAL_MAX = 900;
export const REFERENCE_MACRO_MAX = 100;
/** Écart kcal toléré vs 4P + 4G + 9L (avertissement non bloquant, côté écran). */
export const KCAL_WARN_RATIO = 0.15;

const round1 = (n: number) => Math.round(n * 10) / 10;

export type ReferenceFoodInput = {
	name: string;
	kcal: number;
	proteinG: number;
	carbsG: number;
	fatG: number;
	/** Mode de cuisson (valeurs de cookedState.ts : cru, eau, vapeur, four, grille,
	 *  poele, frit, conserve, cuit, neutre) — FACULTATIF. Renseigné, il pilote le
	 *  badge de cuisson et le classement ; sinon détection d'après le nom. */
	cookingState?: string;
};

export type ReferenceFoodLike = ReferenceFoodInput & { _id?: string; coachId?: string };

/** Trim + arrondi 0,1 g — la forme persistée (aucune autre transformation).
 *  `cookingState` n'est présent que s'il est renseigné (« Non précisé » = champ
 *  absent, jamais une valeur spéciale). */
export function cleanReferenceFood(input: ReferenceFoodInput): ReferenceFoodInput {
	const cookingState = String(input.cookingState ?? '').trim();
	return {
		name: String(input.name ?? '').trim(),
		kcal: round1(Number(input.kcal)),
		proteinG: round1(Number(input.proteinG)),
		carbsG: round1(Number(input.carbsG)),
		fatG: round1(Number(input.fatG)),
		...(cookingState ? { cookingState } : {}),
	};
}

/**
 * Message d'erreur de validation, ou null si la saisie est valide.
 * Bornes produit : nom 2 à 120 caractères, kcal 0 à 900, macros 0 à 100 g.
 */
export function referenceFoodError(input: ReferenceFoodInput): string | null {
	const name = String(input.name ?? '').trim();
	if (name.length < REFERENCE_NAME_MIN || name.length > REFERENCE_NAME_MAX) {
		return `Le nom doit contenir entre ${REFERENCE_NAME_MIN} et ${REFERENCE_NAME_MAX} caractères.`;
	}
	const values: [number, string][] = [
		[Number(input.kcal), 'Les calories (kcal pour 100 g)'],
		[Number(input.proteinG), 'Les protéines (g pour 100 g)'],
		[Number(input.carbsG), 'Les glucides (g pour 100 g)'],
		[Number(input.fatG), 'Les lipides (g pour 100 g)'],
	];
	for (const [value, label] of values) {
		if (!isFinite(value) || value < 0) return `${label} doivent être un nombre positif.`;
	}
	if (Number(input.kcal) > REFERENCE_KCAL_MAX) {
		return `Les calories ne peuvent pas dépasser ${REFERENCE_KCAL_MAX} kcal pour 100 g.`;
	}
	if ([input.proteinG, input.carbsG, input.fatG].some((v) => Number(v) > REFERENCE_MACRO_MAX)) {
		return `Chaque macro (protéines, glucides, lipides) doit rester entre 0 et ${REFERENCE_MACRO_MAX} g pour 100 g.`;
	}
	// Mode de cuisson facultatif : valeur vide = non précisé (détection par le
	// nom) ; toute autre valeur doit être un état de cookedState.ts.
	const cookingState = String(input.cookingState ?? '').trim();
	if (cookingState && !isCookingState(cookingState)) {
		return 'Mode de cuisson invalide (valeurs acceptées : cru, eau, vapeur, four, grille, poele, frit, conserve, cuit, neutre).';
	}
	return null;
}

/**
 * Le compte peut-il gérer CETTE fiche ? Même contrôle que les contenus du
 * Guide nutrition & recettes : coach propriétaire uniquement (la cliente ne
 * crée ni ne modifie jamais un aliment de référence).
 */
export function canManageReferenceFood(
	user: { _id?: string; role?: string } | null | undefined,
	food: { coachId?: string } | null | undefined
): boolean {
	if (!user || user.role !== 'coach' || !food) return false;
	return String(user._id) !== '' && String(food.coachId) === String(user._id);
}

/**
 * Snapshot d'ajout (journal / plan) : nom et valeurs sont COPIÉS au moment de
 * l'ajout, comme pour Ciqual. Modifier ou supprimer la fiche ensuite ne change
 * jamais les entrées passées.
 */
export function referenceFoodSnapshot(
	food: ReferenceFoodInput,
	qtyGrams: number
): { name: string; qtyGrams: number; kcal: number; carbs: number; protein: number; fat: number } {
	const k = qtyGrams / 100;
	return {
		name: food.name,
		qtyGrams,
		kcal: Math.round(food.kcal * k),
		carbs: round1(food.carbsG * k),
		protein: round1(food.proteinG * k),
		fat: round1(food.fatG * k),
	};
}

/**
 * Avertissement (NON bloquant) : les kcal saisies s'écartent de plus de 15 %
 * de 4P + 4G + 9L.
 */
export function kcalMismatchWarning(food: ReferenceFoodInput): boolean {
	const theoretical = 4 * Number(food.proteinG) + 4 * Number(food.carbsG) + 9 * Number(food.fatG);
	if (!isFinite(theoretical) || theoretical <= 0) return false;
	return Math.abs(Number(food.kcal) - theoretical) > theoretical * KCAL_WARN_RATIO;
}

/* ─── Classement / fusion avec les fiches Ciqual ─────────────────────────── */

export type ReferenceHit = {
	label: string;
	kcal: number;
	protein?: number;
	carbs?: number;
	fat?: number;
	/** Provenance affichée (badge) : « gflux » remplace le badge Ciqual. */
	source?: 'gflux';
	/** Identifiant de la fiche G-Flux (`referenceFoods._id`, jamais affiché) — absent pour Ciqual. */
	id?: string;
	/** Mode de cuisson explicite de la fiche G-Flux (valeurs cookedState.ts) —
	 *  absent pour Ciqual, dont l'état se détecte d'après le nom. */
	cookingState?: CookingState;
	/** Badge de cuisson calculé (cookedState.ts) — null = aucun badge. */
	cookLabel?: string | null;
};

/**
 * Clé de pertinence (mêmes règles que la recherche Ciqual, R1/R1-bis) :
 *  1. aliment en tête du nom ; 2. mots consécutifs ; 3. cuisson tapée ;
 *  4. cuisson dans la variété ; 5. nom le plus court.
 * `null` = non candidat (règle « tous les mots présents » non satisfaite).
 * La provenance (G-Flux avant Ciqual) est traitée séparément, à pertinence
 * égale, par `mergeReferenceHits`.
 */
function relevanceKey(name: string, q: string, explicitState?: string): number[] | null {
	const qt = tokenize(q);
	if (qt.length === 0) return null;
	const toks = tokenize(name);
	if (!allWordsPresent(toks, qt, headTokenCount(name))) return null;
	const typed = queryCookState(qt);
	// Cuisson EXPLICITE (champ cookingState de la fiche G-Flux) prioritaire sur
	// la détection par le nom — sinon détection par le nom (inchangée).
	const state = isCookingState(explicitState) ? explicitState : cookingStateOf(name);
	const variety = cookingVarietyOf(name) || norm(name);
	const typedMatch = typed !== undefined ? (sameCookFamily(typed, state) ? 0 : 1) : 0;
	return [
		variety.split(' ')[0].startsWith(qt[0]) ? 0 : 1, // aliment en tête
		phrasePresent(toks, qt) ? 0 : 1, // mots consécutifs
		typedMatch, // cuisson tapée prioritaire
		cookingRank(state), // cuisson dans la variété
		norm(name).length, // nom le plus court
	];
}

function compareKeys(a: number[], b: number[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const ka = a[i] ?? 0;
		const kb = b[i] ?? 0;
		if (ka !== kb) return ka - kb;
	}
	return 0;
}

/**
 * Badge de cuisson d'une fiche : `cookingState` s'il est renseigné (valeurs de
 * cookedState.ts), sinon détection d'après le nom (comportement Ciqual,
 * inchangé). Source unique : cookedState.ts.
 */
export function referenceCookBadge(food: { name: string; cookingState?: string }): string | null {
	const state = isCookingState(food.cookingState) ? food.cookingState : cookingStateOf(food.name);
	return cookingBadge(state);
}

/** Fiche G-Flux → résultat de recherche (badge « Référence G-Flux »). */
export function referenceFoodHit(food: ReferenceFoodLike): ReferenceHit {
	return {
		label: food.name,
		kcal: food.kcal,
		protein: food.proteinG,
		carbs: food.carbsG,
		fat: food.fatG,
		source: 'gflux',
		id: food._id,
		...(isCookingState(food.cookingState) ? { cookingState: food.cookingState } : {}),
		cookLabel: referenceCookBadge(food),
	};
}

/**
 * Fiches G-Flux pertinentes (règle 1 : tous les mots présents), classées avec
 * les mêmes règles que Ciqual puis par nom (départage déterministe).
 */
export function rankReferenceFoods(query: string, foods: ReferenceFoodLike[]): ReferenceFoodLike[] {
	const scored: { food: ReferenceFoodLike; key: number[] }[] = [];
	for (const food of foods) {
		const key = relevanceKey(food.name, query, food.cookingState);
		if (!key) continue;
		scored.push({ food, key });
	}
	scored.sort((a, b) => {
		const cmp = compareKeys(a.key, b.key);
		if (cmp !== 0) return cmp;
		return norm(a.food.name).localeCompare(norm(b.food.name), 'fr');
	});
	return scored.map((s) => s.food);
}

/**
 * Fusionne les fiches G-Flux dans la liste Ciqual déjà classée — l'ordre
 * Ciqual est INCHANGÉ (bonus « déjà ajoutés », exception œuf…). Chaque fiche
 * G-Flux est insérée avant la première fiche Ciqual STRICTEMENT plus
 * pertinente : à pertinence égale, G-Flux passe donc devant Ciqual.
 */
export function mergeReferenceHits(
	query: string,
	foods: ReferenceFoodLike[],
	ciqualHits: ReferenceHit[]
): ReferenceHit[] {
	const ranked = rankReferenceFoods(query, foods);
	const out: ReferenceHit[] = [...ciqualHits];
	for (const food of ranked) {
		const key = relevanceKey(food.name, query, food.cookingState) ?? [];
		let at = out.findIndex((hit) => {
			const other = relevanceKey(hit.label, query, hit.cookingState);
			return other !== null && compareKeys(other, key) < 0;
		});
		if (at === -1) at = out.length;
		out.splice(at, 0, referenceFoodHit(food));
	}
	return out;
}


