import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '$lib/convex-api';
import { SESSION_COOKIE } from '$lib/server/session';
import { googleCalendarFetch, googleCalendarFetchForCoachId } from '$lib/server/googleOAuth';
import { wallTimeToUtcMs } from '$lib/wallTime';

/**
 * MOTEUR DE DISPONIBILITÉ (§9).
 *
 * GET /api/appointments/availability?date=yyyy-mm-dd[&type=Suivi][&days=N]
 *
 * créneaux = plages autorisées (disponibilités coach)
 *          − événements Google Calendar (freebusy, compte du coach)
 *          − rendez-vous G-FLUX existants (toutes clientes)
 *          − buffers 5 min avant / 5 min après chaque RDV
 *
 * La durée dépend du TYPE sélectionné : Suivi 15 min, Démarrage 60 min.
 * Ce n'est PAS une simple grille visuelle : tout blocage réel (Google
 * compris) retire les créneaux correspondants, et la revérification
 * serveur refait le contrôle au moment de la réservation.
 *
 * `excludeId` : replanification — le RDV déplacé ne se bloque pas lui-même.
 */

const TZ = 'Europe/Paris';
const KINDS: Record<string, { durationMin: number; bufferMin: number }> = {
	Suivi: { durationMin: 15, bufferMin: 5 },
	Démarrage: { durationMin: 60, bufferMin: 5 },
};
/** Repli pour les anciens types historiques (aucune migration destructive). */
const FALLBACK = { durationMin: 30, bufferMin: 5 };

function toMin(hhmm: string): number {
	const [h, m] = hhmm.split(':');
	return Number(h) * 60 + Number(m);
}
function fromMin(m: number): string {
	return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function addDaysISO(iso: string, days: number): string {
	const d = new Date(`${iso}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}
/** 1..7 = lundi..dimanche. */
function isoDay(iso: string): number {
	return ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
}
/** now du jour demandé à "HH:mm" (ms UTC réels, DST géré). */
function dayMinuteToMs(dateISO: string, minute: number): number {
	return wallTimeToUtcMs(dateISO, fromMin(minute), TZ);
}

type Busy = { startMs: number; endMs: number; source: 'google' | 'gflux' };

/** Freebusy Google du coach (0 si non connecté / indisponible — repli gracieux). */
async function googleBusy(
	sessionToken: string,
	coachId: string | null,
	timeMinMs: number,
	timeMaxMs: number
): Promise<Busy[]> {
	const out: Busy[] = [];
	try {
		const gBody = JSON.stringify({
			timeMin: new Date(timeMinMs).toISOString(),
			timeMax: new Date(timeMaxMs).toISOString(),
			items: [{ id: 'primary' }],
		});
		let res: Response | null = null;
		if (coachId) {
			res = await googleCalendarFetchForCoachId(coachId, '/freeBusy', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: gBody,
			}, sessionToken);
		} else {
			res = await googleCalendarFetch(sessionToken, '/freeBusy', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: gBody,
			});
		}
		if (!res || !res.ok) return out;
		const data = (await res.json()) as {
			calendars?: { primary?: { busy?: { start: string; end: string }[] } };
		};
		for (const b of data.calendars?.primary?.busy ?? []) {
			const startMs = Date.parse(b.start);
			const endMs = Date.parse(b.end);
			if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
				out.push({ startMs, endMs, source: 'google' });
			}
		}
	} catch {
		/* Google indisponible : on continue avec les données G-FLUX seules */
	}
	return out;
}

export const GET: RequestHandler = async (event) => {
	const token = event.cookies.get(SESSION_COOKIE);
	if (!token) return json({ error: 'Session requise.' }, { status: 401 });
	try {
		const me = await convex.query(api.users.resolveSession, { sessionToken: token });
		if (!me) return json({ error: 'Session invalide.' }, { status: 401 });

		const url = event.url;
		const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? '7'), 1), 14);
		const kind = url.searchParams.get('type') ?? 'Suivi';
		const rule = KINDS[kind] ?? FALLBACK;
		const excludeId = url.searchParams.get('excludeId');
		const excludeRescheduledIds = (url.searchParams.get('excludeIds') ?? '')
			.split(',')
			.filter(Boolean);

		// Cliente : coach rattaché. Coach : lui-même.
		let coachId: string | null;
		if (me.role === 'coach') {
			coachId = me._id;
		} else {
			coachId = await convex.query(api.appointments.myCoachId, { sessionToken: token });
			if (!coachId) return json({ error: 'Ton coach n\'est pas encore rattaché à ton compte.' }, { status: 400 });
		}

		// Un paramètre date = jour unique ; sinon fenêtre glissante de `days` jours.
		const startDate = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
		const windowDays = url.searchParams.get('date') ? 1 : days;
		const daysList: string[] = [];
		for (let i = 0; i < windowDays; i++) daysList.push(addDaysISO(startDate, i));
		const timeMinMs = dayMinuteToMs(daysList[0], 0);
		const timeMaxMs = dayMinuteToMs(daysList[daysList.length - 1], 24 * 60);

		// 1) Plages autorisées (disponibilités hebdo du coach).
		const settings = await convex.query(api.appointments.internalSettingsOf, {
			sessionToken: token,
			coachId: coachId as never,
		});
		const ranges = (settings ?? []) as { day: number; start: string; end: string }[];

		// 2) RDV G-FLUX confirmés du coach (toutes clientes) + buffers.
		const appts = (await convex.query(api.appointments.listForCoachInternal, {
			sessionToken: token,
			coachId: coachId as never,
		})) as {
			_id: string;
			clientId: string;
			date: string;
			time: string;
			endTime: string;
			kind: string;
			status: 'on_book' | 'client_request' | 'cancelled';
		}[];
		const gfluxBusy: Busy[] = appts
			.filter((a) => a.status === 'on_book' && !excludeRescheduledIds.includes(a._id))
			.map((a) => {
				const b = KINDS[a.kind] ?? FALLBACK;
				return {
					startMs: dayMinuteToMs(a.date, toMin(a.time) - b.bufferMin),
					endMs: dayMinuteToMs(a.date, toMin(a.endTime) + b.bufferMin),
					source: 'gflux' as const,
				};
			});

		// 3) Événements Google Calendar du coach (freebusy).
		const gBusy = await googleBusy(token, coachId, timeMinMs, timeMaxMs);

		// 4) Grille candidate par jour (pas 15 min), filtrée par tout le busy.
		const result = daysList.map((date) => {
			const slots: { start: string; end: string }[] = [];
			for (const r of ranges.filter((x) => x.day === isoDay(date))) {
				for (let m = toMin(r.start); m + rule.durationMin <= toMin(r.end); m += 15) {
					const startMs = dayMinuteToMs(date, m);
					const endMs = startMs + rule.durationMin * 60000;
					// Passé (aujourd'hui : créneau déjà commencé).
					if (startMs <= Date.now()) continue;
					const busyHit = [...gfluxBusy, ...gBusy].some(
						(b) => startMs < b.endMs && endMs > b.startMs
					);
					if (busyHit) continue;
					slots.push({ start: fromMin(m), end: fromMin(m + rule.durationMin) });
				}
			}
			return { date, slots };
		});

		return json({ kind, durationMin: rule.durationMin, bufferMin: rule.bufferMin, days: result });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Erreur inconnue' }, { status: 400 });
	}
};
