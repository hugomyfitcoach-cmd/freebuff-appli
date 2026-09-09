import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Enregistre le statut de l'onboarding installation PWA sur le COMPTE
 * (survit au logout). Le navigateur ne prétend jamais qu'une icône existe :
 * seul un lancement standalone ou appinstalled confirme « installed_confirmed ».
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json().catch(() => ({}));
		const status = body?.status;
		const platform = body?.platform;
		if (status !== 'skipped' && status !== 'tutorial_completed' && status !== 'installed_confirmed') {
			return json({ error: 'Statut invalide.' }, { status: 400 });
		}
		if (platform !== undefined && platform !== 'ios' && platform !== 'android') {
			return json({ error: 'Plateforme invalide.' }, { status: 400 });
		}
		const res = await convex.mutation(api.users.setPwaInstall, { sessionToken: token, status, platform });
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
