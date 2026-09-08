import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";	import {
		addDaysISO,
		addMonthsISO,
		daysBetweenISO,
		getSessionUser,
		isBilanWindowOpen,
		localTodayISO,
		mondayISOof,
		monthsBetweenISO,
		nextMidnightUtcMs,
		validTimeZone,
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
		]);		/* ── Message du coach (texte et/ou audio) : éphémère, visible jusqu'au minuit
		   LOCAL DE LA CLIENTE suivant la publication (jamais le minuit serveur/UTC).
		   Replis compat : messages antérieurs au passage en horodatage = 24 h fixes,
		   puis (pré-timestamp) = jour exact — jamais de message périmé qui ressortirait. */
		const MSG_TTL_MS = 24 * 3600 * 1000;
		const msgAt = user.coachMessageAt ?? null;
		const msgExp = user.coachMessageExpiresAt ?? null;
		const msgFresh = msgExp
			? ts < msgExp
			: msgAt
				? ts - msgAt < MSG_TTL_MS
				: user.coachMessageDate === day;
		let coachMessage: {
			date: string;
			text: string | null;
			audio: { mediaId: string; durationMs: number | null; url: string } | null;
			read: boolean;
		} | null = null;
		if (msgFresh) {
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
				const read = msgAt ? (user.coachMessageReadAt ?? 0) >= msgAt : true;
				coachMessage = {
					date: user.coachMessageDate ?? localTodayISO(new Date(ts)),
					text,
					audio,
					read,
				};
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

		/* ── Retours coach publiés : chaque retour non consulté compte réellement
		   (jamais un simple « 1 » codé en dur) ── */
		const withReturn = checkins.filter((c) => c.status === "retour_envoye");
		const unreadReturns = withReturn.filter(
			(c) => c.feedbackReadAt == null || c.feedbackReadAt < (c.feedbackAt ?? c._creationTime)
		);
		const unreadCount = unreadReturns.length;
		const latestFeedback = (unreadReturns[0] ?? withReturn[0]) ?? null;

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

		/* ── Récap hebdo : samedi + dimanche de la semaine courante (sinon rien) ── */
		// La carte « Ta semaine en un coup d'œil » n'apparaît que samedi et
		// dimanche ; dès le lundi 00:00 elle disparaît (aucun résumé d'une
		// semaine déjà terminée). Les moyennes n'utilisent que les jours
		// réellement renseignés (absence de donnée ≠ zéro).
		const dow = new Date(ts).getDay();
		let recap = null;
		if (dow === 6 || dow === 0) {
			const recapWeekStart = weekStart;
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

			recap = {
				weekStart: recapWeekStart,
				weekEnd: recapWeekEnd,
				calories: { avg: kcalAvg, goal: kcalGoal, trackedDays: kcalTracked },
				steps: { avg: stepsAvg, goal: stepGoal, trackedDays: stepsTracked },
				weighins: { count: weighins, goal: 3 },
				bilan: { sent: bilanSent },
			};
		}

		return {
			today: day,
			coachMessage,
			onboarding,
			tracking: { kcal, kcalGoal, maintenanceKcal },
			steps: {
				today: stepsTodayRow?.count ?? null,
				goal: stepGoal,
				// Série de la semaine courante (lundi → dimanche) pour le mini-graphique :
				// uniquement les jours réellement renseignés, jamais de zéro inventé.
				week: stepsRows
					.filter((s) => s.date >= weekStart && s.date < nextMonday)
					.map((s) => ({ date: s.date, count: s.count })),
			},
			progression: {
				lastWeightKg: last?.weightKg ?? null,
				lastWeightDate: last?.date ?? null,
				weighinsThisWeek,
				measurementsDue,
				photosDue,
				startDate,
				// Dernières 10 pesées pour la tendance — même source que Progression/CRM.
				weightTrend: weightRows.slice(-10).map((m) => ({ date: m.date, weightKg: m.weightKg as number })),
			},
			bilan: { due: bilanDue, windowOpen },
			feedback: {
				unread: unreadCount > 0,
				unreadCount,
				hasCheckins: checkins.length > 0,
				latestWeekLabel: latestFeedback?.weekLabel ?? null,
				latestFeedbackAt: latestFeedback?.feedbackAt ?? null,
			},
			recap,
			badges: {
				// « bilans » = actions en attente sur l'Accueil (bilan à faire + retours non lus).
				bilans: (bilanDue ? 1 : 0) + unreadCount,
				// « retours » = uniquement les retours coach non consultés (page Mes bilans).
				retours: unreadCount,
				// « message » = message du coach du jour non encore marqué « Vu » par la cliente.
				message: msgFresh && (msgAt ? (user.coachMessageReadAt ?? 0) < msgAt : false) ? 1 : 0,
				progression: (measurementsDue ? 1 : 0) + (photosDue ? 1 : 0),
			},
		};
	},
});


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
 * La cliente marque réellement le message du coach du jour comme lu (« Vu ») :
 * le badge non lu et la mise en évidence de l'Accueil disparaissent. Une
 * simple consultation de l'Accueil ne suffit jamais — c'est un geste explicite
 * (ou l'écoute de l'audio via markListened) qui consomme l'état non lu.
 */
