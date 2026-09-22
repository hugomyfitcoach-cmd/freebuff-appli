import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';
import { analyzeMealImage, OpenAiUnavailableError } from '$lib/server/openai';

/**
 * Analyse IA d'une photo de repas — la SEULE porte entre la PWA et OpenAI
 * (clé jamais exposée). Appelée par l'action Convex `aiAnalysis.analyzeMeal`
 * (elle-même appelée par /api/meals/analyze). OpenAI reconnait les aliments
 * et propose les quantités ; la nutrition reste du ressort de la base G-FLUX.
 */
export const POST: RequestHandler = async (event) => {
	try {
		await requireRole(event, 'client', { next: '/espace/journal' });
		const body = (await event.request.json()) as { imageDataUrl?: unknown };
		if (typeof body.imageDataUrl !== 'string') {
			return json({ ok: false, error: 'Photo manquante.' }, { status: 400 });
		}
		const { result, usage } = await analyzeMealImage(body.imageDataUrl);
		return json({ ok: true, components: result, usage });
	} catch (e) {
		if (e instanceof OpenAiUnavailableError) {
			return json({ ok: false, error: e.message }, { status: 503 });
		}
		return json({ ok: false, error: errMsg(e) }, { status: 400 });
	}
};
