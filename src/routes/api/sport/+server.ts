import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';
import { BPM_MAX, BPM_MIN } from '$lib/calibrage';

/**
 * FC moyenne : bornes du barème (40 à 240 BPM), validées côté API — refus
 * explicite avec un message lisible, jamais une valeur silencieusement écartée.
 * Absente / vide → undefined (aucune FC transmise).
 */
function bpmMoyenOuErreur(body: Record<string, unknown>): number | undefined {
	const brut = body.bpmMoyen;
	if (brut === undefined || brut === null || brut === '') return undefined;
	const bpm = Number(brut);
	if (!Number.isFinite(bpm) || bpm < BPM_MIN || bpm > BPM_MAX) {
		throw new Error(
			`Fréquence cardiaque invalide : ${BPM_MIN} à ${BPM_MAX} BPM attendu (reçu ${String(brut)}).`
		);
	}
	return bpm;
}

/**
 * Module Dépense sportive (cliente) — BFF.
 *
 * GET   ?weekStart=yyyy-mm-dd  → vue semaine (activités + totaux)
 * GET   ?catalog=1             → catalogue des sports (versionné)
 * GET   ?recent=1              → activités récentes (ajout rapide)
 * POST  { date, activityId, intensity?, durationMinutes } → ajout manuel
 * POST  { duplicateOf, date }  → duplication (nouvelle date)
 * PATCH { _id, date?, activityId?, intensity?, durationMinutes? } → modification
 * DELETE { _id }               → suppression
 *
 * Rappel métier : les kcal de la Dépense sportive sont un REPÈRE — cette
 * route ne touche JAMAIS le journal, les objectifs ni les plans (aucun
 * crédit calorique, aucun ajustement automatique).
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace' });
	const token = event.cookies.get(SESSION_COOKIE);
	const url = event.url;
	try {
		if (url.searchParams.get('catalog')) {
			return json(await convex.query(api.sport.catalog, {}));
		}
		if (url.searchParams.get('recent')) {
			return json(await convex.query(api.sport.myRecentActivities, { sessionToken: token }));
		}
		const weekStart = url.searchParams.get('weekStart') ?? undefined;
		return json(
			await convex.query(api.sport.myWeek, {
				sessionToken: token,
				...(weekStart && /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? { weekStart } : {}),
			})
		);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		if (body.duplicateOf) {
			const res = await convex.mutation(api.sport.duplicateActivity, {
				sessionToken: token,
				activityId: body.duplicateOf as never,
				date: String(body.date),
			});
			return json({ ok: true, _id: res._id });
		}
		const bpmMoyen = bpmMoyenOuErreur(body);
		const res = await convex.mutation(api.sport.addActivity, {
			sessionToken: token,
			date: String(body.date),
			activityId: String(body.activityId),
			...(body.intensity !== undefined && body.intensity !== null
				? { intensity: String(body.intensity) }
				: {}),
			...(bpmMoyen !== undefined ? { bpmMoyen } : {}),
			durationMinutes: Number(body.durationMinutes),
		} as never);
		return json({ ok: true, _id: res._id });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const bpmMoyen = bpmMoyenOuErreur(body);
		await convex.mutation(api.sport.updateActivity, {
			sessionToken: token,
			activityId: String(body._id) as never,
			...(body.date ? { date: String(body.date) } : {}),
			...(body.activityId ? { activityRef: String(body.activityId) } : {}),
			...(body.intensity !== undefined ? { intensity: body.intensity ? String(body.intensity) : undefined } : {}),
			...(bpmMoyen !== undefined ? { bpmMoyen } : {}),
			...(body.durationMinutes !== undefined ? { durationMinutes: Number(body.durationMinutes) } : {}),
		} as never);
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		await convex.mutation(api.sport.deleteActivity, {
			sessionToken: token,
			activityId: String(body._id) as never,
		});
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
