import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE } from '$lib/server/session';

/** GET /api/appointments/settings — disponibilités hebdo de la coach. */
export const GET: RequestHandler = async (event) => {
	const token = event.cookies.get(SESSION_COOKIE);
	if (!token) return json({ error: 'Session requise.' }, { status: 401 });
	try {
		return json({ settings: await convex.query(api.appointments.getSettings, { sessionToken: token }) });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Erreur inconnue' }, { status: 400 });
	}
};

/** PUT /api/appointments/settings — enregistre les créneaux hebdo. */
export const PUT: RequestHandler = async (event) => {
	const token = event.cookies.get(SESSION_COOKIE);
	if (!token) return json({ error: 'Session requise.' }, { status: 401 });
	const body = await event.request.json().catch(() => null);
	if (!body || !Array.isArray(body.ranges)) return json({ error: 'Liste de créneaux attendue.' }, { status: 400 });
	try {
		await convex.mutation(api.appointments.upsertSettings, { sessionToken: token, ranges: body.ranges });
		return json({ ok: true });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Erreur inconnue' }, { status: 400 });
	}
};
