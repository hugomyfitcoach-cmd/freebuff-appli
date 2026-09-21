/**
 * Module Entraînement — ASSIGNATION d'un programme à une cliente + suivi.
 *
 * Principe (règle produit non négociable) : le programme assigné est une
 * COPIE indépendante (copyProgramInto, clientId présent) — modifier le
 * programme modèle ne modifie jamais rétroactivement ce que la cliente suit.
 * Les occurrences datées vivent dans `trainingScheduledSessions` ; l'échec ou
 * le remplacement n'efface JAMAIS l'historique (`trainingSetLogs` est
 * autonome, tout en snapshot, et n'est jamais écrit ici à part l'ajout).
 *
 * Accès : coach via BFF SvelteKit (session cookie). La cliente ne passe JAMAIS
 * par ce module pour écrire : ses gestes vivent dans trainingClient.ts.
 */

import { query, mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser, addDaysISO, mondayISOof } from "./helpers";
import { copyProgramInto } from "./training";

/* ── Phases (partagées avec training.ts, libellés FR affichables) ── */

export const PHASE_LABELS: Record<string, string> = {
	echauffement: "Échauffement",
	principal: "Entraînement principal",
	finisher: "Finisher",
};

/** Ordre d'affichage des phases dans une séance (échauffement en premier). */
export const PHASE_ORDER: Record<string, number> = {
	echauffement: 0,
	principal: 1,
	finisher: 2,
};

/* ── Garde-fous ── */

const MAX_WEEKS = 52;
const MAX_WEEKDAYS = 7;
/** Jours max couverts par une assignation (52 semaines pleines). */
const MAX_SPAN_DAYS = 366;

