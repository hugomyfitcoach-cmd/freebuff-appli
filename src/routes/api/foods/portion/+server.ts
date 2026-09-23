import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Portion mémorisée de la cliente pour un aliment (pré-remplissage de la
 * feuille de quantité). Préférence UTILISATEUR : jamais les données de
 * l'aliment, jamais la portion d'une autre cliente.
 *
 * GET /api/foods/portion?foodId=… | ?customFoodId=… | ?ciqualLabel=…
 *  → { qtyGrams, meal?, portions? } | null
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	const p = event.url.searchParams;
	const args = {
		foodId: (p.get('foodId') ?? undefined) as never,
		customFoodId: (p.get('customFoodId') ?? undefined) as never,
		ciqualLabel: p.get('ciqualLabel') ?? undefined,
	};
	if (!args.foodId && !args.customFoodId && !args.ciqualLabel) return json(null);
	try {
		const portion = await convex.query(api.foodPortions.getPortion, {
			sessionToken: token,
			...args,
		});
		return json(portion);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
