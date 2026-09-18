import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Programme complet (éditeur) — GET. */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const id = event.params.id;
	if (!id) return json({ error: 'Programme introuvable.' }, { status: 400 });
	try {
		const data = await convex.query(api.training.programFull, {
			sessionToken: token,
			programId: id as never,
		});
		return json(data);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 404 });
	}
};

/**
 * Mise à jour des champs du programme (PATCH) — autosave : le front envoie
 * uniquement les champs modifiés ; `null` vide un champ facultatif.
 */
export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const id = event.params.id;
	if (!id) return json({ error: 'Programme introuvable.' }, { status: 400 });
	try {
		const body = (await event.request.json()) as Record<string, unknown>;
		await convex.mutation(api.training.updateProgram, {
			sessionToken: token,
			programId: id as never,
			fields: {
				...(body.name !== undefined ? { name: String(body.name) } : {}),
				...(body.description !== undefined ? { description: (body.description as string | null) || null } : {}),
				...(body.goal !== undefined ? { goal: (body.goal as string | null) as never } : {}),
				...(body.level !== undefined ? { level: (body.level as string | null) as never } : {}),
				...(body.sessionsPerWeek !== undefined
					? { sessionsPerWeek: body.sessionsPerWeek === null ? null : Number(body.sessionsPerWeek) }
					: {}),
			},
		});
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Duplication (POST ?/duplicate) et suppression (DELETE). */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const id = event.params.id;
	if (!id) return json({ error: 'Programme introuvable.' }, { status: 400 });
	try {
		const res = await convex.mutation(api.training.duplicateProgram, {
			sessionToken: token,
			programId: id as never,
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
	if (!id) return json({ error: 'Programme introuvable.' }, { status: 400 });
	try {
		await convex.mutation(api.training.deleteProgram, { sessionToken: token, programId: id as never });
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
