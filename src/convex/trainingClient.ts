/**
 * Module Entraînement — CÔTÉ CLIENTE (espace /espace/entrainement).
 *
 * La cliente lit ses séances planifiées, réalise sa séance (mode libre OU
 * guidé — les deux passent par LES MÊMES mutations d'écriture), termine sa
 * séance et consulte sa progression par exercice.
 *
 * Règles non négociables :
 * - les séries/logs sont en snapshot (jamais réécrits par un changement de
 *   programme) — `trainingSetLogs` est la seule source d'historique ;
 * - une séance réalisée n'est jamais modifiable après coup (statut completed) ;
 * - « terminer même partiellement » est un droit : aucune série n'est exigée.
 */

import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser, localTodayISO, mondayISOof, addDaysISO } from "./helpers";
import { lastKnownWeight } from "./sport";
import {
	GFLUX_SESSION_ACTIVITY_ID,
	GFLUX_SESSION_INTENSITY,
	estimateSportActivity,
} from "./sportCatalog";

/* ── Phases ── */

export const PHASE_LABELS: Record<string, string> = {
	echauffement: "Échauffement",
	principal: "Entraînement principal",
	finisher: "Finisher",
};

const PHASE_ORDER: Record<string, number> = {
	echauffement: 0,
	principal: 1,
	finisher: 2,
};

const MAX_NOTES_LENGTH = 500;

