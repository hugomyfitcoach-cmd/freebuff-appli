import { api } from '$lib/convex-api';
import { convex } from '$lib/server/convex';
import { googleCalendarFetch, googleCalendarFetchForCoachId } from '$lib/server/googleOAuth';
import { wallTimeToUtcMs } from '$lib/wallTime';
import type { SlotCheck } from '$lib/appointments';

/**
 * MOTEUR DE DISPONIBILITÉ SERVEUR (§9) — source unique pour l'affichage des
 * créneaux ET la vérification finale avant réservation.
 *
 * Un créneau n'est proposé (ni confirmé) que si ces cinq sources concordent,
 * à l'instant de l'appel, jamais depuis un cache :
 *   1. les disponibilités coach (plages hebdo) ;
 *   2. les rendez-vous G-FLUX déjà réservés (toutes clientes, confirmés) ;
 *   3. les événements Google Calendar du coach (freebusy du compte connecté) ;
 *   4. les buffers 5 min avant / 5 min après chaque rendez-vous ;
 *   5. la durée COMPLÈTE du rendez-vous demandé (type demandé).
 *
 * STRICT : si le freebusy Google ne peut pas être lu (non connecté exclu —
 * compte requis ; erreur réseau / token mort / réponse invalide), on renvoie
 * une erreur explicite. Aucun créneau n'est jamais calculé sur un repli
 * approximatif : mieux vaut « indisponible pour le moment » qu'un créneau
 * fantôme. (La non-connexion du compte Google est un état nommé et assumé :
 * l'agenda ne peut pas être vérifié, donc rien n'est proposé.)
 */

const TZ = 'Europe/Paris';

export type KindRule = { durationMin: number; bufferMin: number };

export const KIND_RULES: Record<string, KindRule> = {
	Suivi: { durationMin: 15, bufferMin: 5 },
	Démarrage: { durationMin: 60, bufferMin: 5 },
};
/** Repli pour les anciens types historiques (aucune migration destructive). */
export const FALLBACK_RULE: KindRule = { durationMin: 30, bufferMin: 5 };

export function ruleFor(kind: string): KindRule {
	return KIND_RULES[kind] ?? FALLBACK_RULE;
}

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

/** Échec strict de la vérification Google (jamais masqué par un repli). */
export class AvailabilityError extends Error {
	code: 'google_unavailable' | 'google_not_connected' | 'internal';
	constructor(code: 'google_unavailable' | 'google_not_connected' | 'internal', message: string) {
		super(message);
		this.code = code;
	}
}

export type Busy = { startMs: number; endMs: number; source: 'google' | 'gflux' };

/**
 * Freebusy Google du coach — STRICT : lève une erreur si le compte n'est pas
 * connecté ou si la lecture échoue (le créneau ne peut pas être fiabilisé).
 * Jamais de repli silencieux : un agenda illisible ⇒ créneaux refusés.
 */
async function googleBusyStrict(
	sessionToken: string,
	coachId: string | null,
	timeMinMs: number,
	timeMaxMs: number
): Promise<Busy[]> {
	const gBody = JSON.stringify({
		timeMin: new Date(timeMinMs).toISOString(),
		timeMax: new Date(timeMaxMs).toISOString(),
		items: [{ id: 'primary' }],
	});
	let res: Response | null;
	try {
		if (coachId) {
			res = await googleCalendarFetchForCoachId(
				coachId,
				'/freeBusy',
				{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: gBody },
				sessionToken
			);
		} else {
			res = await googleCalendarFetch(sessionToken, '/freeBusy', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: gBody,
			});
		}
	} catch {
		throw new AvailabilityError('google_unavailable', 'Agenda Google momentanément indisponible — réessaie dans un instant.');
	}
	if (!res) {
		throw new AvailabilityError('google_not_connected', 'Google Calendar n’est pas connecté — les créneaux ne peuvent pas être garantis. Le coach doit connecter son agenda dans le CRM.');
	}
	if (!res.ok) {
		throw new AvailabilityError('google_unavailable', 'Agenda Google momentanément indisponible — réessaie dans un instant.');
	}
	let data: { calendars?: { primary?: { busy?: { start: string; end: string }[] } } };
	try {
		data = (await res.json()) as { calendars?: { primary?: { busy?: { start: string; end: string }[] } } };
	} catch {
		throw new AvailabilityError('google_unavailable', 'Agenda Google momentanément indisponible — réessaie dans un instant.');
	}
	const out: Busy[] = [];
	for (const b of data.calendars?.primary?.busy ?? []) {
		const startMs = Date.parse(b.start);
		const endMs = Date.parse(b.end);
		if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
			out.push({ startMs, endMs, source: 'google' });
		}
	}
	return out;
}

