import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '$lib/convex-api';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Notifications coach — marquage de consultation.
 * POST { notificationId } : une notification passe « à consulter » → « vue ».
 * POST { all: true }      : tout marquer comme vu (badge CRM à zéro).
 * Le statut coach est vérifié côté SvelteKit (requireRole) ET dans la
 * fonction Convex (session + rôle) — un appel direct sans session valide
 * n'accède à rien.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		if (body.all) {
			const res = await convex.mutation(api.notifications.markAllRead, { sessionToken: token });
			return json({ ok: true, marked: res.marked });
		}
		if (!body.notificationId) return json({ error: 'Requête invalide' }, { status: 400 });
		await convex.mutation(api.notifications.markRead, {
			sessionToken: token,
			notificationId: String(body.notificationId) as never,
		});
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
