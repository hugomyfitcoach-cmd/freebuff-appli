import type { PageServerLoad } from './$types';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

/** Page de validation du socle Entraînement — auth coach uniquement.
 *  Les données sont chargées côté client via les endpoints BFF. */
export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'coach', { next: '/admin/dev/exercices' });
	return {};
};
