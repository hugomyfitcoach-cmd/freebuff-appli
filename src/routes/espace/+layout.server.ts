import { requireRole, SESSION_COOKIE } from '$lib/server/session';
import { convex } from '$lib/server/convex';
import { api } from '../../convex/_generated/api.js';

export const load = async (event) => {
	const user = await requireRole(event, 'client', { next: '/espace' });
	// Trace la « dernière connexion » (utilisée pour le tri du CRM coach).
	const token = event.cookies.get(SESSION_COOKIE);
	await convex.mutation(api.users.touch, { sessionToken: token }).catch(() => {});
	return { user };
};
