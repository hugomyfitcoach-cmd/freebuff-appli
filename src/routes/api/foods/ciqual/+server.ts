import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Fiches Ciqual (ANSES) pour le bloc « Aliments de référence » — recherche
 * 100 % locale (table embarquée côté Convex, zéro appel réseau externe).
 * Jusqu'à 5 références VRAIMENT pertinentes ; liste vide si aucune.
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	const q = (event.url.searchParams.get('q') ?? '').trim();
	if (q.length < 2) return json([]);
	try {
		const hits = await convex.query(api.ciqual.searchCiqual, { sessionToken: token, query: q });
		return json(hits);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
