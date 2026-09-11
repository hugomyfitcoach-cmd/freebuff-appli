import { internalMutation, mutation, query } from "./_generated/server";
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
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { DEFAULT_GOALS } from "./journal";
import { deleteMessageAudioRows, mediaExpiresAt } from "./media";
import { step2Done } from "./onboarding";
import { wallTimeToUtcMs } from "./helpers";

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

		/* ── « Me le rappeler plus tard » (48 h) : l'échéance reste posée (source de
		   vérité inchangée ci-dessus), mais la carte + le badge sont masqués et les
		   rappels push liés restent silencieux jusqu'à l'expiration du report. Si
		   l'action est faite entre-temps, l'échéance tombe naturellement à false —
		   rien ne réapparaît ; sinon carte + badge reviennent d'eux-mêmes. ── */
		const measurementsSnoozed = measurementsDue && (user.measurementsSnoozeUntil ?? 0) > ts;
		const photosSnoozed = photosDue && (user.photosSnoozeUntil ?? 0) > ts;
		const measurementsDueShown = measurementsDue && !measurementsSnoozed;
		const photosDueShown = photosDue && !photosSnoozed;

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
		const ONBOARDING_HIDE_MS = 24 * 3600 * 1000;
		let onboarding: {
			enabled: boolean;
			formDone: boolean;
			step2: { measurements: boolean; photos: boolean; done: boolean };
			done: boolean;
			completedAt: number | null;
			submittedAt: number | null;
		} | null = null;
		if (user.onboardingEnabled) {
			const intakeRow = await ctx.db
				.query("intakes")
				.withIndex("by_user", (q) => q.eq("userId", user._id))
				.first();
			const formDone = intakeRow?.status === "submitted";
			const step2 = step2Done(metrics, photos);
			const done = formDone && step2.done;
			const completedAt = user.onboardingCompletedAt ?? null;
			// Terminé : confirmation visible 24 h (vraie date, réévaluée à chaque
			// chargement / reprise — aucune minuterie fragile), puis carte masquée.
			// Les données et l'horodatage restent (le CRM continue d'afficher « Terminé »).
			if (done && completedAt && ts - completedAt >= ONBOARDING_HIDE_MS) {
				onboarding = null;
			} else {
				onboarding = {
					enabled: true,
					formDone,
					step2,
					done,
					completedAt,
					submittedAt: intakeRow?.submittedAt ?? null,
				};
			}
		}

		/* ── Pas du jour (une valeur par jour, modifiable) ── */
		const stepsTodayRow = stepsRows.find((s) => s.date === day) ?? null;
		const stepGoal = goalsRow?.stepGoal ?? null;

		/* ── Rappel 12 h du prochain rendez-vous (état DÉRIVÉ, §29/§31) ──
		   Source de vérité : le rendez-vous G-FLUX confirmé (startAt + status).
		   Aucune donnée de rappel indépendante : la carte Accueil et le badge
		   apparaissent dès que now ∈ [startAt − 12 h, startAt[ et disparaissent
		   si le RDV est annulé / passé / replanifié hors fenêtre (recalcul
		   automatique sur le nouveau startAt). Indépendant du push (§24). */
		const apptRows = await ctx.db
			.query("appointments")
			.withIndex("by_client", (q) => q.eq("clientId", user._id))
			.order("desc")
			.take(100);
		let appointmentReminder: {
			appointmentId: string;
			date: string;
			time: string;
			endTime: string;
			kind: string;
			startAtMs: number;
			bookingSource: "coach" | "client" | null;
		} | null = null;
		// Le PLUS PROCHE rendez-vous futur confirmé (jamais un autre, jamais un
		// RDV annulé ni passé), puis test de la fenêtre 12 h sur lui seul.
		let nextStartMs = Number.POSITIVE_INFINITY;
		let nextAppt: Doc<"appointments"> | null = null;
		for (const a of apptRows) {
			if (a.status !== "on_book") continue; // annulé → jamais de rappel (§28)
			const startAtMs = wallTimeToUtcMs(a.date, a.time, "Europe/Paris");
			if (!Number.isFinite(startAtMs)) continue;
			if (startAtMs <= ts || startAtMs >= nextStartMs) continue;
			nextStartMs = startAtMs;
			nextAppt = a;
		}
		if (nextAppt && nextStartMs - ts <= 12 * 3600 * 1000) {
			appointmentReminder = {
				appointmentId: nextAppt._id,
				date: nextAppt.date,
				time: nextAppt.time,
				endTime: nextAppt.endTime,
				kind: nextAppt.kind,
				startAtMs: nextStartMs,
				bookingSource: nextAppt.bookingSource ?? null,
			};
		}

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
			appointmentReminder,
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
				/** État réel de l'échéance (le report ne l'efface jamais) — usage : logique métier, pas l'affichage. */
				measurementsDue,
				photosDue,
				/** État affiché : carte masquée pendant le « Me le rappeler plus tard » (48 h). */
				measurementsDueShown,
				photosDueShown,
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
				// « progression » = échéances affichées (mensurations + photos) : les
				// reports « Me le rappeler plus tard » (48 h) débranche aussi le badge.
				progression: (measurementsDueShown ? 1 : 0) + (photosDueShown ? 1 : 0),
				// « reminder » = information importante disponible sur l'Accueil
				// (rappel rendez-vous dans la fenêtre 12 h) — badge Accueil (§21).
				reminder: appointmentReminder ? 1 : 0,
			},
		};
	},
});


