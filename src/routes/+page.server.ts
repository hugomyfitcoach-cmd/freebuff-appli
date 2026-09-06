import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { currentUser } from '$lib/server/session';

/**
 * Page d'accueil : pas de contenu libre.
 * - non connecté → page de connexion ;
 * - connecté (client) → son espace de suivi ;
 * - connecté (coach) → son CRM.
 */
export const load: PageServerLoad = async (event) => {
	const user = await currentUser(event);
	if (!user) throw redirect(303, '/connexion');
	throw redirect(303, user.role === 'coach' ? '/admin' : '/espace');
};
