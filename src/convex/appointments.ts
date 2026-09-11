import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { getSessionUser, wallTimeToUtcMs } from "./helpers";
import { recordEvent } from "./notifications";

/** Description CRM d'un RDV (ex. « Suivi le ven. 18 sept. à 09:00 »). */
function rdvDescription(a: { kind: string; date: string; time: string }): string {
	const d = new Date(`${a.date}T12:00:00Z`).toLocaleDateString("fr-FR", {
		weekday: "short",
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	});
	return `${a.kind} le ${d} à ${a.time}`;
}

/** Message exact quand un créneau vient d'être pris (double booking évité). */
export const SLOT_TAKEN_MESSAGE = "Ce créneau vient d’être réservé, choisis-en un autre";

/**
 * Grille d'affichage des créneaux : pas de 15 minutes, les heures rondes et
 * les multiples de 15 uniquement. La durée COMPLÈTE du rendez-vous doit tenir
 * dans la plage ouverte — même règle que le moteur de disponibilité BFF.
 */
const SLOT_GRID_STEP_MIN = 15;

/**
 * Rendez-vous (CRM coach ⇄ cliente) — moteur de réservation.
 *
 * RÈGLE CENTRALE : booking réussi = rendez-vous CONFIRMÉ. Il n'existe plus
 * de « demande à valider » : la revérification serveur du créneau (dispo de
 * la coach − événements Google − RDV existants − buffers) est la seule
 * validation. L'origine (`bookingSource`) ne donne jamais de droit : une
 * cliente peut replanifier un RDV créé par elle ou par son coach.
 *
 * Les dates sont "yyyy-mm-dd" et heures "HH:mm" dans le fuseau de la coach
 * (Europe/Paris). L'événement Google Calendar est créé/déplacé/supprimé par
 * le BFF SvelteKit (`googleCalendarFetch`), qui lit le googleEventId ici.
 */

/** Durées réelles + buffers par type (le buffer sert UNIQUEMENT à la dispo). */
export const KIND_RULES: Record<string, { durationMin: number; bufferMin: number }> = {
	Suivi: { durationMin: 15, bufferMin: 5 },
	Démarrage: { durationMin: 60, bufferMin: 5 },
};

/** Règles d'un type connu, sinon repli (30 min / 5) pour les anciens RDV. */
export function kindRule(kind: string): { durationMin: number; bufferMin: number } {
	return KIND_RULES[kind] ?? { durationMin: 30, bufferMin: 5 };
}

async function requireUser(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	return user;
}

async function requireCoach(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await requireUser(ctx, sessionToken);
	if (user.role !== "coach") throw new ConvexError("Accès réservé au coach.");
	return user;
}

/** Minutes depuis minuit — pour trier les créneaux. */
function toMin(hhmm: string): number {
	const [h, m] = hhmm.split(":");
	return Number(h) * 60 + Number(m);
}

/**
 * Chevauchement minute-minute sur le même jour (bornes exclusives : [s, e)).
 * Aligné sur le moteur BFF : deux plages qui se touchent exactement (fin =
 * début) ne se chevauchent PAS — le buffer 5 min garantit déjà l'aération.
 */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
	return aStart < bEnd && aEnd > bStart;
}

/** Le début est-il sur la grille des créneaux proposés (pas 15 min) ? */
function onSlotGrid(time: string): boolean {
	return toMin(time) % SLOT_GRID_STEP_MIN === 0;
}

/** Plages hebdo d'un coach (lecture interne, sans contrôle de rôle). */
async function rangesOfCoach(ctx: Pick<QueryCtx, "db">, coachId: Id<"users">) {
	const s = await ctx.db
		.query("bookingSettings")
		.withIndex("by_coach", (q) => q.eq("coachId", coachId))
		.unique();
	return s ? s.ranges : [];
}

/**
 * Garde-fous d'un créneau demandé (création ou replanification) : format,
 * durée RÉELLE du type, grille 15 min, et durée complète qui tient dans une
 * plage de disponibilité ouverte. Le coach est soumis à la même grille que
 * ses clientes — l'agenda est unique.
 */
