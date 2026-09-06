import { requireRole } from '$lib/server/session';

/** Le guide nutrition & recettes est accessible à tout compte connecté (client ou coach). */
export const load = async (event) => {
	const user = await requireRole(event, ['client', 'coach'], { next: '/recettes' });
	return { user };
};