/** Durée du « Me le rappeler plus tard » : 48 h. */
const SNOOZE_MS = 48 * 60 * 60 * 1000;

/**
 * « Me le rappeler plus tard » (carte Mensurations ou Photos de l'Accueil).
 *
 * Le report ne modifie JAMAIS l'échéance elle-même (15 jours / 1 mois, calculée
 * date à date depuis le démarrage) : il masque uniquement l'affichage — carte +
 * badge de l'icône PWA — pendant 48 h, et débranche les rappels push liés.
 * Après le délai, si l'action n'est toujours pas faite, carte + badge
 * réapparaissent d'eux-mêmes ; si elle a été faite entre-temps, l'échéance est
 * déjà tombée à false et rien ne revient. Idempotent : reporter prolonge
 * simplement l'horodatage de 48 h à partir de maintenant.
 */
export const snoozeProgressionReminder = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		/** Carte visée : "mensurations" ou "photos". */
		reminder: v.union(v.literal("mensurations"), v.literal("photos")),
	},
	handler: async (ctx, { sessionToken, reminder }) => {
		const user = await requireClient(ctx, sessionToken);
		const patch =
			reminder === "mensurations"
				? { measurementsSnoozeUntil: Date.now() + SNOOZE_MS }
				: { photosSnoozeUntil: Date.now() + SNOOZE_MS };
		await ctx.db.patch(user._id, patch);
		return { ok: true };
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

/* ═══ Message global coach → toutes les clientes actives (Tableau de bord) ═══
 *
 * Côté cliente, RIEN ne change : chez chacune on étampe exactement les mêmes
 * champs que la Vision 360 (coachMessage / At / ExpiresAt / ReadAt / AudioId) —
 * la carte Accueil, le badge « Messages », le journal et le « Vu » se
 * comportent à l'identique d'un message classique. Toute la différence vit
 * côté CRM : une seule ligne coachBroadcasts par envoi, un envoi à toutes les
 * clientes actives, un retrait immédiat possible et une disparition du bloc
 * CRM après 24 h. Aucun doublon d'envoi : la publication est transactionnelle
 * (un seul appel inscrit tout le monde) et un message global actif bloque un
 * nouvel envoi tant qu'il n'est pas retiré.
 */

/** Ligne de journal CRM du message global (une par destinataire, étiquetée). */
type BroadcastLogInsert = {
	userId: Id<"users">;
	text: string;
	publishedAt: number;
	publishedDay: string;
	readAt: undefined;
	broadcastId: Id<"coachBroadcasts">;
};

/**
 * Étampe le message global chez UNE cliente — exactement les mêmes champs que
 * la publication personnelle (setCoachMessage), avec l'horodatage de la
 * publication globale (uniforme pour toutes, et clé du retrait ciblé).
 * Retourne false si la cliente n'est pas servie : compte désactivé, ou
 * message personnel ENCORE ACTIF (jamais d'écrasement — le global ne complète
 * que les Accueils « libres » ; si le personnel expire avant le global, le
 * rattrapage la servira plus tard).
 */
async function stampBroadcastToClient(
	ctx: MutationCtx,
	b: { _id: Id<"coachBroadcasts">; text: string; publishedAt: number; publishedDay: string; expiresAt: number },
	u: Doc<"users">
): Promise<boolean> {
	if (u.disabled) return false;
	if (u.coachMessageAt != null && (u.coachMessageExpiresAt == null || Date.now() < u.coachMessageExpiresAt)) {
		return false;
	}
	// La carte de la cliente suit SON minuit local, mais meurt au plus tard
	// avec le message global (cohérence du retrait groupé).
	const tz = validTimeZone(u.timeZone) ?? "Europe/Paris";
	await ctx.db.patch(u._id, {
		coachMessage: b.text,
		coachMessageDate: b.publishedDay,
		coachMessageAt: b.publishedAt,
		coachMessageExpiresAt: Math.min(b.expiresAt, nextMidnightUtcMs(Date.now(), tz)),
		coachMessageReadAt: undefined,
		coachMessageAudioId: undefined,
	});
	const log: BroadcastLogInsert = {
		userId: u._id,
		text: b.text,
		publishedAt: b.publishedAt,
		publishedDay: b.publishedDay,
		readAt: undefined,
		broadcastId: b._id,
	};
	await ctx.db.insert("coachMessages", log);
	return true;
}

/** Dernier message global publié (null si aucun envoi). */
async function lastBroadcast(ctx: QueryCtx) {
	return await ctx.db
		.query("coachBroadcasts")
		.withIndex("by_published")
		.order("desc")
		.first();
}

/**
 * Envoie le message global à TOUTES les clientes actives (activité des
 * 5 derniers jours). Réservé à la coach. Retourne les destinataires
 * réellement servis : côté SvelteKit, chacun reçoit LA MÊME notification
 * push qu'un message classique.
 */
export const sendCoachBroadcast = mutation({
	args: { sessionToken: v.optional(v.string()), message: v.string() },
	handler: async (ctx, { sessionToken, message }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") {
			throw new ConvexError("Réservé à la coach (CRM).");
		}
		const trimmed = message.trim().slice(0, 500);
		if (!trimmed) throw new ConvexError("Le message est vide.");

		const now = Date.now();
		const current = await lastBroadcast(ctx);
		// Anti-doublon : un message global actif (24 h, non retiré) bloque un
		// nouvel envoi — il faut d'abord le retirer pour en publier un autre.
		if (current && current.withdrawnAt == null && now < current.expiresAt) {
			throw new ConvexError(
				"Un message global est déjà actif — retire-le d'abord pour en publier un nouveau."
			);
		}

		// Fuseau de référence pour l'échéance affichée côté CRM ; chaque cliente
		// reste fidèle à SON minuit local (voir stampBroadcastToClient).
		const tz = validTimeZone(coach.timeZone) ?? "Europe/Paris";
		const broadcast = {
			text: trimmed,
			publishedAt: now,
			publishedDay: localTodayISO(new Date(now)),
			expiresAt: nextMidnightUtcMs(now, tz),
		};
		// Le précédent (expiré) est archivé tel quel ; un éventuel résidu non
		// retiré l'est ici — jamais deux messages globaux actifs en même temps.
		if (current && current.withdrawnAt == null) {
			await ctx.db.patch(current._id, { withdrawnAt: now });
		}

		const broadcastId = await ctx.db.insert("coachBroadcasts", {
			...broadcast,
			timeZone: tz,
			sentTo: [],
		});

		// Fenêtre d'activité : 5 derniers jours.
		const activeIds = (
			await ctx.db
				.query("users")
				.filter((q) => q.eq(q.field("role"), "client"))
				.collect()
		)
			.filter((u) => (u.lastSeenAt ?? 0) >= now - 5 * 24 * 3600 * 1000)
			.map((u) => u._id);
		const sentTo: Id<"users">[] = [];
		for (const userId of activeIds) {
			const u = await ctx.db.get(userId);
			if (u && (await stampBroadcastToClient(ctx, { ...broadcast, _id: broadcastId }, u))) {
				sentTo.push(userId);
			}
		}
		await ctx.db.patch(broadcastId, { sentTo });
		return { ok: true, count: sentTo.length, sentTo };
	},
});

