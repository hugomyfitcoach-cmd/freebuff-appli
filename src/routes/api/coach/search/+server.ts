import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Recherche d'aliments (base locale) pour la coach — ?q=… */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const q = event.url.searchParams.get('q') ?? '';
	try {
		const hits = await convex.query(api.journal.searchForCoach, { sessionToken: token, query: q });
		return json(hits);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};