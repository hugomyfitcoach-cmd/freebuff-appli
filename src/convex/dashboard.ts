import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import {
	addDaysISO,
	addMonthsISO,
	daysBetweenISO,
	getSessionUser,
	isBilanWindowOpen,
	localTodayISO,
	mondayISOof,
	monthsBetweenISO,
} from "./helpers";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { DEFAULT_GOALS } from "./journal";
import { deleteMessageAudioRows, mediaExpiresAt } from "./media";
import { step2Done } from "./onboarding";

/**
 * Dashboard « Accueil » de l'espace cliente.
 *
 * Centralise tous les statuts/événements qui alimentent l'accueil et les
 * badges de navigation, calculés à partir des données réelles (jamais de
 * valeurs codées en dur) :
 *
 * - message du coach du jour (champ dédié, jamais une note interne) ;
 * - bilan hebdo disponible (fenêtre ven. 9h → dim. 12h, non soumis) ;
 * - retour coach non lu (publié côté CRM, non encore consulté) ;
 * - mensurations dues (tous les 15 jours, date à date depuis le démarrage) ;
 * - photos de progression dues (tous les mois, date à date) ;
 * - pesées de la semaine (compteur sur 3, sans alerte) ;
 * - tracking calories du jour (réutilisation des données du journal).
 */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

async function requireClient(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") {
		throw new ConvexError("Cette page est réservée à l'espace cliente.");
	}
	return user;
}

function hasMensuration(m: Doc<"bodyMetrics">): boolean {
	return m.waistCm != null || m.hipCm != null || m.neckCm != null;
}

/**
 * État complet du dashboard de la cliente connectée.
 * `today`/`now` sont passés par le loader SvelteKit (fuseau serveur) pour
 * rester cohérents avec le reste de l'application.
 */