async function requireClient(ctx: Parameters<typeof getSessionUser>[0], sessionToken?: string | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") throw new ConvexError("Cette page est réservée à l'espace cliente.");
	return user;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidISO(s: string): boolean {
	return ISO_RE.test(s);
}

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

/* ═══════════ Semaine de la cliente ═══════════ */

/**
 * Vue semaine de l'espace Entraînement : 7 jours (lundi → dimanche) avec
 * indicateur de séance, séance sélectionnable, prochaine séance identifiable.
 * Le front passe `weekStart` (lundi ISO) — défaut : semaine courante.
 */
export const myWeek = query({
	args: {
		sessionToken: v.optional(v.string()),
		/** Lundi de la semaine affichée "yyyy-mm-dd" (défaut : semaine en cours). */
		weekStart: v.optional(v.string()),
	},
	handler: async (ctx, { sessionToken, weekStart }) => {
		const user = await requireClient(ctx, sessionToken);
		const today = localTodayISO();
		const start = weekStart && isValidISO(weekStart) ? weekStart : mondayISOof(today);
		const end = addDaysISO(start, 6);

		const sched = await ctx.db
			.query("trainingScheduledSessions")
			.withIndex("by_user_date", (q) => q.eq("userId", user._id).gte("date", start).lte("date", end))
			.collect();
		const live = sched.filter((s) => s.status !== "cancelled").sort((a, b) => a._creationTime - b._creationTime);

		const items = await Promise.all(
			live.map(async (s) => {
				const ses = await ctx.db.get(s.sessionId);
				return {
					_id: s._id,
					date: s.date,
					status: s.status,
					/** Commencée (bouton « Commencer la séance ») mais non finalisée. */
					startedAt: s.startedAt ?? null,
					/** « Je n'ai pas réalisé cette séance » — terminée sans dépense. */
					skippedAt: s.skippedAt ?? null,
					name: ses?.name ?? "Séance",
				};
			})
		);

		// Prochaine séance : première planned ≥ aujourd'hui, toutes semaines confondues.
		const upcoming = await ctx.db
			.query("trainingScheduledSessions")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.collect();
		const next = upcoming
			.filter((s) => s.status === "planned" && s.date >= today)
			.sort((a, b) => a.date.localeCompare(b.date) || a._creationTime - b._creationTime)[0];
		let nextSession: { _id: string; date: string; name: string } | null = null;
		if (next) {
			const ses = await ctx.db.get(next.sessionId);
			nextSession = { _id: next._id, date: next.date, name: ses?.name ?? "Séance" };
		}

		return {
			weekStart: start,
			today,
			days: items,
			nextSession,
		};
	},
});

/* ═══════════ Vue d'une séance (les deux modes) ═══════════ */

/**
 * Vue complète d'une séance planifiée : programme (nom, phases), exercices
 * avec fiche bibliothèque, prescription par série, et POUR CHAQUE exercice la
 * dernière performance de la cliente (pré-remplissage charges/reps).
 * Sert au mode libre ET au mode guidé — une seule source de vérité.
 */
export const scheduledSession = query({
	args: {
		sessionToken: v.optional(v.string()),
		scheduledId: v.id("trainingScheduledSessions"),
	},
	handler: async (ctx, { sessionToken, scheduledId }) => {
		const user = await requireClient(ctx, sessionToken);
		const s = await ctx.db.get(scheduledId);
		if (!s || s.userId !== user._id) throw new ConvexError("Séance introuvable.");
		const ses = await ctx.db.get(s.sessionId);
		if (!ses) throw new ConvexError("Séance introuvable (programme modifié).");

		const sesEx = await ctx.db
			.query("trainingSessionExercises")
			.withIndex("by_session", (q) => q.eq("sessionId", s.sessionId))
			.collect();
		sesEx.sort((a, b) => a.order - b.order);

		// Toutes les séries déjà saisies pour CETTE occurrence (reprise après
		// interruption + calcul du résumé) — une seule lecture.
		const existingLogs = await ctx.db
			.query("trainingSetLogs")
			.withIndex("by_session", (q) => q.eq("scheduledSessionId", scheduledId))
			.collect();

		// Dernière performance réelle par exercice (toutes séances confondues).
		const lastByExercise = new Map<
			string,
			{ date: string; reps: number | null; weightKg: number | null; durationSeconds: number | null }
		>();
		for (const se of sesEx) {
			const prev = await ctx.db
				.query("trainingSetLogs")
				.withIndex("by_user_exercise", (q) => q.eq("userId", user._id).eq("exerciseId", se.exerciseId))
				.order("desc")
				.first();
			if (prev && prev.done) {
				lastByExercise.set(se._id, {
					date: prev.date,
					reps: prev.reps ?? null,
					weightKg: prev.weightKg ?? null,
					durationSeconds: prev.durationSeconds ?? null,
				});
			}
		}

		const exercises = await Promise.all(
			sesEx.map(async (se) => {
				const ex = await ctx.db.get(se.exerciseId);
				const sets = await ctx.db
					.query("trainingSets")
					.withIndex("by_sessionExercise", (q) => q.eq("sessionExerciseId", se._id))
					.collect();
				sets.sort((a, b) => a.order - b.order);

				// Séries déjà saisies pour CET exercice dans CETTE occurrence.
				const mine = existingLogs.filter((l) => l.exerciseId === se.exerciseId).sort((a, b) => a.setOrder - b.setOrder);

				const last = lastByExercise.get(se._id) ?? null;
				return {
					_id: se._id,
					order: se.order,
					mode: se.mode,
					phase: se.phase ?? "principal",
					tempo: se.tempo ?? null,
					coachNote: se.coachNote ?? null,
					techniqueNote: se.techniqueNote ?? null,
					exercise: ex
						? {
								_id: ex._id,
								gfluxExerciseId: ex.gfluxExerciseId,
								name: ex.name,
								muscleGroup: ex.muscleGroup ?? null,
								equipment: ex.equipment ?? null,
								mediaUrl: ex.mediaUrl ?? null,
								posterUrl: ex.posterUrl ?? null,
								animationUrl: ex.animationUrl ?? null,
								instructions: ex.instructions ?? null,
							}
						: null,
					sets: sets.map((st) => ({
						order: st.order,
						repsMin: st.repsMin ?? null,
						repsMax: st.repsMax ?? null,
						targetWeight: st.targetWeight ?? null,
						targetRir: st.targetRir ?? null,
						restSeconds: st.restSeconds ?? null,
						durationSeconds: st.durationSeconds ?? null,
					})),
					// Pré-remplissage : objectif reps (médiane de la plage) + dernière charge.
					lastPerformance: last,
					suggestedReps: sets[0] ? (sets[0].repsMin ?? sets[0].repsMax ?? null) : null,
					suggestedWeight: last?.weightKg ?? sets[0]?.targetWeight ?? null,
					loggedSets: mine.map((l) => ({
						setOrder: l.setOrder,
						reps: l.reps ?? null,
						weightKg: l.weightKg ?? null,
						durationSeconds: l.durationSeconds ?? null,
						done: l.done,
					})),
					isFirstTime: !last,
				};
			})
		);

		// Durée estimée : somme (durée série ou ~45 s/serie reps) + repos.
		let estimatedMin = 0;
		for (const e of exercises) {
			for (const st of e.sets) {
				estimatedMin += ((e.mode === "time" ? st.durationSeconds ?? 60 : 45) + (st.restSeconds ?? 0)) / 60;
			}
		}

		const program = await ctx.db.get(ses.programId);

		return {
			scheduled: {
				_id: s._id,
				date: s.date,
				status: s.status,
				completedAt: s.completedAt ?? null,
				durationMin: s.durationMin ?? null,
				/** Démarrage réel (bouton « Commencer ») — base de la durée mesurée. */
				startedAt: s.startedAt ?? null,
				/** Clôturée sans réalisation (« Je n'ai pas réalisé cette séance »). */
				skippedAt: s.skippedAt ?? null,
				durationSource: s.durationSource ?? null,
				difficulty: s.difficulty ?? null,
				note: s.note ?? null,
			},
			session: { _id: ses._id, name: ses.name },
			programName: program?.name ?? null,
			estimatedMin: Math.max(5, Math.round(estimatedMin)),
			exercises,
		};
	},
});

/* ═══════════ Écriture d'une série (LES DEUX MODES) ═══════════ */

/**
 * Enregistre UNE série réalisée. Appelée par le mode libre (case cochée /
 * champs remplis) ET par le mode guidé (« Série terminée ») — exactement la
 * même écriture, le même historique. Idempotent par (occurrence, exercice,
 * n° de série) : réenregistrer remplace les valeurs, jamais de doublon.
 */
export const logSet = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		scheduledId: v.id("trainingScheduledSessions"),
		/** Exercice de la séance (copie du programme assigné). */
		sessionExerciseId: v.id("trainingSessionExercises"),
		setOrder: v.number(),
		reps: v.optional(v.number()),
		weightKg: v.optional(v.number()),
		durationSeconds: v.optional(v.number()),
		done: v.boolean(),
	},
	handler: async (
		ctx,
		{ sessionToken, scheduledId, sessionExerciseId, setOrder, reps, weightKg, durationSeconds, done }
	) => {
		const user = await requireClient(ctx, sessionToken);
		const s = await ctx.db.get(scheduledId);
		if (!s || s.userId !== user._id) throw new ConvexError("Séance introuvable.");
		if (s.status === "completed") throw new ConvexError("Séance déjà terminée — l'historique est verrouillé.");
		const se = await ctx.db.get(sessionExerciseId);
		if (!se) throw new ConvexError("Exercice introuvable.");
		// L'exercice appartient bien à la séance planifiée (via la copie du programme).
		const ses = await ctx.db.get(se.sessionId);
		if (!ses || ses._id !== s.sessionId) throw new ConvexError("Exercice hors de cette séance.");

		if (setOrder < 0 || setOrder > 30) throw new ConvexError("Numéro de série invalide.");
		const clampW = (w: number | undefined) =>
			w === undefined ? undefined : round1(Math.min(Math.max(w, 0), 500));
		const clampR = (r: number | undefined) =>
			r === undefined ? undefined : Math.round(Math.min(Math.max(r, 0), 500));
		const clampD = (d: number | undefined) =>
			d === undefined ? undefined : Math.round(Math.min(Math.max(d, 1), 7200));

		const ex = await ctx.db.get(se.exerciseId);
		const sets = await ctx.db
			.query("trainingSets")
			.withIndex("by_sessionExercise", (q) => q.eq("sessionExerciseId", se._id))
			.collect();
		sets.sort((a, b) => a.order - b.order);
		const target = sets.find((st) => st.order === setOrder) ?? sets[0];

		// Snapshot complet à l'écriture (l'historique ne dépend plus du programme).
		const base = {
			userId: user._id,
			scheduledSessionId: scheduledId,
			exerciseId: se.exerciseId,
			gfluxExerciseId: ex?.gfluxExerciseId,
			exerciseName: ex?.name ?? "Exercice",
			mediaUrl: ex?.mediaUrl,
			posterUrl: ex?.posterUrl,
			mode: se.mode,
			targetReps: target ? (target.repsMin ?? target.repsMax) : undefined,
			targetWeight: target?.targetWeight,
			targetDurationSeconds: target?.durationSeconds,
			reps: clampR(reps),
			weightKg: clampW(weightKg),
			durationSeconds: clampD(durationSeconds),
			done,
			setOrder,
			date: s.date,
			createdAt: Date.now(),
		};

		// Idempotence : (occurrence, exercice, série) → une seule ligne.
		const existing = await ctx.db
			.query("trainingSetLogs")
			.withIndex("by_session", (q) => q.eq("scheduledSessionId", scheduledId))
			.collect();
		const prev = existing.find((l) => l.exerciseId === se.exerciseId && l.setOrder === setOrder);
		if (prev) {
			await ctx.db.patch(prev._id, {
				reps: base.reps,
				weightKg: base.weightKg,
				durationSeconds: base.durationSeconds,
				done: base.done,
			});
			return { logId: prev._id };
		}
		const logId = await ctx.db.insert("trainingSetLogs", base);
		return { logId };
	},
});

