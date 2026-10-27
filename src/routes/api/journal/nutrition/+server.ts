import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Bilan nutritionnel du jour (Mission R5c) — ?date=yyyy-mm-dd.
 *
 *  Une SEULE requête Convex (`journal.dayNutritionDetails`), mêmes contrôles
 *  d'accès que le journal : session cliente obligatoire, jour du compte
 *  courant uniquement. Aucun cache : les valeurs suivent le journal en temps
 *  réel après chaque ajout / modification / suppression d'aliment. */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	const date = event.url.searchParams.get('date') ?? '';
	try {
		const bilan = await convex.query(api.journal.dayNutritionDetails, {
			sessionToken: token,
			date,
		});
		return json(bilan);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
