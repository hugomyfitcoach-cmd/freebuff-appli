import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Ajout d'une série (copie de la précédente) — POST. */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = (await event.request.json()) as { sessionExerciseId: string };
		if (!body.sessionExerciseId) return json({ error: 'Requête invalide.' }, { status: 400 });
		const res = await convex.mutation(api.training.addSet, {
			sessionToken: token,
			sessionExerciseId: body.sessionExerciseId as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Mise à jour d'une série (autosave debouncé) : champs partiels. */
export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = (await event.request.json()) as Record<string, unknown>;
		const setId = String(body.setId ?? '');
		if (!setId) return json({ error: 'Requête invalide.' }, { status: 400 });
		const fields: Record<string, number | null> = {};
		for (const k of ['repsMin', 'repsMax', 'targetWeight', 'targetRir', 'restSeconds', 'durationSeconds'] as const) {
			if (body[k] !== undefined) {
				const v = body[k];
				fields[k] = v === null || v === '' ? null : Number(v);
			}
		}
		await convex.mutation(api.training.updateSet, {
			sessionToken: token,
			setId: setId as never,
			fields: fields as never,
		});
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
