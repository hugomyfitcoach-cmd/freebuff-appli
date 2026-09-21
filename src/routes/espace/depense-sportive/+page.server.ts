import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/session';

/** Page « Dépense sportive » (espace cliente) — auth cliente uniquement. */
export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'client', { next: '/espace/depense-sportive' });
	return {};
};
