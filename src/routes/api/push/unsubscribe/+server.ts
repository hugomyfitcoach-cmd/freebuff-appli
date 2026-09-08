import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Désabonnement explicite de la cliente (bouton « Ne plus notifier » ou poussée refusée). */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const endpoint = String(body?.endpoint ?? '');
		if (!endpoint) return json({ error: 'Endpoint manquant.' }, { status: 400 });
		const res = await convex.mutation(api.push.removeSubscription, {
			sessionToken: token,
			endpoint,
		});
		return json({ ok: res.ok });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};