/** Toutes les plages occupées (RDV G-FLUX + buffers, puis Google) sur la fenêtre. */
async function busyForWindow(opts: {
	sessionToken: string;
	coachId: string;
	daysList: string[];
	excludeIds: string[];
}): Promise<{ gfluxBusy: Busy[]; googleBusy: Busy[] }> {
	const { sessionToken, coachId, daysList, excludeIds } = opts;
	const timeMinMs = dayMinuteToMs(daysList[0], 0);
	const timeMaxMs = dayMinuteToMs(daysList[daysList.length - 1], 24 * 60);

	// RDV G-FLUX confirmés du coach (toutes clientes) + buffers 5 min.
	const appts = (await convex.query(api.appointments.listForCoachInternal, {
		sessionToken,
		coachId: coachId as never,
	})) as {
		_id: string;
		date: string;
		time: string;
		endTime: string;
		kind: string;
		status: 'on_book' | 'client_request' | 'cancelled';
	}[];
	const gfluxBusy: Busy[] = appts
		.filter((a) => a.status === 'on_book' && !excludeIds.includes(a._id))
		.map((a) => {
			const rule = ruleFor(a.kind);
			return {
				startMs: dayMinuteToMs(a.date, toMin(a.time) - rule.bufferMin),
				endMs: dayMinuteToMs(a.date, toMin(a.endTime) + rule.bufferMin),
				source: 'gflux' as const,
			};
		});

	// Événements Google Calendar du coach (freebusy) — STRICT.
	const gBusy = await googleBusyStrict(sessionToken, coachId, timeMinMs, timeMaxMs);

	return { gfluxBusy, googleBusy: gBusy };
}

/** Le créneau (durée complète, buffers inclus) chevauche-t-il un bloc occupé ? */
function hitsBusy(startMs: number, endMs: number, busy: Busy[]): boolean {
	return busy.some((b) => startMs < b.endMs && endMs > b.startMs);
}

export type AvailabilityResult = {
	kind: string;
	durationMin: number;
	bufferMin: number;
	googleChecked: boolean;
	days: { date: string; slots: { start: string; end: string }[] }[];
};

/**
 * Calcule les créneaux RÉELLEMENT disponibles, fenêtre de 1 à 14 jours.
 * `date` présent : jour unique (ou fenêtre `days`) ; sinon fenêtre glissante.
 * Les créneaux affichés viennent TOUJOURS d'un calcul frais : disponibilités
 * coach − RDV G-FLUX (toutes clientes) − Google Calendar − buffers, avec la
 * durée complète du type demandé. Google injoignable ⇒ erreur (jamais de
 * repli approximatif).
 */
export async function computeAvailability(opts: {
	sessionToken: string;
	viewerIsCoach: boolean;
	coachId: string | null;
	date: string | null;
	days: number;
	kind: string;
	excludeIds: string[];
	now?: number;
}): Promise<AvailabilityResult> {
	const { sessionToken, viewerIsCoach, coachId, date, kind } = opts;
	const now = opts.now ?? Date.now();
	const rule = ruleFor(kind);

	let coachIdResolved: string;
	if (viewerIsCoach) {
		if (!coachId) {
			throw new AvailabilityError('internal', 'Coach introuvable pour cette session.');
		}
		coachIdResolved = coachId;
	} else {
		const resolved = coachId ?? (await convex.query(api.appointments.myCoachId, { sessionToken }));
		if (!resolved) {
			throw new AvailabilityError('internal', 'Ton coach n\u2019est pas encore rattaché à ton compte.');
		}
		coachIdResolved = resolved;
	}

	// Fenêtre : 1 à 14 jours, à partir de `date` ou d'aujourd'hui.
	const windowDays = Math.min(Math.max(opts.days, 1), 14);
	const startDate = date ?? new Date(now).toISOString().slice(0, 10);
	const daysList: string[] = [];
	for (let i = 0; i < windowDays; i++) daysList.push(addDaysISO(startDate, i));

	// 1) Plages autorisées (disponibilités hebdo du coach).
	const settings = await convex.query(api.appointments.internalSettingsOf, {
		sessionToken,
		coachId: coachIdResolved as never,
	});
	const ranges = (settings ?? []) as { day: number; start: string; end: string }[];

	// 2 + 3) RDV G-FLUX confirmés (toutes clientes) + freebusy Google — STRICT.
	const { gfluxBusy, googleBusy: gBusy } = await busyForWindow({
		sessionToken,
		coachId: coachIdResolved,
		daysList,
		excludeIds: opts.excludeIds,
	});
	const allBusy = [...gfluxBusy, ...gBusy];

	// 4 + 5) Grille candidate par jour (pas 15 min), durée COMPLÈTE du type,
	// filtrée par tout le busy réel (buffers compris).
	const result = daysList.map((dt) => {
		const slots: { start: string; end: string }[] = [];
		for (const r of ranges.filter((x) => x.day === isoDay(dt))) {
			for (let m = toMin(r.start); m + rule.durationMin <= toMin(r.end); m += 15) {
				const startMs = dayMinuteToMs(dt, m);
				const endMs = startMs + rule.durationMin * 60000;
				// Passé (aujourd'hui : créneau déjà commencé).
				if (startMs <= now) continue;
				if (hitsBusy(startMs, endMs, allBusy)) continue;
				slots.push({ start: fromMin(m), end: fromMin(m + rule.durationMin) });
			}
		}
		return { date: dt, slots };
	});

	return { kind, durationMin: rule.durationMin, bufferMin: rule.bufferMin, googleChecked: true, days: result };
}

