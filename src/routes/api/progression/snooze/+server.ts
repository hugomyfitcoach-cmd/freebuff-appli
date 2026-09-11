import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * « Me le rappeler plus tard » — carte Mensurations ou Photos de l'Accueil.
 *
 * Masque la carte + le badge pendant 48 h et débranche les rappels push liés.
 * L'échéance réelle (15 jours / 1 mois) n'est jamais modifiée : après le délai,
 * la carte réapparaît si l'action n'est toujours pas faite.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const reminder = body?.reminder === 'photos' ? 'photos' : 'mensurations';
		const res = await convex.mutation(api.dashboard.snoozeProgressionReminder, {
			sessionToken: token,
			reminder,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
