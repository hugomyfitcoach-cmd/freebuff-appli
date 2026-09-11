import { requireRole, SESSION_COOKIE } from '$lib/server/session';
import { convex } from '$lib/server/convex';
import { api } from '$lib/convex-api';

export const load = async (event) => {
	const user = await requireRole(event, 'coach', { next: '/admin' });
	// Badge CRM : notifications coach « à consulter ». Requête isolée (jamais
	// bloquante) : en cas d'échec, la navigation reste utilisable sans badge.
	const token = event.cookies.get(SESSION_COOKIE);
	const notificationsBadge = await convex
		.query(api.notifications.unreadCount, { sessionToken: token })
		.catch(() => 0);
	return { user, notificationsBadge };
};
