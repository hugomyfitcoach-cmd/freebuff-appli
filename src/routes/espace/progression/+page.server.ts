import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/session';

export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'client', { next: '/espace/progression' });
	return {};
};