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

/** Crée un repas (totaux calculés côté serveur). */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
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