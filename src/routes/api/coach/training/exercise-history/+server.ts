import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Historique / progression par exercice d'une cliente (Vision 360).
 *   GET ?userId=…                 → index des exercices tracés
 *   GET ?userId=…&exerciseId=…    → détail : dernière, meilleure, courbe, séries
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const userId = event.url.searchParams.get('userId') ?? '';
	const exerciseId = event.url.searchParams.get('exerciseId');
	try {
		const res = await convex.query(api.trainingAssign.clientExerciseHistory, {
			sessionToken: token,
			userId: userId as never,
			...(exerciseId ? { exerciseId: exerciseId as never } : {}),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