function validateSlotInput(
	ranges: { day: number; start: string; end: string }[],
	date: string,
	time: string,
	endTime: string,
	kind: string
): { startMin: number; endMin: number } {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !/^\d{2}:\d{2}$/.test(endTime)) {
		throw new ConvexError("Date ou horaire invalide.");
	}
	const rule = kindRule(kind);
	const startMin = toMin(time);
	const endMin = toMin(endTime);
	if (endMin <= startMin) throw new ConvexError("L'heure de fin doit être après le début.");
	if (endMin - startMin !== rule.durationMin) {
		throw new ConvexError(`La durée de ce rendez-vous est de ${rule.durationMin} min.`);
	}
	if (!onSlotGrid(time)) {
		throw new ConvexError("Horaire hors créneaux proposés — choisis un créneau de la grille.");
	}
	const day = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
	const inRanges = ranges.some(
		(r) => r.day === day && startMin >= toMin(r.start) && endMin <= toMin(r.end)
	);
	if (!inRanges) {
		throw new ConvexError("Ce créneau est hors des disponibilités du coach.");
	}
	return { startMin, endMin };
}

/**
 * Busy du coach (RDV confirmés + buffers) sur une date, hors un RDV exclu
 * (replanification : le RDV déplacé ne doit pas se bloquer lui-même).
 */
async function busyFromAppointments(
	ctx: QueryCtx,
	coachId: Id<"users">,
	date: string,
	excludeId?: Id<"appointments">
): Promise<{ start: number; end: number }[]> {
	const rows = await ctx.db
		.query("appointments")
		.withIndex("by_coach", (q) => q.eq("coachId", coachId))
		.collect();
	return rows
		.filter((a) => a._id !== excludeId && a.status === "on_book" && a.date === date)
		.map((a) => {
			const rule = kindRule(a.kind);
			return { start: toMin(a.time) - rule.bufferMin, end: toMin(a.endTime) + rule.bufferMin };
		});
}

/** Type public d'un rendez-vous (jamais d'objet interne). */
function publicAppointment(a: Doc<"appointments">, nameOf: (id: Id<"users">) => string | null) {
	return {
		_id: a._id,
		coachId: a.coachId,
		clientId: a.clientId,
		date: a.date,
		time: a.time,
		endTime: a.endTime,
		kind: a.kind,
		status: a.status,
		bookedBy: a.bookedBy,
		bookingSource: a.bookingSource ?? null,
		lastModifiedBy: a.lastModifiedBy ?? null,
		bookedByName: a.bookedBy ? nameOf(a.bookedBy) : null,
		createdAt: a.createdAt,
		updatedAt: a.updatedAt ?? null,
		rescheduleCount: a.rescheduleCount ?? 0,
		/** Présent uniquement sur les anciennes demandes de replanification (compat). */
		sourceId: a.sourceId ?? null,
		googleEventId: a.googleEventId ?? null,
		cancelledAt: a.cancelledAt ?? null,
		cancelledBy: a.cancelledBy ?? null,
	};
}

/** Résout les prénoms de QUI a réservé (coach ou cliente) pour chaque ligne. */
async function namesOf(ctx: QueryCtx, rows: Doc<"appointments">[]): Promise<Map<Id<"users">, string>> {
	const names = new Map<Id<"users">, string>();
	for (const a of rows) {
		for (const uid of [a.clientId, a.bookedBy]) {
			if (uid && !names.has(uid)) {
				const u = await ctx.db.get(uid);
				names.set(uid, u ? (uid === a.clientId && u.nom ? `${u.prenom} ${u.nom}` : u.prenom) : "—");
			}
		}
	}
	return names;
}

/** Créneaux hebdo (une ligne par coach) : le coach lit les siens, la cliente
 *  lit ceux de SA coach (users.createdBy) pour proposer un créneau. */
