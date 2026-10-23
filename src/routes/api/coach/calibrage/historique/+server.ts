import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';
import type { Id } from '../../../../../convex/_generated/dataModel.js';

/**
 * Historique des objectifs d'une cliente — LECTURE SEULE, côté coach uniquement.
 *
 * GET : liste des changements d'objectifs (du plus récent au plus ancien) fondée
 *       sur `calibrageSnapshots` + `clientGoalHistory`, avec origine (« Calibrage »
 *       ou « Saisie manuelle ») et détail des instantanés. La query Convex
 *       `calibrage.historique` ré-vérifie l'autorisation côté serveur (coach de
 *       la cliente) — jamais de confiance dans l'UI.
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const userId = event.url.searchParams.get('userId') ?? '';
	try {
		const lignes = await convex.query(api.calibrage.historique, {
			sessionToken: token,
			userId: userId as Id<'users'>
		});
		return json(lignes);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
