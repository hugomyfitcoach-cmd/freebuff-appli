import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Toutes les prises d'un client (coach) — ?userId=… */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const userId = event.url.searchParams.get('userId') ?? '';
	try {
		const data = await convex.query(api.metrics.listForCoach, { sessionToken: token, userId: userId as never });
		return json(data);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Enregistre / met à jour une prise pour un client (coach). */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
		const res = await convex.mutation(api.metrics.upsertForCoach, {
			sessionToken: token,
			userId: String(body.userId) as never,
			date: String(body.date ?? ''),
			weightKg: num(body.weightKg),
			neckCm: num(body.neckCm),
			waistCm: num(body.waistCm),
			hipCm: num(body.hipCm),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Enregistre la taille (cm) d'un client (coach) : { userId, heightCm }. */
export const PUT: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.metrics.saveHeightForCoach, {
			sessionToken: token,
			userId: String(body.userId) as never,
			heightCm: Number(body.heightCm),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Modifie UNE métrique d'une date (coach) : { userId, date, metric, value }. */
export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.metrics.updateOneForCoach, {
			sessionToken: token,
			userId: String(body.userId) as never,
			date: String(body.date ?? ''),
			metric: String(body.metric ?? '') as never,
			value: Number(body.value),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Supprime UNE métrique d'une date (coach) : ?userId=…&date=…&metric=… */
export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const userId = event.url.searchParams.get('userId') ?? '';
		const date = event.url.searchParams.get('date') ?? '';
		const metric = event.url.searchParams.get('metric') ?? '';
		if (!userId || !date || !metric) return json({ error: 'Paramètres manquants.' }, { status: 400 });
		const res = await convex.mutation(api.metrics.deleteOneForCoach, {
			sessionToken: token,
			userId: userId as never,
			date,
			metric: metric as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};