import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Jour complet d'un client (coach) — ?userId=…&date=yyyy-mm-dd. */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const userId = event.url.searchParams.get('userId') ?? '';
	const date = event.url.searchParams.get('date') ?? '';
	try {
		const day = await convex.query(api.journal.getDayForCoach, {
			sessionToken: token,
			userId: userId as never,
			date: date || toLocalISO(new Date()),
		});
		return json(day);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Ajoute un aliment au journal d'un client (coach). */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.journal.addEntryForCoach, {
			sessionToken: token,
			userId: String(body.userId) as never,
			date: String(body.date ?? ''),
			meal: String(body.meal ?? ''),
			foodId: body.foodId as never,
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