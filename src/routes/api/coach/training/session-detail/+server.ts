import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Détail d'une séance réalisée (Vision 360, LECTURE seule).
 *   GET ?scheduledSessionId=… → séries enregistrées groupées par exercice
 *                                (nom, séries, volume), note et effort.
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const scheduledSessionId = event.url.searchParams.get('scheduledSessionId') ?? '';
	try {
		const res = await convex.query(api.trainingAssign.sessionDetail, {
			sessionToken: token,
			scheduledSessionId: scheduledSessionId as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
