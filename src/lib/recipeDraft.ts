/**
 * Brouillon de recette côté cliente (localStorage, par téléphone).
 *
 * Problème : quitter l'écran « Nouvelle recette » en cours de saisie perdait
 * nom, description et ingrédients. Ce module PUR (aucun DOM hors stockage)
 * garde ce brouillon sous la clé `gflux:recipeDraft:<userId>`.
 *
 * Règles :
 *  - une clé PAR CLIENTE (jamais de fuite d'un brouillon entre comptes) ;
 *  - JAMAIS de photo : seuls les champs texte et les ingrédients (valeurs
 *    nutritionnelles /100 g) sont sérialisés — les URLs d'images, miniatures
 *    et photos sont ignorées à l'écriture ;
 *  - un brouillon de plus de 7 jours est ignoré ET supprimé ;
 *  - tout accès au stockage est protégé : mode privé / quota / stockage
 *    indisponible → aucune exception, l'app continue.
 */

/** Préfixe de clé (le userId est ajouté derrière). */
export const RECIPE_DRAFT_KEY_PREFIX = 'gflux:recipeDraft:';

/** Durée de vie d'un brouillon : 7 jours. */
export const RECIPE_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Ingrédient du formulaire — volontairement SANS image / photo. */
export type RecipeDraftIngredient = {
	/** Identité de la fiche (food._id) ou libellé de repli pour une estimation IA. */
	foodId: string;
	name: string;
	brand?: string;
	kcal100: number;
	carbs100: number;
	protein100: number;
	fat100: number;
	/** Quantité en grammes. */
	qty: number;
	customFoodId?: string;
	ciqualLabel?: string;
	aiEstimate?: boolean;
};

/** Champs texte + ingrédients du formulaire. */
export type RecipeDraftInput = {
	name: string;
	description: string;
	ingredients: RecipeDraftIngredient[];
};

/** Brouillon tel que stocké (date d'enregistrement incluse). */
export type RecipeDraft = RecipeDraftInput & { savedAt: number };

/** Clé localStorage d'une cliente. */
export function recipeDraftKey(userId: string): string {
	return `${RECIPE_DRAFT_KEY_PREFIX}${userId}`;
}

/** Stockage local, ou null si indisponible (SSR, mode privé, quota…). */
function getStorage(): Storage | null {
	try {
		const storage = (globalThis as { localStorage?: Storage }).localStorage;
		return storage && typeof storage.getItem === 'function' ? storage : null;
	} catch {
		return null;
	}
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : 0;
}

/** Ne garde QUE les champs autorisés : une photo passée par erreur n'est jamais écrite. */
function pickIngredient(raw: unknown): RecipeDraftIngredient | null {
	if (!raw || typeof raw !== 'object') return null;
	const it = raw as Record<string, unknown>;
	const name = text(it.name).trim();
	if (!name) return null;
	const ingredient: RecipeDraftIngredient = {
		foodId: text(it.foodId) || name,
		name,
		kcal100: num(it.kcal100),
		carbs100: num(it.carbs100),
		protein100: num(it.protein100),
		fat100: num(it.fat100),
		qty: num(it.qty),
	};
	const brand = text(it.brand).trim();
	if (brand) ingredient.brand = brand;
	const customFoodId = text(it.customFoodId).trim();
	if (customFoodId) ingredient.customFoodId = customFoodId;
	const ciqualLabel = text(it.ciqualLabel).trim();
	if (ciqualLabel) ingredient.ciqualLabel = ciqualLabel;
	if (it.aiEstimate === true) ingredient.aiEstimate = true;
	return ingredient;
}

function normalizeInput(raw: unknown): RecipeDraftInput | null {
	if (!raw || typeof raw !== 'object') return null;
	const draft = raw as Record<string, unknown>;
	const name = text(draft.name);
	const description = text(draft.description);
	const list = Array.isArray(draft.ingredients) ? draft.ingredients : [];
	const ingredients = list
		.map(pickIngredient)
		.filter((it): it is RecipeDraftIngredient => it !== null);
	return { name, description, ingredients };
}

/**
 * Enregistre le brouillon de la cliente (photo jamais incluse).
 * Ne lève jamais : stockage indisponible = brouillon simplement non gardé.
 */
export function saveRecipeDraft(userId: string, brouillon: RecipeDraftInput): void {
	if (!userId) return;
	const storage = getStorage();
	if (!storage) return;
	const clean = normalizeInput(brouillon);
	if (!clean) return;
	const payload: RecipeDraft = { ...clean, savedAt: Date.now() };
	try {
		storage.setItem(recipeDraftKey(userId), JSON.stringify(payload));
	} catch {
		// quota / mode privé : rien ne casse, l'écran reste utilisable.
	}
}

/**
 * Lit le brouillon d'une cliente. Un brouillon de plus de 7 jours est ignoré
 * et supprimé. Ne lève jamais.
 */
export function loadRecipeDraft(userId: string): RecipeDraft | null {
	if (!userId) return null;
	const storage = getStorage();
	if (!storage) return null;
	const key = recipeDraftKey(userId);
	let raw: string | null = null;
	try {
		raw = storage.getItem(key);
	} catch {
		return null;
	}
	if (!raw) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object') return null;
	const savedAt = (parsed as { savedAt?: unknown }).savedAt;
	if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null;
	if (Date.now() - savedAt > RECIPE_DRAFT_MAX_AGE_MS) {
		clearRecipeDraft(userId);
		return null;
	}
	const clean = normalizeInput(parsed);
	if (!clean) return null;
	return { ...clean, savedAt };
}

/** Supprime le brouillon de la cliente. Ne lève jamais. */
export function clearRecipeDraft(userId: string): void {
	if (!userId) return;
	const storage = getStorage();
	if (!storage) return;
	try {
		storage.removeItem(recipeDraftKey(userId));
	} catch {
		// stockage indisponible : rien à faire.
	}
}
