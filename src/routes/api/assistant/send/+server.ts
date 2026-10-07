import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireClientAccess } from '$lib/server/session';
import { userErrMsg } from '$lib/errors.js';

/**
 * ENVOI d'un message à l'Assistant G-FLUX — porte d'entrée PWA (cookie
 * session requis).
 *
 *   POST { threadId?, topic, message, imageDataUrl? }
 *    → 1) `requireClientAccess` : rôle client + HARD LOCK Billing (le lock
 *         Autonomie reste prioritaire, aucune contournement possible) ;
 *    → 2) flag SERVEUR `assistant.access` : refus tôt, sans coût IA, si
 *         l'Assistant n'est pas activé pour ce compte ;
 *    → 3) action Convex `assistant.send` : quota + rate limit atomiques,
 *         écran de sécurité, boucle d'outils (clé OpenAI côté serveur
 *         uniquement) puis persistance.
 *
 * Le navigateur n'envoie jamais rien d'autre que { threadId, topic, message }
 * — aucune permission, aucun chiffre, aucun payload d'écriture.
 */
export const POST: RequestHandler = async (event) => {
	await requireClientAccess(event, { next: '/espace/assistant' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = (await event.request.json()) as {
			threadId?: unknown;
			topic?: unknown;
			message?: unknown;
			imageDataUrl?: unknown;
			today?: unknown;
		};
		const message = typeof body.message === 'string' ? body.message.trim().slice(0, 4000) : '';
		const topic = typeof body.topic === 'string' ? body.topic : 'nutrition';
		const threadId = typeof body.threadId === 'string' && body.threadId ? body.threadId.slice(0, 40) : undefined;
		const imageDataUrl =
			typeof body.imageDataUrl === 'string' && body.imageDataUrl.startsWith('data:image/')
				? body.imageDataUrl.slice(0, 5_000_000)
				: undefined;
		if (!message && !imageDataUrl) {
			return json({ ok: false, reason: 'Écris un message 🙂' }, { status: 400 });
		}

		// Garde flag côté BFF : refus tôt, avant tout appel IA (défense en profondeur).
		const access = await convex
			.query(api.assistant.access, { sessionToken: token })
			.catch(() => ({ enabled: false, limits: { textPerDay: 0, visionPerDay: 0 }, coach: { url: null, message: '' }, mode: '', model: '' }));
		if (!access.enabled) {
			return json({ ok: false, reason: "L'Assistant n'est pas activé pour ce compte." }, { status: 403 });
		}

		// Date LOCALE de la cliente (fuseau horaire réel) — repli : date serveur.
		const today =
			typeof body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
				? body.today
				: new Date().toISOString().slice(0, 10);
		const res = await convex.action(api.assistant.send, {
			sessionToken: token,
			...(threadId ? { threadId } : {}),
			topic,
			message,
			today,
			...(imageDataUrl ? { imageDataUrl } : {}),
		});
		return json({ ...res, limits: access.limits, coach: access.coach });
	} catch (e) {
		return json({ ok: false, reason: userErrMsg(e, "Impossible d'envoyer pour l'instant. Réessaie.") }, { status: 400 });
	}
};
