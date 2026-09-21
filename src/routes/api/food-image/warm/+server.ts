import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';
import { offThumb100 } from '$lib/foodImage';

/**
 * Préchauffage du miroir G-FLUX des miniatures alimentaires.
 *
 * POST { images: [{ offId, imageUrl }, …] (≤ 12) }
 * → { results: [{ offId, ok, cached?|mirrored?|reason? }] }
 *
 * - Ne fait JAMAIS lever un incident OFF : chaque item renvoie son statut.
 * - Le cache est GLOBAL : un produit miroir par une cliente sert toutes les
 *   autres (déduplication stricte par offId côté Convex).
 * - Appelé en fire-and-forget par l'app (sélection d'un aliment / ajout au
 *   Journal) — jamais dans le chemin critique de la recherche ni de l'ajout.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const items = Array.isArray(body?.images) ? body.images.slice(0, 12) : [];
		if (!items.length) return json({ results: [] });

		// L'appel ne part que si une miniature OFF 100 px est dérivable —
		// jamais pour une URL non-OFF (stock interne, Ciqual, custom foods).
		const candidates = items
			.map((it: { offId?: unknown; imageUrl?: unknown }) => ({
				offId: typeof it?.offId === 'string' ? it.offId : '',
				imageUrl: typeof it?.imageUrl === 'string' ? it.imageUrl : '',
			}))
			.filter((it: { offId: string; imageUrl: string }) => /^[0-9A-Za-z.\-]{4,32}$/.test(it.offId))
			.map((it: { offId: string; imageUrl: string }) => ({
				offId: it.offId,
				sourceUrl: it.imageUrl,
				thumbnailSourceUrl: offThumb100(it.imageUrl) ?? it.imageUrl,
			}));
		if (!candidates.length) return json({ results: [] });

		const results = await convex.action(api.foodImages.mirrorBatch, { items: candidates });
		return json({ results });
	} catch (e) {
		// Échec silencieux : le préchauffage n'est jamais une erreur UX.
		console.warn('[food-image/warm] préchauffage impossible :', errMsg(e));
		return json({ results: [], error: errMsg(e) }, { status: 200 });
	}
};
