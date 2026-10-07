import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireClientAccess } from '$lib/server/session';
import { userErrMsg } from '$lib/errors.js';

/**
 * CONFIRMATION d'une action préparée par l'Assistant — le SEUL chemin
 * d'écriture (§15/§16).
 *
 *   POST { actionId, decision: 'confirm' | 'cancel' | 'undo' }
 *
 * Le client n'envoie qu'un identifiant : le payload (aliments, quantités,
 * dates, mesures) est celui calculé côté serveur à la préparation, relu par
 * la mutation Convex (propriétaire, statut, expiration, bornes). Aucune
 * écriture ne peut être fabriquée depuis le navigateur.
 */
export const POST: RequestHandler = async (event) => {
	await requireClientAccess(event, { next: '/espace/assistant' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = (await event.request.json()) as { actionId?: unknown; decision?: unknown };
		const actionId = typeof body.actionId === 'string' ? body.actionId.trim().slice(0, 40) : '';
		const decision = body.decision;
		if (!actionId || (decision !== 'confirm' && decision !== 'cancel' && decision !== 'undo')) {
			return json({ ok: false, reason: 'Action invalide.' }, { status: 400 });
		}
		const res = await convex.mutation(api.assistant.resolveAction, { sessionToken: token, actionId, decision });
		return json(res);
	} catch (e) {
		return json({ ok: false, reason: userErrMsg(e, "Cette action n'a pas pu être traitée. Réessaie.") }, { status: 400 });
	}
};
