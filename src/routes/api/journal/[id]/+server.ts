import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Met à jour la quantité (et éventuellement le repas) d'une entrée consommée. */
export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		// « Remettre en planifié » : l'entrée consommée redevient grisée/non comptée.
		if (body.unEat) {
			const res = await convex.mutation(api.journal.uneatEntry, {
				sessionToken: token,
				entryId: event.params.id as never,
			});
			return json(res);
		}
		const res = await convex.mutation(api.journal.updateEntryQty, {
			sessionToken: token,
			entryId: event.params.id as never,
			qtyGrams: Number(body.qtyGrams),
			...(body.meal ? { meal: String(body.meal) } : {}),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Supprime une entrée consommée. */
export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const res = await convex.mutation(api.journal.removeEntry, {
			sessionToken: token,
			entryId: event.params.id as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
