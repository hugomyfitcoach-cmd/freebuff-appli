import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Les aliments personnels du client (« Créés par moi »). */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const foods = await convex.query(api.customFoods.list, { sessionToken: token });
		return json(foods);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/**
 * Crée un aliment personnel : valeurs pour 100 g saisies depuis l'étiquette.
 * { name, brand?, kcal100, carbs100, protein100, fat100, servingQty? }
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
		const res = await convex.mutation(api.customFoods.create, {
			sessionToken: token,
			name: String(body.name ?? ''),
			brand: body.brand ? String(body.brand) : undefined,
			kcal100: Number(body.kcal100),
			carbs100: Number(body.carbs100 ?? 0),
			protein100: Number(body.protein100 ?? 0),
			fat100: Number(body.fat100 ?? 0),
			servingQty: num(body.servingQty),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Supprime un aliment personnel : ?id=… */
export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const id = event.url.searchParams.get('id') ?? '';
		if (!id) return json({ error: 'Aliment manquant.' }, { status: 400 });
		const res = await convex.mutation(api.customFoods.remove, {
			sessionToken: token,
			customFoodId: id as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};