export const getDashboard = query({
	args: {
		sessionToken: v.optional(v.string()),
		today: v.optional(v.string()),
		now: v.optional(v.number()),
	},
	handler: async (ctx, { sessionToken, today, now }) => {
		const user = await requireClient(ctx, sessionToken);
		const ts = now ?? Date.now();
		const day = today && ISO_RE.test(today) ? today : localTodayISO(new Date(ts));
		const weekStart = mondayISOof(day);

		const prevMonday = addDaysISO(weekStart, -7);
		const [checkins, metrics, photos, entries, weekEntries, goalsRow, stepsRows] = await Promise.all([
			ctx.db.query("checkins").withIndex("by_user_week", (q) => q.eq("userId", user._id)).order("desc").collect(),
			ctx.db.query("bodyMetrics").withIndex("by_user", (q) => q.eq("userId", user._id)).order("asc").collect(),
			ctx.db.query("progressPhotos").withIndex("by_user", (q) => q.eq("userId", user._id)).order("asc").collect(),
			ctx.db.query("diaryEntries").withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", day)).collect(),
			// Fenêtre de 14 jours (semaine précédente + courante) : sert au récap.
			ctx.db.query("diaryEntries").withIndex("by_user_date", (q) => q.eq("userId", user._id).gte("date", prevMonday).lt("date", addDaysISO(weekStart, 7))).collect(),
			ctx.db.query("clientGoals").withIndex("by_userId", (q) => q.eq("userId", user._id)).first(),
			ctx.db.query("dailySteps").withIndex("by_user", (q) => q.eq("userId", user._id)).order("asc").collect(),
		]);		/* ── Message du coach (texte et/ou audio) : actif uniquement pour le jour associé ── */
		let coachMessage: {
			date: string;
			text: string | null;
			audio: { mediaId: string; durationMs: number | null; url: string } | null;
		} | null = null;
		if (user.coachMessageDate === day) {
			const text = user.coachMessage ?? null;
			let audio: { mediaId: string; durationMs: number | null; url: string } | null = null;
			const audioRow = user.coachMessageAudioId ? await ctx.db.get(user.coachMessageAudioId) : null;
			const audioExp = audioRow ? mediaExpiresAt(audioRow) : null;
			if (
				audioRow &&
				audioRow.status === "published" &&
				audioRow.kind === "audio" &&
				(!audioExp || audioExp > ts)
			) {
				const url = await ctx.storage.getUrl(audioRow.storageId);
				if (url) {
					audio = { mediaId: audioRow._id, durationMs: audioRow.durationMs ?? null, url };
				}
			}
			if (text || audio) {
				coachMessage = { date: user.coachMessageDate, text, audio };
			}
		}

		/* ── Tracking calories du jour (réutilise les données du journal) ── */
		const kcal = Math.round(entries.reduce((s, e) => s + e.kcal, 0));
		const kcalGoal = goalsRow?.kcal ?? DEFAULT_GOALS.kcal;
		const maintenanceKcal = goalsRow?.maintenanceKcal ?? null;

		/* ── Progression : dernier poids + pesées de la semaine ── */
		const weightRows = metrics.filter((m) => m.weightKg != null);
		const last = weightRows.length > 0 ? weightRows[weightRows.length - 1] : null;
		const nextMonday = addDaysISO(weekStart, 7);
		const weighinsThisWeek = weightRows.filter((m) => m.date >= weekStart && m.date < nextMonday).length;

		/* ── Échéances, date à date depuis la date de démarrage ── */
		const startDate = user.startDate ?? localTodayISO(new Date(user._creationTime));
		const daysSince = daysBetweenISO(day, startDate);

		// Mensurations : échéance tous les 15 jours (démarrage + 15n).
		let measurementsDue = false;
		if (daysSince >= 15) {
			const period = Math.floor(daysSince / 15);
			const windowStart = addDaysISO(startDate, period * 15);
			measurementsDue = !metrics.some((m) => hasMensuration(m) && m.date >= windowStart);
		}

		// Photos : échéance mensuelle (démarrage + n mois).
		const monthsSince = monthsBetweenISO(day, startDate);
		let photosDue = false;
		if (monthsSince >= 1) {
			const windowStart = addMonthsISO(startDate, monthsSince);
			photosDue = !photos.some((p) => p.date >= windowStart);
		}

		/* ── Bilan hebdo : fenêtre ouverte ET pas encore soumis ── */
		const windowOpen = isBilanWindowOpen(new Date(ts));
		const currentWeekCheckin = checkins.find((c) => c.weekStart === weekStart) ?? null;
		const bilanDue = windowOpen && !currentWeekCheckin;

		/* ── Retour coach : publié mais pas encore consulté ── */
		const latestFeedback = checkins.find((c) => c.status === "retour_envoye") ?? null;
		const feedbackUnread = latestFeedback
			? latestFeedback.feedbackReadAt == null ||
				latestFeedback.feedbackReadAt < (latestFeedback.feedbackAt ?? latestFeedback._creationTime)
			: false;

		/* ── Onboarding de démarrage (si activé par le coach) ── */
		let onboarding: {
			enabled: boolean;
			formDone: boolean;
			step2: { measurements: boolean; photos: boolean; done: boolean };
			done: boolean;
			submittedAt: number | null;
		} | null = null;
		if (user.onboardingEnabled) {
			const intakeRow = await ctx.db
				.query("intakes")
				.withIndex("by_user", (q) => q.eq("userId", user._id))
				.first();
			const formDone = intakeRow?.status === "submitted";
			const step2 = step2Done(metrics, photos);
			onboarding = {
				enabled: true,
				formDone,
				step2,
				done: formDone && step2.done,
				submittedAt: intakeRow?.submittedAt ?? null,
			};
		}

		/* ── Pas du jour (une valeur par jour, modifiable) ── */
		const stepsTodayRow = stepsRows.find((s) => s.date === day) ?? null;
		const stepGoal = goalsRow?.stepGoal ?? null;

		/* ── Récap hebdo : dimanche ≥ 18h → lundi inclus (sinon rien) ── */
		// La semaine du récap est celle qui vient de se terminer : la semaine
		// courante le dimanche soir, la précédente le lundi.
		const dow = new Date(ts).getDay();
		const hour = new Date(ts).getHours();
		let recap = null;
		if ((dow === 0 && hour >= 18) || dow === 1) {
			const recapWeekStart = dow === 1 ? addDaysISO(weekStart, -7) : weekStart;
			const recapWeekEnd = addDaysISO(recapWeekStart, 6);

			// Calories de la semaine : uniquement les jours ayant des entrées.
			const kcalByDay = new Map<string, number>();
			for (const e of weekEntries) {
				if (e.date >= recapWeekStart && e.date <= recapWeekEnd) {
					kcalByDay.set(e.date, (kcalByDay.get(e.date) ?? 0) + e.kcal);
				}
			}
			const kcalTracked = kcalByDay.size;
			const kcalAvg =
				kcalTracked > 0 ? Math.round([...kcalByDay.values()].reduce((s, x) => s + x, 0) / kcalTracked) : null;

			// Pas de la semaine : moyenne sur les jours renseignés (jamais /7).
			const weekSteps = stepsRows.filter((s) => s.date >= recapWeekStart && s.date <= recapWeekEnd);
			const stepsTracked = weekSteps.length;
			const stepsAvg =
				stepsTracked > 0 ? Math.round(weekSteps.reduce((s, r) => s + r.count, 0) / stepsTracked) : null;

			// Pesées de la semaine.
			const weighins = weightRows.filter(
				(m) => m.date >= recapWeekStart && m.date <= recapWeekEnd
			).length;

			// Bilan : soumis ou non pour la semaine du récap.
			const bilanSent = checkins.some((c) => c.weekStart === recapWeekStart);

			// Mensurations / photos : seulement si l'échéance tombait DANS cette
			// semaine (sinon elles n'influencent ni l'affichage ni le message).
			const msrDue = dueWindowIn(recapWeekStart, recapWeekEnd, startDate, 15, "days");
			const msrDone = msrDue
				? metrics.some((m) => hasMensuration(m) && m.date >= msrDue.windowStart)
				: false;
			const photoDue = dueWindowIn(recapWeekStart, recapWeekEnd, startDate, 1, "months");
			const photoDone = photoDue
				? photos.some((p) => p.date >= photoDue.windowStart)
				: false;

			recap = {
				weekStart: recapWeekStart,
				weekEnd: recapWeekEnd,
				calories: { avg: kcalAvg, goal: kcalGoal, trackedDays: kcalTracked },
				steps: { avg: stepsAvg, goal: stepGoal, trackedDays: stepsTracked },
				weighins: { count: weighins, goal: 3 },
				bilan: { sent: bilanSent },
				due: {
					measurements: msrDue ? { due: true, done: msrDone } : null,
					photos: photoDue ? { due: true, done: photoDone } : null,
				},
				message: weekMessage({
					kcalTracked,
					stepsTracked,
					weighins,
					bilanSent,
					msrDue: !!msrDue,
					msrDone,
					photoDue: !!photoDue,
					photoDone,
				}),
			};
		}

		return {
			today: day,
			coachMessage,
			onboarding,
			tracking: { kcal, kcalGoal, maintenanceKcal },
			steps: { today: stepsTodayRow?.count ?? null, goal: stepGoal },
			progression: {
				lastWeightKg: last?.weightKg ?? null,
				lastWeightDate: last?.date ?? null,
				weighinsThisWeek,
				measurementsDue,
				photosDue,
				startDate,
			},
			bilan: { due: bilanDue, windowOpen },
			feedback: {
				unread: feedbackUnread,
				hasCheckins: checkins.length > 0,
				latestWeekLabel: latestFeedback?.weekLabel ?? null,
				latestFeedbackAt: latestFeedback?.feedbackAt ?? null,
			},
			recap,
			badges: {
				bilans: (bilanDue ? 1 : 0) + (feedbackUnread ? 1 : 0),
				progression: (measurementsDue ? 1 : 0) + (photosDue ? 1 : 0),
			},
		};
	},
});

