import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Ajout d'un exercice de la bibliothèque à une séance (POST). */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = (await event.request.json()) as { sessionId: string; exerciseId: string; mode?: string };
		if (!body.sessionId || !body.exerciseId) return json({ error: 'Requête invalide.' }, { status: 400 });
		const res = await convex.mutation(api.training.addSessionExercise, {
			sessionToken: token,
			sessionId: body.sessionId as never,
			exerciseId: body.exerciseId as never,
			mode: (body.mode === 'time' ? 'time' : body.mode === 'reps' ? 'reps' : undefined) as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Drag & drop des exercices d'une séance : { sessionId, orderedIds: [...] }. */
export const PUT: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = (await event.request.json()) as { sessionId: string; orderedIds: string[] };
		if (!body.sessionId || !Array.isArray(body.orderedIds)) {
			return json({ error: 'Requête invalide.' }, { status: 400 });
		}
		await convex.mutation(api.training.reorderSessionExercises, {
			sessionToken: token,
			sessionId: body.sessionId as never,
			orderedIds: body.orderedIds as never,
		});
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
