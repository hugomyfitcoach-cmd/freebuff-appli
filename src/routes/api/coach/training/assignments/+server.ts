import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Assignations d'entraînement (coach).
 *   GET  ?userId=…            → liste (toutes ou filtrées par cliente)
 *   GET  ?assignmentId=…      → détail d'une assignation (séances planifiées)
 *   POST { userId, sourceProgramId, startDate, weeks, weekdays, replacesAssignmentId? } → assigner / remplacer
 *   POST { assignmentId, weeks } → prolonger
 *   DELETE ?assignmentId=…    → retirer (séances futures annulées, historique intact)
 *   PATCH  { scheduledId, date?, cancel? } → ••• déplacer / annuler-restaurer
 *   POST   { scheduledId, date, duplicate: true } → dupliquer une occurrence
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const assignmentId = event.url.searchParams.get('assignmentId');
	const userId = event.url.searchParams.get('userId');
	try {
		if (assignmentId) {
			const detail = await convex.query(api.trainingAssign.assignmentDetail, {
				sessionToken: token,
				assignmentId: assignmentId as never,
			});
			return json(detail);
		}
		const rows = await convex.query(api.trainingAssign.listAssignments, {
			sessionToken: token,
			...(userId ? { userId: userId as never } : {}),
		});
		return json({ items: rows });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		if (body.duplicate && body.scheduledId) {
			const res = await convex.mutation(api.trainingAssign.duplicateScheduledSession, {
				sessionToken: token,
				scheduledId: String(body.scheduledId) as never,
				date: String(body.date ?? ''),
			});
			return json(res);
		}
		if (body.assignmentId && body.weeks) {
			// Prolongation.
			const res = await convex.mutation(api.trainingAssign.extendAssignment, {
				sessionToken: token,
				assignmentId: String(body.assignmentId) as never,
				weeks: Number(body.weeks),
			});
			return json(res);
		}
		const res = await convex.mutation(api.trainingAssign.assignProgram, {
			sessionToken: token,
			userId: String(body.userId ?? '') as never,
			sourceProgramId: String(body.sourceProgramId ?? '') as never,
			startDate: String(body.startDate ?? ''),
			weeks: Number(body.weeks ?? 0),
			weekdays: Array.isArray(body.weekdays) ? body.weekdays.map(Number) : [],
			...(body.replacesAssignmentId ? { replacesAssignmentId: String(body.replacesAssignmentId) as never } : {}),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		await convex.mutation(api.trainingAssign.updateScheduledSession, {
			sessionToken: token,
			scheduledId: String(body.scheduledId ?? '') as never,
			...(body.date !== undefined ? { date: String(body.date) } : {}),
			...(body.cancel !== undefined ? { cancel: Boolean(body.cancel) } : {}),
		});
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const assignmentId = event.url.searchParams.get('assignmentId') ?? '';
	try {
		await convex.mutation(api.trainingAssign.removeAssignment, {
			sessionToken: token,
			assignmentId: assignmentId as never,
		});
		return json({ ok: true });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
