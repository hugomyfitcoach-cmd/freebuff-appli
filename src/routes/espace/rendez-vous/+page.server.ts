import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

/** Rendez-vous (cliente) — la liste et les créneaux sont chargés côté client. */
export const load: PageServerLoad = async (event) => {
	const user = await requireRole(event, 'client', { next: '/espace/rendez-vous' });
	// MODE AUTONOMIE : accès « Rendez-vous » coupé côté cliente — un lien direct
	// (bookmark/PWA) ramène à l'Accueil. Aucune donnée ni historique supprimé :
	// le retour en Coaching réactive la page à l'identique.
	if (user.coachingMode === 'autonomy') throw redirect(303, '/espace');
	return {};
};
