/**
 * Module Entraînement — CRM coach (programmes → séances → exercices → séries).
 *
 * Principe : un programme référence les exercices de la bibliothèque interne
 * G-FLUX (`exercises._id`, donc le modèle normalisé — jamais une source
 * externe). Toute la prescription (mode, tempo, notes, séries) vit dans les
 * tables de ce module : remplacer la banque d'exercices ne touche jamais un
 * programme existant.
 *
 * Accès : tout passe par la session (jeton transmis par le BFF SvelteKit —
 * le navigateur n'appelle jamais Convex directement). Chaque mutation vérifie
 * la propriété du programme (coachId) en remontant la chaîne program →
 * session → exercice de séance → série.
 *
 * Les ordres sont des entiers contigus 0..n-1 : le drag & drop (et toute
 * insertion/duplication/suppression) renormalise les ordres en un lot —
 * simple, déterministe, aucun trou.
 */

import { query, mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import { programGoal, programLevel } from "./schema";

/* ── Référentiels affichables (l'UI ne code jamais les libellés en dur) ── */

export const PROGRAM_GOALS: Record<string, string> = {
	hypertrophie: "Hypertrophie",
	perte_de_gras: "Perte de gras",
	remise_en_forme: "Remise en forme",
	force: "Force",
	autre: "Autre",
};

export const PROGRAM_LEVELS: Record<string, string> = {
	debutante: "Débutante",
	intermediaire: "Intermédiaire",
	avancee: "Avancée",
};

/* ── Garde-fous de prescription ── */

const MAX_SESSIONS_PER_PROGRAM = 20;
const MAX_EXERCISES_PER_SESSION = 30;
const MAX_SETS_PER_EXERCISE = 12;

function clampInt(n: number, min: number, max: number, label: string): number {
	if (!Number.isFinite(n)) throw new ConvexError(`${label} : valeur invalide.`);
	const r = Math.round(n);
	if (r < min || r > max) throw new ConvexError(`${label} : doit être entre ${min} et ${max}.`);
	return r;
}

/* ── Résolution de propriété (program → session → exercice → série) ── */

type AnyCtx = QueryCtx | MutationCtx;

async function requireCoach(ctx: AnyCtx, sessionToken?: string): Promise<Doc<"users">> {
	const coach = await getSessionUser(ctx, sessionToken);
	if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (CRM).");
	return coach;
}

async function requireProgram(
	ctx: AnyCtx,
	coachId: Id<"users">,
	programId: Id<"trainingPrograms">
): Promise<Doc<"trainingPrograms">> {
	const p = await ctx.db.get(programId);
	if (!p || p.coachId !== coachId) throw new ConvexError("Programme introuvable.");
	return p;
}

async function requireSession(
	ctx: AnyCtx,
	coachId: Id<"users">,
	sessionId: Id<"trainingSessions">
): Promise<Doc<"trainingSessions">> {
	const s = await ctx.db.get(sessionId);
	if (!s) throw new ConvexError("Séance introuvable.");
	await requireProgram(ctx, coachId, s.programId);
	return s;
}

async function requireSessionExercise(
	ctx: AnyCtx,
	coachId: Id<"users">,
	id: Id<"trainingSessionExercises">
): Promise<Doc<"trainingSessionExercises">> {
	const se = await ctx.db.get(id);
	if (!se) throw new ConvexError("Exercice introuvable dans la séance.");
	await requireSession(ctx, coachId, se.sessionId);
	return se;
}

async function requireSet(
	ctx: AnyCtx,
	coachId: Id<"users">,
	setId: Id<"trainingSets">
): Promise<Doc<"trainingSets">> {
	const set = await ctx.db.get(setId);
	if (!set) throw new ConvexError("Série introuvable.");
	await requireSessionExercise(ctx, coachId, set.sessionExerciseId);
	return set;
}

/* ── Normalisation des ordres ── */

async function renormalizeSessionOrders(ctx: MutationCtx, programId: Id<"trainingPrograms">) {
	const rows = await ctx.db
		.query("trainingSessions")
		.withIndex("by_program", (q) => q.eq("programId", programId))
		.collect();
	rows.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
	await Promise.all(rows.map((r, i) => (r.order === i ? null : ctx.db.patch(r._id, { order: i }))));
}

async function renormalizeExerciseOrders(ctx: MutationCtx, sessionId: Id<"trainingSessions">) {
	const rows = await ctx.db
		.query("trainingSessionExercises")
		.withIndex("by_session", (q) => q.eq("sessionId", sessionId))
		.collect();
	rows.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
	await Promise.all(rows.map((r, i) => (r.order === i ? null : ctx.db.patch(r._id, { order: i }))));
}

async function renormalizeSetOrders(ctx: MutationCtx, sessionExerciseId: Id<"trainingSessionExercises">) {
	const rows = await ctx.db
		.query("trainingSets")
		.withIndex("by_sessionExercise", (q) => q.eq("sessionExerciseId", sessionExerciseId))
		.collect();
	rows.sort((a, b) => a.order - b.order || a._creationTime - b._creationTime);
	await Promise.all(rows.map((r, i) => (r.order === i ? null : ctx.db.patch(r._id, { order: i }))));
}

/* ── Cascades de suppression (programmes/séances/exercices uniquement) ── */

async function deleteSessionExerciseCascade(ctx: MutationCtx, id: Id<"trainingSessionExercises">) {
	const sets = await ctx.db
		.query("trainingSets")
		.withIndex("by_sessionExercise", (q) => q.eq("sessionExerciseId", id))
		.collect();
	await Promise.all(sets.map((s) => ctx.db.delete(s._id)));
	await ctx.db.delete(id);
}

async function deleteSessionCascade(ctx: MutationCtx, sessionId: Id<"trainingSessions">) {
	const ses = await ctx.db
		.query("trainingSessionExercises")
		.withIndex("by_session", (q) => q.eq("sessionId", sessionId))
		.collect();
	await Promise.all(ses.map((se) => deleteSessionExerciseCascade(ctx, se._id)));
	await ctx.db.delete(sessionId);
}

async function deleteProgramCascade(ctx: MutationCtx, programId: Id<"trainingPrograms">) {
	const sessions = await ctx.db
		.query("trainingSessions")
		.withIndex("by_program", (q) => q.eq("programId", programId))
		.collect();
	await Promise.all(sessions.map((s) => deleteSessionCascade(ctx, s._id)));
	await ctx.db.delete(programId);
}

/* ═══════════ Image de couverture (Convex file storage) ═══════════ */

/** URL d'upload courte durée pour l'image d'un programme (le BFF poste le fichier). */
export const generateImageUploadUrl = mutation({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		await requireCoach(ctx, sessionToken);
		return await ctx.storage.generateUploadUrl();
	},
});

