import { query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { addDaysISO, getSessionUser, localTodayISO, mondayISOof } from "./helpers";
import { bodyFatSeries } from "./metrics";
import { DEFAULT_GOALS } from "./journal";
import type { Doc } from "./_generated/dataModel";

/**
 * Outils & calibrage — préremplissage automatique (LECTURE SEULE).
 *
 * Les deux outils « Ma semaine » et « Planification refeed / diet break »
 * lisent ici les vraies données déjà présentes dans G-FLUX — ils ne sont
 * jamais la source de vérité et ne modifient aucun objectif :
 *
 * - objectifs / maintenance / pas définis par la coach (clientGoals) ;
 * - kcal réellement consommées par jour (diaryEntries — le planifié n'impacte
 *   jamais les totaux) et pas enregistrés par jour (dailySteps) ; une journée
 *   sans ligne est ABSENTE de la réponse (jamais comptée comme 0) ;
 * - repères de départ du cyclage : poids de référence = première pesée du
 *   suivi (repli : « Poids à jeun » du formulaire de démarrage), % de graisse
 *   de départ = PREMIER point de la série metrics.bodyFatSeries — la même
 *   source de vérité (US Navy) que « Ma progression » et la Vision 360,
 *   aucune nouvelle formule — et date de démarrage du coaching (users.startDate).
 *
 * Côté coach, la vue d'une cliente précise passe par `userId` (?client=…).
 */

/** Fenêtre d'historique renvoyée pour « Ma semaine » : 6 mois + 1 semaine de marge. */
const HISTORY_DAYS = 26 * 7 + 7;

export const calibrage = query({
	args: {
		sessionToken: v.optional(v.string()),
		/** Vue coach : cliente visée. La cliente connectée lit toujours ses propres données. */
		userId: v.optional(v.id("users")),
	},
	handler: async (ctx, { sessionToken, userId }) => {
		const me = await getSessionUser(ctx, sessionToken);
		if (!me) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");

		const today = localTodayISO();
		const currentWeekStart = mondayISOof(today);

		let target: Doc<"users"> = me;
		if (me.role === "coach") {
			if (!userId) {
				/* Vue coach générique (pas de ?client=…) : outils utilisables comme
				   simulateurs, sans aucune donnée cliente — rien n'est inventé. */
				return {
					scoped: false,
					today,
					currentWeekStart,
					earliestWeek: addDaysISO(currentWeekStart, -26 * 7),
					profile: {
						startDate: null,
						weightRefKg: null,
						weightRefDate: null,
						weightRefSource: null,
						bodyFatRef: null,
						bodyFatRefDate: null,
					},
			goals: null,
			cycle: null,
			days: [] as { date: string; kcal: number; steps: number }[],
				};
			}
			const t = await ctx.db.get(userId);
			if (!t || t.role !== "client") throw new ConvexError("Cliente introuvable.");
			target = t;
		}

		const since = addDaysISO(today, -HISTORY_DAYS);

		const [goalsRow, metricRows, entryRows, stepRows, intakeRow] = await Promise.all([
			ctx.db.query("clientGoals").withIndex("by_userId", (q) => q.eq("userId", target._id)).first(),
			ctx.db.query("bodyMetrics").withIndex("by_user", (q) => q.eq("userId", target._id)).order("asc").collect(),
			ctx.db.query("diaryEntries").withIndex("by_user_date", (q) => q.eq("userId", target._id).gte("date", since)).collect(),
			ctx.db.query("dailySteps").withIndex("by_user_date", (q) => q.eq("userId", target._id).gte("date", since)).collect(),
			ctx.db.query("intakes").withIndex("by_user", (q) => q.eq("userId", target._id)).first(),
		]);

		// Même convention que le CRM : tri par DATE de mesure (une saisie
		// rétrodatée reste à sa place chronologique — « première pesée » =
		// date de mesure la plus ancienne, jamais la ligne créée en premier).
		metricRows.sort((a, b) => a.date.localeCompare(b.date));

		const weightTrend = metricRows
			.filter((m) => m.weightKg !== undefined)
			.map((m) => ({ date: m.date, weightKg: m.weightKg as number }));
		const firstWeight = weightTrend.length > 0 ? weightTrend[0] : null;

		// % de graisse de départ : PREMIER point de la série dérivée — la formule
		// et le report en avant restent ceux de metrics.bodyFatSeries (source de
		// vérité unique, partagée avec l'espace cliente et le CRM).
		const bodyFat = bodyFatSeries(metricRows, target.heightCm ?? null);
		const bodyFatRef = bodyFat.length > 0 ? bodyFat[0] : null;

		// Repli poids : réponse « Poids à jeun » du formulaire de démarrage.
		const fw = intakeRow?.answers?.fastingWeight;
		const intakeWeight = typeof fw === "number" && isFinite(fw) && fw > 0 ? fw : null;

		// Totaux journaliers réels. Une journée sans journal ni pas n'existe pas
		// dans la réponse : l'outil ne la comptera jamais comme 0.
		const dayMap = new Map<string, { kcal: number; steps: number }>();
		for (const e of entryRows) {
			const acc = dayMap.get(e.date) ?? { kcal: 0, steps: 0 };
			acc.kcal += e.kcal;
			dayMap.set(e.date, acc);
		}
		for (const s of stepRows) {
			const acc = dayMap.get(s.date) ?? { kcal: 0, steps: 0 };
			acc.steps += s.count;
			dayMap.set(s.date, acc);
		}
		const days = [...dayMap.entries()]
			.map(([date, v]) => ({ date, kcal: Math.round(v.kcal), steps: Math.round(v.steps) }))
			.sort((a, b) => a.date.localeCompare(b.date));

		// Borne de navigation arrière : première donnée du suivi, démarrage du
		// coaching, ou 6 mois — jamais au-delà. Les semaines antérieures ne
		// sont pas réécrites : elles repartent des données réelles de l'époque.
		let earliestWeek = addDaysISO(currentWeekStart, -26 * 7);
		for (const d of days) {
			const m = mondayISOof(d.date);
			if (m < earliestWeek) earliestWeek = m;
		}
		if (target.startDate && /^\d{4}-\d{2}-\d{2}$/.test(target.startDate)) {
			const m = mondayISOof(target.startDate);
			if (m < earliestWeek) earliestWeek = m;
		}
		if (earliestWeek > currentWeekStart) earliestWeek = currentWeekStart;

		return {
			scoped: true,
			today,
			currentWeekStart,
			earliestWeek,
			profile: {
				startDate: target.startDate ?? null,
				weightRefKg: firstWeight?.weightKg ?? intakeWeight,
				weightRefDate: firstWeight?.date ?? null,
				weightRefSource: firstWeight ? ("suivi" as const) : intakeWeight !== null ? ("formulaire" as const) : null,
				bodyFatRef: bodyFatRef?.value ?? null,
				bodyFatRefDate: bodyFatRef?.date ?? null,
			},
			goals: {
				kcal: goalsRow?.kcal ?? DEFAULT_GOALS.kcal,
				maintenanceKcal: goalsRow?.maintenanceKcal ?? null,
				stepGoal: goalsRow?.stepGoal ?? null,
				goalsSet: goalsRow !== undefined,
			},
			/** Seul indice de sexe existant dans G-FLUX : le suivi de cycle
			    (exclusivement féminin). Absent → l'outil laisse le champ manuel. */
			cycle: target.cycle ?? null,
			days,
		};
	},
});
