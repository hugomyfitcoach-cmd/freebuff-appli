import { requireRole } from '$lib/server/session';

/** Page Templates : réservée au coach (le layout admin refait la vérification, défense en profondeur). */
export const load = async (event) => {
	const user = await requireRole(event, 'coach', { next: '/admin' });
	return { user };
};
