import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Actions sur les items PLANIFIÉS (non consommés) du journal client :
 *   POST   { plannedId }                → Mangé (planned → consommé)
 *   POST   { plannedIds: [...] }        → Mangé (validation en masse)
 *   PATCH  { plannedId, qtyGrams, meal? } → modifier la quantité (reste planifié)
 *   PUT    { plannedId, foodId|customFoodId, qtyGrams } → remplacer
 *   DELETE ?plannedId=…                → supprimer la proposition (ce jour)
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		if (Array.isArray(body.plannedIds)) {
			const res = await convex.mutation(api.journal.eatManyPlanned, {
				sessionToken: token,
				plannedIds: body.plannedIds as never,
			});
			return json(res);
		}
		const res = await convex.mutation(api.journal.eatPlanned, {
			sessionToken: token,
			plannedId: String(body.plannedId ?? '') as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.journal.updatePlannedQty, {
			sessionToken: token,
			plannedId: String(body.plannedId ?? '') as never,
			qtyGrams: Number(body.qtyGrams),
			...(body.meal ? { meal: String(body.meal) } : {}),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const PUT: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.journal.replacePlanned, {
			sessionToken: token,
			plannedId: String(body.plannedId ?? '') as never,
			foodId: (body.foodId ?? undefined) as never,
			customFoodId: (body.customFoodId ?? undefined) as never,
			qtyGrams: Number(body.qtyGrams),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	const plannedId = event.url.searchParams.get('plannedId') ?? '';
	try {
		const res = await convex.mutation(api.journal.removePlanned, {
			sessionToken: token,
			plannedId: plannedId as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
