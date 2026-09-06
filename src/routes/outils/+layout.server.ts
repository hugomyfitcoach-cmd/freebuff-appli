import { requireRole } from '$lib/server/session';

/** La barre d'outils « Calibrage » est accessible à tout compte connecté (client ou coach). */
export const load = async (event) => {
	const user = await requireRole(event, ['client', 'coach'], { next: '/outils' });
	return { user };
};