/* ═══════════ Programmes — lectures ═══════════ */

/** Liste des programmes du coach + nombre de séances par programme. */
export const listPrograms = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const rows = await ctx.db
			.query("trainingPrograms")
			.withIndex("by_coach_updated", (q) => q.eq("coachId", coach._id))
			.order("desc")
			.collect();
		return Promise.all(
			rows.map(async (p) => {
				const sessions = await ctx.db
					.query("trainingSessions")
					.withIndex("by_program", (q) => q.eq("programId", p._id))
					.collect();
				const imageUrl = p.imageStorageId ? await ctx.storage.getUrl(p.imageStorageId) : undefined;
				return {
					_id: p._id,
					name: p.name,
					description: p.description,
					goal: p.goal,
					goalLabel: p.goal ? (PROGRAM_GOALS[p.goal] ?? p.goal) : undefined,
					level: p.level,
					levelLabel: p.level ? (PROGRAM_LEVELS[p.level] ?? p.level) : undefined,
					sessionsPerWeek: p.sessionsPerWeek,
					sessionCount: sessions.length,
					imageStorageId: p.imageStorageId,
					imageUrl: imageUrl ?? undefined,
					createdAt: p.createdAt,
					updatedAt: p.updatedAt,
				};
			})
		);
	},
});

/**
 * Programme complet (éditeur) : programme + séances + exercices (avec la
 * fiche bibliothèque jointe) + séries. Une seule lecture reconstruit tout
 * l'état de l'éditeur — le front recharge cet appel après chaque action
 * structurelle (fiabilité) et pilote l'autosave par mutations ciblées.
 */
