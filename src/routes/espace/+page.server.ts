import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

/**
 * Chargement propre à l'Accueil : l'historique des retours de bilan affiché
 * tout en bas (« Mes retours de bilan »). On réutilise le même moteur que la
 * page « Mes bilans » (/espace/historique) — mais on NE marque PAS les
 * retours comme lus ici : la simple consultation de l'Accueil ne doit jamais
 * consommer l'état « Nouveau retour » (seule l'ouverture réelle du retour le
 * fait, dans /espace/historique).
 */
export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'client', { next: '/espace' });
	const token = event.cookies.get(SESSION_COOKIE);
	const checkins = await convex.query(api.checkins.myCheckins, { sessionToken: token });
	// Médias publiés des retours (audios + pièces jointes), groupés par bilan.
	const published = await convex.query(api.media.myPublished, { sessionToken: token }).catch(() => null);
	// Configuration du suivi de cycle (carte « Cycle » de l'Accueil).
	const cycle = await convex.query(api.users.myCycle, { sessionToken: token }).catch(() => null);
	// Un brouillon (retour non publié) ne doit jamais quitter le serveur : on
	// retire le texte tant que le statut n'est pas « retour_envoye ».
	const safe = checkins.map((c) => {
		if (c.status === 'retour_envoye') return c;
		const { feedback: _fb, feedbackAt: _fa, ...rest } = c;
		return rest;
	});
	return {
		checkins: safe as typeof checkins,
		media: (published?.byCheckin ?? {}) as Record<string, unknown[]>,
		cycle,
	};
};