/* ═══════════ Gestion du calendrier (••• côté cliente) ═══════════ */

/**
 * Déplace une occurrence planifiée (menu •••). Une séance réalisée n'est
 * JAMAIS modifiable — l'historique est figé ; une séance passée non réalisée
 * reste déplaçable (rattrapage).
 */
export const moveMySession = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		scheduledId: v.id("trainingScheduledSessions"),
		date: v.string(),
	},
	handler: async (ctx, { sessionToken, scheduledId, date }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidISO(date)) throw new ConvexError("Date invalide.");
		const s = await ctx.db.get(scheduledId);
		if (!s || s.userId !== user._id) throw new ConvexError("Séance introuvable.");
		if (s.status === "completed") throw new ConvexError("Une séance réalisée ne peut plus être déplacée.");
		await ctx.db.patch(scheduledId, { date });
		return { ok: true };
	},
});

/**
 * Duplique une occurrence planifiée (menu •••) : même séance, autre date —
 * la copie est une nouvelle occurrence planned, l'originale reste en place.
 */
export const duplicateMySession = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		scheduledId: v.id("trainingScheduledSessions"),
		date: v.string(),
	},
	handler: async (ctx, { sessionToken, scheduledId, date }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidISO(date)) throw new ConvexError("Date invalide.");
		const s = await ctx.db.get(scheduledId);
		if (!s || s.userId !== user._id) throw new ConvexError("Séance introuvable.");
		const id = await ctx.db.insert("trainingScheduledSessions", {
			userId: user._id,
			assignmentId: s.assignmentId,
			sessionId: s.sessionId,
			date,
			status: "planned",
			createdAt: Date.now(),
		});
		return { scheduledId: id };
	},
});

