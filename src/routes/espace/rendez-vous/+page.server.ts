import type { PageServerLoad } from './$types';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

/** Rendez-vous (cliente) — la liste et les créneaux sont chargés côté client. */
export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'client', { next: '/espace/rendez-vous' });
	return {};
};
