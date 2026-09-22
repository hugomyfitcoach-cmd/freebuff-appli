import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Photographier mon REPAS — orchestration complète côté Convex :
 *   POST { imageDataUrl }
 *    → action aiAnalysis.analyzeMeal
 *        1. OpenAI (via CE serveur) : composants reconnus + quantités estimées
 *           (valeurs nutritionnelles IA = secours uniquement) ;
 *        2. MATCH base G-FLUX : « Créés par moi » → OFF déjà importé → CIQUAL
 *           (jamais d'appel live OFF, jamais de nutrition IA comme source) ;
 *    → { ok, components: MatchedComponent[], hint? }
 *
 * Aucun aliment n'est créé, aucun appel à la base globale : la fiche visuelle
 * est construite côté PWA, chaque composant reste modifiable/supprimable.
 * PANNE OpenAI : { ok: false, reason } — recherche & saisie manuelle OK.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = (await event.request.json()) as { imageDataUrl?: unknown };
		if (typeof body.imageDataUrl !== 'string') {
			return json({ ok: false, reason: 'Photo manquante.' }, { status: 400 });
		}
		const res = await convex.action(api.aiAnalysis.analyzeMeal, {
			sessionToken: token,
			imageDataUrl: body.imageDataUrl,
		});
		return json(res);
	} catch (e) {
		return json({ ok: false, reason: errMsg(e) }, { status: 400 });
	}
};
