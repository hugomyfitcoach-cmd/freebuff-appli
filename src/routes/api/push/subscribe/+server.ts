import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Enregistre l'abonnement push du navigateur de la cliente connectée. */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const endpoint = String(body?.endpoint ?? '');
		const p256dh = String(body?.keys?.p256dh ?? '');
		const auth = String(body?.keys?.auth ?? '');
		if (!endpoint.startsWith('https://') || !p256dh || !auth) {
			return json({ error: 'Abonnement invalide.' }, { status: 400 });
		}
		const res = await convex.mutation(api.push.saveSubscription, {
			sessionToken: token,
			subscription: { endpoint, keys: { p256dh, auth } },
		});
		return json({ ok: res.ok });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};