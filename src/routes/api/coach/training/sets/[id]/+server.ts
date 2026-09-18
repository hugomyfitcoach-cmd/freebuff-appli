import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Série : duplication (POST, insérée juste après) / suppression (DELETE). */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const id = event.params.id;
	if (!id) return json({ error: 'Série introuvable.' }, { status: 400 });
	try {
		const res = await convex.mutation(api.training.duplicateSet, {
			sessionToken: token,
			setId: id as never,
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
	if (!id) return json({ error: 'Série introuvable.' }, { status: 400 });
	try {
		await convex.mutation(api.training.deleteSet, { sessionToken: token, setId: id as never });
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
