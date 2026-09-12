import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Recherche d'aliments (Open Food Facts, mis en cache côté Convex).
 *
 * Réponse paginée : `{ items, hasMore }` — tranches de 25 produits classés,
 * la suite est chargée par le client au défilement (scroll infini). `offset`
 * est le décalage dans le classement (0 par défaut), `limit` la taille de
 * tranche (25 par défaut).
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	const q = (event.url.searchParams.get('q') ?? '').trim();
	if (q.length < 2) return json({ items: [], hasMore: false });
	const offset = Math.max(0, Math.floor(Number(event.url.searchParams.get('offset') ?? 0) || 0));
	const limit = Math.min(50, Math.max(1, Math.floor(Number(event.url.searchParams.get('limit') ?? 25) || 25)));
	try {
		const page = await convex.action(api.off.searchFoods, {
			sessionToken: token,
			query: q,
			offset,
			limit,
		});
		return json(page);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
