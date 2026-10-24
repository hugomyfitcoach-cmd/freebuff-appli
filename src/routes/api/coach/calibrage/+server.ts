import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';
import type { Id } from '../../../../convex/_generated/dataModel.js';

/**
 * Onglet « Calibrage » du CRM — CÔTÉ COACH UNIQUEMENT.
 *
 * GET  : pré-remplissage des entrées (poids moyen 7 j, masse grasse US Navy,
 *        pas sur 14 j, réponse « sport » du démarrage, objectifs courants) ;
 * POST : « Appliquer à la fiche » — objectif + macros + date d'effet, écrits
 *        par le chemin existant des objectifs (clientGoals + clientGoalHistory)
 *        avec un instantané du calibrage. Jamais d'application automatique :
 *        seul ce POST écrit, et uniquement après confirmation du coach.
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const userId = event.url.searchParams.get('userId') ?? '';
	try {
		const data = await convex.query(api.calibrage.fiche, {
			sessionToken: token,
			userId: userId as Id<'users'>
		});
		return json(data);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Applique un calibrage à la fiche : { userId, entrees, objectif, effectiveFrom }. */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.calibrage.apply, {
			sessionToken: token,
			userId: String(body.userId) as Id<'users'>,
			entrees: body.entrees ?? {},
			kcal: Number(body.kcal),
			carbs: Number(body.carbs),
			protein: Number(body.protein),
			fat: Number(body.fat),
			maintenanceKcal:
				body.maintenanceKcal === undefined || body.maintenanceKcal === null || body.maintenanceKcal === ''
					? undefined
					: Number(body.maintenanceKcal),
			effectiveFrom: String(body.effectiveFrom ?? '')
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
