import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Assignations de plans aux clientes (coach).
 *   GET  ?userId=…  → liste des assignations (actives + retirées)
 *   POST { userId, templateId, startDate, endDate, weekdays? } → assigner
 *   DELETE ?assignmentId=… → retirer (futur coach_plan s'arrête, historique conservé)
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const userId = event.url.searchParams.get('userId') ?? '';
	try {
		const rows = await convex.query(api.mealPlans.assignmentsForClient, {
			sessionToken: token,
			userId: userId as never,
		});
		return json(rows);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const weekdays = Array.isArray(body.weekdays)
			? (body.weekdays.map(Number).filter((n: number) => n >= 1 && n <= 7) as number[])
			: undefined;
		const res = await convex.mutation(api.mealPlans.assignTemplate, {
			sessionToken: token,
			userId: String(body.userId ?? '') as never,
			templateId: String(body.templateId ?? '') as never,
			startDate: String(body.startDate ?? ''),
			endDate: String(body.endDate ?? ''),
			...(weekdays ? { weekdays } : {}),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const assignmentId = event.url.searchParams.get('assignmentId') ?? '';
	try {
		const res = await convex.mutation(api.mealPlans.removeAssignment, {
			sessionToken: token,
			assignmentId: assignmentId as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
