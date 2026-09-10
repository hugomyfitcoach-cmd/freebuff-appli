import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Modifie la quantité d'une entrée d'un client (coach). */
export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.journal.updateEntryQtyForCoach, {
			sessionToken: token,
			userId: String(body.userId) as never,
			entryId: event.params.id as never,
			qtyGrams: Number(body.qtyGrams),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Supprime une entrée d'un client (coach). */
export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const userId = event.url.searchParams.get('userId') ?? '';
		const res = await convex.mutation(api.journal.removeEntryForCoach, {
			sessionToken: token,
			userId: userId as never,
			entryId: event.params.id as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};