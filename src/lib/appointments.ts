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

/**
 * Message EXACT affiché quand le créneau a été pris entre-temps (double
 * booking évité de justesse) : la 2e vérification serveur au clic « Réserver »
 * a refusé la création, aucun RDV n'a été créé, et les disponibilités sont
 * rechargées immédiatement.
 */
export const SLOT_TAKEN_MESSAGE = 'Ce créneau vient d’être réservé, choisis-en un autre';

/** Codes d’échec de la vérification finale d’un créneau (2e passe serveur). */
export type SlotCheckFailureCode =
	| 'slot_taken'
	| 'not_in_ranges'
	| 'in_past'
	| 'overlap_gflux'
	| 'overlap_google'
	| 'invalid'
	| 'google_unavailable'
	| 'google_not_connected'
	| 'unknown';

/** Résultat de la vérification finale d’un créneau (moteur serveur). */
export type SlotCheck =
	| { ok: true; durationMin: number; bufferMin: number }
	| { ok: false; code: SlotCheckFailureCode; message: string; durationMin: number; bufferMin: number };

/** La cliente peut-elle encore replanifier seule ce RDV ? */
export function clientCanReschedule(r: { date: string; time: string }): boolean {
	return rdvStartMs(r) - Date.now() > CLIENT_RESCHEDULE_LIMIT_MS;
}

/**
 * Erreur de disponibilité structurée — le client peut reconnaître un échec
 * strict du moteur (Google injoignable / non connecté, créneau pris…) sans
 * parser un message en langue naturelle.
 */
export class AvailabilityError extends Error {
	code: 'google_unavailable' | 'google_not_connected' | 'slot_taken' | 'unknown';
	constructor(
		code: 'google_unavailable' | 'google_not_connected' | 'slot_taken' | 'unknown',
		message: string
	) {
		super(message);
		this.code = code;
	}
}

/**
 * VÉRIFICATION FINALE D'UN CRÉNEAU juste avant la réservation (2e passe
 * serveur, indépendante de l'affichage). À appeler au clic « Réserver » : si
 * le créneau vient d’être pris, on n’envoie JAMAIS le POST/PATCH — on
 * affiche `SLOT_TAKEN_MESSAGE` et on recharge les disponibilités.
 */
export async function verifySlot(opts: {
	date: string;
	time: string;
	kind: string;
	excludeId?: string;
}): Promise<SlotCheck> {
	const p = new URLSearchParams({ date: opts.date, time: opts.time, type: opts.kind });
	if (opts.excludeId) p.set('excludeId', opts.excludeId);
	const res = await fetch(`/api/appointments/availability/verify?${p.toString()}`);
	const j = (await res.json()) as {
		ok?: boolean;
		reason?: string;
		code?: string;
		message?: string;
		durationMin?: number;
		bufferMin?: number;
		error?: string;
	};
	if (!res.ok && res.status !== 409) {
		throw new AvailabilityError(
			(j.code as AvailabilityError['code']) ?? 'unknown',
			j.error ?? j.message ?? 'Vérification du créneau impossible.'
		);
	}
	if (j.ok) {
		return {
			ok: true,
			durationMin: j.durationMin ?? kindRule(opts.kind).durationMin,
			bufferMin: j.bufferMin ?? 5,
		};
	}
	return {
		ok: false,
		code: (j.code as SlotCheckFailureCode) ?? 'unknown',
		message: j.message ?? SLOT_TAKEN_MESSAGE,
		durationMin: j.durationMin ?? kindRule(opts.kind).durationMin,
		bufferMin: j.bufferMin ?? 5,
	};
}

/**
 * RECHARGE IMMÉDIATE des disponibilités — appelé dès qu'un créneau s'est
 * fait prendre entre-temps (vérification finale ou refus à la création) :
 * l'utilisateur revoit instantanément la grille réelle, jamais une liste
 * périmée contenant encore le créneau fantôme.
 */
export async function refreshAvailability(opts: {
	date: string;
	kind: string;
	excludeId?: string;
	days?: number;
}): Promise<{ days: AvailabilityDay[]; durationMin: number; bufferMin: number }> {
	return fetchAvailability(opts);
}

export type AvailabilitySlot = { start: string; end: string };
export type AvailabilityDay = { date: string; slots: AvailabilitySlot[] };

/**
 * Créneaux réellement disponibles (moteur serveur STRICT, recalcul à chaque
 * appel — jamais un cache) :
 * disponibilités coach − Google Calendar − RDV G-FLUX (toutes clientes) −
 * buffers, avec la durée COMPLÈTE du type demandé. `excludeId` : replanification.
 *
 * STRICT : si l'agenda Google ne peut pas être lu (non connecté, erreur,
 * token expiré), l'endpoint renvoie une erreur — aucun créneau approximatif
 * n'est jamais affiché.
 */
export async function fetchAvailability(opts: {
	date: string;
	kind: string;
	excludeId?: string;
	/** Nombre de jours à partir de `date` (défaut 1 — ex. 7 pour la semaine du CRM coach). */
	days?: number;
}): Promise<{ days: AvailabilityDay[]; durationMin: number; bufferMin: number }> {
	const p = new URLSearchParams({ date: opts.date, type: opts.kind });
	if (opts.excludeId) p.set('excludeId', opts.excludeId);
	if (opts.days) p.set('days', String(opts.days));
	const res = await fetch(`/api/appointments/availability?${p.toString()}`);
	const j = (await res.json()) as {
		days?: AvailabilityDay[];
		durationMin?: number;
		bufferMin?: number;
		error?: string;
		code?: string;
	};
	if (!res.ok) {
		// Échec STRICT du moteur (Google non connecté / injoignable) : erreur
		// structurée — l'appelant peut afficher une explication honnête au lieu
		// d'une liste de créneaux non garantis.
		if (j.code === 'google_unavailable' || j.code === 'google_not_connected') {
			throw new AvailabilityError(j.code, j.error ?? 'Agenda non vérifiable.');
		}
		throw new Error(j.error ?? 'Disponibilités indisponibles.');
	}
	return {
		days: j.days ?? [],
		durationMin: j.durationMin ?? kindRule(opts.kind).durationMin,
		bufferMin: j.bufferMin ?? 5,
	};
}
