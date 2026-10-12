/**
 * OUTILS DE LECTURE ÉTENDUS + CONTEXTE CLIENT — Assistant G-FLUX V2 (Lot 2).
 *
 * Rôle : donner à l'agent l'accès LECTURE aux données autorisées qui existent
 * déjà en base mais que la V1 n'exposait pas — profil, historique de
 * mensurations, dernier bilan hebdo + RETOUR DU COACH, plan alimentaire
 * actif — ainsi qu'un bloc `<contexte>` compact injecté côté serveur à
 * chaque tour (§7 de la mission Lot 2).
 *
 * RÈGLES (non négociables) :
 *  - TOUTES les fonctions passent par `requireAssistantClient` (session +
 *    rôle client + flag + hard lock Billing recalculé) et filtrent par
 *    `userId` DE LA SESSION — jamais un id fourni par le modèle ;
 *  - LECTURE SEULE : aucune mutation ici ;
 *  - données BORNÉES (take ≤ 10), jamais d'objet Convex brut ;
 *  - moyennes TOUJOURS qualifiées (jours renseignés / total — §10.1) ;
 *  - le retour du coach est identifié comme tel (jamais confondu avec une
 *    analyse de l'agent).
 */

import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAssistantClient } from "./assistantTools";
import { assistantEnabledFor } from "../lib/assistant/policy";
import { localTodayISO, mondayISOof, addDaysISO } from "./helpers";
import { kcalGoalForDate, withCurrentGoal } from "../lib/goalHistory";
import { norm } from "./foodRanking";

/* ───────────────── Garde commune (recopiée, défense en profondeur) ───────────────── */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function requireReadClient(ctx: QueryCtx, sessionToken?: string) {
	const user = await requireAssistantClient(ctx, sessionToken);
	return user;
}

/* ══════════════════════ 1. PROFIL (lecture seule) ══════════════════════ */

export const getProfile = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireReadClient(ctx, sessionToken);
		const age = user.birthDate
			? Math.floor((Date.now() - new Date(user.birthDate).getTime()) / (365.25 * 24 * 3600 * 1000))
			: null;
		return {
			prenom: user.prenom ?? null,
			heightCm: user.heightCm ?? null,
			birthYear: user.birthDate ? Number(user.birthDate.slice(0, 4)) : null,
			age,
			coachingMode: user.coachingMode ?? "coaching",
			timeZone: user.timeZone ?? null,
			/** Aucune préférence/restriction alimentaire structurée n'existe en base (audit §6.1) — explicite. */
			dietaryPreferences: null as null,
			startDate: user.startDate ?? null,
		};
	},
});

/* ══════════════════════ 2. MESURES CORPORELLES ══════════════════════ */

export const getMeasurements = query({
	args: { sessionToken: v.optional(v.string()), limit: v.optional(v.number()) },
	handler: async (ctx, { sessionToken, limit = 8 }) => {
		const user = await requireReadClient(ctx, sessionToken);
		const rows = await ctx.db
			.query("bodyMetrics")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.order("desc")
			.take(Math.min(20, Math.max(1, limit)));
		const clean = rows.map((m) => ({
			date: m.date,
			...(m.weightKg !== undefined && m.weightKg !== null ? { weightKg: m.weightKg } : {}),
			...(m.neckCm !== undefined && m.neckCm !== null ? { neckCm: m.neckCm } : {}),
			...(m.waistCm !== undefined && m.waistCm !== null ? { waistCm: m.waistCm } : {}),
			...(m.hipCm !== undefined && m.hipCm !== null ? { hipCm: m.hipCm } : {}),
		}));
		// Tendance poids SIMPLE et déterministe (première ↔ dernière ≤ 90 j) —
		// pas d'analyse avancée ici (Lot 5).
		const weights = rows.filter((r) => typeof r.weightKg === "number").reverse();
		let trend = null as null | { fromKg: number; toKg: number; from: string; to: string; deltaKg: number };
		if (weights.length >= 2) {
			const first = weights[0];
			const last = weights[weights.length - 1];
			trend = {
				fromKg: first.weightKg as number,
				toKg: last.weightKg as number,
				from: first.date,
				to: last.date,
				deltaKg: Math.round(((last.weightKg as number) - (first.weightKg as number)) * 10) / 10,
			};
		}
		return { items: clean, weightTrend: trend };
	},
});

