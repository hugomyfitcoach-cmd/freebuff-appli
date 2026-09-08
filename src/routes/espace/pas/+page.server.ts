import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

/**
 * « Mes pas » — statistiques sur les 7 derniers jours.
 * Source unique : dailySteps + clientGoals (mêmes données que l'Accueil et le
 * CRM). La fenêtre de 7 jours est construite côté client dans le fuseau de la
 * cliente ; une journée sans ligne n'est jamais interprétée comme 0 pas.
 */
export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'client', { next: '/espace/pas' });
	const token = event.cookies.get(SESSION_COOKIE);
	const history = await convex.query(api.steps.myHistory, { sessionToken: token });
	return { history };
};