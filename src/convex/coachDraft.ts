/**
 * CONTEXTE DU BROUILLON DE RETOUR — query INTERNE, LECTURE SEULE.
 *
 * Pour UN bilan donné, assemble :
 *  - les réponses du bilan et sa semaine ;
 *  - les statistiques de la semaine du bilan (7 jours complets) et de la
 *    semaine précédente (7 jours précédents, pour les écarts), en réutilisant
 *    les fonctions pures de `src/lib/vision360.ts` ;
 *  - les 2 derniers retours PUBLIÉS de la MÊME cliente.
 *
 * Aucun identifiant, e-mail ni nom de famille ne sort de cette query :
 * uniquement `prenom`, les réponses, les faits calculés et les textes de
 * retours nettoyés. Aucune écriture, aucun appel IA, aucune interface.
 *
 * Accès : session coach obligatoire (vérifiée ici, pas seulement dans l'UI).
 * `internalQuery` n'est de toute façon pas exposée au navigateur ; la garde
 * reste nécessaire pour une future action/appel serveur.
 *
 * M1 ajoute `generate` (action publique réservée au coach) et `status`
 * (query coach : état du kill switch pour l'interface). La génération
 * n'écrit RIEN : elle lit le contexte, construit le prompt, appelle le
 * fournisseur générique et renvoie le texte seul. Aucun événement cliente,
 * aucun push, aucun badge — seuls `coach.setFeedback` écrivent un retour.
 */
import { action, internalQuery, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { generateText, isAiFeatureDisabled } from "./ai/provider";
import { COACH_DRAFT_STYLE_GUIDE } from "../lib/data/coachDraftStyleGuide";
import { COACH_DRAFT_METHOD_REFERENCE } from "../lib/data/methodeGflux";
import { addDaysISO, getSessionUser, localTodayISO } from "./helpers";
import { DEFAULT_GOALS } from "./journal";
import { kcalGoalForDate, withCurrentGoal, type GoalHistoryRow } from "../lib/goalHistory";
import {
	exploitabilityThresholdKcal,
	foodAverages,
	last7CompletedDays,
	mensurationsVision,
	sportVision,
	stepsAverages,
	weightVision,
	type SportDayInput,
} from "../lib/vision360";
import {
	buildCoachDraftPrompt,
	type CoachDraftContext,
	type CoachDraftWeekStats,
} from "./coachDraftPrompt";

type CheckinRow = Doc<"checkins">;
type UserRow = Doc<"users">;

/**
 * Consigne système du brouillon : rôle et cadre, indépendants des données.
 * Le prompt (faits + consignes de rédaction) reste construit par le module
 * pur `coachDraftPrompt`.
 */
const COACH_DRAFT_SYSTEM =
	"Tu es Hugo, coach G-FLUX. Tu rédiges des retours de bilan hebdomadaires en français, au tutoiement, avec un ton chaleureux, direct et concret. Tu ne poses aucun diagnostic médical ou hormonal et tu ne promets aucun résultat.";

async function requireCoach(
	ctx: Pick<QueryCtx, "db">,
	sessionToken: string | undefined | null
): Promise<UserRow> {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "coach") throw new ConvexError("Accès réservé au coach.");
	return user;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Nettoie un retour avant de le faire entrer dans le prompt : e-mails,
 * téléphones, nom de famille et e-mail de la cliente concernée. Le prénom
 * reste autorisé (seule identité transmise).
 */
export function redactFeedback(text: string, user: Pick<UserRow, "email" | "nom">): string {
	let out = text
		.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/gi, "[e-mail]")
		.replace(/\b(?:\+?\d[\s.-]?){9,14}\d\b/g, "[téléphone]");
	if (typeof user.email === "string" && user.email.trim().length >= 3) {
		out = out.replace(new RegExp(escapeRegExp(user.email.trim()), "gi"), "[e-mail]");
	}
	if (typeof user.nom === "string" && user.nom.trim().length > 0) {
		// Nom de famille TOUJOURS retiré, même court : la seule identité qui
		// reste dans le contexte est le prénom. Pas de `\b` (ASCII) : un nom
		// accentué (« Élise ») ne serait pas reconnu comme un mot.
		out = out.replace(new RegExp(escapeRegExp(user.nom.trim()), "gi"), "[nom]");
	}
	return out.trim();
}

