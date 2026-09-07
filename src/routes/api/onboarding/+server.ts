import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Sauvegarde du formulaire de démarrage (brouillon autosavé pendant la saisie,
 * puis soumission finale). Les réponses sont rattachées à la cliente par sa
 * session — aucune ressaisie d'identité.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const status = body.status === 'submitted' ? 'submitted' : 'draft';
		const raw = body.answers;
		const answers: Record<string, unknown> = {};
		if (raw && typeof raw === 'object') {
			for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
				if (typeof v === 'string' && v.trim() !== '') answers[k] = v.trim();
				else if (typeof v === 'number' && isFinite(v)) answers[k] = v;
			}
		}
		const res = await convex.mutation(api.onboarding.save, {
			sessionToken: token,
			status,
			answers: answers as never,
		});
		return json({ ok: true, status: res.status, submittedAt: res.submittedAt ?? null });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