function clampInt(n: number, min: number, max: number, label: string): number {
	if (!Number.isFinite(n)) throw new ConvexError(`${label} : valeur invalide.`);
	const r = Math.round(n);
	if (r < min || r > max) throw new ConvexError(`${label} : doit être entre ${min} et ${max}.`);
	return r;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidISO(s: string): boolean {
	if (!ISO_RE.test(s)) return false;
	const [y, m, d] = s.split("-").map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** ISO weekday (1 = lundi … 7 = dimanche) d'une date "yyyy-mm-dd". */
function isoWeekday(iso: string): number {
	const d = new Date(iso + "T00:00:00Z");
	const js = d.getUTCDay(); // 0 = dimanche
	return js === 0 ? 7 : js;
}

/* ── Auth ── */

async function requireCoach(ctx: Pick<MutationCtx, "db">, sessionToken?: string | null) {
	const coach = await getSessionUser(ctx, sessionToken);
	if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (CRM).");
	return coach;
}

/* ── Répartition logique des jours (présélection à l'assignation) ── */

/** Jours conseillés selon le nombre de séances/semaine — précochés dans l'UI. */
export const SUGGESTED_WEEKDAYS: Record<number, number[]> = {
	1: [3],
	2: [2, 5],
	3: [1, 3, 6],
	4: [1, 2, 4, 6],
	5: [1, 2, 3, 5, 6],
	6: [1, 2, 3, 4, 5, 6],
	7: [1, 2, 3, 4, 5, 6, 7],
};

/* ═══════════ Génération des occurrences ═══════════ */

/**
 * Dates des occurrences : les séances (dans l'ordre du programme) se posent
 * en boucle sur les jours cochés, à partir de la date de début incluse.
 * Plusieurs séances peuvent tomber le même jour si la coach coche plus de
 * jours qu'il n'y a de séances… non : en boucle, chaque jour coché porte la
 * séance suivante, et après la dernière on recommence à la première.
 */
function plannedDates(startDate: string, endDate: string, weekdays: number[]): string[] {
	const days: string[] = [];
	let d = startDate;
	while (d <= endDate) {
		if (weekdays.includes(isoWeekday(d))) days.push(d);
		d = addDaysISO(d, 1);
		if (days.length > 400) break; // garde-fou dur (52 sem × 7 j = 364 max)
	}
	return days;
}

/* ═══════════ Lectures coach ═══════════ */

/**
 * Liste des assignations de la coach (toutes clientes), avec un résumé par
 * cliente : programme, période, séances prévues/réalisées, prochaine séance.
 * Sert à l'onglet Entraînement du tableau de bord ET aux Vision 360.
 */
export const listAssignments = query({
	args: {
		sessionToken: v.optional(v.string()),
		/** Filtre par cliente (Vision 360) — optionnel. */
		userId: v.optional(v.id("users")),
	},
	handler: async (ctx, { sessionToken, userId }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (CRM).");

		const rows = await ctx.db.query("trainingAssignments").withIndex("by_coach", (q) => q.eq("coachId", coach._id)).collect();
		const today = new Date().toISOString().slice(0, 10);
		const out = [];
		for (const a of rows) {
			if (userId && a.userId !== userId) continue;
			const [program, scheduled] = await Promise.all([
				ctx.db.get(a.programId),
				ctx.db.query("trainingScheduledSessions").withIndex("by_assignment", (q) => q.eq("assignmentId", a._id)).collect(),
			]);
			const planned = scheduled.filter((s) => s.status !== "cancelled");
			const completed = planned.filter((s) => s.status === "completed");
			const next = planned
				.filter((s) => s.status === "planned" && s.date >= today)
				.sort((x, y) => x.date.localeCompare(y.date))[0];
			out.push({
				_id: a._id,
				userId: a.userId,
				programId: a.programId,
				programName: program?.name ?? "(programme supprimé)",
				sourceProgramId: a.sourceProgramId,
				startDate: a.startDate,
				endDate: a.endDate,
				weekdays: a.weekdays,
				removedAt: a.removedAt ?? null,
				createdAt: a.createdAt,
				plannedCount: planned.length,
				completedCount: completed.length,
				adherence: planned.length > 0 ? Math.round((completed.length / planned.length) * 100) : null,
				nextDate: next?.date ?? null,
				nextScheduledId: next?._id ?? null,
			});
		}
		// Plus récentes d'abord.
		out.sort((x, y) => y.createdAt - x.createdAt);
		return out;
	},
});

/** Vue détaillée d'une assignation (séances planifiées + infos programme). */
export const assignmentDetail = query({
	args: { sessionToken: v.optional(v.string()), assignmentId: v.id("trainingAssignments") },
	handler: async (ctx, { sessionToken, assignmentId }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (CRM).");
		const a = await ctx.db.get(assignmentId);
		if (!a || a.coachId !== coach._id) throw new ConvexError("Assignation introuvable.");
		const [program, client, sessions] = await Promise.all([
			ctx.db.get(a.programId),
			ctx.db.get(a.userId),
			ctx.db.query("trainingScheduledSessions").withIndex("by_assignment", (q) => q.eq("assignmentId", a._id)).collect(),
		]);
		sessions.sort((x, y) => x.date.localeCompare(y.date) || x._creationTime - y._creationTime);
		const template = a.sourceProgramId ? await ctx.db.get(a.sourceProgramId) : null;
		// Noms des séances (une lecture par séance distincte du programme copie).
		const sesCache = new Map<string, Doc<"trainingSessions"> | null>();
		const sessionNames = new Map<string, string>();
		for (const s of sessions) {
			if (!sessionNames.has(s.sessionId)) {
				sesCache.set(s.sessionId, await ctx.db.get(s.sessionId));
				sessionNames.set(s.sessionId, sesCache.get(s.sessionId)?.name ?? "Séance");
			}
		}
		return {
			_id: a._id,
			userId: a.userId,
			clientName: client ? `${client.prenom}${client.nom ? ` ${client.nom}` : ""}` : "(cliente inconnue)",
			programId: a.programId,
			programName: program?.name ?? "(programme supprimé)",
			templateName: template?.name ?? null,
			templateId: a.sourceProgramId ?? null,
			startDate: a.startDate,
			endDate: a.endDate,
			weekdays: a.weekdays,
			removedAt: a.removedAt ?? null,				sessions: sessions.map((s) => ({
					_id: s._id,
					sessionId: s.sessionId,
					sessionName: sessionNames.get(s.sessionId) ?? "Séance",
					date: s.date,
					status: s.status,
					completedAt: s.completedAt ?? null,
					difficulty: s.difficulty ?? null,
					note: s.note ?? null,
				})),
		};
	},
});

/* ═══════════ Écritures coach ═══════════ */

/**
 * ASSIGNE un programme modèle à une cliente : copie indépendante + génération
 * des occurrences sur les jours cochés, en boucle, sur `weeks` semaines.
 * Un remplacement peut poser `replacesAssignmentId` : les occurrences futures
 * de l'ancienne assignation passent en "cancelled" (jamais supprimées), les
 * séances réalisées restent intactes.
 */
export const assignProgram = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		/** Programme MODÈLE (sans clientId) à copier. */
		sourceProgramId: v.id("trainingPrograms"),
		startDate: v.string(),
		/** Durée en semaines — OBLIGATOIRE, choisie explicitement par la coach. */
		weeks: v.number(),
		/** Jours de semaine cochés (1..7 = lundi..dimanche). */
		weekdays: v.array(v.number()),
		/** Remplacement : assignation dont les séances FUTURES sont annulées. */
		replacesAssignmentId: v.optional(v.id("trainingAssignments")),
	},
	handler: async (
		ctx,
		{ sessionToken, userId, sourceProgramId, startDate, weeks, weekdays, replacesAssignmentId }
	) => {
		const coach = await requireCoach(ctx, sessionToken);

		const client = await ctx.db.get(userId);
		if (!client || client.role !== "client") throw new ConvexError("Cliente introuvable.");

		const src = await ctx.db.get(sourceProgramId);
		if (!src || src.coachId !== coach._id) throw new ConvexError("Programme introuvable.");
		if (src.clientId) throw new ConvexError("Ce programme est déjà une copie assignée — assigne le programme modèle.");

		const nWeeks = clampInt(weeks, 1, MAX_WEEKS, "Durée");
		if (!isValidISO(startDate)) throw new ConvexError("Date de début invalide.");
		if (weekdays.length === 0) throw new ConvexError("Coche au moins un jour de la semaine.");
		const wd = [...new Set(weekdays)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
		if (wd.length === 0 || wd.length > MAX_WEEKDAYS) throw new ConvexError("Jours de semaine invalides.");

		// La première occurrence tombe au PREMIER jour coché à partir de startDate.
		const endDate = addDaysISO(startDate, nWeeks * 7 - 1);
		const dates = plannedDates(startDate, endDate, wd);
		if (dates.length === 0) throw new ConvexError("Aucune date ne correspond aux jours choisis — vérifie la période.");
		if (dates.length > MAX_SPAN_DAYS) throw new ConvexError("Trop de séances générées.");

		const now = Date.now();

		// 1. Copie indépendante du programme (séances → exercices → séries).
		const copyId = await copyProgramInto(ctx, {
			sourceProgramId: src._id,
			coachId: coach._id,
			clientId: userId,
			sourceProgramIdForCopy: src._id,
		});

		// 2. Assignation.
		const assignmentId = await ctx.db.insert("trainingAssignments", {
			coachId: coach._id,
			userId,
			programId: copyId,
			sourceProgramId: src._id,
			startDate,
			endDate,
			weekdays: wd,
			createdAt: now,
		});

		// 3. Occurrences : les séances de la copie, dans l'ordre, en boucle.
		const copySessions = await ctx.db
			.query("trainingSessions")
			.withIndex("by_program", (q) => q.eq("programId", copyId))
			.collect();
		copySessions.sort((a, b) => a.order - b.order);
		if (copySessions.length === 0) throw new ConvexError("Le programme n'a aucune séance — complète-le avant de l'assigner.");
		for (let i = 0; i < dates.length; i++) {
			const session = copySessions[i % copySessions.length];
			await ctx.db.insert("trainingScheduledSessions", {
				userId,
				assignmentId,
				sessionId: session._id,
				date: dates[i],
				status: "planned",
				createdAt: now,
			});
		}

		// 4. Remplacement : annule UNIQUEMENT les occurrences FUTURES non faites
		//    de l'ancienne assignation. Réalisées (completed) et passées restent.
		if (replacesAssignmentId) {
			const old = await ctx.db.get(replacesAssignmentId);
			if (old && old.coachId === coach._id && old.userId === userId) {
				const oldSched = await ctx.db
					.query("trainingScheduledSessions")
					.withIndex("by_assignment", (q) => q.eq("assignmentId", old._id))
					.collect();
				for (const s of oldSched) {
					if (s.status === "planned" && s.date >= startDate) {
						await ctx.db.patch(s._id, { status: "cancelled" });
					}
				}
			}
		}

		return { assignmentId, programId: copyId, sessionsCreated: dates.length };
	},
});

