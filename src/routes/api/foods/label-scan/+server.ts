import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Photographier une ÉTIQUETTE — porte d'entrée PWA (cookie session requis).
 *
 *   POST { imageDataUrl, barcode? }
 *    → 1) contrôle bêta SERVEUR (betaAccess.flags : food_label_ai_beta) —
 *         refus immédiat des comptes non autorisés (aucun appel OpenAI) ;
 *    → 2) action Convex aiAnalysis.analyzeLabel — re-vérifie session + flags
 *         (défense en profondeur), appelle OpenAI DIRECTEMENT (runtime node)
 *         puis valide/clampe le JSON (kJ→kcal, needsReview) ;
 *    → { ok, analysis, barcode, needsReview[] }
 *
 * ARCHITECTURE : PWA → BFF → Convex (→ OpenAI). Le BFF n'héberge plus l'appel
 * OpenAI : pas de boucle Convex→BFF, la clé vit dans l'env des DEUX runtimes
 * serveur (jamais côté PWA, jamais loggée, jamais PUBLIC_*).
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
		// Garde bêta côté BFF : refus tôt (rapide, sans coût IA ni payload).
		// Repli défensif : si la fonction n'existe pas encore côté Convex, on
		// refuse (jamais d'appel OpenAI sans contrôle serveur confirmé).
		const flags = await convex
			.query(api.betaAccess.flags, { sessionToken: token })
			.catch(() => ({ foodLabelAi: false, mealPhotoAi: false }));
		if (!flags.foodLabelAi) {
			return json({ ok: false, reason: 'Fonction bêta non disponible pour ce compte.' }, { status: 403 });
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
