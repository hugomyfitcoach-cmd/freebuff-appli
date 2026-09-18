import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Séances d'un programme — ajout (POST) et réordonnancement (PUT ?op=reorder). */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const programId = event.url.searchParams.get('programId');
	if (!programId) return json({ error: 'Programme introuvable.' }, { status: 400 });
	try {
		const body = (await event.request.json().catch(() => ({}))) as { name?: string };
		const res = await convex.mutation(api.training.addSession, {
			sessionToken: token,
			programId: programId as never,
			...(body.name ? { name: body.name } : {}),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Drag & drop des séances : { programId, orderedIds: [...] }. */
export const PUT: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = (await event.request.json()) as { programId: string; orderedIds: string[] };
		if (!body.programId || !Array.isArray(body.orderedIds)) {
			return json({ error: 'Requête invalide.' }, { status: 400 });
		}
		await convex.mutation(api.training.reorderSessions, {
			sessionToken: token,
			programId: body.programId as never,
			orderedIds: body.orderedIds as never,
		});
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
