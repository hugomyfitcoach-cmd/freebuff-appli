import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { addDaysISO, getSessionUser, localTodayISO } from "./helpers";
import { bodyFatSeries } from "./metrics";
import { DEFAULT_GOALS, baselineLegacyGoalHistory, upsertGoalHistoryToday } from "./journal";
import { CalibrageError, VERSION_FORMULES_CALIBRAGE } from "../lib/calibrage";
import { resultatsFiche, type EntreesFicheCalibrage } from "../lib/calibrageFiche";
import type { Doc } from "./_generated/dataModel";

/**
 * Onglet « Calibrage » du CRM — CÔTÉ COACH UNIQUEMENT (aucune donnée ni
 * écriture côté cliente dans cette mission).
 *
 * - `fiche` (lecture) : pré-remplissage des entrées du calibrage à partir des
 *   données RÉELLES de la cliente — poids (moyenne des pesées sur 7 jours,
 *   sinon dernière pesée), masse grasse (dernière estimation US Navy dérivée
 *   de `metrics.bodyFatSeries`, sinon saisie manuelle), moyenne de pas sur
 *   14 jours, réponse « sport » du formulaire de démarrage (affichée telle
 *   quelle, jamais convertie) et objectifs courants ;
 * - `apply` (écriture) : « Appliquer à la fiche » — passe par LE chemin
 *   existant des objectifs (`clientGoals` + `clientGoalHistory`, mêmes
 *   fonctions d'écriture que `journal.setClientGoals`) pour que le garde-fou
 *   du journal sur les jours passés continue de fonctionner, puis fige un
 *   instantané du calibrage dans `calibrageSnapshots`.
 *
 * Aucun calcul ici : les résultats viennent de `lib/calibrageFiche`, qui
 * n'orchestre que le module pur `lib/calibrage.ts` (source unique des
 * formules). Rien n'est jamais appliqué automatiquement.
 */

/** Repli pré-remplissage : réponse « sport » du formulaire de démarrage. */
type SportOnboarding = {
	sport: string | number | null;
	sportsDetail: string | number | null;
	sportFrequency: string | number | null;
};

function arrondi1(n: number): number {
	return Math.round(n * 10) / 10;
}

function estDateISO(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const [y, m, d] = s.split("-").map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export const fiche = query({
	args: {
		sessionToken: v.optional(v.string()),
		/** Cliente visée (obligatoire : la fiche Calibrage vit dans sa fiche CRM). */
		userId: v.id("users"),
	},
	handler: async (ctx, { sessionToken, userId }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") {
			throw new ConvexError("Réservé à la coach (CRM).");
		}
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") {
			throw new ConvexError("Cliente introuvable.");
		}

		const today = localTodayISO();
		const [metricRows, stepRows, intakeRow, goalsRow, snapshotRows] = await Promise.all([
			ctx.db.query("bodyMetrics").withIndex("by_user", (q) => q.eq("userId", userId)).order("asc").collect(),
			ctx.db
				.query("dailySteps")
				.withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", addDaysISO(today, -13)))
				.collect(),
			ctx.db.query("intakes").withIndex("by_user", (q) => q.eq("userId", userId)).first(),
			ctx.db.query("clientGoals").withIndex("by_userId", (q) => q.eq("userId", userId)).first(),
			ctx.db.query("calibrageSnapshots").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
		]);

		/* Poids : moyenne des pesées sur 7 jours, sinon dernière pesée. Une
		   journée sans pesée n'existe pas (jamais comptée comme 0). */
		const poidsRows = metricRows
			.filter((m) => m.weightKg !== undefined)
			.map((m) => ({ date: m.date, weightKg: m.weightKg as number }));
		const recent = poidsRows.filter((p) => p.date >= addDaysISO(today, -6));
		const derniere = poidsRows.length > 0 ? poidsRows[poidsRows.length - 1] : null;
		const poids =
			recent.length > 0
				? {
						valeur: arrondi1(recent.reduce((s, p) => s + p.weightKg, 0) / recent.length),
						source: "moyenne7j" as const,
						nbPesees: recent.length,
						date: derniere?.date ?? null,
					}
				: derniere
					? { valeur: arrondi1(derniere.weightKg), source: "derniere" as const, nbPesees: 0, date: derniere.date }
					: { valeur: null, source: null, nbPesees: 0, date: null };

		/* Masse grasse : dernier point de la série US Navy DÉRIVÉE (même source
		   de vérité que « Ma progression » et la Vision 360), sinon saisie. */
		const bodyFat = bodyFatSeries(metricRows, target.heightCm ?? null);
		const derniereMg = bodyFat.length > 0 ? bodyFat[bodyFat.length - 1] : null;

		/* Moyenne de pas sur 14 jours — jours RENSEIGNÉS uniquement. */
		const pasMoyen =
			stepRows.length > 0
				? {
						valeur: arrondi1(stepRows.reduce((s, r) => s + r.count, 0) / stepRows.length),
						jours: stepRows.length,
					}
				: { valeur: null, jours: 0 };

		/* Réponse « sport » du formulaire de démarrage — affichée en AIDE, telle
		   quelle (jamais convertie en profil sportif). */
		const answers = intakeRow?.answers ?? {};
		const sportOnboarding: SportOnboarding = {
			sport: answers.sport ?? null,
			sportsDetail: answers.sportsDetail ?? null,
			sportFrequency: answers.sportFrequency ?? null,
		};

		const dernier = snapshotRows.length > 0 ? snapshotRows[snapshotRows.length - 1] : null;

		return {
			today,
			poids,
			masseGrasse: derniereMg
				? { valeur: derniereMg.value, source: "usNavy" as const, date: derniereMg.date }
				: { valeur: null, source: null, date: null },
			pasMoyen,
			sportOnboarding,
			goals: goalsRow
				? {
						kcal: goalsRow.kcal,
						carbs: goalsRow.carbs,
						protein: goalsRow.protein,
						fat: goalsRow.fat,
						maintenanceKcal: goalsRow.maintenanceKcal ?? null,
						stepGoal: goalsRow.stepGoal ?? null,
						goalsSet: true,
					}
				: { ...DEFAULT_GOALS, maintenanceKcal: null, stepGoal: null, goalsSet: false },
			dernierCalibrage: dernier
				? { date: dernier.date, effectiveFrom: dernier.effectiveFrom, createdAt: dernier.createdAt }
				: null,
		};
	},
});

