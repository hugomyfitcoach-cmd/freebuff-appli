import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '$lib/convex-api';
import { SESSION_COOKIE } from '$lib/server/session';
import { googleCalendarFetch, googleCalendarFetchForCoachId } from '$lib/server/googleOAuth';

/**
 * Rendez-vous — un rendez-vous.
 * PATCH  : replanification (le MÊME événement Google est déplacé — aucune
 *          duplication ; l'id vient de la mutation, source de vérité).
 * DELETE : annulation (l'événement Google est supprimé/annulé proprement,
 *          G-FLUX mis à jour, créneau immédiatement libéré).
 * La limite « 4 h avant » pour la cliente est appliquée côté serveur
 * (appointments.reschedule) — le coach n'est jamais limité.
 */

function parseDT(date: string, hhmm: string): string {
	return `${date}T${hhmm}:00`;
}

/** Déplace le MÊME événement Google (meilleur effort, jamais bloquant). */
async function moveGoogleEvent(
	sessionToken: string,
	coachId: string | null,
	googleEventId: string,
	body: { date: string; time: string; endTime: string }
): Promise<boolean> {
	const patchBody = JSON.stringify({
		start: { dateTime: parseDT(body.date, body.time), timeZone: 'Europe/Paris' },
		end: { dateTime: parseDT(body.date, body.endTime), timeZone: 'Europe/Paris' },
	});
	try {
		if (coachId) {
			const res = await googleCalendarFetchForCoachId(
				coachId,
				`/calendars/primary/events/${encodeURIComponent(googleEventId)}`,
				{ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: patchBody },
				sessionToken
			);
			return !!res && res.ok;
		}
		const res = await googleCalendarFetch(
			sessionToken,
			`/calendars/primary/events/${encodeURIComponent(googleEventId)}`,
			{ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: patchBody }
		);
		return res.ok;
	} catch {
		return false;
	}
}

export const PATCH: RequestHandler = async (event) => {
	const token = event.cookies.get(SESSION_COOKIE);
	if (!token) return json({ error: 'Session requise.' }, { status: 401 });
	const id = event.params.id;
	const body = await event.request.json().catch(() => null);
	if (!body) return json({ error: 'Corps JSON attendu.' }, { status: 400 });
	try {
		// La mutation (revérification serveur du créneau + règle 4 h cliente)
		// précède tout appel Google : jamais de déplacement d'événement si le
		// RDV G-FLUX ne bouge pas. Elle renvoie le googleEventId à déplacer.
		const res = await convex.mutation(api.appointments.reschedule, {
			sessionToken: token,
			appointmentId: id as never,
			date: String(body.date ?? ''),
			time: String(body.time ?? ''),
			endTime: String(body.endTime ?? ''),
		});
		const coachId = await convex.query(api.appointments.myCoachId, { sessionToken: token });
		let moved = false;
		if (res.googleEventId) {
			moved = await moveGoogleEvent(token, coachId, res.googleEventId, {
				date: String(body.date ?? ''),
				time: String(body.time ?? ''),
				endTime: String(body.endTime ?? ''),
			});
		}
		return json({ ok: true, googleEventId: res.googleEventId, googleMoved: moved });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Erreur inconnue' }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	const token = event.cookies.get(SESSION_COOKIE);
	if (!token) return json({ error: 'Session requise.' }, { status: 401 });
	const id = event.params.id;
	try {
		// La mutation renvoie le googleEventId (source de vérité) et libère
		// immédiatement le créneau (status cancelled).
		const res = await convex.mutation(api.appointments.cancel, {
			sessionToken: token,
			appointmentId: id as never,
		});
		const coachId = await convex.query(api.appointments.myCoachId, { sessionToken: token });
		let deleted = false;
		if (res.googleEventId) {
			try {
				if (coachId) {
					const gRes = await googleCalendarFetchForCoachId(
						coachId,
						`/calendars/primary/events/${encodeURIComponent(res.googleEventId)}`,
						{ method: 'DELETE' },
						token
					);
					deleted = !!gRes && (gRes.ok || gRes.status === 404 || gRes.status === 410);
				} else {
					const gRes = await googleCalendarFetch(
						token,
						`/calendars/primary/events/${encodeURIComponent(res.googleEventId)}`,
						{ method: 'DELETE' }
					);
					deleted = gRes.ok || gRes.status === 404 || gRes.status === 410;
				}
			} catch {
				deleted = false;
			}
		}
		return json({ ok: true, googleDeleted: deleted });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Erreur inconnue' }, { status: 400 });
	}
};