/**
 * Supprime (annule) une occurrence planifiée (menu •••). Jamais une séance
 * réalisée : l'historique sportif est intouchable. Une annulation reste en
 * base (statut cancelled) — traçabilité complète côté coach.
 */
export const deleteMySession = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		scheduledId: v.id("trainingScheduledSessions"),
	},
	handler: async (ctx, { sessionToken, scheduledId }) => {
		const user = await requireClient(ctx, sessionToken);
		const s = await ctx.db.get(scheduledId);
		if (!s || s.userId !== user._id) throw new ConvexError("Séance introuvable.");
		if (s.status === "completed") throw new ConvexError("Une séance réalisée ne peut pas être supprimée.");
		await ctx.db.patch(scheduledId, { status: "cancelled" });
		return { ok: true };
	},
});

/* ═══════════ Début & fin de séance ═══════════ */

/**
 * COMMENCE RÉELLEMENT la séance (bouton « Commencer la séance »).
 *
 * Ouvrir/consulter la séance ne fait RIEN :startedAt n'est posé que par ce
 * geste explicite — une séance simplement consultée ou aux séries cochées
 * sans démarrage n'est pas une séance en cours. Persisté côté backend : la
 * durée réelle (completedAt − startedAt) survit au verrouillage iPhone / PWA
 * en arrière-plan — jamais dépendante d'un chrono JavaScript.
 * Réidempotent : un second appel ne réarme pas le chronomètre.
 */