export const programFull = query({
	args: { sessionToken: v.optional(v.string()), programId: v.id("trainingPrograms") },
	handler: async (ctx, { sessionToken, programId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const p = await requireProgram(ctx, coach._id, programId);

		const sessions = await ctx.db
			.query("trainingSessions")
			.withIndex("by_program", (q) => q.eq("programId", p._id))
			.collect();
		sessions.sort((a, b) => a.order - b.order);

		const sessionViews = await Promise.all(
			sessions.map(async (s) => {
				const ses = await ctx.db
					.query("trainingSessionExercises")
					.withIndex("by_session", (q) => q.eq("sessionId", s._id))
					.collect();
				ses.sort((a, b) => a.order - b.order);
				const exerciseViews = await Promise.all(
					ses.map(async (se) => {
						const ex = await ctx.db.get(se.exerciseId);
						const sets = await ctx.db
							.query("trainingSets")
							.withIndex("by_sessionExercise", (q) => q.eq("sessionExerciseId", se._id))
							.collect();
						sets.sort((a, b) => a.order - b.order);
						return {
							_id: se._id,
							order: se.order,
							mode: se.mode,
							tempo: se.tempo,
							coachNote: se.coachNote,
							techniqueNote: se.techniqueNote,
							exercise: ex
								? {
										_id: ex._id,
										gfluxExerciseId: ex.gfluxExerciseId,
										name: ex.name,
										muscleGroup: ex.muscleGroup,
										bodyPart: ex.bodyPart,
										equipment: ex.equipment,
										mediaUrl: ex.mediaUrl,
										thumbnailUrl: ex.thumbnailUrl,
										instructions: ex.instructions,
									}
								: null, // exercice supprimé de la bibliothèque : la ligne reste éditable/supprimable
							sets: sets.map((st) => ({
								_id: st._id,
								order: st.order,
								repsMin: st.repsMin,
								repsMax: st.repsMax,
								targetWeight: st.targetWeight,
								targetRir: st.targetRir,
								restSeconds: st.restSeconds,
								durationSeconds: st.durationSeconds,
							})),
						};
					})
				);
				return { _id: s._id, name: s.name, order: s.order, exercises: exerciseViews };
			})
		);

		return {
			program: {
				_id: p._id,
				name: p.name,
				description: p.description,
				goal: p.goal,
				goalLabel: p.goal ? (PROGRAM_GOALS[p.goal] ?? p.goal) : undefined,
				level: p.level,
				levelLabel: p.level ? (PROGRAM_LEVELS[p.level] ?? p.level) : undefined,
				sessionsPerWeek: p.sessionsPerWeek,
				imageStorageId: p.imageStorageId,
				imageUrl: p.imageStorageId ? ((await ctx.storage.getUrl(p.imageStorageId)) ?? undefined) : undefined,
				createdAt: p.createdAt,
				updatedAt: p.updatedAt,
			},
			sessions: sessionViews,
		};
	},
});

/* ═══════════ Programmes — écritures ═══════════ */

const programFields = v.object({
	name: v.optional(v.string()),
	description: v.optional(v.union(v.string(), v.null())),
	goal: v.optional(v.union(programGoal, v.null())),
	level: v.optional(v.union(programLevel, v.null())),
	sessionsPerWeek: v.optional(v.union(v.number(), v.null())),
	imageStorageId: v.optional(v.union(v.id("_storage"), v.null())),
});

/**
 * Crée un programme + sa première séance « Jour 1 » (le coach atterrit
 * directement dans un éditeur utilisable).
 */
export const createProgram = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		name: v.string(),
		description: v.optional(v.string()),
		goal: v.optional(programGoal),
		level: v.optional(programLevel),
		sessionsPerWeek: v.optional(v.number()),
		imageStorageId: v.optional(v.id("_storage")),
	},
	handler: async (ctx, { sessionToken, name, description, goal, level, sessionsPerWeek, imageStorageId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const clean = name.trim().slice(0, 120);
		if (clean.length < 2) throw new ConvexError("Le nom du programme est trop court.");
		if (sessionsPerWeek !== undefined) {
			clampInt(sessionsPerWeek, 1, 7, "Séances par semaine");
		}
		const now = Date.now();
		const programId = await ctx.db.insert("trainingPrograms", {
			coachId: coach._id,
			name: clean,
			description: description?.trim() || undefined,
			goal,
			level,
			sessionsPerWeek,
			imageStorageId,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("trainingSessions", {
			programId,
			name: "Jour 1",
			order: 0,
			createdAt: now,
		});
		return { programId };
	},
});

/** Mise à jour des champs du programme (autosave — null = vider le champ). */
export const updateProgram = mutation({
	args: { sessionToken: v.optional(v.string()), programId: v.id("trainingPrograms"), fields: programFields },
	handler: async (ctx, { sessionToken, programId, fields }) => {
		const coach = await requireCoach(ctx, sessionToken);
		await requireProgram(ctx, coach._id, programId);
		const patch: Record<string, unknown> = { updatedAt: Date.now() };
		if (fields.name !== undefined) {
			const clean = fields.name.trim().slice(0, 120);
			if (clean.length < 2) throw new ConvexError("Le nom du programme est trop court.");
			patch.name = clean;
		}
		if (fields.description !== undefined) patch.description = fields.description?.trim() || undefined;
		if (fields.goal !== undefined) patch.goal = fields.goal ?? undefined;
		if (fields.level !== undefined) patch.level = fields.level ?? undefined;
		if (fields.sessionsPerWeek !== undefined) {
			patch.sessionsPerWeek = fields.sessionsPerWeek === null ? undefined : clampInt(fields.sessionsPerWeek, 1, 7, "Séances par semaine");
		}
		if (fields.imageStorageId !== undefined) patch.imageStorageId = fields.imageStorageId ?? undefined;
		await ctx.db.patch(programId, patch as never);
		return { ok: true };
	},
});

/** Duplique un programme (séances, exercices et séries compris) — « (copie) ». */
export const duplicateProgram = mutation({
	args: { sessionToken: v.optional(v.string()), programId: v.id("trainingPrograms") },
	handler: async (ctx, { sessionToken, programId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const src = await requireProgram(ctx, coach._id, programId);
		const now = Date.now();

		const newId = await ctx.db.insert("trainingPrograms", {
			coachId: coach._id,
			name: `${src.name} (copie)`.slice(0, 120),
			description: src.description,
			goal: src.goal,
			level: src.level,
			sessionsPerWeek: src.sessionsPerWeek,
			imageStorageId: src.imageStorageId, // le même blob storage peut être référencé deux fois
			createdAt: now,
			updatedAt: now,
		});

		const sessions = await ctx.db
			.query("trainingSessions")
			.withIndex("by_program", (q) => q.eq("programId", src._id))
			.collect();
		sessions.sort((a, b) => a.order - b.order);
		for (const s of sessions) {
			const newSessionId = await ctx.db.insert("trainingSessions", {
				programId: newId,
				name: s.name,
				order: s.order,
				createdAt: now,
			});
			const ses = await ctx.db
				.query("trainingSessionExercises")
				.withIndex("by_session", (q) => q.eq("sessionId", s._id))
				.collect();
			ses.sort((a, b) => a.order - b.order);
			for (const se of ses) {
				const newSeId = await ctx.db.insert("trainingSessionExercises", {
					sessionId: newSessionId,
					exerciseId: se.exerciseId,
					order: se.order,
					mode: se.mode,
					tempo: se.tempo,
					coachNote: se.coachNote,
					techniqueNote: se.techniqueNote,
					createdAt: now,
				});
				const sets = await ctx.db
					.query("trainingSets")
					.withIndex("by_sessionExercise", (q) => q.eq("sessionExerciseId", se._id))
					.collect();
				sets.sort((a, b) => a.order - b.order);
				for (const st of sets) {
					await ctx.db.insert("trainingSets", {
						sessionExerciseId: newSeId,
						order: st.order,
						repsMin: st.repsMin,
						repsMax: st.repsMax,
						targetWeight: st.targetWeight,
						targetRir: st.targetRir,
						restSeconds: st.restSeconds,
						durationSeconds: st.durationSeconds,
					});
				}
			}
		}
		return { programId: newId };
	},
});

/** Supprime un programme et TOUTE sa prescription (confirmation côté UI). */
export const deleteProgram = mutation({
	args: { sessionToken: v.optional(v.string()), programId: v.id("trainingPrograms") },
	handler: async (ctx, { sessionToken, programId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		await requireProgram(ctx, coach._id, programId);
		await deleteProgramCascade(ctx, programId);
		return { ok: true };
	},
});

/* ═══════════ Séances ═══════════ */

/** Ajoute une séance « Jour N » en fin de programme (N = position suivante). */
export const addSession = mutation({
	args: { sessionToken: v.optional(v.string()), programId: v.id("trainingPrograms"), name: v.optional(v.string()) },
	handler: async (ctx, { sessionToken, programId, name }) => {
		const coach = await requireCoach(ctx, sessionToken);
		await requireProgram(ctx, coach._id, programId);
		const existing = await ctx.db
			.query("trainingSessions")
			.withIndex("by_program", (q) => q.eq("programId", programId))
			.collect();
		if (existing.length >= MAX_SESSIONS_PER_PROGRAM) {
			throw new ConvexError(`Maximum ${MAX_SESSIONS_PER_PROGRAM} séances par programme.`);
		}
		const order = existing.length;
		const sessionId = await ctx.db.insert("trainingSessions", {
			programId,
			name: name?.trim() || `Jour ${order + 1}`,
			order,
			createdAt: Date.now(),
		});
		await ctx.db.patch(programId, { updatedAt: Date.now() });
		return { sessionId };
	},
});

/** Renomme une séance (autosave). */
export const renameSession = mutation({
	args: { sessionToken: v.optional(v.string()), sessionId: v.id("trainingSessions"), name: v.string() },
	handler: async (ctx, { sessionToken, sessionId, name }) => {
		const coach = await requireCoach(ctx, sessionToken);
		await requireSession(ctx, coach._id, sessionId);
		const clean = name.trim().slice(0, 80);
		if (clean.length < 1) throw new ConvexError("Le nom de la séance est vide.");
		await ctx.db.patch(sessionId, { name: clean });
		return { ok: true };
	},
});

/** Duplique une séance (exercices + séries) — insérée juste après la source. */
export const duplicateSession = mutation({
	args: { sessionToken: v.optional(v.string()), sessionId: v.id("trainingSessions") },
	handler: async (ctx, { sessionToken, sessionId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const src = await requireSession(ctx, coach._id, sessionId);
		const programId = src.programId;
		const now = Date.now();

		const siblings = await ctx.db
			.query("trainingSessions")
			.withIndex("by_program", (q) => q.eq("programId", programId))
			.collect();
		if (siblings.length >= MAX_SESSIONS_PER_PROGRAM) {
			throw new ConvexError(`Maximum ${MAX_SESSIONS_PER_PROGRAM} séances par programme.`);
		}

		const newSessionId = await ctx.db.insert("trainingSessions", {
			programId,
			name: src.name,
			order: siblings.length, // temporaire — renumérotation juste après
			createdAt: now,
		});

		const ses = await ctx.db
			.query("trainingSessionExercises")
			.withIndex("by_session", (q) => q.eq("sessionId", src._id))
			.collect();
		ses.sort((a, b) => a.order - b.order);
		for (const se of ses) {
			const newSeId = await ctx.db.insert("trainingSessionExercises", {
				sessionId: newSessionId,
				exerciseId: se.exerciseId,
				order: se.order,
				mode: se.mode,
				tempo: se.tempo,
				coachNote: se.coachNote,
				techniqueNote: se.techniqueNote,
				createdAt: now,
			});
			const sets = await ctx.db
				.query("trainingSets")
				.withIndex("by_sessionExercise", (q) => q.eq("sessionExerciseId", se._id))
				.collect();
			for (const st of sets) {
				await ctx.db.insert("trainingSets", {
					sessionExerciseId: newSeId,
					order: st.order,
					repsMin: st.repsMin,
					repsMax: st.repsMax,
					targetWeight: st.targetWeight,
					targetRir: st.targetRir,
					restSeconds: st.restSeconds,
					durationSeconds: st.durationSeconds,
				});
			}
		}

		// Réordonne : la copie passe juste après la source (ordres contigus).
		siblings.sort((a, b) => a.order - b.order);
		const ordered = siblings.map((s) => s._id);
		ordered.splice(ordered.indexOf(src._id) + 1, 0, newSessionId);
		await Promise.all(ordered.map((id, i) => ctx.db.patch(id, { order: i })));
		await ctx.db.patch(programId, { updatedAt: now });

		return { sessionId: newSessionId };
	},
});

/** Supprime une séance puis renormalise les ordres. */
export const deleteSession = mutation({
	args: { sessionToken: v.optional(v.string()), sessionId: v.id("trainingSessions") },
	handler: async (ctx, { sessionToken, sessionId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const s = await requireSession(ctx, coach._id, sessionId);
		await deleteSessionCascade(ctx, sessionId);
		await renormalizeSessionOrders(ctx, s.programId);
		await ctx.db.patch(s.programId, { updatedAt: Date.now() });
		return { ok: true };
	},
});

/** Drag & drop des séances : ids dans le nouvel ordre (renormalisés 0..n-1). */
export const reorderSessions = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		programId: v.id("trainingPrograms"),
		orderedIds: v.array(v.id("trainingSessions")),
	},
	handler: async (ctx, { sessionToken, programId, orderedIds }) => {
		const coach = await requireCoach(ctx, sessionToken);
		await requireProgram(ctx, coach._id, programId);
		const rows = await ctx.db
			.query("trainingSessions")
			.withIndex("by_program", (q) => q.eq("programId", programId))
			.collect();
		if (rows.length !== orderedIds.length || new Set(orderedIds).size !== orderedIds.length) {
			throw new ConvexError("Ordre des séances invalide.");
		}
		const known = new Set(rows.map((r) => r._id));
		if (!orderedIds.every((id) => known.has(id))) throw new ConvexError("Ordre des séances invalide.");
		await Promise.all(orderedIds.map((id, i) => ctx.db.patch(id, { order: i })));
		await ctx.db.patch(programId, { updatedAt: Date.now() });
		return { ok: true };
	},
});

/* ═══════════ Exercices de séance ═══════════ */

/**
 * Ajoute un exercice (de la bibliothèque) en fin de séance avec sa
 * prescription par défaut : 3 séances de travail → 3 séries de 10 reps,
 * repos 60 s — le coach ajuste en quelques frappes ensuite.
 */
export const addSessionExercise = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		sessionId: v.id("trainingSessions"),
		exerciseId: v.id("exercises"),
		mode: v.optional(v.union(v.literal("reps"), v.literal("time"))),
	},
	handler: async (ctx, { sessionToken, sessionId, exerciseId, mode }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const session = await requireSession(ctx, coach._id, sessionId);
		const ex = await ctx.db.get(exerciseId);
		if (!ex) throw new ConvexError("Exercice introuvable dans la bibliothèque.");

		const existing = await ctx.db
			.query("trainingSessionExercises")
			.withIndex("by_session", (q) => q.eq("sessionId", sessionId))
			.collect();
		if (existing.length >= MAX_EXERCISES_PER_SESSION) {
			throw new ConvexError(`Maximum ${MAX_EXERCISES_PER_SESSION} exercices par séance.`);
		}
		const order = existing.length;
		const now = Date.now();
		const id = await ctx.db.insert("trainingSessionExercises", {
			sessionId,
			exerciseId,
			order,
			mode: mode ?? "reps",
			createdAt: now,
		});

		const isTime = (mode ?? "reps") === "time";
		const setCount = 3;
		for (let i = 0; i < setCount; i++) {
			await ctx.db.insert("trainingSets", {
				sessionExerciseId: id,
				order: i,
				...(isTime ? { durationSeconds: 60, restSeconds: 30 } : { repsMin: 10, repsMax: 10, restSeconds: 60 }),
			});
		}
		await ctx.db.patch(session.programId, { updatedAt: now });
		return { sessionExerciseId: id };
	},
});

