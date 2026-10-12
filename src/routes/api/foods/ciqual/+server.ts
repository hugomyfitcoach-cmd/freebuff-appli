import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Fiches Ciqual (ANSES) pour le bloc « Aliments de référence » — recherche
 * 100 % locale (table embarquée côté Convex, zéro appel réseau externe).
 * Trois références par défaut; une demande explicite peut charger jusqu'à 13.
 * CLIENTE (Journal PWA) ET COACH (CRM) : même moteur `searchCiqual` (mêmes
 * repères — « oeuf » → cru, dur, au plat), jamais deux implémentations.
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, ['client', 'coach']);
	const token = event.cookies.get(SESSION_COOKIE);
	const q = (event.url.searchParams.get('q') ?? '').trim();
	if (q.length < 2) return json([]);
	const rawLimit = Number(event.url.searchParams.get('limit'));
	const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(13, Math.floor(rawLimit))) : 3;
	try {
		const hits = await convex.query(api.ciqual.searchCiqual, { sessionToken: token, query: q, limit });
		return json(hits);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