/**
 * PROLONGE une assignation : ajoute les occurrences des semaines suivantes
 * (même cycle de jours, boucle sur les séances), à partir de la dernière
 * occurrence planifiée existante. L'historique réalisé n'est jamais touché.
 */
export const extendAssignment = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		assignmentId: v.id("trainingAssignments"),
		weeks: v.number(),
	},
	handler: async (ctx, { sessionToken, assignmentId, weeks }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const a = await ctx.db.get(assignmentId);
		if (!a || a.coachId !== coach._id) throw new ConvexError("Assignation introuvable.");
		if (a.removedAt) throw new ConvexError("Cette assignation est retirée — elle ne peut plus être prolongée.");
		const nWeeks = clampInt(weeks, 1, MAX_WEEKS, "Durée");

		// Dernière occurrence planifiée existante (point de départ du prolongement).
		const existing = await ctx.db
			.query("trainingScheduledSessions")
			.withIndex("by_assignment", (q) => q.eq("assignmentId", a._id))
			.collect();
		const planned = existing.filter((s) => s.status !== "cancelled");
		if (planned.length === 0) throw new ConvexError("Aucune séance à prolonger.");
		const lastDate = planned.map((s) => s.date).sort().slice(-1)[0];

		// Suite du cycle : on continue après lastDate sur les mêmes jours.
		const newEnd = addDaysISO(lastDate, nWeeks * 7);
		const dates = plannedDates(addDaysISO(lastDate, 1), newEnd, a.weekdays);
		if (dates.length === 0) throw new ConvexError("Aucune nouvelle date générée.");

		// Ordre des séances : reprend après la dernière séance placée.
		const copySessions = await ctx.db
			.query("trainingSessions")
			.withIndex("by_program", (q) => q.eq("programId", a.programId))
			.collect();
		copySessions.sort((x, y) => x.order - y.order);
		const countBySession = new Map<string, number>();
		for (const s of planned) countBySession.set(s.sessionId, (countBySession.get(s.sessionId) ?? 0) + 1);
		let total = [...countBySession.values()].reduce((x, y) => x + y, 0);
		const now = Date.now();
		for (const date of dates) {
			const session = copySessions[total % copySessions.length];
			await ctx.db.insert("trainingScheduledSessions", {
				userId: a.userId,
				assignmentId: a._id,
				sessionId: session._id,
				date,
				status: "planned",
				createdAt: now,
			});
			total += 1;
		}
		await ctx.db.patch(a._id, { endDate: newEnd });
		return { added: dates.length, endDate: newEnd };
	},
});