/**
 * Échéance (mensurations / photos) tombant dans une semaine donnée.
 * `kind: "days"` → cadence tous les 15 jours ; `"months"` → tous les mois.
 * Retourne null si aucune échéance de la cadence ne tombe dans la semaine.
 */
function dueWindowIn(
	weekStart: string,
	weekEnd: string,
	startDate: string,
	step: number,
	kind: "days" | "months"
): { windowStart: string } | null {
	const span = daysBetweenISO(weekEnd, startDate);
	const maxIdx =
		kind === "days" ? Math.floor(span / step) : monthsBetweenISO(weekEnd, startDate);
	for (let n = 0; n <= maxIdx + 1; n++) {
		const due = kind === "days" ? addDaysISO(startDate, n * step) : addMonthsISO(startDate, n);
		if (due < weekStart) continue;
		if (due > weekEnd) break;
		return { windowStart: due };
	}
	return null;
}

/**
 * Moteur de message de fin de semaine — déterministe, jamais culpabilisant.
 * Le score reste interne (jamais affiché) et ne mesure QUE l'adhésion à la
 * collecte de données : aucun jugement sur le poids ou le respect exact des
 * calories. Mensurations/photos ne comptent que les semaines où l'échéance
 * tombait réellement dans la semaine.
 */
function weekMessage(args: {
	kcalTracked: number;
	stepsTracked: number;
	weighins: number;
	bilanSent: boolean;
	msrDue: boolean;
	msrDone: boolean;
	photoDue: boolean;
	photoDone: boolean;
}): string {
	const { kcalTracked, stepsTracked, weighins, bilanSent, msrDue, msrDone, photoDue, photoDone } = args;
	const total =
		7 + 7 + 3 + 1 + (msrDue ? 1 : 0) + (photoDue ? 1 : 0);
	const achieved =
		Math.min(kcalTracked, 7) +
		Math.min(stepsTracked, 7) +
		Math.min(weighins, 3) +
		(bilanSent ? 1 : 0) +
		(msrDue && msrDone ? 1 : 0) +
		(photoDue && photoDone ? 1 : 0);
	const ratio = total > 0 ? achieved / total : 0;

	if (ratio >= 0.8) {
		// Deux variantes : la régularité data avant tout, jamais un jugement sur
		// le résultat physique ou le fait d'avoir dépassé légèrement ses calories.
		return kcalTracked >= 6 && stepsTracked >= 5
			? "Suivi très régulier cette semaine. Tes données donnent une base claire pour ajuster la suite 💪"
			: "Belle régularité cette semaine. Tu as été présente sur l'essentiel 👏";
	}
	if (ratio >= 0.55) {
		return "Une semaine globalement bien suivie. Quelques points restent à consolider pour avoir une vision encore plus précise.";
	}
	if (ratio >= 0.3) {
		return "Cette semaine a été plus irrégulière. L'objectif maintenant : retrouver un rythme simple sur les fondamentaux.";
	}
	return "Pas assez de données cette semaine pour dégager une vraie tendance. On repart sur une semaine plus régulière pour y voir plus clair.";
}

