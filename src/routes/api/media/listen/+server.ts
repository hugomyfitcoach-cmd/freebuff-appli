import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Première écoute réelle d'un audio (retour de bilan ou message) par la cliente. */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const mediaId = String(body.mediaId ?? '');
		if (!mediaId) return json({ error: 'Média manquant.' }, { status: 400 });
		const res = await convex.mutation(api.media.markListened, {
			sessionToken: token,
			mediaId: mediaId as never,
		});
		return json({ ok: res.ok });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
