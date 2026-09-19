import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * URL d'upload Convex DIRECTE pour le Drive (multi-fichiers).
 *
 * ROOT CAUSE (bug « Unexpected end of JSON input » sur upload multi-fichiers) :
 * le POST multipart historique relayait TOUS les octets par la fonction Netlify
 * (BFF). Au-delà de quelques fichiers (~6 Mo de payload), la fonction Netlify
 * est tuée avant toute réponse → corps vide → `response.json()` côté navigateur
 * plantait sur « Unexpected end of JSON input ». Même cause déjà corrigée sur
 * les photos de suivi (photo par photo).
 *
 * CORRECTION — byte-passing (pattern Convex documenté) : le BFF ne transporte
 * plus aucun octet. Il renvoie l'URL d'upload courte durée du storage Convex ;
 * le navigateur poste le fichier DIRECTEMENT dessus. Chaque requête transporte
 * UN seul fichier → le Drive multi-fichiers reste intact, sans jamais franchir
 * la limite de la fonction. L'entrée Drive n'est créée qu'ensuite via
 * POST /api/coach/resources (JSON + storageIds) — un échec réseau pendant un
 * fichier ne peut plus laisser d'entrée incomplète (ou d'orphelins invisibles :
 * les blobs non rattachés sont purgés par le cron existant).
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const uploadUrl = await convex.mutation(api.media.generateUploadUrl, { sessionToken: token });
		return json({ ok: true, uploadUrl });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
