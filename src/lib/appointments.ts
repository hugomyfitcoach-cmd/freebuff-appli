/**
 * Domaine rendez-vous — partagé par l'espace cliente et le CRM coach.
 *
 * TYPES AUTORISÉS pour toute NOUVELLE réservation (§6) :
 *   - Suivi     : 15 minutes réelles + buffer 5 min avant / 5 min après ;
 *   - Démarrage : 60 minutes réelles + buffer 5 min avant / 5 min après.
 * Le buffer sert UNIQUEMENT au calcul de disponibilité : l'événement Google
 * reste à la durée réelle (ex. Suivi 10:00 → 10:15, indisponible 09:55 → 10:20).
 * Les anciens types historiques (Bilan, Visio…) restent affichés sur les vieux
 * rendez-vous — aucune migration destructive.
 */

export const APPOINTMENT_KINDS = ['Suivi', 'Démarrage'] as const;
export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number];

/**
 * Types réservables PAR UNE CLIENTE : « Suivi » uniquement. « Démarrage » est
 * réservé au coach (réservation CRM) — ni l'UI cliente ne le propose, ni le
 * serveur ne l'accepte (bookByClient + endpoint /api/appointments).
 */
export const CLIENT_BOOKING_KINDS = ['Suivi'] as const;

export const KIND_RULES: Record<string, { durationMin: number; bufferMin: number }> = {
	Suivi: { durationMin: 15, bufferMin: 5 },
	Démarrage: { durationMin: 60, bufferMin: 5 },
};

/** Règles d'un type connu, sinon repli (anciens RDV historiques). */
export function kindRule(kind: string): { durationMin: number; bufferMin: number } {
	return KIND_RULES[kind] ?? { durationMin: 30, bufferMin: 5 };
}

export type Rdv = {
	_id: string;
	clientId: string;
	date: string;
	time: string;
	endTime: string;
	kind: string;
	status: 'on_book' | 'client_request' | 'cancelled';
	bookedByName: string | null;
	bookingSource: 'coach' | 'client' | null;
	lastModifiedBy: string | null;
	rescheduleCount: number;
	googleEventId: string | null;
};

/** Type de réservation autorisé ? (les nouveaux bookings sont limités à Suivi/Démarrage) */
export function isBookableKind(kind: string): kind is AppointmentKind {
	return (APPOINTMENT_KINDS as readonly string[]).includes(kind);
}

export function toMin(h: string): number {
	const [hh, mm] = h.split(':');
	return Number(hh) * 60 + Number(mm);
}

export function fromMin(m: number): string {
	return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Instant (ms UTC) du début d'un RDV (fuseau coach Europe/Paris). */
export function rdvStartMs(r: { date: string; time: string }): number {
	return new Date(`${r.date}T${r.time}:00`).getTime();
}

export function toISO(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function prettyDate(iso: string): string {
	const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
	return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Fenêtre de replanification autonome cliente : jusqu'à 4 h avant (§15). */
export const CLIENT_RESCHEDULE_LIMIT_MS = 4 * 60 * 60 * 1000;

/** La cliente peut-elle encore replanifier seule ce RDV ? */
export function clientCanReschedule(r: { date: string; time: string }): boolean {
	return rdvStartMs(r) - Date.now() > CLIENT_RESCHEDULE_LIMIT_MS;
}

export type AvailabilitySlot = { start: string; end: string };
export type AvailabilityDay = { date: string; slots: AvailabilitySlot[] };

/**
 * Créneaux réellement disponibles (moteur serveur) :
 * plages autorisées − Google Calendar − RDV G-FLUX − buffers, pour le TYPE
 * demandé (la durée dépend du type). `excludeId` : replanification.
 */
export async function fetchAvailability(opts: {
	date: string;
	kind: string;
	excludeId?: string;
}): Promise<{ days: AvailabilityDay[]; durationMin: number; bufferMin: number }> {
	const p = new URLSearchParams({ date: opts.date, type: opts.kind });
	if (opts.excludeId) p.set('excludeId', opts.excludeId);
	const res = await fetch(`/api/appointments/availability?${p.toString()}`);
	const j = (await res.json()) as {
		days?: AvailabilityDay[];
		durationMin?: number;
		bufferMin?: number;
		error?: string;
	};
	if (!res.ok) throw new Error(j.error ?? 'Disponibilités indisponibles.');
	return {
		days: j.days ?? [],
		durationMin: j.durationMin ?? kindRule(opts.kind).durationMin,
		bufferMin: j.bufferMin ?? 5,
	};
}
