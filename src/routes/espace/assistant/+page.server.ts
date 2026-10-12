import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireClientAccess } from '$lib/server/session';

/**
 * Page Assistant G-FLUX (§3).
 *
 * GARDES (jamais contournables en tapant l'URL) :
 *  - `requireClientAccess` → rôle client + HARD LOCK Billing (le lock
 *    Autonomie reste PRIORITAIRE sur cette page comme sur tout /espace/*) ;
 *  - flag SERVEUR `assistant.access` → si désactivé, redirection douce vers
 *    l'Accueil (aucun écran d'erreur, aucun contournement).
 *
 * Le layout /espace a déjà posé la session : on ajoute uniquement les
 * données propres à l'Assistant (fil actif, historique, quotas, contact).
 */
export const load: PageServerLoad = async (event) => {
	await requireClientAccess(event, { next: '/espace/assistant' });
	const token = event.cookies.get(SESSION_COOKIE);

	const access = await convex
		.query(api.assistant.access, { sessionToken: token })
		.catch(() => ({
			enabled: false,
			mode: 'coaching_readonly',
			model: '',
			limits: { textPerDay: 0, visionPerDay: 0 },
			coach: { url: null as string | null, message: '' },
		}));
	if (!access.enabled) throw redirect(303, '/espace');

	const threads = await convex.query(api.assistant.threads, { sessionToken: token }).catch(() => []);
	const active = threads.length > 0 ? threads[0] : null;
	const history = await convex
		.query(api.assistant.historyFor, {
			sessionToken: token,
			...(active ? { threadId: active.threadId } : {}),
		})
		.catch(() => null);
	const usage = await convex.query(api.assistantTools.usageFor, { sessionToken: token }).catch(() => null);

	return { access, threads, history, usage };
};