/* ══════════════════════ 3. DERNIER BILAN + RETOUR DU COACH ══════════════════════ */

export const getLastCheckin = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireReadClient(ctx, sessionToken);
		const rows = await ctx.db
			.query("checkins")
			.withIndex("by_user_week", (q) => q.eq("userId", user._id))
			.order("desc")
			.take(1);
		const c = rows[0];
		if (!c) return { ok: false as const, reason: "no_checkin" as const };
		return {
			ok: true as const,
			weekStart: c.weekStart,
			weekLabel: c.weekLabel,
			status: c.status,
			/** Réponses déclarées par la cliente — chaînes bornées. */
			answers: c.answers ?? null,
			/** RETOUR DU COACH — texte Hugo, distinct de toute analyse IA. */
			coachFeedback:
				typeof c.feedback === "string" && c.feedback.trim()
					? { text: c.feedback.slice(0, 1500), at: c.feedbackAt ?? null }
					: null,
		};
	},
});

/* ══════════════════════ 4. PLAN ALIMENTAIRE ACTIF (lecture seule) ══════════════════════ */

export const getMealPlan = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireReadClient(ctx, sessionToken);
		const today = localTodayISO();
		const rows = await ctx.db
			.query("mealPlanAssignments")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.order("desc")
			.take(6);
		const active = rows.filter((a) => !a.removedAt && a.endDate >= today);
		if (active.length === 0) return { ok: false as const, reason: "no_active_plan" as const };
		const a = active[0];
		const t = await ctx.db.get(a.templateId);
		if (!t) return { ok: false as const, reason: "template_missing" as const };
		return {
			ok: true as const,
			plan: {
				name: t.name,
				startDate: a.startDate,
				endDate: a.endDate,
				weekdays: a.weekdays ?? null,
				/** Aperçu borné des items du template coach (lecture seule). */
				itemsPreview: (Array.isArray(t.items) ? t.items : []).slice(0, 12).map((it) => {
					const item = it as { meal?: string; name?: string; qtyGrams?: number };
					return { meal: item.meal ?? null, name: item.name ?? null, qtyGrams: item.qtyGrams ?? null };
				}),
			},
		};
	},
});

/* ══════════════════════ 5. BLOC CONTEXTE (injecté par `send`) ══════════════════════ */

type DayTotals = { kcal: number; protein: number; carbs: number; fat: number };

/** Agrégats semaine QUALIFIÉS : jours renseignés ≠ jours vides (§10.1). */
export function qualifyWeek(
	journal: { date: string; kcal: number }[],
	goalKcal: number
): {
	daysTotal: number;
	daysLogged: number;
	daysMissing: number;
	avgKcal: number | null;
	goalKcal: number;
} {
	const daysTotal = journal.length > 0 ? journal.length : 0;
	const logged = journal.filter((j) => j.kcal > 0);
	return {
		daysTotal,
		daysLogged: logged.length,
		daysMissing: daysTotal - logged.length,
		avgKcal: logged.length
			? Math.round(logged.reduce((a, j) => a + j.kcal, 0) / logged.length)
			: null,
		goalKcal,
	};
}

