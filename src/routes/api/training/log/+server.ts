import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Enregistre UNE série réalisée — l'unique point d'écriture de l'historique,
 * partagé par le mode libre et le mode guidé (idempotent par série).
 * POST { scheduledId, sessionExerciseId, setOrder, reps?, weightKg?, durationSeconds?, done }
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/entrainement' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.trainingClient.logSet, {
			sessionToken: token,
			scheduledId: String(body.scheduledId ?? '') as never,
			sessionExerciseId: String(body.sessionExerciseId ?? '') as never,
			setOrder: Number(body.setOrder ?? 0),
			...(body.reps !== undefined && body.reps !== null ? { reps: Number(body.reps) } : {}),
			...(body.weightKg !== undefined && body.weightKg !== null ? { weightKg: Number(body.weightKg) } : {}),
			...(body.durationSeconds !== undefined && body.durationSeconds !== null
				? { durationSeconds: Number(body.durationSeconds) }
				: {}),
			done: Boolean(body.done),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