/**
 * Retrait immédiat du message global actif (bouton CRM « Retirer ») : les
 * champs actifs sont effacés chez chaque destinataire et les lignes du journal
 * CRM correspondantes disparaissent — exactement comme l'éphémère automatique,
 * mais tout de suite. Une cliente qui aurait déjà publié un message personnel
 * depuis n'est pas touchée (on ne retire que CE message global).
 */
export const withdrawCoachBroadcast = mutation({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") {
			throw new ConvexError("Réservé à la coach (CRM).");
		}
		const current = await lastBroadcast(ctx);
		if (!current || current.withdrawnAt != null) return { ok: true, removed: 0 };
		const now = Date.now();
		for (const userId of current.sentTo) {
			const u = await ctx.db.get(userId);
			if (u && u.coachMessageAt === current.publishedAt) {
				await ctx.db.patch(userId, {
					coachMessage: undefined,
					coachMessageDate: undefined,
					coachMessageAt: undefined,
					coachMessageExpiresAt: undefined,
					coachMessageReadAt: undefined,
					coachMessageAudioId: undefined,
				});
			}
		}
		const rows = await ctx.db
			.query("coachMessages")
			.withIndex("by_broadcast", (q) => q.eq("broadcastId", current._id))
			.collect();
		for (const row of rows) await ctx.db.delete(row._id);
		await ctx.db.patch(current._id, { withdrawnAt: now });
		return { ok: true, removed: current.sentTo.length };
	},
});

