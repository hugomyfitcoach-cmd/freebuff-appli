import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Enregistre la configuration de cycle de la cliente connectée (carte « Cycle »
 * de l'Accueil). Mêmes questions que l'outil d'origine : contraception,
 * « je n'ai plus de règles régulières », premier jour des dernières règles,
 * durée moyenne. Les valeurs sont stockées sur `users.cycle` (par cliente).
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.users.saveCycle, {
			sessionToken: token,
			contra: body.contra,
			noDate: !!body.noDate,
			lmp: typeof body.lmp === 'string' && body.lmp ? String(body.lmp) : undefined,
			len: typeof body.len === 'number' && Number.isFinite(body.len) ? Number(body.len) : undefined,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
