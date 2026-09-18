import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Prescription d'un exercice de séance : mode, tempo, notes (PATCH). */
export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const id = event.params.id;
	if (!id) return json({ error: 'Exercice introuvable.' }, { status: 400 });
	try {
		const body = (await event.request.json()) as Record<string, unknown>;
		await convex.mutation(api.training.updateSessionExercise, {
			sessionToken: token,
			sessionExerciseId: id as never,
			...(body.mode !== undefined ? { mode: (body.mode === 'time' ? 'time' : 'reps') as never } : {}),
			...(body.tempo !== undefined ? { tempo: (body.tempo as string | null) ?? null } : {}),
			...(body.coachNote !== undefined ? { coachNote: (body.coachNote as string | null) ?? null } : {}),
			...(body.techniqueNote !== undefined ? { techniqueNote: (body.techniqueNote as string | null) ?? null } : {}),
		});
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Duplication avec séries (POST) / retrait de la séance (DELETE). */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const id = event.params.id;
	if (!id) return json({ error: 'Exercice introuvable.' }, { status: 400 });
	try {
		const res = await convex.mutation(api.training.duplicateSessionExercise, {
			sessionToken: token,
			sessionExerciseId: id as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const id = event.params.id;
	if (!id) return json({ error: 'Exercice introuvable.' }, { status: 400 });
	try {
		await convex.mutation(api.training.removeSessionExercise, {
			sessionToken: token,
			sessionExerciseId: id as never,
		});
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
