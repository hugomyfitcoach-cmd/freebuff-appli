import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';
import { sendPushToUser } from '$lib/server/push';

/**
 * Une entrée du Dossier : PATCH pour modifier (titre, note, visibilité
 * « Privé coach ⇄ Partager avec la cliente »), DELETE pour supprimer
 * définitivement (fichier du storage inclus). Réservé à la coach.
 */
export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json().catch(() => ({}));
		const res = await convex.mutation(api.resources.updateResource, {
			sessionToken: token,
			resourceId: event.params.id as never,
			...(typeof body?.title === 'string' ? { title: body.title } : {}),
			...(typeof body?.body === 'string' ? { body: body.body } : {}),
			...(body?.visibility === 'private' || body?.visibility === 'shared' ? { visibility: body.visibility } : {}),
		});
		// Partage = « nouveau contenu envoyé à la cliente » : alerte push
		// IMMÉDIATE après le commit réussi (même contrat que la publication d'un
		// retour de bilan). Le badge interne, lui, est déjà en base — il n'attend
		// jamais le push (canal d'alerte supplémentaire, jamais une dépendance).
		if (res.justShared) {
			void sendPushToUser(
				res.userId,
				{
					title: 'Nouveau contenu partagé',
					body: `${res.title} t'attend dans ton Drive G-FLUX.`,
					url: '/espace/ressources',
					tag: 'coach-resource',
				},
				token
			).catch(() => {});
		}
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const res = await convex.mutation(api.resources.deleteResource, {
			sessionToken: token,
			resourceId: event.params.id as never,
		});
		return json({ ok: res.ok });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
