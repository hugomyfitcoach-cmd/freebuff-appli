import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * ALIMENTS DE RÉFÉRENCE G-FLUX (Mission R3) — section « Aliments de référence
 * G-Flux » du Guide nutrition & recettes (coach uniquement).
 *
 * GET    : fiches du coach connecté.
 * POST   : création { name, kcal, proteinG, carbsG, fatG, cookingState? }.
 * PATCH  : modification { referenceFoodId, name, kcal, proteinG, carbsG, fatG, cookingState? }.
 * DELETE : suppression ?id=<referenceFoodId>.
 *
 * Écriture réservée au coach PROPRIÉTAIRE (contrôle Convex, even if the BFF
 * role check is bypassed). La cliente lit les fiches de son coach via la
 * recherche (`/api/foods/ciqual`) — jamais par cette route.
 */
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value));

function fields(body: Record<string, unknown>) {
	// Mode de cuisson facultatif (valeurs de cookedState.ts) — vide = non
	// précisé (champ absent, cuisson détectée d'après le nom).
	const cookingState = String(body.cookingState ?? '').trim();
	return {
		name: String(body.name ?? ''),
		kcal: num(body.kcal),
		proteinG: num(body.proteinG),
		carbsG: num(body.carbsG),
		fatG: num(body.fatG),
		...(cookingState ? { cookingState } : {}),
	};
}

export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const rows = await convex.query(api.referenceFoods.list, { sessionToken: token });
		return json({ rows });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = (await event.request.json()) as Record<string, unknown>;
		const res = await convex.mutation(api.referenceFoods.create, {
			sessionToken: token,
			...fields(body),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = (await event.request.json()) as Record<string, unknown>;
		const id = String(body.referenceFoodId ?? '');
		if (!id) return json({ error: 'Aliment de référence requis.' }, { status: 400 });
		const res = await convex.mutation(api.referenceFoods.update, {
			sessionToken: token,
			referenceFoodId: id as never,
			...fields(body),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const id = event.url.searchParams.get('id') ?? '';
		if (!id) return json({ error: 'Aliment de référence requis.' }, { status: 400 });
		const res = await convex.mutation(api.referenceFoods.remove, {
			sessionToken: token,
			referenceFoodId: id as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
