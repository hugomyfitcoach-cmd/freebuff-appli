import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Progression cliente.
 *   GET ?exerciseId=… → détail d'un exercice (dernière, meilleure, courbe, séries)
 *   GET ?sessions=1   → historique des séances réalisées (résumé)
 *   GET sans param    → index des exercices tracés
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/entrainement' });
	const token = event.cookies.get(SESSION_COOKIE);
	const exerciseId = event.url.searchParams.get('exerciseId');
	try {
		if (exerciseId) {
			const res = await convex.query(api.trainingClient.myExerciseHistory, {
				sessionToken: token,
				exerciseId: exerciseId as never,
			});
			return json(res);
		}
		if (event.url.searchParams.get('sessions')) {
			const res = await convex.query(api.trainingClient.mySessionHistory, { sessionToken: token });
			return json(res);
		}
		const res = await convex.query(api.trainingClient.myTrackedExercises, { sessionToken: token });
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