/** Bloc texte compact injecté au tour — jamais l'historique complet. */
export function buildContextBlock(ctxData: {
	prenom: string | null;
	mode: string;
	goals: { kcal: number; protein: number; carbs: number; fat: number; stepGoal: number | null };
	eaten: DayTotals;
	remaining: DayTotals;
	week: { daysTotal: number; daysLogged: number; daysMissing: number; avgKcal: number | null };
	measurements: { date: string; weightKg?: number }[];
	weightTrend: { fromKg: number; toKg: number; deltaKg: number } | null;
	lastCheckin: { weekLabel: string; coachFeedback: { text: string } | null } | null;
	mealPlan: { name: string; startDate: string; endDate: string } | null;
}): string {
	const p: string[] = [];
	p.push(`<contexte>`);
	p.push(`(Données serveur à jour — font foi. Re-vérifie par outil si la cliente parle d'un autre jour.)`);
	p.push(`Cliente : ${ctxData.prenom ?? "?"} · mode : ${ctxData.mode}.`);
	p.push(
		`Objectifs officiels (fixés par Hugo — NE JAMAIS modifier) : ${ctxData.goals.kcal} kcal, P ${ctxData.goals.protein} g, G ${ctxData.goals.carbs} g, L ${ctxData.goals.fat} g${ctxData.goals.stepGoal ? `, pas : ${ctxData.goals.stepGoal}` : ""}.`
	);
	p.push(
		`Aujourd'hui : mangé ${ctxData.eaten.kcal} kcal (P ${ctxData.eaten.protein} / G ${ctxData.eaten.carbs} / L ${ctxData.eaten.fat}) — restes ${ctxData.remaining.kcal} kcal (P ${ctxData.remaining.protein} / G ${ctxData.remaining.carbs} / L ${ctxData.remaining.fat}).`
	);
	p.push(
		`Semaine en cours : ${ctxData.week.daysLogged}/${ctxData.week.daysTotal} jour(s) renseigné(s)${ctxData.week.daysMissing > 0 ? ` (${ctxData.week.daysMissing} sans saisie — moyenne NON représentative des jours vides)` : ""}, moyenne ${ctxData.week.avgKcal ?? "n/a"} kcal/jour sur les jours renseignés.`
	);
	if (ctxData.measurements.length) {
		const last = ctxData.measurements[0];
		p.push(
			`Dernière mesure (${last.date}) : ${last.weightKg !== undefined ? `${last.weightKg} kg` : "poids n/a"}.`
		);
	}
	if (ctxData.weightTrend) {
		p.push(
			`Tendance poids (déterministe) : ${ctxData.weightTrend.fromKg} → ${ctxData.weightTrend.toKg} kg (${ctxData.weightTrend.deltaKg >= 0 ? "+" : ""}${ctxData.weightTrend.deltaKg} kg).`
		);
	}
	if (ctxData.lastCheckin) {
		p.push(`Dernier bilan : ${ctxData.lastCheckin.weekLabel}.`);
		if (ctxData.lastCheckin.coachFeedback) {
			p.push(
				`RETOUR DE HUGO (consigne officielle du coach — ne pas contredire, ne pas inventer) : « ${ctxData.lastCheckin.coachFeedback.text} »`
			);
		}
	}
	if (ctxData.mealPlan) {
		p.push(`Plan alimentaire actif : « ${ctxData.mealPlan.name} » (${ctxData.mealPlan.startDate} → ${ctxData.mealPlan.endDate}) — lecture seule.`);
	}
	p.push(`</contexte>`);
	return p.join("\n");
}

