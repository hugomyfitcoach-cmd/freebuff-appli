import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Fiche nutritionnelle détaillée (Mission R5b) — valeurs /100 g.
 *
 * Une SEULE source de vérité : la requête Convex `foodDetails(source, id)`
 * (contrôles d'accès identiques aux requêtes aliments existantes : session
 * obligatoire côté Convex, fiche perso limitée à sa propriétaire).
 * CLIENTE (Journal) ET COACH (planification) : mêmes fiches, même moteur.
 *
 * `source` : « ciqual » | « food » (OFF) | « custom » | « reference ».
 * Réponse : `{ details }` — `null` si l'aliment est introuvable.
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, ['client', 'coach']);
	const token = event.cookies.get(SESSION_COOKIE);
	const source = event.url.searchParams.get('source') ?? '';
	const id = (event.url.searchParams.get('id') ?? '').trim();
	if (!['ciqual', 'food', 'custom', 'reference'].includes(source) || !id) {
		return json({ error: 'Fiche nutritionnelle : source ou aliment invalide.' }, { status: 400 });
	}
	try {
		const details = await convex.query(api.foodDetails.foodDetails, {
			sessionToken: token,
			source: source as 'ciqual' | 'food' | 'custom' | 'reference',
			id,
		});
		return json({ details });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