function foodTotalsFromEntries(
	entries: Doc<"diaryEntries">[],
	days: string[]
): Map<string, { kcal: number | null; protein: number | null }> {
	const totals = new Map<string, { kcal: number | null; protein: number | null }>();
	for (const day of days) totals.set(day, { kcal: null, protein: null });
	for (const entry of entries) {
		const acc = totals.get(entry.date);
		if (!acc) continue;
		acc.kcal = (acc.kcal ?? 0) + entry.kcal;
		acc.protein = (acc.protein ?? 0) + entry.protein;
	}
	return totals;
}

function buildWeekStats(args: {
	days: string[];
	entries: Doc<"diaryEntries">[];
	weightRows: { date: string; weightKg: number }[];
	stepsRows: { date: string; count: number }[];
	sportRows: SportDayInput[];
	goalHistory: GoalHistoryRow[];
	fallbackKcal: number;
	proteinGoal: number;
	stepGoal: number | null;
}): CoachDraftWeekStats {
	const { days, goalHistory, fallbackKcal } = args;
	const start = days[0];
	const end = days[days.length - 1];
	const goalForDay = (date: string): number => kcalGoalForDate(goalHistory, date, fallbackKcal);
	// Objectif affiché : celui applicable à la dernière journée de la semaine
	// (même règle que le cockpit quand la fenêtre traverse un changement).
	const displayedGoalKcal = goalForDay(end);
	const food = foodAverages(foodTotalsFromEntries(args.entries, days), days, goalForDay);
	const weight = weightVision(args.weightRows, days);
	const steps = stepsAverages(args.stepsRows, days);
	const sport = sportVision(args.sportRows, days);

	return {
		start,
		end,
		days,
		food: {
			kcalAvg: food.kcalAvg,
			proteinAvg: food.proteinAvg,
			goalKcal: displayedGoalKcal,
			goalProtein: args.proteinGoal,
			thresholdKcal: exploitabilityThresholdKcal(displayedGoalKcal),
			exploitableDays: food.breakdown.exploitableDays,
			partialDays: food.breakdown.partialDays,
			absentDays: food.breakdown.absentDays,
		},
		weight: {
			avg: weight.avg,
			count: weight.count,
			last: weight.last,
			prevLast: weight.prevLast,
			delta: weight.delta,
		},
		steps: {
			avg: steps.avg,
			goal: args.stepGoal,
			trackedDays: steps.trackedDays,
		},
		sport: {
			activities: sport.activities,
			durationMin: sport.durationMin,
			kcal: sport.kcal,
			metMinutes: sport.metMinutes,
		},
	};
}

function deltaOf(a: number | null, b: number | null, digits: number): number | null {
	if (a === null || b === null) return null;
	const factor = 10 ** digits;
	return Math.round((a - b) * factor) / factor;
}

/**
 * Query interne : contexte complet d'un bilan pour le prompt builder.
 * Aucun identifiant (userId, checkinId, _id), aucun e-mail, aucun nom de
 * famille dans le résultat — le prénom seul suffit au prompt.
 */