export const markCoachMessageRead = mutation({
	args: { sessionToken: v.optional(v.string()) },		handler: async (ctx, { sessionToken }) => {
			const user = await requireClient(ctx, sessionToken);
			const msgAt = user.coachMessageAt ?? null;
			if (!msgAt) return { ok: false };
			if ((user.coachMessageReadAt ?? 0) < msgAt) {
				await ctx.db.patch(user._id, { coachMessageReadAt: Date.now() });
			}
			// Journal CRM : toutes les publications jusqu'à celle en cours deviennent lues.
			const now = Date.now();
			const log = await ctx.db
				.query("coachMessages")
				.withIndex("by_user", (q) => q.eq("userId", user._id))
				.collect();
			for (const row of log) {
				if (row.readAt == null && row.publishedAt <= msgAt) {
					await ctx.db.patch(row._id, { readAt: now });
				}
			}
			return { ok: true };
		},
});

/**
 * La cliente a réellement ouvert la section « Messages » (qui liste le journal
 * des messages du coach) : chaque publication non encore consultée passe en
 * « lu », y compris les messages antérieurs dont l'éphémère 24 h a expiré.
 */
export const markAllCoachMessagesRead = mutation({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireClient(ctx, sessionToken);
		const now = Date.now();
		const log = await ctx.db
			.query("coachMessages")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.collect();
		let updated = 0;
		for (const row of log) {
			if (row.readAt == null) {
				await ctx.db.patch(row._id, { readAt: now });
				updated++;
			}
		}
		if (user.coachMessageAt && (user.coachMessageReadAt ?? 0) < user.coachMessageAt) {
			await ctx.db.patch(user._id, { coachMessageReadAt: now });
		}
		return { ok: true, updated };
	},
});

/**
 * Journal des messages du coach vus côté cliente (section « Messages »).
 * Une ligne par publication (texte et/ou audio), de la plus récente à la plus
 * ancienne — les messages déjà « lus » restent consultables ici pour toujours.
 */
export const myCoachMessages = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireClient(ctx, sessionToken);
		const rows = await ctx.db
			.query("coachMessages")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.order("desc")
			.collect();
		const out: {
			publishedAt: number;
			publishedDay: string;
			text: string | null;
			readAt: number | null;
			audio: { mediaId: string; durationMs: number | null; url: string } | null;
		}[] = [];
		for (const r of rows) {
			let audio: { mediaId: string; durationMs: number | null; url: string } | null = null;
			if (r.audioId) {
				const media = await ctx.db.get(r.audioId);
				if (media && media.kind === "audio" && media.status === "published") {
					audio = {
						mediaId: String(r.audioId),
						durationMs: media.durationMs ?? null,
						url: (await ctx.storage.getUrl(media.storageId)) ?? "",
					};
				}
			}
			out.push({
				publishedAt: r.publishedAt,
				publishedDay: r.publishedDay,
				text: r.text ?? null,
				readAt: r.readAt ?? null,
				audio: audio && audio.url ? audio : null,
			});
		}
		return out;
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
			// Message entièrement vidé → on retire texte, audio et toute trace d'activité.
			await ctx.db.patch(userId, {
				coachMessage: undefined,
				coachMessageDate: undefined,
				coachMessageAt: undefined,
				coachMessageExpiresAt: undefined,
				coachMessageReadAt: undefined,
				coachMessageAudioId: undefined,
			});
		} else {
			// Minuit local de la cliente après cette publication (fuseau IANA stocké,
			// Europe/Paris par défaut) — l'éphémère suit SON jour, pas un créneau fixe.
			const publishedMs = Date.now();
			const tz = validTimeZone(target.timeZone) ?? "Europe/Paris";
			const expiresAt = nextMidnightUtcMs(publishedMs, tz);
			await ctx.db.patch(userId, {
				// Message du jour : le texte vide (audio seul) efface tout texte
				// précédent — jamais de message périmé qui ressortirait.
				coachMessage: trimmed ? trimmed : undefined,
				// Le message (texte et/ou audio) est éphémère : actif jusqu'au minuit
				// local de la cliente, puis retiré de l'Accueil (état actif nettoyé par
				// le cron). Une nouvelle publication réinitialise le non-lu.
				coachMessageDate: today,
				coachMessageAt: publishedMs,
				coachMessageExpiresAt: expiresAt,
				coachMessageReadAt: undefined,
				...(newAudioId ? { coachMessageAudioId: newAudioId as never } : {}),
			});
			// Journal CRM : une ligne par publication (texte et/ou audio, datée,
			// état lu/non lu) — l'historique n'est jamais supprimé par l'éphémère.
			await ctx.db.insert("coachMessages", {
				userId: userId as never,
				...(trimmed ? { text: trimmed } : {}),
				...(newAudioId ? { audioId: newAudioId as never } : {}),
				publishedAt: publishedMs,
				publishedDay: today,
				readAt: undefined,
			});
		}
		return { ok: true, hasText: !!trimmed, hasAudio: !!newAudioId };
	},
});