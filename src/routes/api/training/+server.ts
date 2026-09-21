import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Semaine Entraînement de la cliente — ?weekStart=yyyy-mm-dd (lundi, optionnel). */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/entrainement' });
	const token = event.cookies.get(SESSION_COOKIE);
	const weekStart = event.url.searchParams.get('weekStart') ?? undefined;
	try {
		const res = await convex.query(api.trainingClient.myWeek, {
			sessionToken: token,
			...(weekStart && /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? { weekStart } : {}),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/**
 * « Commencer la séance » — pose startedAt (persisté backend). Ouvrir la
 * séance ne démarre RIEN : seul ce geste explicite lance la mesure.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/entrainement' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.trainingClient.startSession, {
			sessionToken: token,
			scheduledId: String(body.scheduledId) as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