export const getSettings = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireUser(ctx, sessionToken);
		let coachId = user._id;
		if (user.role === "client") {
			const coach = user.createdBy ? await ctx.db.get(user.createdBy) : null;
			if (!coach) return null;
			coachId = coach._id;
		}
		const s = await ctx.db
			.query("bookingSettings")
			.withIndex("by_coach", (q) => q.eq("coachId", coachId))
			.unique();
		return s ? { _id: s._id, ranges: s.ranges, updatedAt: s.updatedAt } : null;
	},
});

/** Enregistre les disponibilités hebdo de la coach. */
export const upsertSettings = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		ranges: v.array(v.object({ day: v.number(), start: v.string(), end: v.string() })),
	},
	handler: async (ctx, { sessionToken, ranges }) => {
		const user = await requireCoach(ctx, sessionToken);
		const cleaned = ranges
			.filter(
				(r) =>
					r.day >= 1 &&
					r.day <= 7 &&
					/^\d{2}:\d{2}$/.test(r.start) &&
					/^\d{2}:\d{2}$/.test(r.end) &&
					toMin(r.end) > toMin(r.start)
			)
			.sort((a, b) => a.day - b.day || toMin(a.start) - toMin(b.start));
		const existing = await ctx.db
			.query("bookingSettings")
			.withIndex("by_coach", (q) => q.eq("coachId", user._id))
			.unique();
		if (existing) await ctx.db.patch(existing._id, { ranges: cleaned, updatedAt: Date.now() });
		else await ctx.db.insert("bookingSettings", { coachId: user._id, ranges: cleaned, updatedAt: Date.now() });
		return { ok: true, ranges: cleaned };
	},
});

/** Liste des rendez-vous gérés par la coach (toutes clientes, à venir + passés proches). */
export const listForCoach = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const rows = await ctx.db
			.query("appointments")
			.withIndex("by_coach", (q) => q.eq("coachId", coach._id))
			.order("desc")
			.take(400);
		const names = await namesOf(ctx, rows);
		return rows.map((a) => publicAppointment(a, (id) => names.get(id) ?? null));
	},
});

/**
 * Rendez-vous d'une cliente — SOURCE DE VÉRITÉ = clientId demandé.
 * Vue cliente (elle-même, sans `userId`) ou coach dans le 360° (`userId`).
 * Le filtre se fait dans la REQUÊTE (index by_client) : aucune liste globale
 * n'est jamais envoyée puis filtrée côté client.
 */
export const listForUser = query({
	args: { sessionToken: v.optional(v.string()), userId: v.optional(v.id("users")) },
	handler: async (ctx, { sessionToken, userId }) => {
		const user = await requireUser(ctx, sessionToken);
		let targetId: Id<"users">;
		if (userId) {
			// Le coach consulte le planning de SA cliente.
			if (user.role !== "coach") throw new ConvexError("Accès réservé au coach.");
			targetId = userId;
		} else {
			if (user.role !== "client") throw new ConvexError("Accès réservé aux clientes.");
			targetId = user._id;
		}
		const rows = await ctx.db
			.query("appointments")
			.withIndex("by_client", (q) => q.eq("clientId", targetId))
			.order("desc")
			.take(100);
		const names = await namesOf(ctx, rows);
		return rows.map((a) => publicAppointment(a, (id) => names.get(id) ?? null));
	},
});

/** Id du coach rattaché à la cliente connectée (push Google depuis le BFF). */
export const myCoachId = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireUser(ctx, sessionToken);
		if (user.role !== "client") return null;
		return user.createdBy ?? null;
	},
});

/**
 * Réservation par le coach pour une cliente (date + heure exacte) —
 * créée DIRECTEMENT confirmée (`on_book`). La revérification serveur du
 * créneau (dispo − RDV − buffers) est la seule validation.
 */