export const apply = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		/** Entrées du calibrage figées dans l'instantané (recopiées telles quelles). */
		entrees: v.record(v.string(), v.any()),
		/** Objectif appliqué (la coach peut l'ajuster avant d'appliquer). */
		kcal: v.number(),
		carbs: v.number(),
		protein: v.number(),
		fat: v.number(),
		/** Maintenance appliquée (filet de sécurité) — optionnelle. */
		maintenanceKcal: v.optional(v.number()),
		/** Date d'effet "yyyy-mm-dd" choisie par la coach. */
		effectiveFrom: v.string(),
	},
	handler: async (ctx, { sessionToken, userId, entrees, kcal, carbs, protein, fat, maintenanceKcal, effectiveFrom }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") {
			throw new ConvexError("Seule la coach peut appliquer un calibrage.");
		}
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") {
			throw new ConvexError("Ce compte client n'existe pas.");
		}
		if (
			!isFinite(kcal) || kcal < 800 || kcal > 6000 ||
			!isFinite(carbs) || carbs < 0 || carbs > 1000 ||
			!isFinite(protein) || protein < 0 || protein > 400 ||
			!isFinite(fat) || fat < 0 || fat > 300
		) {
			throw new ConvexError("Objectifs hors plage. Vérifie les valeurs (kcal 800-6000, macros en grammes).");
		}
		if (
			maintenanceKcal !== undefined &&
			maintenanceKcal !== null &&
			(!isFinite(maintenanceKcal) || maintenanceKcal < kcal || maintenanceKcal > 10000)
		) {
			throw new ConvexError("Maintenance invalide : elle doit être supérieure à l'objectif calorique (et ≤ 10000 kcal).");
		}
		if (!estDateISO(effectiveFrom)) {
			throw new ConvexError("Date d'effet invalide : format « jj/mm/aaaa » attendu (yyyy-mm-dd).");
		}

		/* Instantané : les RÉSULTATS sont recalculés par le module (la seule
		   source des formules) à partir des entrées figées — jamais inventés. */
		let resultats;
		try {
			resultats = resultatsFiche(entrees as unknown as EntreesFicheCalibrage);
		} catch (e) {
			throw new ConvexError(
				e instanceof CalibrageError || e instanceof Error ? e.message : "Calibrage invalide."
			);
		}

		const existing = await ctx.db
			.query("clientGoals")
			.withIndex("by_userId", (q) => q.eq("userId", userId))
			.first();

		/* ÉCRITURE PAR LE CHEMIN EXISTANT des objectifs : même historisation
		   datée et même baseline legacy que `journal.setClientGoals` — le
		   garde-fou du journal sur les jours passées continue de fonctionner. */
		await upsertGoalHistoryToday(ctx, userId, kcal, coach._id, effectiveFrom);
		if (existing && existing.kcal !== kcal) {
			await baselineLegacyGoalHistory(ctx, userId, existing, coach._id);
		}

		if (existing) {
			const p: Partial<Doc<"clientGoals">> = { kcal, carbs, protein, fat };
			if (maintenanceKcal !== undefined && maintenanceKcal !== null) p.maintenanceKcal = maintenanceKcal;
			await ctx.db.patch(existing._id, p);
		} else {
			const opt: { maintenanceKcal?: number } = {};
			if (maintenanceKcal !== undefined && maintenanceKcal !== null) opt.maintenanceKcal = maintenanceKcal;
			await ctx.db.insert("clientGoals", { userId, kcal, carbs, protein, fat, ...opt });
		}

		/* Instantané du calibrage : entrées, résultats, version des formules,
		   date, auteur — ajout rétrocompatible (table dédiée). */
		await ctx.db.insert("calibrageSnapshots", {
			userId,
			inputs: entrees,
			results: {
				...resultats,
				applique: { kcal, carbs, protein, fat, maintenanceKcal: maintenanceKcal ?? null, effectiveFrom },
			},
			formulaVersion: VERSION_FORMULES_CALIBRAGE,
			effectiveFrom,
			date: localTodayISO(),
			createdBy: coach._id,
			createdAt: Date.now(),
		});

		return { ok: true, effectiveFrom };
	},
});

export type { EntreesFicheCalibrage };