export const loadContext = internalQuery({
	args: {
		sessionToken: v.optional(v.string()),
		checkinId: v.id("checkins"),
	},
	handler: async (ctx, { sessionToken, checkinId }): Promise<CoachDraftContext> => {
		await requireCoach(ctx, sessionToken);

		const checkin: CheckinRow | null = await ctx.db.get(checkinId);
		if (!checkin) throw new ConvexError("Bilan introuvable.");
		const target = await ctx.db.get(checkin.userId);
		if (!target || target.role !== "client") throw new ConvexError("Cliente introuvable.");

		// Fenêtres CALENDAIRES : semaine du bilan (lundi → dimanche) et les 7
		// journées immédiatement précédentes. `last7CompletedDays(J)` renvoie
		// exactement J-7 → J-1 : on l'ancre au lendemain de la semaine.
		const weekDays = last7CompletedDays(addDaysISO(checkin.weekStart, 7));
		const previousDays = last7CompletedDays(checkin.weekStart);
		const weekEnd = weekDays[weekDays.length - 1];
		const previousStart = previousDays[0];

		const [goalsRow, goalHistory, entries, stepsRows, metrics, sportRows, allCheckins] = await Promise.all([
			ctx.db.query("clientGoals").withIndex("by_userId", (q) => q.eq("userId", target._id)).first(),
			ctx.db
				.query("clientGoalHistory")
				.withIndex("by_user_from", (q) => q.eq("userId", target._id))
				.collect(),
			ctx.db
				.query("diaryEntries")
				.withIndex("by_user_date", (q) =>
					q.eq("userId", target._id).gte("date", previousStart).lte("date", weekEnd)
				)
				.collect(),
			ctx.db
				.query("dailySteps")
				.withIndex("by_user_date", (q) =>
					q.eq("userId", target._id).gte("date", previousStart).lte("date", weekEnd)
				)
				.collect(),
			ctx.db
				.query("bodyMetrics")
				.withIndex("by_user", (q) => q.eq("userId", target._id))
				.order("asc")
				.collect(),
			ctx.db
				.query("sportActivities")
				.withIndex("by_user_date", (q) =>
					q.eq("userId", target._id).gte("date", previousStart).lte("date", weekEnd)
				)
				.collect(),
			ctx.db
				.query("checkins")
				.withIndex("by_user_week", (q) => q.eq("userId", target._id))
				.order("desc")
				.collect(),
		]);

		const currentKcalGoal = goalsRow?.kcal ?? DEFAULT_GOALS.kcal;
		const proteinGoal = goalsRow?.protein ?? DEFAULT_GOALS.protein;
		const stepGoal = goalsRow?.stepGoal ?? null;
		const effectiveHistory = withCurrentGoal(
			goalHistory.map((row) => ({ kcal: row.kcal, effectiveFrom: row.effectiveFrom })),
			currentKcalGoal,
			localTodayISO()
		);

		const metricsByDate = [...metrics].sort((a, b) => a.date.localeCompare(b.date));
		const weightRows = metricsByDate
			.filter((row) => row.weightKg !== undefined)
			.map((row) => ({ date: row.date, weightKg: row.weightKg as number }));
		const stepsForStats = stepsRows.map((row) => ({ date: row.date, count: row.count }));
		const sportForStats: SportDayInput[] = sportRows.map((row) => ({
			date: row.date,
			durationMinutes: row.durationMinutes,
			source: row.source,
			estimatedCalories: row.estimatedCalories ?? null,
			metMinutes: row.metMinutes,
		}));

		const week = buildWeekStats({
			days: weekDays,
			entries,
			weightRows,
			stepsRows: stepsForStats,
			sportRows: sportForStats,
			goalHistory: effectiveHistory,
			fallbackKcal: currentKcalGoal,
			proteinGoal,
			stepGoal,
		});
		const previousWeek = buildWeekStats({
			days: previousDays,
			entries,
			weightRows,
			stepsRows: stepsForStats,
			sportRows: sportForStats,
			goalHistory: effectiveHistory,
			fallbackKcal: currentKcalGoal,
			proteinGoal,
			stepGoal,
		});

		// 2 derniers retours PUBLIÉS de la même cliente, du plus récent au plus
		// ancien. Un brouillon (`nouveau`) n'est jamais un exemple de style.
		const examples = allCheckins
			.filter(
				(row) =>
					row._id !== checkinId &&
					row.status === "retour_envoye" &&
					typeof row.feedback === "string" &&
					row.feedback.trim().length > 0
			)
			.sort((a, b) => {
				const at = (row: CheckinRow) => row.feedbackAt ?? row._creationTime;
				return at(b) - at(a) || b.weekStart.localeCompare(a.weekStart);
			})
			.slice(0, 2)
			.map((row) => ({
				weekLabel: row.weekLabel,
				text: redactFeedback(row.feedback as string, target),
			}))
			.filter((row) => row.text.length > 0);

		// Les textes libres des réponses sont nettoyés comme les retours :
		// aucun e-mail ni nom de famille ne doit sortir dans le contexte.
		const answers: CoachDraftContext["answers"] = { ...(checkin.answers as CoachDraftContext["answers"]) };
		if (answers.point_retour) answers.point_retour = redactFeedback(answers.point_retour, target);
		if (answers.victoire) answers.victoire = redactFeedback(answers.victoire, target);

		return {
			prenom: target.prenom,
			weekStart: checkin.weekStart,
			weekLabel: checkin.weekLabel,
			answers,
			goals: {
				kcal: currentKcalGoal,
				protein: proteinGoal,
				stepGoal,
			},
			stats: {
				week,
				previousWeek,
				deltas: {
					kcalAvg: deltaOf(week.food.kcalAvg, previousWeek.food.kcalAvg, 0),
					proteinAvg: deltaOf(week.food.proteinAvg, previousWeek.food.proteinAvg, 1),
					weightAvg: deltaOf(week.weight.avg, previousWeek.weight.avg, 1),
					stepsAvg: deltaOf(week.steps.avg, previousWeek.steps.avg, 0),
					sportDurationMin: week.sport.durationMin - previousWeek.sport.durationMin,
					sportKcal: week.sport.kcal - previousWeek.sport.kcal,
				},
				mensurations: mensurationsVision(metricsByDate),
			},
			examples,
		};
	},
});

