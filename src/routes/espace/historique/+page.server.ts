import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'client', { next: '/espace/historique' });
	const token = event.cookies.get(SESSION_COOKIE);
	const checkins = await convex.query(api.checkins.myCheckins, { sessionToken: token });
	// Médias publiés des retours (audios + pièces jointes), groupés par bilan.
	const published = await convex.query(api.media.myPublished, { sessionToken: token }).catch(() => null);
	// La cliente a réellement ouvert la page qui affiche les retours :
	// chaque retour publié et non encore consulté passe en « lu ».
	// Le badge « Bilans » et la carte « Retours de mon coach » disparaissent alors.
	const unread = (checkins as { _id: string; status: string; feedbackReadAt?: number; feedbackAt?: number; _creationTime: number }[]).filter(
		(c) => c.status === 'retour_envoye' && (c.feedbackReadAt == null || c.feedbackReadAt < (c.feedbackAt ?? c._creationTime))
	);
	for (const c of unread) {
		await convex
			.mutation(api.dashboard.markFeedbackRead, {
				sessionToken: token,
				checkinId: c._id as never,
			})
			.catch(() => {});
	}
	// Un brouillon (retour non publié) ne doit jamais quitter le serveur : on
	// retire le texte tant que le statut n'est pas « retour_envoye ». La coach
	// peut donc rédiger librement sans que rien ne filtre côté cliente.
	const safe = checkins.map((c) => {
		if (c.status === 'retour_envoye') return c;
		const { feedback: _fb, feedbackAt: _fa, ...rest } = c;
		return rest;
	});
	return {
		checkins: safe as typeof checkins,
		media: (published?.byCheckin ?? {}) as Record<string, unknown[]>,
	};
};