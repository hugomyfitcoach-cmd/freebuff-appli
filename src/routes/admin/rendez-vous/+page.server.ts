import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

/**
 * Rendez-vous (coach) — authentifie la coach et fournit la liste des clientes
 * (modale de réservation). La liste des RDV et les disponibilités sont
 * chargées côté client (fetch) pour rester fraîches après chaque action.
 */
export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'coach', { next: '/admin/rendez-vous' });
	const token = event.cookies.get(SESSION_COOKIE);
	const clients = await convex.query(api.coach.listClients, { sessionToken: token });
	return { clients };
};