/* ═══════════════════════════ M1 — PLOMBERIE ═══════════════════════════ */

/**
 * ÉTAT du brouillon assisté pour l'interface coach : uniquement le kill
 * switch. Une query (et non une variable côté client) pour que le bouton
 * disparaisse dès que `AI_COACH_DRAFT_DISABLED` est actif, sans redéploiement
 * du frontend. Réservée au coach, comme le reste du couloir.
 */
export const status = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }): Promise<{ enabled: boolean }> => {
		await requireCoach(ctx, sessionToken);
		return { enabled: !isAiFeatureDisabled("coach_draft") };
	},
});

/**
 * ACTION coachDraft.generate — réservée au coach, LECTURE SEULE.
 *
 * Chaîne : garde de session → `loadContext` (qui re-vérifie le coach, lit le
 * bilan et calcule les faits) → `buildCoachDraftPrompt` (module pur) →
 * `generateText` (fournisseur réglé par `AI_PROVIDER_COACH_DRAFT` /
 * `AI_MODEL_COACH_DRAFT`, ici `fake`).
 *
 * Retourne le TEXTE SEUL. Aucune écriture (`checkins` intact), aucun
 * événement, push ou badge côté cliente : ces effets n'existent que dans
 * `coach.setFeedback`, appelé plus tard par les boutons existants du CRM.
 */
export const generate = action({
	args: {
		sessionToken: v.optional(v.string()),
		checkinId: v.id("checkins"),
	},
	handler: async (ctx, { sessionToken, checkinId }): Promise<string> => {
		// Arrêt d'urgence — vérifié DANS l'action (défense en profondeur : la
		// route BFF le vérifie aussi, un appel direct ne doit rien produire).
		if (isAiFeatureDisabled("coach_draft")) {
			throw new ConvexError("La préparation de brouillon est momentanément désactivée.");
		}

		// Garde explicite dans l'action : ni la route ni l'interface ne sont un
		// périmètre de confiance.
		const session = (await ctx.runQuery(api.journal.checkSession, { sessionToken })) as {
			_id: string;
			role: "coach" | "client";
		} | null;
		if (!session) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
		if (session.role !== "coach") throw new ConvexError("Accès réservé au coach.");

		// loadContext vérifie de nouveau le coach et renvoie un contexte sans
		// identifiant, e-mail ni nom de famille (prénom seul).
		const context = (await ctx.runQuery(internal.coachDraft.loadContext, {
			sessionToken,
			checkinId,
		})) as CoachDraftContext;

		// Longueur : paramètre explicite, jamais codée en dur dans le prompt.
		const rawTargetWords = Number(process.env.COACH_DRAFT_TARGET_WORDS ?? "");
		const targetWords = Number.isFinite(rawTargetWords) && rawTargetWords > 0 ? rawTargetWords : undefined;

		const prompt = buildCoachDraftPrompt({
			context,
			styleGuide: COACH_DRAFT_STYLE_GUIDE,
			methodReference: COACH_DRAFT_METHOD_REFERENCE,
			// Historique de la MÊME cliente, déjà nettoyé par loadContext. Le
			// fichier d'exemples sélectionnés par Hugo rejoint le prompt en M3
			// (mission « style et historique »), sans changer ce module.
			examples: context.examples,
			targetWords,
		});

		const { text } = await generateText({
			feature: "coach_draft",
			system: COACH_DRAFT_SYSTEM,
			prompt,
			maxTokens: 400,
			// Repères factuels du fournisseur fictif (M1 uniquement). Un vrai
			// fournisseur ne reçoit que le prompt.
			fakeFacts: { prenom: context.prenom, weekLabel: context.weekLabel },
		});

		// Texte brut, prêt à être relu/modifié dans le textarea. Rien n'est
		// persisté : sans clic sur « Sauvegarder » ou « Publier », il n'existe
		// que dans le navigateur de Hugo.
		return text;
	},
});
