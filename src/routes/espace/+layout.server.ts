import { requireRole } from '$lib/server/session';

export const load = async (event) => {
	const user = await requireRole(event, 'client', { next: '/espace' });
	return { user };
};
