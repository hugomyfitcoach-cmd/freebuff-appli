import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

/**
 * Section « Messages » : la cliente retrouve ici tous les messages de sa coach
 * (texte et/ou audio), y compris ceux déjà lus qui ont quitté la zone
 * prioritaire de l'Accueil. Ouvrir cette page ne marque RIEN comme lu : seul le
 * bouton « J'ai lu » (explicite) consomme l'état non lu.
 */
export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'client', { next: '/espace/messages' });
	const token = event.cookies.get(SESSION_COOKIE);
	const messagesP = convex
		.query(api.dashboard.myCoachMessages, { sessionToken: token })
		.catch(() => []);
	const coachP = convex
		.query(api.dashboard.myCoachProfile, { sessionToken: token })
		.catch(() => null);
	return { messages: await messagesP, coach: await coachP };
};
