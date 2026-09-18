import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Séance : renommage (PATCH), duplication (POST), suppression (DELETE). */
export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const id = event.params.id;
	if (!id) return json({ error: 'Séance introuvable.' }, { status: 400 });
	try {
		const body = (await event.request.json()) as { name?: string };
		if (!body.name) return json({ error: 'Nom requis.' }, { status: 400 });
		await convex.mutation(api.training.renameSession, {
			sessionToken: token,
			sessionId: id as never,
			name: body.name,
		});
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const id = event.params.id;
	if (!id) return json({ error: 'Séance introuvable.' }, { status: 400 });
	try {
		const res = await convex.mutation(api.training.duplicateSession, {
			sessionToken: token,
			sessionId: id as never,
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
	if (!id) return json({ error: 'Séance introuvable.' }, { status: 400 });
	try {
		await convex.mutation(api.training.deleteSession, { sessionToken: token, sessionId: id as never });
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
