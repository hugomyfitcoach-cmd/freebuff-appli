import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Résout les barcodes d'un lot d'aliments — utilisé par le pré-remplissage
 * de la portion mémorisée (on ne consulte Open Food Facts QUE pour des
 * produits réellement présents en cache local ; jamais d'appel réseau dans
 * une simple ouverture de feuille de quantité).
 *
 * GET /api/foods/lookup?ids=a,b,c
 *  → { barcodes: { [id]: string } }
 *
 * Sécurité : réservé client (session vérifiée), portée session, 40 ids max.
 * Résolution en un seul aller-retour : base commune (offId) + aliments
 * personnels de la cliente (isolation stricte côté Convex).
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	const ids = (event.url.searchParams.get('ids') ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.slice(0, 40);
	if (ids.length === 0) return json({ barcodes: {} });
	try {
		// Un seul batch de deux queries en parallèle (base commune + personnels).
		const [common, own] = await Promise.all([
			convex.query(api.journal.resolveBarcodes, {
				sessionToken: token,
				foodIds: ids as never,
			}),
			convex.query(api.customFoods.barcodesByIds, {
				sessionToken: token,
				ids: ids as never,
			}),
		]).catch(() => [{} as Record<string, string>, {} as Record<string, string>]);
		return json({ barcodes: { ...common, ...own } });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
