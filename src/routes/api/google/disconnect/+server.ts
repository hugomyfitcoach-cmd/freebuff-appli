import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE } from '$lib/server/session';

/** Déconnecte le compte Google Calendar du coach (blobs chiffrés supprimés). */
export const POST: RequestHandler = async (event) => {
	const token = event.cookies.get(SESSION_COOKIE);
	if (!token) return json({ error: 'Session requise.' }, { status: 401 });
	try {
		await convex.mutation(api.googleCalendar.disconnect, { sessionToken: token });
		return json({ ok: true });
	} catch {
		return json({ error: 'Déconnexion impossible — réessaie.' }, { status: 400 });
	}
};
