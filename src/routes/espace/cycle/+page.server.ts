import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'client', { next: '/espace' });
	const token = event.cookies.get(SESSION_COOKIE);
	const cycle = await convex.query(api.users.myCycle, { sessionToken: token }).catch(() => null);
	return { cycle };
};