export const bookByCoach = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		clientId: v.id("users"),
		date: v.string(),
		time: v.string(),
		endTime: v.string(),
		kind: v.string(),
	},
	handler: async (ctx, { sessionToken, clientId, date, time, endTime, kind }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const client = await ctx.db.get(clientId);
		if (!client || client.role !== "client") throw new ConvexError("Cliente introuvable.");
		const ranges = await rangesOfCoach(ctx, coach._id);
		// Garde-fous : format, durée réelle, grille 15 min, plage ouverte.
		const { startMin, endMin } = validateSlotInput(ranges, date, time, endTime, kind);
		// Revérification serveur : créneau toujours libre (RDV + buffers) ?
		const busy = await busyFromAppointments(ctx, coach._id, date);
		const candidate = { start: startMin - kindRule(kind).bufferMin, end: endMin + kindRule(kind).bufferMin };
		if (busy.some((b) => overlaps(candidate.start, candidate.end, b.start, b.end))) {
			throw new ConvexError(SLOT_TAKEN_MESSAGE);
		}
		// Passé : un RDV commence toujours après maintenant (durée complète).
		if (wallTimeToUtcMs(date, time, "Europe/Paris") <= Date.now()) {
			throw new ConvexError("Ce créneau est déjà passé — choisis un créneau à venir.");
		}
		const now = Date.now();
		const id = await ctx.db.insert("appointments", {
			coachId: coach._id,
			clientId,
			date,
			time,
			endTime,
			kind,
			status: "on_book",
			bookedBy: coach._id,
			bookingSource: "coach",
			createdAt: now,
			updatedAt: now,
		});
		await recordEvent(ctx, clientId, "rdv_pris", rdvDescription({ kind, date, time }), { appointmentId: id });
		return { appointmentId: id, date, time, endTime, kind };
	},
});

/**
 * Réservation par la cliente — créée DIRECTEMENT confirmée (`on_book`).
 * Aucune validation coach : la revérification serveur du créneau
 * (dispo − RDV − buffers) est la seule validation. booking réussi = validé.
 */
export const bookByClient = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
		time: v.string(),
		endTime: v.string(),
		kind: v.string(),
	},
	handler: async (ctx, { sessionToken, date, time, endTime, kind }) => {
		const user = await requireUser(ctx, sessionToken);
		if (user.role !== "client") throw new ConvexError("Accès réservé aux clientes.");
		// « Démarrage » est réservé au coach : une cliente ne peut créer qu'un Suivi.
		if (kind !== "Suivi") {
			throw new ConvexError("Type de rendez-vous non disponible — le démarrage est proposé par ton coach.");
		}
		const coachId = user.createdBy;
		if (!coachId) throw new ConvexError("Ton coach n'est pas encore rattaché à ton compte.");
		const ranges = await rangesOfCoach(ctx, coachId);
		// Garde-fous : format, durée réelle, grille 15 min, plage ouverte.
		const { startMin, endMin } = validateSlotInput(ranges, date, time, endTime, kind);
		// Revérification serveur : créneau toujours libre (RDV + buffers) ?
		const busy = await busyFromAppointments(ctx, coachId, date);
		const candidate = { start: startMin - kindRule(kind).bufferMin, end: endMin + kindRule(kind).bufferMin };
		if (busy.some((b) => overlaps(candidate.start, candidate.end, b.start, b.end))) {
			throw new ConvexError(SLOT_TAKEN_MESSAGE);
		}
		// Passé : un RDV commence toujours après maintenant (durée complète).
		if (wallTimeToUtcMs(date, time, "Europe/Paris") <= Date.now()) {
			throw new ConvexError("Ce créneau est déjà passé — choisis un créneau à venir.");
		}
		const now = Date.now();
		const id = await ctx.db.insert("appointments", {
			coachId,
			clientId: user._id,
			date,
			time,
			endTime,
			kind,
			status: "on_book",
			bookedBy: user._id,
			bookingSource: "client",
			createdAt: now,
			updatedAt: now,
		});
		await recordEvent(ctx, user._id, "rdv_pris", rdvDescription({ kind, date, time }), { appointmentId: id });
		return { appointmentId: id, date, time, endTime, kind };
	},
});

