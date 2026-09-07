import { requireRole, SESSION_COOKIE } from '$lib/server/session';
import { convex } from '$lib/server/convex';
import { api } from '../../convex/_generated/api.js';

export const load = async (event) => {
	const user = await requireRole(event, 'client', { next: '/espace' });
	// Trace la « dernière connexion » (utilisée pour le tri du CRM coach).
	const token = event.cookies.get(SESSION_COOKIE);
	await convex.mutation(api.users.touch, { sessionToken: token }).catch(() => {});
	// État du dashboard (badges de navigation inclus), calculé une seule fois
	// côté serveur — partagé par le layout (badges) et la page Accueil.
	const now = new Date();
	const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	const dashboard = await convex
		.query(api.dashboard.getDashboard, { sessionToken: token, today, now: now.getTime() })
		.catch(() => null);
	return { user, dashboard };
};