/** Query de contexte — appelée par `send` (une seule lecture par tour). */
export const contextFor = query({
	args: { sessionToken: v.optional(v.string()), date: v.optional(v.string()) },
	handler: async (ctx, { sessionToken, date }) => {
		const user = await requireReadClient(ctx, sessionToken);
		const d = date && DATE_RE.test(date) ? date : localTodayISO();

		const [goalsRow, history, entries, metrics, checkinRows, planRows] = await Promise.all([
			ctx.db.query("clientGoals").withIndex("by_userId", (q) => q.eq("userId", user._id)).first(),
			ctx.db.query("clientGoalHistory").withIndex("by_user", (q) => q.eq("userId", user._id)).order("asc").collect(),
			ctx.db
				.query("diaryEntries")
				.withIndex("by_user_date", (q) => q.eq("userId", user._id).gte("date", mondayISOof(d)).lte("date", d))
				.collect(),
			ctx.db.query("bodyMetrics").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(2),
			ctx.db.query("checkins").withIndex("by_user_week", (q) => q.eq("userId", user._id)).order("desc").take(1),
			ctx.db.query("mealPlanAssignments").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(6),
		]);

		const goalKcal = kcalGoalForDate(
			withCurrentGoal(history, goalsRow?.kcal ?? 2000, d),
			d,
			goalsRow?.kcal ?? 2000
		);
		const goals = {
			kcal: goalKcal,
			protein: goalsRow?.protein ?? 0,
			carbs: goalsRow?.carbs ?? 0,
			fat: goalsRow?.fat ?? 0,
			stepGoal: goalsRow?.stepGoal ?? null,
		};

		const eaten: DayTotals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
		const byDay = new Map<string, number>();
		for (const e of entries) {
			eaten.kcal += e.kcal;
			eaten.protein += e.protein;
			eaten.carbs += e.carbs;
			eaten.fat += e.fat;
			byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.kcal);
		}
		// Semaine du bilan : lundi → d (jours écoulés uniquement, jamais de 0 inventé).
		const week: string[] = [];
		let cur = mondayISOof(d);
		let guard = 0;
		while (cur <= d && guard++ < 10) {
			week.push(cur);
			cur = addDaysISO(cur, 1);
		}
		const weekJournal = week.map((date) => ({ date, kcal: Math.round(byDay.get(date) ?? 0) }));

		const measurements = metrics
			.filter((m) => typeof m.weightKg === "number")
			.map((m) => ({ date: m.date, weightKg: m.weightKg as number }));
		const weightTrend =
			measurements.length >= 2
				? {
						fromKg: measurements[measurements.length - 1].weightKg,
						toKg: measurements[0].weightKg,
						deltaKg:
							Math.round(((measurements[0].weightKg as number) - (measurements[measurements.length - 1].weightKg as number)) * 10) / 10,
					}
				: null;

		const c = checkinRows[0] ?? null;
		const lastCheckin = c
			? {
					weekLabel: c.weekLabel,
					coachFeedback:
						typeof c.feedback === "string" && c.feedback.trim()
							? { text: c.feedback.slice(0, 600) }
							: null,
				}
			: null;

		const activePlan = planRows.find((a) => !a.removedAt && a.endDate >= d) ?? null;
		let mealPlan: { name: string; startDate: string; endDate: string } | null = null;
		if (activePlan) {
			const t = await ctx.db.get(activePlan.templateId);
			if (t) mealPlan = { name: t.name, startDate: activePlan.startDate, endDate: activePlan.endDate };
		}

		return {
			prenom: user.prenom ?? null,
			mode: user.coachingMode ?? "coaching",
			goals,
			eaten: {
				kcal: Math.round(eaten.kcal),
				protein: Math.round(eaten.protein * 10) / 10,
				carbs: Math.round(eaten.carbs * 10) / 10,
				fat: Math.round(eaten.fat * 10) / 10,
			},
			remaining: {
				kcal: Math.round(goalKcal - eaten.kcal),
				protein: Math.round((goals.protein - eaten.protein) * 10) / 10,
				carbs: Math.round((goals.carbs - eaten.carbs) * 10) / 10,
				fat: Math.round((goals.fat - eaten.fat) * 10) / 10,
			},
			steps: { count: null as number | null, goal: goals.stepGoal },
			week: qualifyWeek(weekJournal, goalKcal),
			measurements,
			weightTrend,
			lastCheckin,
			mealPlan,
		};
	},
});

// réexport pratique (utilisé par les tests fonctionnels)
export { norm as _norm };
export type { Doc, Id };
export const _internal = { ConvexError, assistantEnabledFor };