/**
 * Marque un retour coach comme lu : appelé quand la cliente ouvre réellement
 * la page qui affiche le retour (historique). Le badge disparaît alors.
 */
export const markFeedbackRead = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		checkinId: v.id("checkins"),
	},
	handler: async (ctx, { sessionToken, checkinId }) => {
		const user = await requireClient(ctx, sessionToken);
		const checkin = await ctx.db.get(checkinId);
		if (!checkin || checkin.userId !== user._id) return { ok: false };
		if (
			checkin.status === "retour_envoye" &&
			(checkin.feedbackReadAt == null || checkin.feedbackReadAt < (checkin.feedbackAt ?? checkin._creationTime))
		) {
			await ctx.db.patch(checkinId, { feedbackReadAt: Date.now() });
		}
		return { ok: true };
	},
});

/**
 * Message du coach visible par la cliente sur son dashboard.
 * Réservé à la coach : un message vide supprime le message courant.
 * Le message est associé au jour courant et expire le lendemain.
 */
export const setCoachMessage = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		message: v.string(),
		audioId: v.optional(v.id("coachMedia")),
		removeAudio: v.optional(v.boolean()),
	},
	handler: async (ctx, { sessionToken, userId, message, audioId, removeAudio }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") {
			throw new ConvexError("Réservé à la coach (CRM).");
		}
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") throw new ConvexError("Client introuvable.");
		const trimmed = message.trim().slice(0, 500);
		const today = localTodayISO();

		// Retrait explicite de l'audio (bouton « Effacer » / « Retirer l'audio ») :
		// on supprime les fichiers du storage, jamais de fichier orphelin.
		if (removeAudio) {
			await deleteMessageAudioRows(ctx, userId);
		}

		// Nouvel audio publié avec le message : on publie le brouillon et on
		// remplace l'ancien (un seul message audio actif à la fois).
		let newAudioId: string | undefined;
		if (audioId && !removeAudio) {
			const row = await ctx.db.get(audioId);
			if (!row || row.userId !== userId || row.source !== "coach_message_audio") {
				throw new ConvexError("Audio du message invalide.");
			}
			await ctx.db.patch(audioId, { status: "published", publishedAt: Date.now() });
			await deleteMessageAudioRows(ctx, userId, audioId);
			newAudioId = audioId;
		}

		if (!trimmed && !audioId) {
			// Message entièrement vidé → on retire texte, audio et la date d'activité.
			await ctx.db.patch(userId, {
				coachMessage: undefined,
				coachMessageDate: undefined,
				coachMessageAudioId: undefined,
			});
		} else {
			await ctx.db.patch(userId, {
				// Message du jour : le texte vide (audio seul) efface tout texte
				// précédent — jamais de message périmé qui ressortirait.
				coachMessage: trimmed ? trimmed : undefined,
				// Le message (texte et/ou audio) est actif pour aujourd'hui uniquement ;
				// le fichier audio suit sa propre rétention (72 h après écoute / 14 j max).
				coachMessageDate: today,
				...(newAudioId ? { coachMessageAudioId: newAudioId as never } : {}),
			});
		}
		return { ok: true, hasText: !!trimmed, hasAudio: !!newAudioId };
	},
});