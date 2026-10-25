import { requireRole } from '$lib/server/session';

/** Aliments de référence : page coach (le layout /admin refait la vérification, défense en profondeur). */
export const load = async (event) => {
	const user = await requireRole(event, 'coach', { next: '/admin' });
	return { user };
};