/**
 * RETIRE une assignation : les occurrences planifiées (non réalisées) sont
 * annulées (jamais supprimées), les séances réalisées et tout l'historique
 * restent intacts. Le programme copie reste en base (traçabilité).
 */
export const removeAssignment = mutation({
	args: { sessionToken: v.optional(v.string()), assignmentId: v.id("trainingAssignments") },
	handler: async (ctx, { sessionToken, assignmentId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const a = await ctx.db.get(assignmentId);
		if (!a || a.coachId !== coach._id) throw new ConvexError("Assignation introuvable.");
		if (a.removedAt) return { ok: true };
		const now = Date.now();
		await ctx.db.patch(a._id, { removedAt: now });
		const sched = await ctx.db
			.query("trainingScheduledSessions")
			.withIndex("by_assignment", (q) => q.eq("assignmentId", a._id))
			.collect();
		for (const s of sched) {
			if (s.status === "planned") await ctx.db.patch(s._id, { status: "cancelled" });
		}
		return { ok: true };
	},
});

/**
 * Déplace / renomme / annule / restaure une occurrence — le menu ••• coach
 * (mêmes gestes que côté cliente, autorité coach). Une occurrence réalisée
 * ne peut être ni déplacée ni annulée : l'historique est figé.
 */
export const updateScheduledSession = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		scheduledId: v.id("trainingScheduledSessions"),
		date: v.optional(v.string()),
		cancel: v.optional(v.boolean()),
	},
	handler: async (ctx, { sessionToken, scheduledId, date, cancel }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const s = await ctx.db.get(scheduledId);
		if (!s) throw new ConvexError("Séance planifiée introuvable.");
		const a = await ctx.db.get(s.assignmentId);
		if (!a || a.coachId !== coach._id) throw new ConvexError("Séance planifiée introuvable.");
		if (s.status === "completed") throw new ConvexError("Une séance réalisée ne peut plus être modifiée.");
		const patch: Record<string, unknown> = {};
		if (date !== undefined) {
			if (!isValidISO(date)) throw new ConvexError("Date invalide.");
			patch.date = date;
		}
		if (cancel !== undefined) patch.status = cancel ? "cancelled" : "planned";
		if (Object.keys(patch).length === 0) return { ok: true };
		await ctx.db.patch(scheduledId, patch as never);
		return { ok: true };
	},
});

