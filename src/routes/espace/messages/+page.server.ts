import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

/**
 * Section « Messages » : la cliente retrouve ici tous les messages de sa coach
 * (texte et/ou audio), y compris ceux déjà lus qui ont quitté la zone
 * prioritaire de l'Accueil. Ouvrir réellement cette page = consultation :
 * les messages non encore marqués « Vu » passent en « lu » (journal CRM).
 */
export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'client', { next: '/espace/messages' });
	const token = event.cookies.get(SESSION_COOKIE);
	// Consultation réelle (jamais déclenchée par le simple affichage de l'Accueil).
	await convex
		.mutation(api.dashboard.markAllCoachMessagesRead, { sessionToken: token })
		.catch(() => {});
	const messages = await convex
		.query(api.dashboard.myCoachMessages, { sessionToken: token })
		.catch(() => []);
	return { messages };
};
