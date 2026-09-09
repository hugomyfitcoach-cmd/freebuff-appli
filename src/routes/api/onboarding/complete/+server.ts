import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Marque la complétion de l'onboarding de démarrage (idempotent) : horodaté
 * une seule fois, dès que formulaire + mensurations + photos de démarrage
 * sont réellement terminés. Ne supprime jamais de données ; appelé
 * automatiquement par l'Accueil cliente à la première détection.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const res = await convex.mutation(api.onboarding.complete, { sessionToken: token });
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};