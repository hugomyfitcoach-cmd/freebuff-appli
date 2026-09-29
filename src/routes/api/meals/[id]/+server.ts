import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Modifie un repas (nom, description, ingrédients — totaux recalculés côté serveur).
 * Un ingrédient SANS identité (foodId/customFoodId/ciqualLabel) mais AVEC un
 * snapshot (ex. « Estimation IA » d'une recette importée par photo) est transmis
 * tel quel : updateMeal accepte ce repli (additif rétrocompatible) au lieu de
 * rejeter tout le repas.
 */
export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const ingredients = Array.isArray(body.ingredients)
			? body.ingredients.map(
					(i: {
						foodId?: string;
						customFoodId?: string;
						ciqualLabel?: string;
						qtyGrams: number;
						name?: string;
						brand?: string;
						imageUrl?: string;
						kcal?: number;
						carbs?: number;
						protein?: number;
						fat?: number;
					}) => {
						// Même mapping que POST /api/meals : fiche de RÉFÉRENCE Ciqual
						// (ANSES), puis aliment personnel, puis produit OFF — sans
						// JAMAIS envoyer de foodId vide (sinon Convex rejette le
						// payload avant la mutation : ArgumentValidationError).
						const identity = i.ciqualLabel
							? { ciqualLabel: String(i.ciqualLabel) }
							: i.customFoodId
								? { customFoodId: String(i.customFoodId) }
								: i.foodId
									? { foodId: String(i.foodId) }
									: {};
						// Snapshot de secours (additif) : ingrédient SANS identité
						// (« Estimation IA » d'une recette importée) OU fiche disparue —
						// kcal/macros de la ligne exacte, transmis à updateMeal qui
						// l'accepte au lieu de rejeter tout le repas.
						const snapshot =
							i.kcal !== undefined || i.name
								? {
										...(i.name ? { name: String(i.name) } : {}),
										...(i.brand ? { brand: String(i.brand) } : {}),
										...(i.imageUrl ? { imageUrl: String(i.imageUrl) } : {}),
										...(i.kcal !== undefined ? { kcal: Number(i.kcal) } : {}),
										...(i.carbs !== undefined ? { carbs: Number(i.carbs) } : {}),
										...(i.protein !== undefined ? { protein: Number(i.protein) } : {}),
										...(i.fat !== undefined ? { fat: Number(i.fat) } : {}),
									}
								: undefined;
						return { ...identity, qtyGrams: Number(i.qtyGrams), ...(snapshot ? { snapshot } : {}) };
					}
				)
			: [];
		const res = await convex.mutation(api.meals.updateMeal, {
			sessionToken: token,
			mealId: event.params.id as never,
			name: String(body.name ?? ''),
			description: body.description ? String(body.description) : undefined,
			ingredients: ingredients as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Supprime un repas. */
export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const res = await convex.mutation(api.meals.deleteMeal, {
			sessionToken: token,
			mealId: event.params.id as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Journalise une portion de repas : ?date=...&meal=...&portion=... */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const portions = body.portions !== undefined && body.portions !== null && body.portions !== '' ? Number(body.portions) : undefined;
		const res = await convex.mutation(api.meals.addMealEntry, {
			sessionToken: token,
			date: String(body.date ?? ''),
			meal: String(body.meal ?? ''),
			mealId: event.params.id as never,
			portionGrams: Number(body.portionGrams),
			portions,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