/** Replanification (coach ou cliente) — même RDV, même événement Google. */
export const reschedule = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		appointmentId: v.id("appointments"),
		date: v.string(),
		time: v.string(),
		endTime: v.string(),
	},
	handler: async (ctx, { sessionToken, appointmentId, date, time, endTime }) => {
		const user = await requireUser(ctx, sessionToken);
		const a = await ctx.db.get(appointmentId);
		if (!a) throw new ConvexError("Rendez-vous introuvable.");
		const isCoach = user.role === "coach" && a.coachId === user._id;
		const isClient = user.role === "client" && a.clientId === user._id;
		if (!isCoach && !isClient) throw new ConvexError("Action non autorisée.");
		if (a.status !== "on_book") throw new ConvexError("Ce rendez-vous n'est pas confirmé.");
		const ranges = await rangesOfCoach(ctx, a.coachId);
		// Garde-fous : format, durée réelle, grille 15 min, plage ouverte.
		const { startMin, endMin } = validateSlotInput(ranges, date, time, endTime, a.kind);
		// Limite cliente : replanification autonome jusqu'à 4 h avant (jamais pour le coach).
		if (!isCoach) {
			const startAt = wallTimeToUtcMs(a.date, a.time, "Europe/Paris");
			if (startAt - Date.now() < 4 * 60 * 60 * 1000) {
				throw new ConvexError("Moins de 4 h avant le rendez-vous : contacte directement ton coach.");
			}
		}
		// Revérification serveur : le nouveau créneau est-il toujours libre ?
		// (le RDV déplacé ne se bloque pas lui-même — excludeId).
		const busy = await busyFromAppointments(ctx, a.coachId, date, appointmentId);
		const candidate = { start: startMin - kindRule(a.kind).bufferMin, end: endMin + kindRule(a.kind).bufferMin };
		if (busy.some((b) => overlaps(candidate.start, candidate.end, b.start, b.end))) {
			throw new ConvexError(SLOT_TAKEN_MESSAGE);
		}
		// Passé : un RDV se déplace toujours vers un créneau à venir.
		if (wallTimeToUtcMs(date, time, "Europe/Paris") <= Date.now()) {
			throw new ConvexError("Ce créneau est déjà passé — choisis un créneau à venir.");
		}
		const now = Date.now();
		await ctx.db.patch(appointmentId, {
			date,
			time,
			endTime,
			updatedAt: now,
			lastModifiedBy: user._id,
			rescheduleCount: (a.rescheduleCount ?? 0) + 1,
			// Réarmement du rappel 12 h : un éventuel envoi lié à l'ANCIENNE date
			// n'empêchera plus le rappel de la nouvelle (logique startAt, §27).
			reminder12hSentAt: undefined,
			reminder12hForStartAt: undefined,
			// googleEventId conservé : le BFF déplace le MÊME événement Google.
		});
		await recordEvent(
			ctx,
			a.clientId,
			"rdv_replanifie",
			`${rdvDescription({ kind: a.kind, date, time })} (auparavant ${rdvDescription({ kind: a.kind, date: a.date, time: a.time })})`,
			{ appointmentId }
		);
		return { ok: true, googleEventId: a.googleEventId ?? null, date, time, endTime, kind: a.kind };
	},
});

/** Annulation (coach ou cliente) — l'historique est conservé, le créneau libéré. */
export const cancel = mutation({
	args: { sessionToken: v.optional(v.string()), appointmentId: v.id("appointments") },
	handler: async (ctx, { sessionToken, appointmentId }) => {
		const user = await requireUser(ctx, sessionToken);
		const a = await ctx.db.get(appointmentId);
		if (!a) throw new ConvexError("Rendez-vous introuvable.");
		const isCoach = user.role === "coach" && a.coachId === user._id;
		const isClient = user.role === "client" && a.clientId === user._id;
		if (!isCoach && !isClient) throw new ConvexError("Action non autorisée.");
		if (a.status === "cancelled") return { ok: true, googleEventId: a.googleEventId ?? null };
		await ctx.db.patch(appointmentId, {
			status: "cancelled",
			cancelledAt: Date.now(),
			cancelledBy: user._id,
			lastModifiedBy: user._id,
			updatedAt: Date.now(),
			// Aucun futur rappel sur un RDV annulé (§28) : l'état cancelled
			// exclut déjà le RDV du moteur de rappel — on purge aussi l'état.
			reminder12hSentAt: undefined,
			reminder12hForStartAt: undefined,
			// googleEventId conservé : le BFF supprime l'événement Google associé.
		});
		await recordEvent(ctx, a.clientId, "rdv_annule", `${rdvDescription(a)} — annulé`, { appointmentId });
		return { ok: true, googleEventId: a.googleEventId ?? null };
	},
});