export const startSession = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		scheduledId: v.id("trainingScheduledSessions"),
	},
	handler: async (ctx, { sessionToken, scheduledId }) => {
		const user = await requireClient(ctx, sessionToken);
		const s = await ctx.db.get(scheduledId);
		if (!s || s.userId !== user._id) throw new ConvexError("Séance introuvable.");
		if (s.status === "completed") throw new ConvexError("Séance déjà terminée.");
		if (s.startedAt) return { ok: true, startedAt: s.startedAt };
		const now = Date.now();
		await ctx.db.patch(scheduledId, { startedAt: now });
		return { ok: true, startedAt: now };
	},
});

/**
 * TERMINE la séance (depuis le mode libre ou le guidé) : statut completed +
 * durée réelle + difficulté/note optionnelles. Autorisé même partiellement
 * renseignée — c'est la règle, pas une exception.
 *
 * NOUVEAU (module Dépense sportive) :
 * - `skipped: true` → « Je n'ai pas réalisé cette séance » : séance clôturée
 *   SANS dépense sportive (consultée / séries cochées, mais pas faite) ;
 * - sinon, et une seule fois : upsert idempotent de la dépense sportive
 *   (index by_trainingSession relu DANS la même transaction) — correction de
 *   durée → mise à jour de la ligne existante, JAMAIS un doublon. Une erreur
 *   de calcul de dépense ne bloque JAMAIS la fin de séance (écriture
 *   défensive) : Entraînement reste utilisable quoi qu'il arrive.
 */
export const completeSession = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		scheduledId: v.id("trainingScheduledSessions"),
		durationMin: v.optional(v.number()),
		difficulty: v.optional(v.number()),
		note: v.optional(v.string()),
		/** « Je n'ai pas réalisé cette séance » — clôture sans dépense sportive. */
		skipped: v.optional(v.boolean()),
	},
	handler: async (
		ctx,
		{ sessionToken, scheduledId, durationMin, difficulty, note, skipped }
	) => {
		const user = await requireClient(ctx, sessionToken);
		const s = await ctx.db.get(scheduledId);
		if (!s || s.userId !== user._id) throw new ConvexError("Séance introuvable.");
		if (s.status === "completed") return { ok: true };

		const patch: Record<string, unknown> = {
			status: "completed",
			completedAt: Date.now(),
		};
		// Démarrage réel absent → durée inconnue : la valeur passée est la saisie
		// MANUELLE de la cliente. startedAt présent → durée mesurée, la valeur
		// passée ne peut être qu'une CORRECTION (durationSource reste "tracked").
		if (durationMin !== undefined) {
			patch.durationMin = Math.round(Math.min(Math.max(durationMin, 0), 600));
			patch.durationSource = s.startedAt ? "tracked" : "manual";
		} else if (s.startedAt) {
			// Aucune durée passée mais un démarrage persisté : durée mesurée.
			patch.durationMin = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
			patch.durationSource = "tracked";
		}
		if (skipped) {
			patch.skippedAt = Date.now();
		}
		if (difficulty !== undefined) {
			patch.difficulty = Math.round(Math.min(Math.max(difficulty, 1), 5));
		}
		if (note !== undefined) {
			patch.note = note.trim().slice(0, MAX_NOTES_LENGTH) || undefined;
		}
		await ctx.db.patch(scheduledId, patch as never);

		// ── Dépense sportive automatique (jamais bloquante, jamais en doublon) ──
		if (!skipped && !patch.skippedAt) {
			try {
				const existing = await ctx.db
					.query("sportActivities")
					.withIndex("by_trainingSession", (q) => q.eq("trainingSessionId", scheduledId))
					.first();
				if (!existing) {
					const durationSource = (patch.durationSource as "tracked" | "manual" | undefined) ?? (s.startedAt ? "tracked" : "manual");
					const minutes = Math.max(1, Math.round((patch.durationMin as number | undefined) ?? 0));
					if (minutes > 0) {
						const weight = await lastKnownWeight(ctx, user._id);
						const est = estimateSportActivity({
							activityId: GFLUX_SESSION_ACTIVITY_ID,
							intensity: GFLUX_SESSION_INTENSITY,
							durationMinutes: minutes,
							weightKg: weight,
						});
						const now = Date.now();
						// Nom de la séance (snapshot) — repli : « Musculation ».
						const sesRow = await ctx.db.get(s.sessionId);
						await ctx.db.insert("sportActivities", {
							userId: user._id,
							// Date de la séance (pas du serveur) — cohérent avec la vue semaine.
							date: s.date,
							activityId: est.activityId,
							activityNameSnapshot: sesRow?.name ?? est.activityNameSnapshot,
							durationMinutes: minutes,
							intensity: GFLUX_SESSION_INTENSITY,
							metValue: est.metValue,
							coefficientSource: est.coefficientSource,
							coefficientVersion: est.coefficientVersion,
							...(weight != null ? { weightSnapshot: weight, estimatedCalories: est.estimatedCalories } : {}),
							metMinutes: est.metMinutes,
							source: "gflux_training",
							trainingSessionId: scheduledId,
							durationSource,
							createdAt: now,
							updatedAt: now,
						});
					}
				}
			} catch {
				// Défense : une erreur de calcul de dépense ne doit JAMAIS empêcher
				// l'utilisation d'Entraînement (règle de robustesse de la mission).
			}
		}

		return { ok: true };
	},
});

