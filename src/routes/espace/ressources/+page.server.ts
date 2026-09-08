import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

/**
 * Page cliente « Ressources » : uniquement les entrées du Dossier que la coach
 * a explicitement partagées (visibility = shared). Les notes / documents privés
 * du coach ne quittent jamais le serveur. Lecture seule : la cliente ne peut ni
 * modifier, ni supprimer, ni changer la visibilité.
 */
export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'client', { next: '/espace/ressources' });
	const token = event.cookies.get(SESSION_COOKIE);
	const rows = await convex
		.query(api.resources.clientResources, { sessionToken: token })
		.catch(() => []);
	return { rows };
};
