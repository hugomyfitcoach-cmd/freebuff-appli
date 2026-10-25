/**
 * CONTEXTE DU BROUILLON DE RETOUR — query INTERNE, LECTURE SEULE.
 *
 * Pour UN bilan donné, assemble :
 *  - les réponses du bilan et sa semaine ;
 *  - les statistiques LIVE des 7 derniers jours terminés (J-7 → J-1) et des
 *    7 jours précédents (J-14 → J-8, pour les écarts), en réutilisant les
 *    fonctions pures de `src/lib/vision360.ts` — EXACTEMENT les mêmes que la
 *    carte du bilan, pour qu'elle et le brouillon affichent les mêmes chiffres
 *    au moment de la consultation ;
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
 *
 * M2 complète le contexte : part des repas estimés par photo IA (marqueur
 * « analyse:… » du journal), jours renseignés sur 7, phase du cycle si elle
 * est renseignée, dernier appel et prochain rendez-vous (appointments) pour
 * la règle « proposer un rendez-vous si aucun appel depuis 15 jours », et
 * formule de la cliente (coaching ou autonomie). Le référentiel de méthode
 * (`src/convex/ai/methodeGflux.ts`, copie serveur de docs/methode-gflux.md)
 * n'entre que dans le prompt — jamais dans une réponse de query. M2 ajoute
 * `contextPreview` (query coach, via loadContext) : le contexte assemblé du
 * lien discret « Voir les données envoyées à l'assistant », réservé au CRM.
 *
 * M4-4 précise DEUX filtres appliqués ici, dans le code (pas seulement dans le
 * guide) : les mensurations ne partent QUE si le dernier relevé est daté de
 * J-7 à J (sinon un simple indicateur `mensurationsAttenduesNonSaisies`), et
 * calories, protéines et pas transportent leur complétude (moins de 4 jours
 * sur 7 = aucun jugement sur la moyenne).
 */
import { action, internalQuery, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { generateText, isAiFeatureDisabled, resolveGenerationConfig } from "./ai/provider";
import { OpenAiIncompleteError } from "../lib/server/openai";
import { DRAFT_RATE_LIMITED, draftFailReason, type DraftFailReasonCode } from "../lib/coachDraftError";
import { COACH_DRAFT_STYLE_GUIDE } from "../lib/data/coachDraftStyleGuide";
import { COACH_DRAFT_METHOD_REFERENCE } from "./ai/methodeGflux";
import { daysBetweenISO, getSessionUser, localTodayISO } from "./helpers";
import { DEFAULT_GOALS } from "./journal";
import { cycleState } from "../lib/cycle";
import { kcalGoalForDate, withCurrentGoal, type GoalHistoryRow } from "../lib/goalHistory";
import {
	exploitabilityThresholdKcal,
	foodAverages,
	freshMensurationsVision,
	isRecentDate,
	last7CompletedDays,
	mensurationsVision,
	parisTodayISO,
	shiftISO,
	sportVision,
	stepsAverages,
	trackingCompleteness,
	weightTrendFacts,
	weightVision,
	type SportDayInput,
} from "../lib/vision360";
import {
	buildCoachDraftPrompt,
	buildDraftPreview,
	restorePrenom,
	type CoachDraftAppointments,
	type CoachDraftContext,
	type CoachDraftCycle,
	type CoachDraftPhotoAi,
	type CoachDraftWeekStats,
} from "./coachDraftPrompt";

// MÊME fonction que la carte du bilan (une seule définition de la tendance) —
// ré-exportée ici pour les tests et les appelants historiques du module.
export { weightTrendFacts };

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
	/**
	 * Deux pesées les plus récentes (toutes dates, aujourd'hui inclus) —
	 * fournies pour la fenêtre courante afin que la carte et le brouillon
	 * affichent la même dernière pesée et le même écart.
	 */
	latestWeights?: { last: { date: string; weightKg: number } | null; previous: { date: string; weightKg: number } | null; gapKg: number | null };
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
	const photoAi = photoAiVision(args.entries, days);

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
			daysWithData: food.breakdown.daysWithData,
			// Complétude : dénominateur RÉEL de la moyenne (jours exploitables).
			completeness: trackingCompleteness(food.breakdown.exploitableDays),
		},
		weight: {
			avg: weight.avg,
			count: weight.count,
			last: args.latestWeights ? args.latestWeights.last : weight.last,
			prevLast: args.latestWeights ? args.latestWeights.previous : weight.prevLast,
			delta: args.latestWeights ? args.latestWeights.gapKg : weight.delta,
		},
		steps: {
			avg: steps.avg,
			goal: args.stepGoal,
			trackedDays: steps.trackedDays,
			// Complétude : dénominateur RÉEL de la moyenne (jours renseignés).
			completeness: trackingCompleteness(steps.trackedDays),
		},
		sport: {
			activities: sport.activities,
			durationMin: sport.durationMin,
			kcal: sport.kcal,
			metMinutes: sport.metMinutes,
		},
		photoAi,
	};
}

