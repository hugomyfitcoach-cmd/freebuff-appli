import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Import d'exercices d'une séance dans plusieurs séances (POST).
 *   { sourceSessionId, sessionExerciseIds, targetSessionIds, position, phaseMode }
 * Copie indépendante côté Convex (une transaction) : la source n'est jamais
 * modifiée et aucun lien n'est conservé entre la source et les cibles.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = (await event.request.json()) as {
			sourceSessionId?: string;
			sessionExerciseIds?: string[];
			targetSessionIds?: string[];
			position?: string;
			phaseMode?: string;
		};
		if (!body.sourceSessionId || !Array.isArray(body.sessionExerciseIds) || !Array.isArray(body.targetSessionIds)) {
			return json({ error: 'Requête invalide.' }, { status: 400 });
		}
		const res = await convex.mutation(api.training.importSessionExercises, {
			sessionToken: token,
			sourceSessionId: body.sourceSessionId as never,
			sessionExerciseIds: body.sessionExerciseIds as never,
			targetSessionIds: body.targetSessionIds as never,
			position: (body.position === 'end' ? 'end' : 'start') as never,
			phaseMode: (body.phaseMode === 'keep' ? 'keep' : 'echauffement') as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