/**
 * CORRIGE la durée d'une séance terminée (écran « Confirmer la durée » puis
 * fiche séance) et met à jour la dépense sportive EXISTANTE — jamais une
 * deuxième (idempotence par trainingSessionId).
 */
export const updateSessionDuration = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		scheduledId: v.id("trainingScheduledSessions"),
		durationMin: v.number(),
	},
	handler: async (ctx, { sessionToken, scheduledId, durationMin }) => {
		const user = await requireClient(ctx, sessionToken);
		const s = await ctx.db.get(scheduledId);
		if (!s || s.userId !== user._id) throw new ConvexError("Séance introuvable.");
		if (s.status !== "completed") throw new ConvexError("La séance n'est pas terminée.");
		const minutes = Math.round(Math.min(Math.max(durationMin, 1), 600));
		await ctx.db.patch(scheduledId, {
			durationMin: minutes,
			durationSource: s.startedAt ? "tracked" : "manual",
		});
		// La dépense liée (si elle existe) est mise à jour, jamais dupliquée.
		const dep = await ctx.db
			.query("sportActivities")
			.withIndex("by_trainingSession", (q) => q.eq("trainingSessionId", scheduledId))
			.first();
		if (dep) {
			const weight = dep.weightSnapshot ?? (await lastKnownWeight(ctx, user._id));
			const est = estimateSportActivity({
				activityId: dep.activityId,
				intensity: dep.intensity,
				durationMinutes: minutes,
				weightKg: weight,
			});
			await ctx.db.patch(dep._id, {
				durationMinutes: minutes,
				metValue: est.metValue,
				metMinutes: est.metMinutes,
				...(weight != null ? { estimatedCalories: est.estimatedCalories } : {}),
				updatedAt: Date.now(),
			});
		}
		return { ok: true };
	},
});

/* ═══════════ Progression par exercice (cliente) ═══════════ */

/**
 * Historique d'un exercice pour la cliente : dernière perf, meilleure perf,
 * courbe (1 point/jour) et séries récentes — même moteur que côté coach.
 */
