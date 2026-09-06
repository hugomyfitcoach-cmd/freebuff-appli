import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Recherche d'aliments (Open Food Facts, mis en cache côté Convex). */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	const q = (event.url.searchParams.get('q') ?? '').trim();
	if (q.length < 2) return json([]);
	try {
		const foods = await convex.action(api.off.searchFoods, {
			sessionToken: token,
			query: q,
		});
		return json(foods);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};