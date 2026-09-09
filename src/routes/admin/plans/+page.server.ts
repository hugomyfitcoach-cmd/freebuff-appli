import type { PageServerLoad } from './$types';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

/** Bibliothèque de plans de repas — la liste est chargée côté client (fetch),
 *  ce loader ne fait qu'authentifier la coach. */
export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'coach', { next: '/admin/plans' });
	return {};
};
