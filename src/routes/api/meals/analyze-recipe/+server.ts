import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Importer une RECETTE par photo — porte d'entrée PWA (cookie session requis).
 *
 *   POST { imageDataUrl }
 *    → 1) contrôle bêta SERVEUR (betaAccess.flags : meal_photo_ai_beta) —
 *         refus immédiat des comptes non autorisés (aucun appel OpenAI) ;
 *    → 2) action Convex aiAnalysis.analyzeRecipe — re-vérifie session + flags,
 *         appelle OpenAI (extraction de la LISTE D'INGRÉDIENTS + quantités),
 *         puis MATCH base G-FLUX (custom → OFF importé → CIQUAL → estimation IA).
 *
 * AUCUN enregistrement automatique : la réponse pré-remplit l'écran de
 * validation (« Recette détectée ») — l'utilisateur corrige avant de créer le
 * repas via le constructeur existant. Panne OpenAI : { ok:false, reason }.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = (await event.request.json()) as { imageDataUrl?: unknown };
		if (typeof body.imageDataUrl !== 'string') {
			return json({ ok: false, reason: 'Photo manquante.' }, { status: 400 });
		}
		// Garde bêta côté BFF (refus tôt, sans appel IA). Repli défensif : si la
		// fonction n'existe pas encore côté Convex, on refuse (jamais d'appel
		// OpenAI sans contrôle serveur confirmé).
		const flags = await convex
			.query(api.betaAccess.flags, { sessionToken: token })
			.catch(() => ({ foodLabelAi: false, mealPhotoAi: false }));
		if (!flags.mealPhotoAi) {
			return json({ ok: false, reason: 'Fonction bêta non disponible pour ce compte.' }, { status: 403 });
		}
		const res = await convex.action(api.aiAnalysis.analyzeRecipe, {
			sessionToken: token,
			imageDataUrl: body.imageDataUrl,
		});
		return json(res);
	} catch (e) {
		return json({ ok: false, reason: errMsg(e) }, { status: 400 });
	}
};
