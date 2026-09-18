import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '$lib/convex-api';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Statistiques de la bibliothèque d'exercices (page de validation). */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const stats = await convex.query(api.exercises.libraryStats, { sessionToken: token });
		return json(stats);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
