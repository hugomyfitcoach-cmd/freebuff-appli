import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * ••• d'une séance programmée (cliente) : déplacer / dupliquer / supprimer.
 *   PATCH  { scheduledId, date }            → déplacer
 *   POST   { scheduledId, date }            → dupliquer (copie à la date donnée)
 *   DELETE ?scheduledId=…                   → supprimer (annulée, jamais réalisée)
 */
export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/entrainement' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		await convex.mutation(api.trainingClient.moveMySession, {
			sessionToken: token,
			scheduledId: String(body.scheduledId ?? '') as never,
			date: String(body.date ?? ''),
		});
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/entrainement' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.trainingClient.duplicateMySession, {
			sessionToken: token,
			scheduledId: String(body.scheduledId ?? '') as never,
			date: String(body.date ?? ''),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/entrainement' });
	const token = event.cookies.get(SESSION_COOKIE);
	const scheduledId = event.url.searchParams.get('scheduledId') ?? '';
	try {
		await convex.mutation(api.trainingClient.deleteMySession, {
			sessionToken: token,
			scheduledId: scheduledId as never,
		});
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
