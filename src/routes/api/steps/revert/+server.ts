import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Revenir à la valeur Apple Santé : { date } — supprime la correction manuelle du jour. */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/pas' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const date = typeof body?.date === 'string' ? body.date : '';
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date invalide.');
		const res = await convex.mutation(api.steps.revertToHealth, { sessionToken: token, date });
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
