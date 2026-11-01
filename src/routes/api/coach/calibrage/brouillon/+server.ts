import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';
import type { Id } from '../../../../../convex/_generated/dataModel.js';

/**
 * MÉMOIRE DU CALIBRAGE — brouillon de saisie du coach, CÔTÉ COACH UNIQUEMENT.
 *
 * PUT    : sauvegarde automatique (debounce côté page) des décisions en cours
 *          (entrées + semaine type). N'écrit QUE le brouillon : les objectifs
 *          de la cliente (`clientGoals`) ne changent qu'avec « Appliquer à la
 *          fiche » (POST /api/coach/calibrage).
 * DELETE : « Repartir des valeurs par défaut » — efface le brouillon de la
 *          cliente. Aucune autre écriture.
 *
 * L'appartenance coach → cliente est vérifiée côté Convex
 * (`assertCoachOwnsClient`), jamais dans le navigateur.
 */
export const PUT: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.calibrage.saveDraft, {
			sessionToken: token,
			userId: String(body.userId) as Id<'users'>,
			entrees: body.entrees ?? {},
			ecartsSemaine: Array.isArray(body.ecartsSemaine)
				? body.ecartsSemaine.map((e: unknown) => Number(e))
				: [0, 0, 0, 0, 0, 0, 0]
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const userId = event.url.searchParams.get('userId') ?? '';
		const res = await convex.mutation(api.calibrage.clearDraft, {
			sessionToken: token,
			userId: userId as Id<'users'>
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