export type SlotCheckResult = {
	ok: boolean;
	reason: 'ok' | 'not_in_ranges' | 'in_past' | 'overlap_gflux' | 'overlap_google' | 'invalid';
	durationMin: number;
	bufferMin: number;
};

/**
 * VÉRIFICATION FINALE D'UN CRÉNEAU (appelée juste avant toute création /
 * modification de rendez-vous) — le même calcul strict que l'affichage,
 * exécuté à l'instant du clic :
 *   1. dans une plage de disponibilité coach ;
 *   2. durée complète à partir de maintenant (jamais dans le passé) ;
 *   3. pas de chevauchement avec un RDV G-FLUX confirmé (+ buffers) ;
 *   4. pas de chevauchement avec un événement Google Calendar (+ freebusy).
 * STRICT : Google illisible ⇒ refus (`google_unavailable`), jamais de
 * validation approximative.
 */
export async function verifySlotServer(opts: {
	sessionToken: string;
	coachId: string;
	date: string;
	time: string;
	kind: string;
	excludeIds?: string[];
	now?: number;
}): Promise<SlotCheckResult> {
	const { sessionToken, coachId, date, time, kind } = opts;
	const now = opts.now ?? Date.now();
	const rule = ruleFor(kind);
	const durationMin = rule.durationMin;

	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
		return { ok: false, reason: 'invalid', durationMin, bufferMin: rule.bufferMin };
	}

	// 1) Disponibilités coach : le créneau ENTIER (durée complète) doit tenir
	// dans une plage ouverte du bon jour de semaine.
	const settings = await convex.query(api.appointments.internalSettingsOf, {
		sessionToken,
		coachId: coachId as never,
	});
	const ranges = (settings ?? []) as { day: number; start: string; end: string }[];
	const startMin = toMin(time);
	const endMin = startMin + durationMin;
	const inRanges = ranges.some(
		(r) => r.day === isoDay(date) && startMin >= toMin(r.start) && endMin <= toMin(r.end)
	);
	if (!inRanges) return { ok: false, reason: 'not_in_ranges', durationMin, bufferMin: rule.bufferMin };

	// 2) Durée complète à partir de maintenant.
	const startMs = dayMinuteToMs(date, startMin);
	const endMs = startMs + durationMin * 60000;
	if (!Number.isFinite(startMs) || startMs <= now) {
		return { ok: false, reason: 'in_past', durationMin, bufferMin: rule.bufferMin };
	}

	// 3 + 4) RDV G-FLUX + Google freebusy sur la journée du créneau.
	const { gfluxBusy, googleBusy: gBusy } = await busyForWindow({
		sessionToken,
		coachId,
		daysList: [date],
		excludeIds: opts.excludeIds ?? [],
	});
	if (hitsBusy(startMs, endMs, gfluxBusy)) {
		return { ok: false, reason: 'overlap_gflux', durationMin, bufferMin: rule.bufferMin };
	}
	if (hitsBusy(startMs, endMs, gBusy)) {
		return { ok: false, reason: 'overlap_google', durationMin, bufferMin: rule.bufferMin };
	}
	return { ok: true, reason: 'ok', durationMin, bufferMin: rule.bufferMin };
}

export type { SlotCheck };
