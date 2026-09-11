import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '$lib/convex-api';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'coach', { next: '/admin/notifications' });
	const token = event.cookies.get(SESSION_COOKIE);
	// Journal d'activité (150 dernières notifications) + compteur « à consulter ».
	const [rows, unread] = await Promise.all([
		convex.query(api.notifications.list, { sessionToken: token }),
		convex.query(api.notifications.unreadCount, { sessionToken: token }),
	]);
	return { rows, unread };
};