/**
 * Duplique une occurrence planifiée (menu •••) : même séance, autre date.
 * La copie est une nouvelle occurrence planned — l'originale reste en place.
 */
export const duplicateScheduledSession = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		scheduledId: v.id("trainingScheduledSessions"),
		date: v.string(),
	},
	handler: async (ctx, { sessionToken, scheduledId, date }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const s = await ctx.db.get(scheduledId);
		if (!s) throw new ConvexError("Séance planifiée introuvable.");
		const a = await ctx.db.get(s.assignmentId);
		if (!a || a.coachId !== coach._id) throw new ConvexError("Séance planifiée introuvable.");
		if (!isValidISO(date)) throw new ConvexError("Date invalide.");
		const id = await ctx.db.insert("trainingScheduledSessions", {
			userId: s.userId,
			assignmentId: s.assignmentId,
			sessionId: s.sessionId,
			date,
			status: "planned",
			createdAt: Date.now(),
		});
		return { scheduledId: id };
	},
});

/* ═══════════ Suivi coach — données de performance ═══════════ */

/**
 * Résumé d'exécution d'une cliente (Vision 360) : assignation active,
 * semaine en cours, prévues/réalisées, adhérence, dernière/prochaine séance,
 * notes clientes récentes. Les charges par exercice vivent dans
 * `clientExerciseHistory` (recharge à la demande dans l'UI coach).
 */
export const clientTrainingSummary = query({
	args: { sessionToken: v.optional(v.string()), userId: v.id("users") },
	handler: async (ctx, { sessionToken, userId }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (CRM).");
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") throw new ConvexError("Cliente introuvable.");

		const today = new Date().toISOString().slice(0, 10);
		const weekStart = mondayISOof(today);

		const assignments = await ctx.db
			.query("trainingAssignments")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();
		const active = assignments
			.filter((a) => !a.removedAt)
			.sort((x, y) => y.createdAt - x.createdAt)[0];

		let summary: {
			assignmentId: string;
			programId: string;
			programName: string;
			startDate: string;
			endDate: string;
			weekdays: number[];
			weekNumber: number;
		} | null = null;

		if (active) {
			const program = await ctx.db.get(active.programId);
			const weekNumber = Math.min(
				7,
				Math.max(
					0,
					Math.floor(
						(new Date(today + "T00:00:00Z").getTime() - new Date(active.startDate + "T00:00:00Z").getTime()) /
							(7 * 86400000)
					) + 1
				)
			);
			summary = {
				assignmentId: active._id,
				programId: active.programId,
				programName: program?.name ?? "(programme supprimé)",
				startDate: active.startDate,
				endDate: active.endDate,
				weekdays: active.weekdays,
				weekNumber,
			};
		}

		// Séances planifiées : borné aux assignations de la cliente.
		const sched = await ctx.db
			.query("trainingScheduledSessions")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();
		const live = sched.filter((s) => s.status !== "cancelled");
		const completed = live.filter((s) => s.status === "completed").sort((x, y) => y.date.localeCompare(x.date));
		const next = live
			.filter((s) => s.status === "planned" && s.date >= today)
			.sort((x, y) => x.date.localeCompare(y.date))[0];
		const thisWeek = live.filter((s) => s.date >= weekStart && s.date <= addDaysISO(weekStart, 6));
		const adherence =
			live.length > 0
				? Math.round((completed.filter((c) => c.date < today).length / Math.max(live.filter((s) => s.date < today).length, 1)) * 100)
				: null;

		// Noms des séances (une seule lecture par séance distincte).
		const sessionNames = new Map<string, string>();
		for (const s of live) {
			if (!sessionNames.has(s.sessionId)) {
				const ses = await ctx.db.get(s.sessionId);
				sessionNames.set(s.sessionId, ses?.name ?? "(séance)");
			}
		}

		return {
			active: summary,
			today,
			weekStart,
			plannedCount: live.length,
			completedCount: completed.length,
			adherence,
			thisWeek: thisWeek.map((s) => ({
				_id: s._id,
				date: s.date,
				status: s.status,
				name: sessionNames.get(s.sessionId) ?? "Séance",
			})),
			lastCompleted: completed[0]
				? {
						_id: completed[0]._id,
						date: completed[0].date,
						name: sessionNames.get(completed[0].sessionId) ?? "Séance",
						durationMin: completed[0].durationMin ?? null,
						difficulty: completed[0].difficulty ?? null,
						note: completed[0].note ?? null,
					}
				: null,
			nextSession: next
				? { _id: next._id, date: next.date, name: sessionNames.get(next.sessionId) ?? "Séance" }
				: null,
			recentNotes: completed
				.filter((c) => c.note || c.difficulty)
				.slice(0, 5)
				.map((c) => ({
					_id: c._id,
					date: c.date,
					name: sessionNames.get(c.sessionId) ?? "Séance",
					difficulty: c.difficulty ?? null,
					note: c.note ?? null,
				})),
		};
	},
});

