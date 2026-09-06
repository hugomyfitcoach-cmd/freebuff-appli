import { requireRole } from '$lib/server/session';

export const load = async (event) => {
	const user = await requireRole(event, 'coach', { next: '/admin' });
	return { user };
};
