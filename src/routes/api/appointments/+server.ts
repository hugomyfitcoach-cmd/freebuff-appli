import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '$lib/convex-api';
import { SESSION_COOKIE } from '$lib/server/session';
import { googleCalendarFetch, googleCalendarFetchForCoachId } from '$lib/server/googleOAuth';
import { isBookableKind, SLOT_TAKEN_MESSAGE } from '$lib/appointments';
import { AvailabilityError, verifySlotServer } from '$lib/server/availability';

/**
 * Rendez-vous — collection.
 * GET  : coach = tous ses rendez-vous ; cliente = les SIENS.
 *        `?userId=` (coach, Vision 360) → UNIQUEMENT les RDV de cette cliente :
 *        le filtre est fait DANS la requête Convex (index by_client) — la
 *        source de vérité est le clientId de l'URL, jamais un masquage UI.
 * POST : réservation DIRECTE (coach pour une cliente, ou cliente pour elle).
 *        booking réussi = rendez-vous CONFIRMÉ (`on_book`) — aucun flux
 *        « demande à valider ». Un RDV confirmé est poussé dans le Google
 *        Calendar du coach (googleEventId conservé pour replanifier/annuler).
 */

function parseDT(date: string, hhmm: string): string {
	return `${date}T${hhmm}:00`;
}

async function pushToGoogleWithToken(
	accessToken: string,
	rdv: { date: string; time: string; endTime: string; kind: string; clientName: string }
): Promise<string | null> {
	try {
		const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
			body: JSON.stringify({
				summary: `RDV ${rdv.kind} — ${rdv.clientName}`,
				description: 'Rendez-vous planifié depuis G-FLUX.',
				start: { dateTime: parseDT(rdv.date, rdv.time), timeZone: 'Europe/Paris' },
				end: { dateTime: parseDT(rdv.date, rdv.endTime), timeZone: 'Europe/Paris' },
				reminders: { useDefault: true },
			}),
		});
		if (!res.ok) return null;
		const ev = await res.json();
		return typeof ev?.id === 'string' ? ev.id : null;
	} catch {
		return null;
	}
}

/** Création de l'événement Google — meilleur effort, jamais bloquant. */
async function pushToGoogle(
	sessionToken: string,
	coachId: string | null,
	rdv: { date: string; time: string; endTime: string; kind: string; clientName: string }
): Promise<string | null> {
	try {
		if (coachId) {
			const res = await googleCalendarFetchForCoachId(coachId, '/calendars/primary/events', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					summary: `RDV ${rdv.kind} — ${rdv.clientName}`,
					description: 'Rendez-vous planifié depuis G-FLUX.',
					start: { dateTime: parseDT(rdv.date, rdv.time), timeZone: 'Europe/Paris' },
					end: { dateTime: parseDT(rdv.date, rdv.endTime), timeZone: 'Europe/Paris' },
					reminders: { useDefault: true },
				}),
			}, sessionToken);
			if (!res || !res.ok) return null;
			const ev = await res.json();
			return typeof ev?.id === 'string' ? ev.id : null;
		}
		const res = await googleCalendarFetch(sessionToken, '/calendars/primary/events', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				summary: `RDV ${rdv.kind} — ${rdv.clientName}`,
				description: 'Rendez-vous planifié depuis G-FLUX.',
				start: { dateTime: parseDT(rdv.date, rdv.time), timeZone: 'Europe/Paris' },
				end: { dateTime: parseDT(rdv.date, rdv.endTime), timeZone: 'Europe/Paris' },
				reminders: { useDefault: true },
			}),
		});
		if (!res.ok) return null;
		const ev = await res.json();
		return typeof ev?.id === 'string' ? ev.id : null;
	} catch {
		return null;
	}
}

/**
 * 2e VÉRIFICATION SERVEUR du créneau juste avant la création (anti double
 * booking) : disponibilités coach − RDV G-FLUX − Google Calendar − buffers,
 * durée complète. Le résultat (422 = refus, 503 = Google illisible) est
 * normalisé pour le client, qui recharge les disponibilités et affiche le
 * message « créneau pris » sans rien créer.
 */
async function preBookCheck(
	sessionToken: string,
	coachId: string,
	rdv: { date: string; time: string; kind: string }
): Promise<Response | null> {
	try {
		const check = await verifySlotServer({ sessionToken, coachId, date: rdv.date, time: rdv.time, kind: rdv.kind });
		if (check.ok) return null; // Le créneau est confirmé libre — on peut créer.
		return json(
			{ ok: false, code: 'slot_taken', message: SLOT_TAKEN_MESSAGE, detail: check.reason },
			{ status: 422 }
		);
	} catch (e) {
		if (e instanceof AvailabilityError) {
			return json({ ok: false, code: e.code, error: e.message }, { status: 503 });
		}
		throw e;
	}
}

