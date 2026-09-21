import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Suivi Entraînement d'une cliente (Vision 360) — résumé d'exécution. */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const userId = event.url.searchParams.get('userId') ?? '';
	try {
		const res = await convex.query(api.trainingAssign.clientTrainingSummary, {
			sessionToken: token,
			userId: userId as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
