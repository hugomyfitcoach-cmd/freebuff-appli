import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Les mesures corporelles du client (poids, cou, taille, fessier) + sa taille. */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/progression' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const data = await convex.query(api.metrics.list, { sessionToken: token });
		return json(data);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/**
 * Enregistre une prise de mesures : { date, weightKg?, neckCm?, waistCm?, hipCm? }
 * Une ligne par date : les champs déjà saisis ce jour-là sont conservés.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/progression' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
		const res = await convex.mutation(api.metrics.upsert, {
			sessionToken: token,
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

/** Enregistre la taille : { heightCm } */
export const PUT: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/progression' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.metrics.saveHeight, {
			sessionToken: token,
			heightCm: Number(body.heightCm),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Modifie UNE métrique d'une date : { date, metric, value } (correction). */
export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/progression' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.metrics.updateOne, {
			sessionToken: token,
			date: String(body.date ?? ''),
			metric: String(body.metric ?? '') as never,
			value: Number(body.value),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Supprime UNE métrique d'une date : ?date=…&metric=… */
export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/progression' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const date = event.url.searchParams.get('date') ?? '';
		const metric = event.url.searchParams.get('metric') ?? '';
		if (!date || !metric) return json({ error: 'Paramètres manquants.' }, { status: 400 });
		const res = await convex.mutation(api.metrics.deleteOne, {
			sessionToken: token,
			date,
			metric: metric as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};