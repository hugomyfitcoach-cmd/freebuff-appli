import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Duplication d'une sélection du journal vers une autre date.
 *
 * POST { entryIds: [...], plannedIds: [...], targetDate, clientDate? }
 * → copie fidèle (même aliment, même quantité, même repas, même identité
 *   OFF / Ciqual / custom) — les originaux ne sont jamais modifiés.
 *   Date future → items PLANIFIÉS (client_planned) ; le jour même ou le
 *   passé → entrées consommées classiques.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const entryIds = Array.isArray(body.entryIds) ? body.entryIds.map(String) : [];
		const plannedIds = Array.isArray(body.plannedIds) ? body.plannedIds.map(String) : [];
		if (entryIds.length === 0 && plannedIds.length === 0) {
			return json({ error: 'Aucun aliment sélectionné.' }, { status: 400 });
		}
		const res = await convex.mutation(api.journal.duplicateEntries, {
			sessionToken: token,
			entryIds: entryIds as never,
			plannedIds: plannedIds as never,
			targetDate: String(body.targetDate ?? ''),
			// Date locale navigateur — frontière « futur » fiable la nuit.
			clientDate: /^\d{4}-\d{2}-\d{2}$/.test(String(body.clientDate ?? '')) ? String(body.clientDate) : undefined,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
