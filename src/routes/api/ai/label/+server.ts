import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';
import { analyzeLabelImage, OpenAiUnavailableError } from '$lib/server/openai';

/**
 * Analyse IA d'une photo d'étiquette — la SEULE porte entre la PWA et
 * OpenAI (clé jamais exposée). Appelée par l'action Convex `aiAnalysis.analyzeLabel`
 * (elle-même appelée par /api/foods/label-scan), jamais directement par la PWA.
 * Réponse : JSON structuré déjà validé + usage (traçabilité).
 */
export const POST: RequestHandler = async (event) => {
	try {
		await requireRole(event, 'client', { next: '/espace/journal' });
		const body = (await event.request.json()) as { imageDataUrl?: unknown };
		if (typeof body.imageDataUrl !== 'string') {
			return json({ ok: false, error: 'Photo manquante.' }, { status: 400 });
		}
		const { analysis, usage } = await analyzeLabelImage(body.imageDataUrl);
		return json({ ok: true, analysis, usage });
	} catch (e) {
		if (e instanceof OpenAiUnavailableError) {
			return json({ ok: false, error: e.message }, { status: 503 });
		}
		return json({ ok: false, error: errMsg(e) }, { status: 400 });
	}
};