function deltaOf(a: number | null, b: number | null, digits: number): number | null {
	if (a === null || b === null) return null;
	const factor = 10 ** digits;
	return Math.round((a - b) * factor) / factor;
}

/* ───────── Faits calculés : photo IA, cycle, rendez-vous (M2) ───────── */

/** Marqueur journal d'un repas estimé par photo IA (une photo = un groupe). */
const PHOTO_AI_GROUP_PREFIX = "analyse:";

/** Heure locale "HH:mm" de l'instant courant dans le fuseau de l'app (Paris). */
const PARIS_HHMM_FMT = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Paris",
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
});

function parisHHMM(now: Date): string {
	return PARIS_HHMM_FMT.format(now);
}

/**
 * PART DES REPAS ESTIMÉS PAR PHOTO IA — 100 % calculée par le code.
 *
 * Le journal regroupe les composants d'une photo analysée sous une clé
 * « analyse:… » (repas estimé par photo IA) ; les autres entrées sont des
 * saisies manuelles, même ajoutées à un repas mixte.
 *  - part principale : kcal des groupes « analyse:… » ÷ kcal totales de la
 *    fenêtre, arrondie en % — null si le total est nul (« non disponible ») ;
 *  - lisibilité : repas (date + repas) contenant au moins une analyse photo,
 *    sur le nombre de repas renseignés.
 */
export function photoAiVision(entries: Doc<"diaryEntries">[], days: string[]): CoachDraftPhotoAi {
	const daySet = new Set(days);
	let aiKcal = 0;
	let totalKcal = 0;
	const mealsLogged = new Set<string>();
	const mealsWithAi = new Set<string>();
	for (const entry of entries) {
		if (!daySet.has(entry.date)) continue;
		totalKcal += entry.kcal;
		const key = `${entry.date}|${entry.meal}`;
		mealsLogged.add(key);
		if (typeof entry.mealGroup === "string" && entry.mealGroup.startsWith(PHOTO_AI_GROUP_PREFIX)) {
			aiKcal += entry.kcal;
			mealsWithAi.add(key);
		}
	}
	return {
		kcalSharePct: totalKcal > 0 ? Math.round((aiKcal / totalKcal) * 100) : null,
		aiKcal: Math.round(aiKcal),
		totalKcal: Math.round(totalKcal),
		mealsWithAi: mealsWithAi.size,
		mealsLogged: mealsLogged.size,
	};
}

/**
 * DERNIER APPEL ET PROCHAIN RENDEZ-VOUS — pour la règle de la méthode §2
 * (« proposer un rendez-vous si aucun appel depuis 15 jours et perte au
 * ralenti »). Tous les rendez-vous non annulés sont des appels ; le nombre
 * de jours écoulés est calculé ici pour que l'assistant n'ait jamais à
 * comparer des dates ni à compter.
 */
