import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * BILAN NUTRITIONNEL D'UN JOUR D'UNE CLIENTE (coach) — ?userId=…&date=yyyy-mm-dd.
 *
 * Carte « Fibres » du journal coach : mêmes fibres et même repère que la carte
 * Fibres de l'espace cliente pour la journée affichée (calcul Convex partagé
 * `bilanJourForUser`). L'appartenance coach ↔ cliente est vérifiée côté Convex
 * (`assertCoachOwnsClient`). Lecture seule.
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const userId = event.url.searchParams.get('userId') ?? '';
	const date = event.url.searchParams.get('date') ?? '';
	try {
		const bilan = await convex.query(api.journal.dayNutritionDetailsForCoach, {
			sessionToken: token,
			userId: userId as never,
			date,
		});
		return json(bilan);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