/**
 * Historique par exercice d'une cliente (Vision 360 / progression) : dernière
 * performance, meilleure performance (charge la plus lourde en reps ; durée
 * max en time) et séries chronologiques par date. Identité = exerciseId de la
 * bibliothèque (même base que les programmes) + snapshot du nom.
 */
export const clientExerciseHistory = query({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		/** Exercice précis (bibliothèque) — sinon liste des exercices tracés. */
		exerciseId: v.optional(v.id("exercises")),
	},
	handler: async (ctx, { sessionToken, userId, exerciseId }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (CRM).");

		if (!exerciseId) {
			// Index des exercices tracés (distincts, avec compte de séries).
			const rows = await ctx.db
				.query("trainingSetLogs")
				.withIndex("by_user", (q) => q.eq("userId", userId))
				.collect();
			const map = new Map<
				string,
				{ exerciseId: string; name: string; sets: number; lastDate: string; lastWeight: number | null; bestWeight: number | null }
			>();
			for (const r of rows) {
				if (!r.done) continue;
				const cur = map.get(r.exerciseId) ?? {
					exerciseId: r.exerciseId,
					name: r.exerciseName,
					sets: 0,
					lastDate: r.date,
					lastWeight: null as number | null,
					bestWeight: null as number | null,
				};
				cur.sets += 1;
				if (r.date > cur.lastDate) cur.lastDate = r.date;
				if (r.weightKg != null) {
					cur.lastWeight = r.weightKg; // ordre de création ≈ chronologique
					if (cur.bestWeight == null || r.weightKg > cur.bestWeight) cur.bestWeight = r.weightKg;
				}
				map.set(r.exerciseId, cur);
			}
			return { exercises: [...map.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate)) };
		}

		// Détail d'un exercice : toutes les séries chronologiques.
		const rows = await ctx.db
			.query("trainingSetLogs")
			.withIndex("by_user_exercise", (q) => q.eq("userId", userId).eq("exerciseId", exerciseId))
			.collect();
		const done = rows.filter((r) => r.done).sort((a, b) => a.date.localeCompare(b.date) || a._creationTime - b._creationTime);
		let last: (typeof done)[number] | null = null;
		let best: (typeof done)[number] | null = null;
		for (const r of done) {
			last = r;
			if (!best) best = r;
			else {
				const rw = r.weightKg ?? -1;
				const bw = best.weightKg ?? -1;
				if (rw > bw) best = r;
			}
		}
		return {
			last: last
				? {
						date: last.date,
						reps: last.reps ?? null,
						weightKg: last.weightKg ?? null,
						durationSeconds: last.durationSeconds ?? null,
						mode: last.mode,
					}
				: null,
			best: best
				? {
						date: best.date,
						reps: best.reps ?? null,
						weightKg: best.weightKg ?? null,
						durationSeconds: best.durationSeconds ?? null,
						mode: best.mode,
					}
				: null,
			// Courbe simple : 1 point par jour de réalisation (meilleure charge du jour).
			timeline: (() => {
				const byDay = new Map<string, number | null>();
				for (const r of done) {
					const w = r.weightKg ?? null;
					const cur = byDay.get(r.date);
					if (cur == null || (w != null && w > cur)) byDay.set(r.date, w);
				}
				return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, weightKg]) => ({ date, weightKg }));
			})(),
			sets: done.slice(-60).map((r) => ({
				date: r.date,
				setOrder: r.setOrder,
				reps: r.reps ?? null,
				weightKg: r.weightKg ?? null,
				durationSeconds: r.durationSeconds ?? null,
				mode: r.mode,
			})),
		};
	},
});