export function appointmentFacts(
	rows: { date: string; time: string; status: string }[],
	todayISO: string,
	nowHHMM: string
): CoachDraftAppointments {
	const startOf = (row: { date: string; time: string }) => `${row.date}T${row.time}`;
	const nowStamp = `${todayISO}T${nowHHMM}`;
	const booked = rows
		.filter((row) => row.status !== "cancelled")
		.slice()
		.sort((a, b) => startOf(a).localeCompare(startOf(b)));
	const past = booked.filter((row) => startOf(row) < nowStamp);
	const upcoming = booked.filter((row) => startOf(row) >= nowStamp);
	const last = past.length > 0 ? past[past.length - 1] : null;
	const next = upcoming.length > 0 ? upcoming[0] : null;
	return {
		lastCallDate: last ? last.date : null,
		daysSinceLastCall: last ? Math.max(0, daysBetweenISO(todayISO, last.date)) : null,
		nextAppointmentDate: next ? next.date : null,
	};
}

/**
 * PHASE DU CYCLE — uniquement si la cliente a renseigné son suivi de cycle
 * (`users.cycle`). La formule existante (`lib/cycle`) est réutilisée telle
 * quelle : aucune phase n'est jamais inventée (hormonal / irrégulier =
 * renseigné sans phase estimable).
 */
export function cycleFacts(cycle: UserRow["cycle"], nowMs: number): CoachDraftCycle | null {
	if (!cycle) return null;
	const state = cycleState(cycle, new Date(nowMs));
	if (state.kind === "tracked") {
		return { kind: "tracked", phaseLabel: state.label, cycleDay: state.cycleDay };
	}
	if (state.kind === "empty") return null;
	return { kind: state.kind, phaseLabel: null, cycleDay: null };
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
		const coach = await requireCoach(ctx, sessionToken);

		const checkin: CheckinRow | null = await ctx.db.get(checkinId);
		if (!checkin) throw new ConvexError("Bilan introuvable.");
		const target = await ctx.db.get(checkin.userId);
		if (!target || target.role !== "client") throw new ConvexError("Cliente introuvable.");
		// APPARTENANCE : chaque coach n'accède qu'à SES clientes
		// (`users.createdBy`, même contrat que les rendez-vous) — un autre
		// coach est refusé même avec l'identifiant du bilan en main.
		if (!target.createdBy || target.createdBy !== coach._id) {
			throw new ConvexError("Accès refusé.");
		}

		// FENÊTRES LIVE — les mêmes que la carte du bilan, calculées AU MOMENT
		// DE LA CONSULTATION dans le fuseau de référence (Europe/Paris) :
		// 7 journées terminées J-7 → J-1 (la journée en cours est exclue) et les
		// 7 précédentes J-14 → J-8, uniquement pour les écarts. La date d'envoi
		// du bilan n'entre plus dans le calcul des chiffres — elle ne sert
		// qu'à identifier le bilan (libellé, précédent, exemples).
		const today360 = parisTodayISO();
		const weekDays = last7CompletedDays(today360);
		const previousDays = last7CompletedDays(shiftISO(today360, -7));
		const weekEnd = weekDays[weekDays.length - 1];
		const previousStart = previousDays[0];

		const [goalsRow, goalHistory, entries, stepsRows, metrics, sportRows, allCheckins, appointmentRows] =
			await Promise.all([
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
			ctx.db
				.query("appointments")
				.withIndex("by_client", (q) => q.eq("clientId", target._id))
				.collect(),
			]);

		const currentKcalGoal = goalsRow?.kcal ?? DEFAULT_GOALS.kcal;
		const proteinGoal = goalsRow?.protein ?? DEFAULT_GOALS.protein;
		const stepGoal = goalsRow?.stepGoal ?? null;
		const effectiveHistory = withCurrentGoal(
			goalHistory.map((row) => ({ kcal: row.kcal, effectiveFrom: row.effectiveFrom })),
			currentKcalGoal,
			// Même « aujourd'hui » que la carte (fuseau de référence Europe/Paris).
			today360
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

		// Bilan précédent (le plus récent avant celui-ci) : pour son poids
		// moyen, même quand la semaine précédente du calendrier est vide.
		const prevCheckinRow =
			allCheckins.find((row) => row._id !== checkinId && row.weekStart < checkin.weekStart) ?? null;

		// Mensurations — MÊME comparaison que la carte (mensurationsVision :
		// dernier relevé vs précédent, deltas par mesure), mais filtrée par la
		// fraîcheur du dernier relevé (J-7 → J, fuseau Paris) : au-delà, rien
		// n'est transmis à l'assistant (le panneau dira « relevé trop ancien »).
		const mensurationsToutes = mensurationsVision(metricsByDate);
		const mensurations = freshMensurationsVision(metricsByDate, today360);
		const mensurationsHorsFenetre = mensurationsToutes !== null && mensurations === null;
		// RYTHME DE 15 JOURS — un relevé de J-14 à J-8 est « dans les temps » :
		// rien n'est transmis et rien n'est relancé. La relance ne dépend QUE de
		// la date du dernier relevé (jamais de la réponse « Mensurations » du
		// bilan) : aucun relevé, ou dernier relevé antérieur à J-14.
		const dernierReleveMensurations = mensurationsToutes?.date ?? null;
		const mensurationsAttenduesNonSaisies =
			dernierReleveMensurations === null || dernierReleveMensurations < shiftISO(today360, -14);

		// Tendance de poids — MÊME fonction que la carte : deux pesées les plus
		// récentes, toutes dates confondues (aujourd'hui inclus).
		const latestWeights = weightTrendFacts(
			weightRows,
			prevCheckinRow ? { weekLabel: prevCheckinRow.weekLabel, weekStart: prevCheckinRow.weekStart } : null
		);
		// ÉCART DE PESÉE — les faits restent calculés (même contrat que la carte),
		// mais l'écart n'est TRANSMIS que si la DERNIÈRE pesée est datée de J-7 à J
		// (même fenêtre que les mensurations). Sinon le prompt le retire et invite
		// à se peser ; la moyenne J-7 → J-1 reste inchangée.
		const peseeRecenteAbsente =
			latestWeights.last === null || !isRecentDate(latestWeights.last.date, today360);
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
			latestWeights,
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

		const now = new Date();

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
			formule: target.coachingMode === "autonomy" ? "autonomie" : "coaching",
			cycle: cycleFacts(target.cycle, now.getTime()),
			appointments: appointmentFacts(appointmentRows, localTodayISO(now), parisHHMM(now)),
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
				// Mensurations : la comparaison de la carte, transmise SEULEMENT si
				// le dernier relevé est daté de J-7 à J (aujourd'hui inclus) — un
				// relevé plus ancien a déjà été commenté au bilan précédent.
				mensurations,
				/** Aucun relevé, ou dernier relevé antérieur à J-14 : une relance courte. */
				mensurationsAttenduesNonSaisies,
				/** Un relevé existe mais hors fenêtre (panneau : « relevé trop ancien »). */
				mensurationsHorsFenetre,
				/**
				 * Ouverture : aucune appréciation globale dès qu'une donnée commentée
				 * est partielle ou insuffisante (< 7 jours) — on ouvre sur un fait.
				 */
				ouvertureFactuelle:
					week.food.completeness !== "complete" || week.steps.completeness !== "complete",
				/** Dernière pesée absente ou trop ancienne (écart non transmis). */
				peseeRecenteAbsente,
				weightTrend: latestWeights,
			},
			examples,
		};
	},
});

