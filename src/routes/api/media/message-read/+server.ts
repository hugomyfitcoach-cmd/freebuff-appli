import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * La cliente marque réellement le message du coach du jour comme vu (« Vu »).
 * Geste explicite (bouton discret sur la carte Accueil) : une simple
 * consultation de l'Accueil ne consomme jamais l'état non lu.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const res = await convex.mutation(api.dashboard.markCoachMessageRead, { sessionToken: token });
		return json({ ok: res.ok });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};