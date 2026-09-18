import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '$lib/convex-api';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Fiche d'un exercice : GET (lecture), PATCH (masquer/afficher — le champ
 * `hidden` est le seul modifiable pour l'instant), POST (création d'un
 * exercice personnalisé coach — préfiguration des créations sans source).
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	// Le paramètre de route est l'id (interne Convex OU gfluxExerciseId portable).
	const id = event.params.id ?? event.url.searchParams.get('id') ?? '';
	if (!id) return json({ error: 'id requis.' }, { status: 400 });
	try {
		const exercise = await convex.query(api.exercises.exerciseById, {
			sessionToken: token,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			id: id as any,
		});
		if (!exercise) return json({ error: 'Exercice introuvable.' }, { status: 404 });
		return json(exercise);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = (await event.request.json()) as { id?: string; hidden?: boolean };
		if (!body.id || typeof body.hidden !== 'boolean') {
			return json({ error: 'id et hidden requis.' }, { status: 400 });
		}
		const out = await convex.mutation(api.exercises.setHidden, {
			sessionToken: token,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			id: body.id as any,
			hidden: body.hidden,
		});
		return json(out);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = (await event.request.json()) as {
			name?: string;
			muscleGroup?: string;
			equipment?: string;
			bodyPart?: string;
			category?: string;
			secondaryMuscles?: string[];
			instructions?: string[];
			mediaUrl?: string;
			thumbnailUrl?: string;
		};
		if (!body.name || body.name.trim().length < 2) {
			return json({ error: 'Nom trop court (2 caractères minimum).' }, { status: 400 });
		}
		const out = await convex.mutation(api.exercises.createCustomExercise, {
			sessionToken: token,
			name: body.name,
			muscleGroup: body.muscleGroup || undefined,
			equipment: body.equipment || undefined,
			bodyPart: body.bodyPart || undefined,
			category: body.category || undefined,
			secondaryMuscles: body.secondaryMuscles,
			instructions: body.instructions,
			mediaUrl: body.mediaUrl || undefined,
			thumbnailUrl: body.thumbnailUrl || undefined,
		});
		return json(out);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
