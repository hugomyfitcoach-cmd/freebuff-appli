import { requireClientAccess, requireRole, SESSION_COOKIE } from '$lib/server/session';
import { convex } from '$lib/server/convex';
import { api } from '../../convex/_generated/api.js';	/**
	 * Routes de l'espace accessibles pendant le HARD LOCK (décision produit :
	 * facturation = re-souscription ; déconnexion via ?/logout). Tout le reste
	 * de /espace/* est verrouillé par le garde serveur : Accueil, Journal,
	 * Progression, Entraînement, Bilans, Photos, RDV, Profil, Compte,
	 * Notifications — données conservées mais inaccessibles.
	 */
	const BILLING_OPEN_PATHS = ['/espace/facturation'];

export const load = async (event) => {
	// FACTURATION — garde serveur central (mission §4) : une cliente Autonomie
	// bloquée (canAccessApp = block, décidé côté Convex) est redirigée vers
	// /espace/facturation AVANT toute charge de page. Couvre /espace ET toutes
	// ses sous-pages (journal, progression, entrainement…) — impossible de
	// contourner le paywall en tapant une URL interne. Coaching, complimentary,
	// abonnement actif et grâce non expirée passent sans rien voir changer.
	// Exception CÔTÉ SERVEUR (même mécanisme, décision serveur) : la facturation
	// seule reste ouverte à une cliente bloquée (hard lock complet ailleurs).
	const openPath = BILLING_OPEN_PATHS.includes(event.url.pathname);
	const user = await (openPath ? requireRole(event, 'client', { next: '/espace' }) : requireClientAccess(event, { next: '/espace' }));
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
	// Photo de profil (avatar de l'en-tête) : URL signée lue côté serveur —
	// SSR cohérent avec le menu profil, sans aller-retour navigateur au premier rendu.
	const profilePhotoUrl = await convex
		.query(api.users.getProfilePhotoUrl, { sessionToken: token })
		.catch(() => null);
	await touchP;
	// Onboarding installation PWA : après une PREMIÈRE connexion, la cliente
	// est guidée vers l'installation (jamais en mode standalone — règle gérée
	// côté client qui redirige aussitôt ; le layout ne bloque jamais l'accès).
	if (user.pwaInstallStatus === 'not_seen') {
		return { user, dashboard, today, profilePhotoUrl, pwaInstallNeeded: true, rdvAccessAllowed: dashboard?.rdvAccessAllowed ?? true };
	}
	return { user, dashboard, today, profilePhotoUrl, pwaInstallNeeded: false, rdvAccessAllowed: dashboard?.rdvAccessAllowed ?? true };
};