/** Associe l'événement Google Calendar créé par le BFF au rendez-vous. */
export const attachGoogleEvent = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		appointmentId: v.id("appointments"),
		googleEventId: v.string(),
	},
	handler: async (ctx, { sessionToken, appointmentId, googleEventId }) => {
		const user = await requireUser(ctx, sessionToken);
		const a = await ctx.db.get(appointmentId);
		if (!a) throw new ConvexError("Rendez-vous introuvable.");
		if (!(user.role === "coach" && a.coachId === user._id) && a.clientId !== user._id) {
			throw new ConvexError("Action non autorisée.");
		}
		await ctx.db.patch(appointmentId, { googleEventId, updatedAt: Date.now() });
		return { ok: true };
	},
});

/**
 * MOTEUR DE DISPONIBILITÉ — lectures publiques, session requise, appelées par
 * le BFF SvelteKit (endpoint /api/appointments/availability). Le calcul final
 * (plages − Google − RDV − buffers) vit côté BFF : Convex fournit les données
 * brutes, mais chaque lecture vérifie que l'appelant est le coach lui-même ou
 * une cliente rattachée à CE coach (jamais un autre coach ni un tiers).
 */
export const internalSettingsOf = query({
	args: { sessionToken: v.optional(v.string()), coachId: v.id("users") },
	handler: async (ctx, { sessionToken, coachId }) => {
		const user = await requireUser(ctx, sessionToken);
		const isCoach = user.role === "coach" && user._id === coachId;
		const isClientOf = user.role === "client" && user.createdBy === coachId;
		if (!isCoach && !isClientOf) throw new ConvexError("Accès refusé.");
		return rangesOfCoach(ctx, coachId);
	},
});

/**
 * Moteur de dispo — rendez-vous BRUTS du coach (toutes clientes), pour le
 * coach lui-même ou une de ses clientes. Le BFF applique lui-même le filtre
 * par statut, les buffers et le freebusy Google.
 */
export const listForCoachInternal = query({
	args: { sessionToken: v.optional(v.string()), coachId: v.id("users") },
	handler: async (ctx, { sessionToken, coachId }) => {
		const user = await requireUser(ctx, sessionToken);
		const isCoach = user.role === "coach" && user._id === coachId;
		const isClientOf = user.role === "client" && user.createdBy === coachId;
		if (!isCoach && !isClientOf) throw new ConvexError("Accès refusé.");
		const rows = await ctx.db
			.query("appointments")
			.withIndex("by_coach", (q) => q.eq("coachId", coachId))
			.collect();
		return rows.map((a) => ({
			_id: a._id,
			clientId: a.clientId,
			date: a.date,
			time: a.time,
			endTime: a.endTime,
			kind: a.kind,
			status: a.status,
		}));
	},
});

/**
 * Lecture de sécurité POUR LE BFF — un seul rendez-vous par _id, visible
 * uniquement par le coach propriétaire ou la cliente du RDV. Utilisée par la
 * 2e vérification serveur du créneau : la propriété du rendez-vous est
 * revérifiée ICI (dans la transaction Convex), jamais seulement côté BFF.
 */
