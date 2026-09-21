import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Vue complète d'une séance planifiée (exercices, séries, dernières perfs). */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/entrainement' });
	const token = event.cookies.get(SESSION_COOKIE);
	const id = event.params.id;
	if (!id) return json({ error: 'Séance introuvable.' }, { status: 400 });
	try {
		const res = await convex.query(api.trainingClient.scheduledSession, {
			sessionToken: token,
			scheduledId: id as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 404 });
	}
};

/**
 * Fin de séance — même parcours depuis le mode libre ou le guidé.
 * `skipped: true` = « Je n'ai pas réalisé cette séance » (clôture sans dépense).
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/entrainement' });
	const token = event.cookies.get(SESSION_COOKIE);
	const id = event.params.id;
	if (!id) return json({ error: 'Séance introuvable.' }, { status: 400 });
	try {
		const body = await event.request.json();
		await convex.mutation(api.trainingClient.completeSession, {
			sessionToken: token,
			scheduledId: id as never,
			...(body.durationMin !== undefined ? { durationMin: Number(body.durationMin) } : {}),
			...(body.difficulty !== undefined ? { difficulty: Number(body.difficulty) } : {}),
			...(body.note !== undefined ? { note: String(body.note) } : {}),
			...(body.skipped === true ? { skipped: true } : {}),
		});
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/**
 * Corrige la durée d'une séance terminée — la dépense sportive existante est
 * mise à jour (jamais dupliquée).
 */
export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/entrainement' });
	const token = event.cookies.get(SESSION_COOKIE);
	const id = event.params.id;
	if (!id) return json({ error: 'Séance introuvable.' }, { status: 400 });
	try {
		const body = await event.request.json();
		await convex.mutation(api.trainingClient.updateSessionDuration, {
			sessionToken: token,
			scheduledId: id as never,
			durationMin: Number(body.durationMin),
		});
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
