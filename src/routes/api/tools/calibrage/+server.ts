import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Id } from '../../../../convex/_generated/dataModel.js';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Données réelles pour le préremplissage des outils « Outils & calibrage »
 * (lecture seule — jamais d'écriture d'objectifs depuis ces outils).
 *
 * - La cliente connectée lit ses propres données ;
 * - La coach peut viser une cliente précise via ?client=<userId> — sans
 *   paramètre, la réponse est hors périmètre (simulateur sans données,
 *   rien n'est inventé).
 *
 * Même garde d'accès que le layout /outils : tout compte connecté
 * (cliente ou coach).
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, ['client', 'coach'], { next: '/outils' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const clientId = event.url.searchParams.get('client');
		const data = await convex.query(api.tools.calibrage, {
			sessionToken: token,
			userId: clientId ? (clientId as Id<'users'>) : undefined,
		});
		return json(data);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