/* ═══════════════════════════ M1 — PLOMBERIE ═══════════════════════════ */

/**
 * CONSENTEMENT ASSISTANT IA (M5) — query COACH, LECTURE SEULE.
 *
 * Répond à une seule question : le coach a-t-il enregistré l'accord de CETTE
 * cliente pour l'assistant ? Mêmes gardes que `loadContext` (coach + bilan +
 * appartenance), donc un autre coach est refusé même avec l'identifiant.
 * Aucune donnée de la fiche ne sort : un booléen, rien d'autre.
 *
 * Publique (et non interne) pour que la route BFF puisse refuser en 403 avec
 * le code `consent` AVANT d'appeler l'action ; l'action revérifie de son côté.
 */
export const hasAiConsent = query({
	args: { sessionToken: v.optional(v.string()), checkinId: v.id("checkins") },
	handler: async (ctx, { sessionToken, checkinId }): Promise<boolean> => {
		const coach = await requireCoach(ctx, sessionToken);
		const checkin = await ctx.db.get(checkinId);
		if (!checkin) throw new ConvexError("Bilan introuvable.");
		const target = await ctx.db.get(checkin.userId);
		if (!target || target.role !== "client") throw new ConvexError("Cliente introuvable.");
		if (!target.createdBy || target.createdBy !== coach._id) throw new ConvexError("Accès refusé.");
		return typeof target.aiConsentAt === "number";
	},
});