/**
 * État du message global pour le CRM (Tableau de bord) : actif pendant 24 h
 * (minuit local de référence) tant qu'il n'est pas retiré, avec le nombre de
 * destinataires et de lectures réelles. Jamais de mutation ici : l'affichage
 * CRM ne déclenche aucun envoi caché.
 */
export const activeCoachBroadcast = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") return null;
		const current = await lastBroadcast(ctx);
		const now = Date.now();
		if (!current || current.withdrawnAt != null || now >= current.expiresAt) return null;
		const rows = await ctx.db
			.query("coachMessages")
			.withIndex("by_broadcast", (q) => q.eq("broadcastId", current._id))
			.collect();
		return {
			_id: current._id,
			text: current.text,
			publishedAt: current.publishedAt,
			publishedDay: current.publishedDay,
			expiresAt: current.expiresAt,
			recipientCount: current.sentTo.length,
			readCount: rows.filter((r) => r.readAt != null).length,
		};
	},
});

/**
 * Rattrapage du message global (cron 5 min) : les clientes devenues actives
 * APRÈS la publication reçoivent le même étampage à leur prochaine visite.
 * Aucun effet quand aucun message global n'est actif (une seule lecture
 * indexée) — et jamais de doublon : sentTo est la mémoire des servies.
 */
export const coachBroadcastCatchUp = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const current = await lastBroadcast(ctx);
		if (!current || current.withdrawnAt != null || now >= current.expiresAt) {
			return { stamped: 0 };
		}
		const have = new Set<Id<"users">>(current.sentTo);
		const clients = await ctx.db
			.query("users")
			.filter((q) => q.eq(q.field("role"), "client"))
			.collect();
		const fresh: Id<"users">[] = [];
		for (const u of clients) {
			if (have.has(u._id)) continue;
			// Seulement les clientes réellement actives depuis la publication.
			if ((u.lastSeenAt ?? 0) < current.publishedAt) continue;
			if (await stampBroadcastToClient(ctx, current, u)) fresh.push(u._id);
		}
		if (fresh.length > 0) {
			await ctx.db.patch(current._id, { sentTo: [...current.sentTo, ...fresh] });
		}
		return { stamped: fresh.length };
	},
});