export const myExerciseHistory = query({
	args: {
		sessionToken: v.optional(v.string()),
		exerciseId: v.id("exercises"),
	},
	handler: async (ctx, { sessionToken, exerciseId }) => {
		const user = await requireClient(ctx, sessionToken);
		const rows = await ctx.db
			.query("trainingSetLogs")
			.withIndex("by_user_exercise", (q) => q.eq("userId", user._id).eq("exerciseId", exerciseId))
			.collect();
		const done = rows.filter((r) => r.done).sort((a, b) => a.date.localeCompare(b.date) || a._creationTime - b._creationTime);
		let last: (typeof done)[number] | null = null;
		let best: (typeof done)[number] | null = null;
		for (const r of done) {
			last = r;
			if (!best) best = r;
			else if ((r.weightKg ?? -1) > (best.weightKg ?? -1)) best = r;
		}
		const byDay = new Map<string, number | null>();
		for (const r of done) {
			const w = r.weightKg ?? null;
			const cur = byDay.get(r.date);
			if (cur == null || (w != null && w > cur)) byDay.set(r.date, w);
		}
		return {
			last: last
				? { date: last.date, reps: last.reps ?? null, weightKg: last.weightKg ?? null, durationSeconds: last.durationSeconds ?? null, mode: last.mode }
				: null,
			best: best
				? { date: best.date, reps: best.reps ?? null, weightKg: best.weightKg ?? null, durationSeconds: best.durationSeconds ?? null, mode: best.mode }
				: null,
			timeline: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, weightKg]) => ({ date, weightKg })),
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

/**
 * Index des exercices que la cliente a réellement tracés (progression).
 */
export const myTrackedExercises = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireClient(ctx, sessionToken);
		const rows = await ctx.db
			.query("trainingSetLogs")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.collect();
		const map = new Map<
			string,
			{ exerciseId: string; gfluxExerciseId: string | null; name: string; sets: number; lastDate: string; lastWeight: number | null; bestWeight: number | null }
		>();
		for (const r of rows) {
			if (!r.done) continue;
			const cur = map.get(r.exerciseId) ?? {
				exerciseId: r.exerciseId,
				gfluxExerciseId: r.gfluxExerciseId ?? null,
				name: r.exerciseName,
				sets: 0,
				lastDate: r.date,
				lastWeight: null as number | null,
				bestWeight: null as number | null,
			};
			cur.sets += 1;
			if (r.date > cur.lastDate) cur.lastDate = r.date;
			if (r.weightKg != null) {
				cur.lastWeight = r.weightKg;
				if (cur.bestWeight == null || r.weightKg > cur.bestWeight) cur.bestWeight = r.weightKg;
			}
			map.set(r.exerciseId, cur);
		}
		return { exercises: [...map.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate)) };
	},
});

/** Historique des séances réalisées (cliente) — résumé simple. */
export const mySessionHistory = query({
	args: { sessionToken: v.optional(v.string()), limit: v.optional(v.number()) },
	handler: async (ctx, { sessionToken, limit }) => {
		const user = await requireClient(ctx, sessionToken);
		const max = Math.min(Math.max(limit ?? 20, 1), 60);
		const rows = await ctx.db
			.query("trainingScheduledSessions")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.collect();
		const done = rows.filter((s) => s.status === "completed").sort((a, b) => b.date.localeCompare(a.date));
		const out = await Promise.all(
			done.slice(0, max).map(async (s) => {
				const ses = await ctx.db.get(s.sessionId);
				const logs = await ctx.db
					.query("trainingSetLogs")
					.withIndex("by_session", (q) => q.eq("scheduledSessionId", s._id))
					.collect();
				const doneLogs = logs.filter((l) => l.done);
				const volume = doneLogs.reduce((sum, l) => sum + (l.weightKg ?? 0) * (l.reps ?? 0), 0);
				return {
					_id: s._id,
					date: s.date,
					name: ses?.name ?? "Séance",
					durationMin: s.durationMin ?? null,
					difficulty: s.difficulty ?? null,
					note: s.note ?? null,
					setsDone: doneLogs.length,
					volumeKg: round1(volume) || null,
				};
			})
		);
		return { sessions: out };
	},
});
