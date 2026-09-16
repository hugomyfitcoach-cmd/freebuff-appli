import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

/**
 * Émet un jeton court (15 min) pour le raccourci « G-FLUX — Synchroniser mes
 * pas ». La cliente est identifiée par son cookie de session — le raccourci,
 * lui, ne reçoit que ce jeton éphémère (jamais l'ID, jamais le cookie).
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/pas' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const res = await convex.mutation(api.steps.createHealthSyncToken, { sessionToken: token });
		return json(res);
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Impossible de démarrer la synchronisation.' }, { status: 400 });
	}
};
