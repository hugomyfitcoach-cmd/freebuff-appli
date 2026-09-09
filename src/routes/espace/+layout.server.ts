import { requireRole, SESSION_COOKIE } from '$lib/server/session';
import { convex } from '$lib/server/convex';
import { api } from '../../convex/_generated/api.js';	export const load = async (event) => {
	const user = await requireRole(event, 'client', { next: '/espace' });
	// Trace la « dernière connexion » (utilisée pour le tri du CRM coach).
	// Non bloquant : le dashboard (ligne suivante) est lancé en parallèle.
	const token = event.cookies.get(SESSION_COOKIE);
	const touchP = convex.mutation(api.users.touch, { sessionToken: token }).catch(() => {});
	// État du dashboard (badges de navigation inclus), calculé une seule fois
	// côté serveur — partagé par le layout (badges) et la page Accueil.
	const now = new Date();
	const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	const dashboard = await convex
		.query(api.dashboard.getDashboard, { sessionToken: token, today, now: now.getTime() })
		.catch(() => null);
	await touchP;
	// Onboarding installation PWA : après une PREMIÈRE connexion, la cliente
	// est guidée vers l'installation (jamais en mode standalone — règle gérée
	// côté client qui redirige aussitôt ; le layout ne bloque jamais l'accès).
	if (user.pwaInstallStatus === 'not_seen') {
		return { user, dashboard, today, pwaInstallNeeded: true };
	}
	return { user, dashboard, today, pwaInstallNeeded: false };
};
