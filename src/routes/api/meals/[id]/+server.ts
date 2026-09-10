import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Modifie un repas (nom, description, ingrédients — totaux recalculés côté serveur). */
export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const ingredients = Array.isArray(body.ingredients)
			? body.ingredients.map((i: { foodId?: string; customFoodId?: string; qtyGrams: number }) => ({
					...(i.customFoodId ? { customFoodId: String(i.customFoodId) } : { foodId: String(i.foodId ?? '') }),
					qtyGrams: Number(i.qtyGrams),
				}))
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
