import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Bibliothèque d'exercices (module Entraînement — socle de validation) :
 * recherche + filtres (groupe musculaire / équipement / source) + pagination.
 * ?q=&muscleGroup=&equipment=&source=&includeHidden=1&offset=&limit=
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const url = event.url.searchParams;
	try {
		const result = await convex.query(api.exercises.searchExercises, {
			sessionToken: token,
			query: url.get('q') ?? undefined,
			muscleGroup: url.get('muscleGroup') || undefined,
			equipment: url.get('equipment') || undefined,
			bodyPart: url.get('bodyPart') || undefined,
			source: url.get('source') || undefined,
			includeHidden: url.get('includeHidden') === '1',
			offset: Number(url.get('offset') ?? 0) || 0,
			limit: Number(url.get('limit') ?? 24) || 24,
		});
		return json(result);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
