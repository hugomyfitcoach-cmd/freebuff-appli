import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Jour complet (objectifs + consommé + planifié + totaux) — ?date=yyyy-mm-dd.
 *  Le plan coach actif est matérialisé (copy-on-write) AVANT la lecture. */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	const date = event.url.searchParams.get('date') ?? '';
	try {
		if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
			// Résolution copy-on-write du plan coach (mutation) — jamais dans le passé.
			await convex.mutation(api.mealPlans.ensurePlanForDate, { sessionToken: token, date });
		}
		const day = await convex.query(api.journal.getDay, {
			sessionToken: token,
			date: date || toLocalISO(new Date()),
		});
		return json(day);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Ajout : aujourd'hui → consommé ; date future → planifié (client_planned). */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.journal.addEntry, {
			sessionToken: token,
			date: String(body.date ?? ''),
			meal: String(body.meal ?? ''),
			foodId: body.foodId as never,
			customFoodId: body.customFoodId as never,
			qtyGrams: Number(body.qtyGrams),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

function toLocalISO(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${dd}`;
}
