import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Liste des repas personnalisés du client. */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const meals = await convex.query(api.meals.listMeals, { sessionToken: token });
		return json(meals);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/**
 * Crée un repas (totaux calculés côté serveur).
 * `fromSelection: true` → création depuis une sélection du journal : chaque
 * ingrédient porte son identité (foodId / customFoodId / ciqualLabel) ET le
 * snapshot exact de la ligne — le repas reste fidèle même si une fiche
 * source a disparu (mutation dédiée createMealFromSelection).
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		if (body.fromSelection) {
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
						}) => ({
							...(i.ciqualLabel
								? { ciqualLabel: String(i.ciqualLabel) } // fiche de référence Ciqual (ANSES)
								: i.customFoodId
									? { customFoodId: String(i.customFoodId) }
									: i.foodId
									? { foodId: String(i.foodId) }
									: {}), // identité perdue : seul le snapshot parle
							qtyGrams: Number(i.qtyGrams),
							...(i.name ? { name: String(i.name) } : {}),
							...(i.brand ? { brand: String(i.brand) } : {}),
							...(i.imageUrl ? { imageUrl: String(i.imageUrl) } : {}),
							...(i.kcal !== undefined ? { kcal: Number(i.kcal) } : {}),
							...(i.carbs !== undefined ? { carbs: Number(i.carbs) } : {}),
							...(i.protein !== undefined ? { protein: Number(i.protein) } : {}),
							...(i.fat !== undefined ? { fat: Number(i.fat) } : {}),
						})
				)
				: [];
			const res = await convex.mutation(api.meals.createMealFromSelection, {
				sessionToken: token,
				name: String(body.name ?? ''),
				description: body.description ? String(body.description) : undefined,
				ingredients: ingredients as never,
			});
			return json(res);
		}
		const ingredients = Array.isArray(body.ingredients)
			? body.ingredients.map((i: { foodId?: string; customFoodId?: string; ciqualLabel?: string; qtyGrams: number }) => ({
					...(i.ciqualLabel
						? { ciqualLabel: String(i.ciqualLabel) } // fiche de référence Ciqual (ANSES)
						: i.customFoodId
							? { customFoodId: String(i.customFoodId) }
							: { foodId: String(i.foodId ?? '') }),
					qtyGrams: Number(i.qtyGrams),
				}))
			: [];
		const res = await convex.mutation(api.meals.createMeal, {
			sessionToken: token,
			name: String(body.name ?? ''),
			description: body.description ? String(body.description) : undefined,
			ingredients: ingredients as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};