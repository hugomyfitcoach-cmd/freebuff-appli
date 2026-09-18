import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/session';

/** Page Entraînement (CRM coach) — auth coach uniquement. */
export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'coach', { next: '/admin/entrainement' });
	return {};
};
