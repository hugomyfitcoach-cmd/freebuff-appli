import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Aliments récemment consommés (dédupliqués) — suggestions avant toute recherche. */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const foods = await convex.query(api.journal.recentFoods, { sessionToken: token });
		return json(foods);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};