/** Drag & drop des exercices dans une séance (ids réordonnés). */
export const reorderSessionExercises = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		sessionId: v.id("trainingSessions"),
		orderedIds: v.array(v.id("trainingSessionExercises")),
	},
	handler: async (ctx, { sessionToken, sessionId, orderedIds }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const session = await requireSession(ctx, coach._id, sessionId);
		const rows = await ctx.db
			.query("trainingSessionExercises")
			.withIndex("by_session", (q) => q.eq("sessionId", sessionId))
			.collect();
		if (rows.length !== orderedIds.length || new Set(orderedIds).size !== orderedIds.length) {
			throw new ConvexError("Ordre des exercices invalide.");
		}
		const known = new Set(rows.map((r) => r._id));
		if (!orderedIds.every((id) => known.has(id))) throw new ConvexError("Ordre des exercices invalide.");
		await Promise.all(orderedIds.map((id, i) => ctx.db.patch(id, { order: i })));
		await ctx.db.patch(session.programId, { updatedAt: Date.now() });
		return { ok: true };
	},
});

/** Duplique un exercice de séance (séries comprises) — inséré juste après. */
export const duplicateSessionExercise = mutation({
	args: { sessionToken: v.optional(v.string()), sessionExerciseId: v.id("trainingSessionExercises") },
	handler: async (ctx, { sessionToken, sessionExerciseId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const src = await requireSessionExercise(ctx, coach._id, sessionExerciseId);
		const sessionId = src.sessionId;
		const now = Date.now();

		const siblings = await ctx.db
			.query("trainingSessionExercises")
			.withIndex("by_session", (q) => q.eq("sessionId", sessionId))
			.collect();
		if (siblings.length >= MAX_EXERCISES_PER_SESSION) {
			throw new ConvexError(`Maximum ${MAX_EXERCISES_PER_SESSION} exercices par séance.`);
		}
		const newId = await ctx.db.insert("trainingSessionExercises", {
			sessionId,
			exerciseId: src.exerciseId,
			order: siblings.length, // renumérotation après copie des séries
			mode: src.mode,
			tempo: src.tempo,
			coachNote: src.coachNote,
			techniqueNote: src.techniqueNote,
			createdAt: now,
		});
		const sets = await ctx.db
			.query("trainingSets")
			.withIndex("by_sessionExercise", (q) => q.eq("sessionExerciseId", src._id))
			.collect();
		sets.sort((a, b) => a.order - b.order);
		for (const st of sets) {
			await ctx.db.insert("trainingSets", {
				sessionExerciseId: newId,
				order: st.order,
				repsMin: st.repsMin,
				repsMax: st.repsMax,
				targetWeight: st.targetWeight,
				targetRir: st.targetRir,
				restSeconds: st.restSeconds,
				durationSeconds: st.durationSeconds,
			});
		}

		siblings.sort((a, b) => a.order - b.order);
		const ordered = siblings.map((s) => s._id);
		ordered.splice(ordered.indexOf(src._id) + 1, 0, newId);
		await Promise.all(ordered.map((id, i) => ctx.db.patch(id, { order: i })));
		const session = await ctx.db.get(sessionId);
		if (session) await ctx.db.patch(session.programId, { updatedAt: now });
		return { sessionExerciseId: newId };
	},
});

/** Retire un exercice de la séance (séries supprimées) + renormalisation. */
export const removeSessionExercise = mutation({
	args: { sessionToken: v.optional(v.string()), sessionExerciseId: v.id("trainingSessionExercises") },
	handler: async (ctx, { sessionToken, sessionExerciseId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const se = await requireSessionExercise(ctx, coach._id, sessionExerciseId);
		await deleteSessionExerciseCascade(ctx, sessionExerciseId);
		await renormalizeExerciseOrders(ctx, se.sessionId);
		const session = await ctx.db.get(se.sessionId);
		if (session) await ctx.db.patch(session.programId, { updatedAt: Date.now() });
		return { ok: true };
	},
});

/** Mise à jour de la prescription d'un exercice de séance (autosave). */
export const updateSessionExercise = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		sessionExerciseId: v.id("trainingSessionExercises"),
		mode: v.optional(v.union(v.literal("reps"), v.literal("time"))),
		tempo: v.optional(v.union(v.string(), v.null())),
		coachNote: v.optional(v.union(v.string(), v.null())),
		techniqueNote: v.optional(v.union(v.string(), v.null())),
	},
	handler: async (ctx, { sessionToken, sessionExerciseId, mode, tempo, coachNote, techniqueNote }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const se = await requireSessionExercise(ctx, coach._id, sessionExerciseId);
		const patch: Record<string, unknown> = {};
		if (mode !== undefined) patch.mode = mode;
		if (tempo !== undefined) {
			const t = tempo?.trim() || undefined;
			if (t && !/^[0-9]{1,2}(-[0-9xX]{1,2}){0,3}$/.test(t)) {
				throw new ConvexError("Tempo invalide — format attendu : 3-1-1-0.");
			}
			patch.tempo = t;
		}
		if (coachNote !== undefined) patch.coachNote = coachNote?.trim() || undefined;
		if (techniqueNote !== undefined) patch.techniqueNote = techniqueNote?.trim() || undefined;
		await ctx.db.patch(sessionExerciseId, patch as never);

		// Changement de mode : complète les séries existantes avec le défaut du
		// nouveau mode (durée 60 s / reps 10) SANS écraser ce que la coach a
		// déjà réglé (le repos, notamment, est conservé).
		if (mode !== undefined && se.mode !== mode) {
			const sets = await ctx.db
				.query("trainingSets")
				.withIndex("by_sessionExercise", (q) => q.eq("sessionExerciseId", sessionExerciseId))
				.collect();
			await Promise.all(
				sets.map((st) => {
					if (mode === "time" && st.durationSeconds === undefined) {
						return ctx.db.patch(st._id, { durationSeconds: 60 });
					}
					if (mode === "reps" && st.repsMin === undefined && st.repsMax === undefined) {
						return ctx.db.patch(st._id, { repsMin: 10, repsMax: 10 });
					}
					return null;
				})
			);
		}
		const session = await ctx.db.get(se.sessionId);
		if (session) await ctx.db.patch(session.programId, { updatedAt: Date.now() });
		return { ok: true };
	},
});