export const getForUser = query({
	args: { sessionToken: v.optional(v.string()), appointmentId: v.id("appointments") },
	handler: async (ctx, { sessionToken, appointmentId }) => {
		const user = await requireUser(ctx, sessionToken);
		const a = await ctx.db.get(appointmentId);
		if (!a) return null;
		const isCoach = user.role === "coach" && a.coachId === user._id;
		const isClient = user.role === "client" && a.clientId === user._id;
		if (!isCoach && !isClient) return null;
		return {
			_id: a._id,
			coachId: a.coachId,
			clientId: a.clientId,
			date: a.date,
			time: a.time,
			endTime: a.endTime,
			kind: a.kind,
			status: a.status,
		};
	},
});

/**
 * MOTEUR DE RAPPEL 12 h — fenêtre à balayer, sans session (usage interne).
 * Source de vérité = appointment.confirmé (status on_book) + startAt calculé
 * dans le fuseau de la coach. Aucune donnée de rappel indépendante : le
 * rappel est DÉRIVÉ du rendez-vous (§29).
 */
export const internalWindow = internalQuery({
	args: { now: v.number() },
	handler: async (ctx, { now }) => {
		const rows = await ctx.db
			.query("appointments")
			.withIndex("by_coach")
			.order("desc")
			.take(600);
		const out: {
			_id: string;
			clientId: string;
			date: string;
			time: string;
			kind: string;
			status: string;
			startAtMs: number;
			reminder12hSentAt: number | null;
			reminder12hForStartAt: number | null;
		}[] = [];
		for (const a of rows) {
			if (a.status !== "on_book") continue;
			const startAtMs = wallTimeToUtcMs(a.date, a.time, "Europe/Paris");
			if (!Number.isFinite(startAtMs)) continue;
			// Fenêtre large : rappels à envoyer (fenêtre 12 h entamée) + rappels
			// envoyés dont la date a bougé (à réarmer) — le filtre fin se fait
			// dans l'action d'envoi.
			if (startAtMs - now > 12 * 3600 * 1000 + 30 * 60 * 1000) continue;
			if (startAtMs <= now - 7 * 24 * 3600 * 1000) continue;
			out.push({
				_id: a._id,
				clientId: a.clientId,
				date: a.date,
				time: a.time,
				kind: a.kind,
				status: a.status,
				startAtMs,
				reminder12hSentAt: a.reminder12hSentAt ?? null,
				reminder12hForStartAt: a.reminder12hForStartAt ?? null,
			});
		}
		return out;
	},
});

/**
 * Marque le rappel 12 h comme envoyé — IDEMPOTENT (§26) : la condition de
 * garde est évaluée dans CETTE mutation transactionnelle. Un double appel
 * (cron qui se superpose, retry) ne réenvoie jamais la notification.
 */
export const internalMarkReminderSent = internalMutation({
	args: { appointmentId: v.id("appointments"), startAtMs: v.number() },
	handler: async (ctx, { appointmentId, startAtMs }) => {
		const a = await ctx.db.get(appointmentId);
		if (!a || a.status !== "on_book") return { ok: false as const };
		// Garde : le RDV a bougé ou le rappel a déjà été posé pendant l'envoi.
		const currentStart = wallTimeToUtcMs(a.date, a.time, "Europe/Paris");
		if (currentStart !== startAtMs) return { ok: false as const };
		if (a.reminder12hSentAt && a.reminder12hForStartAt === startAtMs) {
			return { ok: false as const };
		}
		await ctx.db.patch(appointmentId, {
			reminder12hSentAt: Date.now(),
			reminder12hForStartAt: startAtMs,
		});
		return { ok: true as const };
	},
});

/** Suppression d'une ancienne demande cliente (compat — plus de flux « demande »). */
export const removeLegacyRequest = mutation({
	args: { sessionToken: v.optional(v.string()), requestId: v.id("appointments") },
	handler: async (ctx, { sessionToken, requestId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const req = await ctx.db.get(requestId);
		if (!req || req.coachId !== coach._id || req.status !== "client_request") {
			throw new ConvexError("Demande introuvable ou déjà traitée.");
		}
		await ctx.db.delete(requestId);
		return { ok: true };
	},
});