export const GET: RequestHandler = async (event) => {
	const token = event.cookies.get(SESSION_COOKIE);
	if (!token) return json({ error: 'Session requise.' }, { status: 401 });
	try {
		const me = await convex.query(api.users.resolveSession, { sessionToken: token });
		if (!me) return json({ error: 'Session invalide.' }, { status: 401 });
		// Paramètre Vision 360 : STRICTEMENT réservé au coach, et le filtre est
		// appliqué par la requête Convex elle-même (listForUser + index by_client).
		const requestedUserId = event.url.searchParams.get('userId');
		if (requestedUserId) {
			if (me.role !== 'coach') return json({ error: 'Accès réservé au coach.' }, { status: 403 });
			const list = await convex.query(api.appointments.listForUser, {
				sessionToken: token,
				userId: requestedUserId as never,
			});
			return json({ appointments: list });
		}
		if (me.role === 'coach') {
			const list = await convex.query(api.appointments.listForCoach, { sessionToken: token });
			return json({ appointments: list });
		}
		const list = await convex.query(api.appointments.listForUser, { sessionToken: token });
		return json({ appointments: list });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Erreur inconnue' }, { status: 400 });
	}
};

export const POST: RequestHandler = async (event) => {
	const token = event.cookies.get(SESSION_COOKIE);
	if (!token) return json({ error: 'Session requise.' }, { status: 401 });
	const body = await event.request.json().catch(() => null);
	if (!body) return json({ error: 'Corps JSON attendu.' }, { status: 400 });
	try {
		const me = await convex.query(api.users.resolveSession, { sessionToken: token });
		if (!me) return json({ error: 'Session invalide.' }, { status: 401 });

		const rdvInput = {
			date: String(body.date ?? ''),
			time: String(body.time ?? ''),
			endTime: String(body.endTime ?? ''),
			kind: String(body.kind ?? 'Suivi'),
		};
		// Garde-fou §6 : seuls Suivi/Démarrage sont réservables — et « Démarrage »
		// est strictement réservé au coach (double contrôle Convex + BFF).
		if (!isBookableKind(rdvInput.kind)) {
			return json({ error: 'Type de rendez-vous inconnu ou non réservable.' }, { status: 400 });
		}
		if (me.role !== 'coach' && rdvInput.kind !== 'Suivi') {
			return json({ error: 'Type de rendez-vous non disponible — le démarrage est proposé par ton coach.' }, { status: 403 });
		}

		if (me.role === 'coach') {
			if (!body.clientId) return json({ error: 'Cliente requise.' }, { status: 400 });
			const clientName = String(body.clientName ?? '').trim() || 'cliente';
			// 2e vérification serveur du créneau (moteur STRICT : RDV + Google +
			// buffers, durée complète) juste avant la création — anti double booking.
			const guard = await preBookCheck(token, me._id, rdvInput);
			if (guard) return guard;
			const res = await convex.mutation(api.appointments.bookByCoach, {
				sessionToken: token,
				clientId: body.clientId,
				...rdvInput,
			});
			// Poussée Google Calendar du coach (meilleur effort : le RDV reste valide sans).
			const googleEventId = await pushToGoogle(token, null, { ...rdvInput, clientName });
			if (googleEventId) {
				await convex
					.mutation(api.appointments.attachGoogleEvent, {
						sessionToken: token,
						appointmentId: res.appointmentId,
						googleEventId,
					})
					.catch(() => null);
			}
			return json({ ok: true, appointmentId: res.appointmentId, googleEventId, status: 'on_book' });
		}

		// Cliente : réservation DIRECTE — immédiatement confirmée. La 2e vérification
		// serveur du créneau (dispo − RDV − Google − buffers, durée complète) est
		// faite ICI, juste avant la création — puis l'insertion Convex revalide
		// en dernier ressort dans sa transaction.
		const coachId = await convex.query(api.appointments.myCoachId, { sessionToken: token });
		const guard = await preBookCheck(token, coachId as string, rdvInput);
		if (guard) return guard;
		const res = await convex.mutation(api.appointments.bookByClient, { sessionToken: token, ...rdvInput });
		const googleEventId = await pushToGoogle(token, coachId, { ...rdvInput, clientName: me.prenom || 'cliente' });
		if (googleEventId) {
			await convex
				.mutation(api.appointments.attachGoogleEvent, {
					sessionToken: token,
					appointmentId: res.appointmentId,
					googleEventId,
				})
				.catch(() => null);
		}
		return json({ ok: true, appointmentId: res.appointmentId, googleEventId, status: 'on_book' });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Erreur inconnue' }, { status: 400 });
	}
};
