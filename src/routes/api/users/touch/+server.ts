import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * La cliente connectée envoie son fuseau horaire réel (envoyé par son
 * navigateur via Intl) pour que l'expiration du message du coach du jour
 * suive SON minuit local, pas celui du serveur. Nom IANA validé côté Convex
 * (jamais de valeur arbitraire stockée) ; Europe/Paris reste le défaut.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json().catch(() => ({}));
		const timeZone = typeof body?.timeZone === 'string' ? String(body.timeZone) : undefined;
		const res = await convex.mutation(api.users.touch, { sessionToken: token, timeZone });
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
