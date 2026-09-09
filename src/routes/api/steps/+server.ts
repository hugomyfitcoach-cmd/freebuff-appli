import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Enregistre (ou corrige) le nombre de pas du jour : { date?, count }. */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const d = new Date();
		const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		const date = typeof body.date === 'string' && body.date ? String(body.date) : local;
		// Garde-fou : jamais de pas pour une journée future (tolérance d'1 jour pour
		// les fuseaux horaires — la fenêtre client reste limitée à aujourd'hui + 6 jours).
		if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
			const max = new Date();
			max.setDate(max.getDate() + 1);
			const maxISO = `${max.getFullYear()}-${String(max.getMonth() + 1).padStart(2, '0')}-${String(max.getDate()).padStart(2, '0')}`;
			if (date > maxISO) throw new Error('Impossible d\u2019enregistrer des pas pour une journée future.');
		}
		const res = await convex.mutation(api.steps.setSteps, {
			sessionToken: token,
			date,
			count: Number(body.count),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
