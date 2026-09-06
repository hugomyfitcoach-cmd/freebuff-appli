import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'client', { next: '/espace/progression' });
	const token = event.cookies.get(SESSION_COOKIE);
	const checkins = await convex.query(api.checkins.myCheckins, { sessionToken: token });
	return { checkins };
};