/* ═══════════ Séries ═══════════ */

const setFields = v.object({
	repsMin: v.optional(v.union(v.number(), v.null())),
	repsMax: v.optional(v.union(v.number(), v.null())),
	targetWeight: v.optional(v.union(v.number(), v.null())),
	targetRir: v.optional(v.union(v.number(), v.null())),
	restSeconds: v.optional(v.union(v.number(), v.null())),
	durationSeconds: v.optional(v.union(v.number(), v.null())),
});

/** Ajoute une série — copie de la dernière (valeur par défaut sinon). */
export const addSet = mutation({
	args: { sessionToken: v.optional(v.string()), sessionExerciseId: v.id("trainingSessionExercises") },
	handler: async (ctx, { sessionToken, sessionExerciseId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const se = await requireSessionExercise(ctx, coach._id, sessionExerciseId);
		const sets = await ctx.db
			.query("trainingSets")
			.withIndex("by_sessionExercise", (q) => q.eq("sessionExerciseId", sessionExerciseId))
			.collect();
		if (sets.length >= MAX_SETS_PER_EXERCISE) throw new ConvexError(`Maximum ${MAX_SETS_PER_EXERCISE} séries.`);
		sets.sort((a, b) => a.order - b.order);
		const last = sets[sets.length - 1];
		const order = sets.length;
		const id = await ctx.db.insert("trainingSets", {
			sessionExerciseId,
			order,
			...(last
				? {
						repsMin: last.repsMin,
						repsMax: last.repsMax,
						targetWeight: last.targetWeight,
						targetRir: last.targetRir,
						restSeconds: last.restSeconds,
						durationSeconds: last.durationSeconds,
					}
				: se.mode === "time"
					? { durationSeconds: 60, restSeconds: 30 }
					: { repsMin: 10, repsMax: 10, restSeconds: 60 }),
		});
		return { setId: id };
	},
});

/** Mise à jour d'une série (autosave) — validations par champ. */
export const updateSet = mutation({
	args: { sessionToken: v.optional(v.string()), setId: v.id("trainingSets"), fields: setFields },
	handler: async (ctx, { sessionToken, setId, fields }) => {
		const coach = await requireCoach(ctx, sessionToken);
		await requireSet(ctx, coach._id, setId);
		const patch: Record<string, unknown> = {};
		if (fields.repsMin !== undefined) {
			patch.repsMin = fields.repsMin === null ? undefined : clampInt(fields.repsMin, 1, 100, "Reps min");
		}
		if (fields.repsMax !== undefined) {
			patch.repsMax = fields.repsMax === null ? undefined : clampInt(fields.repsMax, 1, 100, "Reps max");
		}
		if (fields.targetWeight !== undefined) {
			const w = fields.targetWeight;
			patch.targetWeight = w === null ? undefined : Math.round(Math.min(Math.max(w, 0), 500) * 10) / 10;
		}
		if (fields.targetRir !== undefined) {
			patch.targetRir = fields.targetRir === null ? undefined : clampInt(fields.targetRir, 0, 5, "RIR");
		}
		if (fields.restSeconds !== undefined) {
			patch.restSeconds = fields.restSeconds === null ? undefined : clampInt(fields.restSeconds, 0, 600, "Repos");
		}
		if (fields.durationSeconds !== undefined) {
			patch.durationSeconds = fields.durationSeconds === null ? undefined : clampInt(fields.durationSeconds, 1, 3600, "Durée");
		}
		await ctx.db.patch(setId, patch as never);
		return { ok: true };
	},
});

/** Duplique une série — insérée juste après la source. */
export const duplicateSet = mutation({
	args: { sessionToken: v.optional(v.string()), setId: v.id("trainingSets") },
	handler: async (ctx, { sessionToken, setId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const src = await requireSet(ctx, coach._id, setId);
		const siblings = await ctx.db
			.query("trainingSets")
			.withIndex("by_sessionExercise", (q) => q.eq("sessionExerciseId", src.sessionExerciseId))
			.collect();
		if (siblings.length >= MAX_SETS_PER_EXERCISE) throw new ConvexError(`Maximum ${MAX_SETS_PER_EXERCISE} séries.`);
		const newId = await ctx.db.insert("trainingSets", {
			sessionExerciseId: src.sessionExerciseId,
			order: siblings.length,
			repsMin: src.repsMin,
			repsMax: src.repsMax,
			targetWeight: src.targetWeight,
			targetRir: src.targetRir,
			restSeconds: src.restSeconds,
			durationSeconds: src.durationSeconds,
		});
		siblings.sort((a, b) => a.order - b.order);
		const ordered = siblings.map((s) => s._id);
		ordered.splice(ordered.indexOf(src._id) + 1, 0, newId);
		await Promise.all(ordered.map((id, i) => ctx.db.patch(id, { order: i })));
		return { setId: newId };
	},
});

/** Supprime une série + renormalisation des ordres. */
export const deleteSet = mutation({
	args: { sessionToken: v.optional(v.string()), setId: v.id("trainingSets") },
	handler: async (ctx, { sessionToken, setId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const set = await requireSet(ctx, coach._id, setId);
		await ctx.db.delete(setId);
		await renormalizeSetOrders(ctx, set.sessionExerciseId);
		return { ok: true };
	},
});