/**
 * DERNIÈRE CAUSE D'ÉCHEC DU BROUILLON — query coach, LECTURE SEULE.
 *
 * Renvoie UNIQUEMENT la raison courte déjà tracée dans `aiUsageLog`
 * (`failReason`) pour un échec postérieur à `since` (l'instant où le coach a
 * lancé la génération), et `null` sinon. Aucun contenu, aucun identifiant :
 * le BFF la traduit en cause lisible, jamais en message technique.
 */
export const lastDraftFailure = query({
	args: { sessionToken: v.optional(v.string()), since: v.optional(v.number()) },
	handler: async (ctx, { sessionToken, since }): Promise<string | null> => {
		await requireCoach(ctx, sessionToken);
		const sinceMs = typeof since === "number" ? since : 0;
		const rows = await ctx.db
			.query("aiUsageLog")
			.withIndex("by_kind", (q) => q.eq("kind", "coach_draft"))
			.collect();
		const failures = rows
			.filter((row) => row.status === "error" && row.createdAt >= sinceMs)
			.sort((a, b) => b.createdAt - a.createdAt);
		return failures[0]?.failReason ?? null;
	},
});

/**
 * FENÊTRE ANTI-DOUBLE GÉNÉRATION — un seul brouillon réussi par bilan et par
 * 30 secondes (double-clic, deux onglets ouverts). Valeur explicite et stable.
 */
export const DRAFT_RATE_LIMIT_MS = 30_000;

/**
 * BROUILLON RÉCENT POUR CE BILAN — query INTERNE, LECTURE SEULE.
 *
 * Vrai si une génération a RÉUSSI (`status: "ok"`) pour ce bilan depuis
 * `since`. Seul un identifiant technique est lu (`aiUsageLog.checkinId`) :
 * aucun contenu, aucun prénom, aucune donnée de la fiche.
 */
