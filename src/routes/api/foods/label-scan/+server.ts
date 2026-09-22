import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Photographier une ÉTIQUETTE — orchestration complète côté Convex :
 *   POST { imageDataUrl, barcode? }
 *    → action aiAnalysis.analyzeLabel (OpenAI via CE serveur, JSON validé)
 *    → { ok, analysis, barcode, needsReview[] }
 *
 * L'IA ne crée JAMAIS l'aliment : elle préremplit le formulaire « Créés par
 * moi » ; la cliente vérifie/corrige puis valide. Le code-barres transmis
 * (lu côté navigateur par le vrai décodeur) sert d'information produit —
 * jamais de numéro deviné par l'IA.
 *
 * PANNE OpenAI : { ok: false, reason } — le scan barcode, la recherche et la
 * saisie manuelle restent pleinement fonctionnels.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = (await event.request.json()) as { imageDataUrl?: unknown; barcode?: unknown };
		if (typeof body.imageDataUrl !== 'string') {
			return json({ ok: false, reason: 'Photo manquante.' }, { status: 400 });
		}
		const res = await convex.action(api.aiAnalysis.analyzeLabel, {
			sessionToken: token,
			imageDataUrl: body.imageDataUrl,
			barcode: typeof body.barcode === 'string' ? body.barcode : undefined,
		});
		return json(res);
	} catch (e) {
		return json({ ok: false, reason: errMsg(e) }, { status: 400 });
	}
};
