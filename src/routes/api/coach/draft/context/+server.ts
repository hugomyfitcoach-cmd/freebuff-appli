import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

/**
 * CONTEXTE ASSEMBLÉ DU BROUILLON — BFF, coach uniquement (M2).
 *
 *   GET ?checkinId=…  →  { context }
 *
 * Sert le lien discret « Voir les données envoyées à l'assistant » de la
 * carte du bilan : le coach relit les faits calculés qui partiront dans le
 * prompt, avant toute génération. Lecture seule, aucun appel IA.
 *
 * GARDE-FOUS :
 *  - `requireRole coach` : une session cliente est renvoyée vers son espace
 *    (jamais visible côté cliente — la vue cliente n'appelle pas cette route) ;
 *  - Convex revérifie le coach ET l'appartenance de la cliente (`loadContext`
 *    via `coachDraft.contextPreview`) : un autre coach est refusé ;
 *  - erreurs sobres et génériques : aucun message technique ni identifiant.
 */

/** Message unique côté coach en cas d'échec — sans détail technique. */
const CONTEXT_ERROR = 'Les données du bilan n’ont pas pu être chargées.';

export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);

	const checkinId = (event.url.searchParams.get('checkinId') ?? '').trim();
	if (!checkinId) {
		return json({ error: 'Bilan introuvable.' }, { status: 400 });
	}

	try {
		const context = await convex.query(api.coachDraft.contextPreview, {
			sessionToken: token,
			checkinId: checkinId as never,
		});
		return json({ context });
	} catch (e) {
		// Cause réelle dans les logs serveur uniquement ; le coach ne voit
		// jamais de stack ni de message Convex brut.
		console.error('[coach-draft] contexte indisponible', e instanceof Error ? e.message : e);
		return json({ error: CONTEXT_ERROR }, { status: 502 });
	}
};