export const recentSuccessfulDraft = internalQuery({
	args: {
		sessionToken: v.optional(v.string()),
		checkinId: v.id("checkins"),
		since: v.number(),
	},
	handler: async (ctx, { sessionToken, checkinId, since }): Promise<boolean> => {
		const coach = await requireCoach(ctx, sessionToken);
		const checkin = await ctx.db.get(checkinId);
		if (!checkin) throw new ConvexError("Bilan introuvable.");
		const target = await ctx.db.get(checkin.userId);
		if (!target || target.role !== "client") throw new ConvexError("Cliente introuvable.");
		if (!target.createdBy || target.createdBy !== coach._id) throw new ConvexError("Accès refusé.");
		const rows = await ctx.db
			.query("aiUsageLog")
			.withIndex("by_kind", (q) => q.eq("kind", "coach_draft"))
			.collect();
		return rows.some(
			(row) =>
				row.status === "ok" && row.checkinId === checkinId && row.createdAt >= since
		);
	},
});

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

		// CONSENTEMENT (M5) — refus AVANT tout appel au fournisseur : sans
		// consentement enregistré par le coach, aucun prompt n'est construit et
		// OpenAI n'est jamais appelé (aucun coût, aucune donnée transmise).
		const consent = (await ctx.runQuery(api.coachDraft.hasAiConsent, {
			sessionToken,
			checkinId,
		})) as boolean;
		if (!consent) {
			throw new ConvexError("Consentement IA non enregistré pour cette cliente.");
		}

		// ANTI-DOUBLE GÉNÉRATION — refus AVANT lecture du contexte et AVANT tout
		// appel fournisseur : un second brouillon réussi pour le même bilan en
		// moins de 30 secondes coûterait deux fois pour le même texte.
		const recentDraft = (await ctx.runQuery(internal.coachDraft.recentSuccessfulDraft, {
			sessionToken,
			checkinId,
			since: Date.now() - DRAFT_RATE_LIMIT_MS,
		})) as boolean;
		if (recentDraft) throw new ConvexError(DRAFT_RATE_LIMITED);

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

		const started = Date.now();
		let result: Awaited<ReturnType<typeof generateText>>;
		try {
			result = await generateText({
				feature: "coach_draft",
				system: COACH_DRAFT_SYSTEM,
				prompt,
				maxTokens: 2000,
				// Repères factuels du fournisseur fictif uniquement (jamais transmis
				// à un vrai fournisseur, qui ne reçoit que system + prompt).
				fakeFacts: { prenom: context.prenom, weekLabel: context.weekLabel },
			});
		} catch (error) {
			// CAUSE COURTE ET STABLE uniquement : jamais le message brut du
			// fournisseur (il peut citer une clé ou un détail technique). Réponse
			// coupée → « incomplete » ; le reste est classé par `draftFailReason`.
			const failReason: DraftFailReasonCode =
				error instanceof OpenAiIncompleteError
					? "incomplete"
					: draftFailReason(error instanceof Error ? error.message : String(error));
			// Erreur ou délai dépassé : on trace la cause technique courte (jamais
			// le prompt ni le contenu) puis on renvoie un message clair — le coach
			// écrit à la main comme avant.
			await ctx.runMutation(internal.aiLog.record as never, {
				kind: "coach_draft",
				model: resolveGenerationConfig("coach_draft").model || "non configuré",
				durationMs: Date.now() - started,
				status: "error",
				failReason,
			} as never);
			throw new ConvexError(
				"Le brouillon n'a pas pu être préparé. Tu peux écrire ton retour à la main comme avant, ou réessayer dans un instant."
			);
		}

		// SUIVI DES COÛTS — modèle, tokens lus/écrits/mis en cache et durée.
		// JAMAIS le contenu : ni prompt, ni brouillon, ni donnée cliente.
		await ctx.runMutation(internal.aiLog.record as never, {
			kind: "coach_draft",
			model: result.usage.model,
			inputTokens: result.usage.inputTokens,
			outputTokens: result.usage.outputTokens,
			cachedInputTokens: result.usage.cachedInputTokens,
			durationMs: result.usage.durationMs,
			status: "ok",
			estimatedCostUsd: result.usage.estimatedCostUsd,
			checkinId,
		} as never);

		// Prénom réinséré côté serveur : l'appel ne contenait que {{prenom}}.
		const text = restorePrenom(result.text, context.prenom);

		// Texte brut, prêt à être relu/modifié dans le textarea. Rien n'est
		// persisté : sans clic sur « Sauvegarder » ou « Publier », il n'existe
		// que dans le navigateur de Hugo.
		return text;
	},
});

/* ═══════════════════════ M2 — CONTEXTE VISIBLE CÔTÉ COACH ═══════════════════════ */

/**
 * CONTEXTE ASSEMBLÉ POUR VÉRIFICATION — query coach, LECTURE SEULE.
 *
 * Sert le lien discret « Voir les données envoyées à l'assistant » de la
 * carte du bilan (CRM uniquement — la vue cliente n'appelle ni cette query
 * ni la route BFF associée). Renvoie le contexte assemblé par `loadContext`,
 * présenté comme il part au modèle : chaque donnée retirée (suivi
 * insuffisant, relevé trop ancien, écart non fiable) est remplacée par
 * « non transmis — … » au lieu de sa valeur. Mêmes gardes (coach +
 * appartenance), mêmes chiffres calculés par le code.
 *
 * Le référentiel de méthode n'en fait pas partie : il reste côté serveur et
 * n'est injecté que dans le prompt de `generate`.
 */
export const contextPreview = query({
	args: {
		sessionToken: v.optional(v.string()),
		checkinId: v.id("checkins"),
	},
	handler: async (ctx, { sessionToken, checkinId }): Promise<Record<string, unknown>> => {
		// Même query interne, aucune duplication du calcul ni de la lecture :
		// les faits sont ensuite présentés comme ils partent au modèle (une
		// donnée retirée est remplacée par « non transmis — … »).
		const context = await ctx.runQuery(internal.coachDraft.loadContext, { sessionToken, checkinId });
		return buildDraftPreview(context);
	},
});
