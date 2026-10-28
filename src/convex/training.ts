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
import { planSessionLayout } from "./trainingLayout";

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
	if (!coach || coach.role !== "coach") throw new ConvexError("Réservé au coach (CRM).");
	return coach;
}

async function requireProgram(
	ctx: AnyCtx,
	coachId: Id<"users">,
	programId: Id<"trainingPrograms">
): Promise<Doc<"trainingPrograms">> {
	const p = await ctx.db.get(programId);
	if (!p || p.coachId !== coachId) throw new ConvexError("Programme introuvable.");
	// Les copies assignées (clientId présent) ne sont JAMAIS éditées ici : leur
	// contenu appartient à la cliente (séances planifiées + historique). Toute
	// modification passe par un remplacement de programme (voir trainingAssign).
	if (p.clientId) throw new ConvexError("Ce programme est une copie assignée à une cliente — il n'est pas éditable.");
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

/**
 * Applique la mise en page CANONIQUE d'une séance (voir `trainingLayout`) :
 * groupes de circuit contigus, références orphelines retirées, `order`
 * réindexé 0..n-1. Appelée à la fin de TOUTE écriture structurelle (ajout,
 * duplication, retrait, réordonnancement, liaison/déliage) : aucune suite
 * « circuit → suppression → déplacement » ne peut plus laisser deux blocs de
 * même identifiant, ni une position dupliquée. Aucune ligne n'est supprimée.
 */
async function normalizeSessionLayout(ctx: MutationCtx, sessionId: Id<"trainingSessions">) {
	const rows = await ctx.db
		.query("trainingSessionExercises")
		.withIndex("by_session", (q) => q.eq("sessionId", sessionId))
		.collect();
	const plan = planSessionLayout(rows);
	const clear = new Set(plan.clearGroupIds);
	await Promise.all(
		rows.map((r) => {
			const patch: Record<string, unknown> = {};
			const order = plan.orders.get(r._id);
			if (order !== undefined && order !== r.order) patch.order = order;
			if (clear.has(r._id) && r.supersetGroup !== undefined) patch.supersetGroup = undefined;
			return Object.keys(patch).length > 0 ? ctx.db.patch(r._id, patch as never) : null;
		})
	);
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
		// Les copies assignées (clientId présent) n'appartiennent qu'à leur
		// cliente (séances planifiées + historique) : jamais dans la liste des
		// modèles éditables — elles se gèrent via la Vision 360 (trainingAssign).
		const templates = rows.filter((p) => !p.clientId);
		return Promise.all(
			templates.map(async (p) => {
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
					phase: se.phase,
					supersetGroup: se.supersetGroup,
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
										posterUrl: ex.posterUrl,
										animationUrl: ex.animationUrl,
										instructions: ex.instructions,
										instructionsFr: ex.instructionsFr,
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

/**
 * COPIE INTÉGRALE d'un programme (séances → exercices → séries) vers un
 * nouveau programme. Utilisé par la duplication coach ET par l'assignation
 * à une cliente (trainingAssign) : une seule mécanique de copie, éprouvée,
 * jamais deux. La copie est indépendante : modifier la source ne la touche
 * jamais (aucun champ partagé, les médias storage sont référencés tels quels).
 */
export async function copyProgramInto(
	ctx: MutationCtx,
	opts: {
		/** Programme source (modèle). */
		sourceProgramId: Id<"trainingPrograms">;
		/** Coach propriétaire de la copie. */
		coachId: Id<"users">;
		/** Nom de la copie (défaut : nom source). */
		name?: string;
		/** Cliente destinataire (présent UNIQUEMENT pour une copie assignée). */
		clientId?: Id<"users">;
		/** Programme modèle d'origine (traçabilité d'une copie assignée). */
		sourceProgramIdForCopy?: Id<"trainingPrograms">;
	}
): Promise<Id<"trainingPrograms">> {
	const src = await ctx.db.get(opts.sourceProgramId);
	if (!src) throw new ConvexError("Programme introuvable.");
	const now = Date.now();
	const newId = await ctx.db.insert("trainingPrograms", {
		coachId: opts.coachId,
		name: (opts.name ?? src.name).slice(0, 120),
		description: src.description,
		goal: src.goal,
		level: src.level,
		sessionsPerWeek: src.sessionsPerWeek,
		imageStorageId: src.imageStorageId, // le même blob storage peut être référencé deux fois
		...(opts.clientId ? { clientId: opts.clientId } : {}),
		...(opts.sourceProgramIdForCopy ? { sourceProgramId: opts.sourceProgramIdForCopy } : {}),
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
				...(se.phase ? { phase: se.phase } : {}),
				...(se.supersetGroup ? { supersetGroup: se.supersetGroup } : {}),
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
	return newId;
}

/** Duplique un programme (séances, exercices et séries compris) — « (copie) ». */
export const duplicateProgram = mutation({
	args: { sessionToken: v.optional(v.string()), programId: v.id("trainingPrograms") },
	handler: async (ctx, { sessionToken, programId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const src = await requireProgram(ctx, coach._id, programId);
		const newId = await copyProgramInto(ctx, {
			sourceProgramId: src._id,
			coachId: coach._id,
			name: `${src.name} (copie)`,
		});
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
			...(se.phase ? { phase: se.phase } : {}),
			...(se.supersetGroup ? { supersetGroup: se.supersetGroup } : {}),
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
		await normalizeSessionLayout(ctx, sessionId);
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
		// Un glisser-déposer ne peut pas couper un circuit en deux : la mise en
		// page canonique recolle le groupe (l'exercice déplacé glisse DANS son
		// bloc, jamais hors du bloc sans passer par « Sortir du groupe »).
		await normalizeSessionLayout(ctx, sessionId);
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
			// La copie EST l'exercice d'origine dans un groupe : si la source est
			// liée, la copie se sépare (exercice isolé) — dupliquer un exercice
			// d'un superset ne crée jamais une 2e référence au même groupe.
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
		// La copie est isolée : sans cette passe, l'insérer au milieu d'un circuit
		// séparerait le groupe en deux blocs de même identifiant (`each_key_duplicate`).
		await normalizeSessionLayout(ctx, sessionId);
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
		// Retrait d'un membre : réindexe les positions ET retire la référence de
		// circuit devenue orpheline (un membre seul n'est plus un circuit).
		await normalizeSessionLayout(ctx, se.sessionId);
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
		/** Phase du parcours (échauffement / principal / finisher). */
		phase: v.optional(v.union(
			v.literal("echauffement"),
			v.literal("principal"),
			v.literal("finisher"),
			v.null()
		)),
	},
	handler: async (ctx, { sessionToken, sessionExerciseId, mode, tempo, coachNote, techniqueNote, phase }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const se = await requireSessionExercise(ctx, coach._id, sessionExerciseId);
		const patch: Record<string, unknown> = {};
		if (mode !== undefined) patch.mode = mode;
		if (phase !== undefined) patch.phase = phase ?? undefined;
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
		// nouveau mode (durée 60 s / reps 10) SANS écraser ce que le coach a
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

/* ═══════════ Supersets / trisets ═══════════ */

/**
 * Lie ou délie des exercices d'une MÊME séance dans un superset/triset.
 *
 * ADDITIF PUR : le champ `supersetGroup` (optionnel) est le seul changement
 * de schéma — aucune migration, aucun backfill, les séances existantes
 * (champ absent) restent des exercices isolés. La liaison est un simple
 * patch de N lignes ; le déliage est un patch à undefined. L'ordre
 * d'affichage reste porté par `order` : un groupe se lit par contiguïté.
 *
 * Garde-fous : 2 à 6 exercices par groupe, tous de la même séance (propriété
 * coach vérifiée ligne par ligne). Réutiliser le même identifiant pour
 * étendre/réduire un groupe existant est autorisé.
 */
export const setSupersetGroup = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		/** Exercices à marquer (ordre = ordre d'affichage souhaité). */
		orderedIds: v.array(v.id("trainingSessionExercises")),
		/** null = délier totalement (tous les membres deviennent isolés). */
		group: v.optional(v.union(v.string(), v.null())),
		/**
		 * Membres SORTIS du groupe dans la même opération (jamais dans
		 * `orderedIds`) : leur référence est retirée. Sans ça, le membre exclu
		 * gardait l'identifiant du groupe et créait un 2e bloc du même nom.
		 */
		detachIds: v.optional(v.array(v.id("trainingSessionExercises"))),
	},
	handler: async (ctx, { sessionToken, orderedIds, group, detachIds }) => {
		const coach = await requireCoach(ctx, sessionToken);
		if (orderedIds.length === 0) throw new ConvexError("Aucun exercice à lier.");
		if (detachIds && detachIds.some((id) => orderedIds.includes(id))) {
			throw new ConvexError("Un exercice ne peut pas être lié et sorti du même groupe.");
		}
		// Opération atomique : un identifiant ne peut jamais figurer deux fois
		// dans le même groupe (référence partagée = doublon garanti à l'écran).
		if (new Set(orderedIds).size !== orderedIds.length) {
			throw new ConvexError("Exercices en double dans le groupe — opération refusée.");
		}
		let sessionId: Id<"trainingSessions"> | null = null;
		if (group === null || group === undefined) {
			// DÉLIAGE : retire l'appartenance de chaque ligne (individuel ou total).
			for (const id of orderedIds) {
				const se = await requireSessionExercise(ctx, coach._id, id);
				sessionId = se.sessionId;
				if (se.supersetGroup !== undefined) await ctx.db.patch(se._id, { supersetGroup: undefined } as never);
			}
		} else {
			if (orderedIds.length < 2 || orderedIds.length > 6) {
				throw new ConvexError("Un superset réunit 2 à 6 exercices.");
			}
			const rows: Doc<"trainingSessionExercises">[] = [];
			for (const id of orderedIds) {
				rows.push(await requireSessionExercise(ctx, coach._id, id));
			}
			const linkedSessionId = rows[0].sessionId;
			if (!rows.every((r) => r.sessionId === linkedSessionId)) {
				throw new ConvexError("Les exercices d'un superset doivent appartenir à la même séance.");
			}
			sessionId = linkedSessionId;
			// Membres explicitement sortis du groupe (même transaction).
			for (const id of detachIds ?? []) {
				const se = await requireSessionExercise(ctx, coach._id, id);
				if (se.supersetGroup === group) await ctx.db.patch(se._id, { supersetGroup: undefined } as never);
			}
			// Patch de groupe : les ids reçoivent le même identifiant, réordonnés
			// par contiguïté (le 1er du groupe amorce la position, les suivants
			// viennent se placer juste après, dans l'ordre fourni).
			const siblings = await ctx.db
				.query("trainingSessionExercises")
				.withIndex("by_session", (q) => q.eq("sessionId", linkedSessionId))
				.collect();
			siblings.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
			const chosen = new Set(orderedIds);
			const ordered = siblings.map((s) => s._id);
			// Retire puis réinsère les membres en contiguïté à la position du premier.
			const rest = ordered.filter((id) => !chosen.has(id));
			const firstPos = ordered.findIndex((id) => chosen.has(id));
			rest.splice(firstPos < 0 ? rest.length : firstPos, 0, ...orderedIds);
			await Promise.all(
				rest.map((id, i) =>
					ctx.db.patch(id, i < firstPos || i >= firstPos + orderedIds.length
						? { order: i } as never
						: ({ order: i, supersetGroup: group } as never))
				)
			);
		}
		// Mise en page canonique : le groupe lié devient UN bloc contigu, et tout
		// ancien groupe laissé avec un seul membre (membre sorti ou absorbé) perd
		// sa référence — plus jamais deux blocs de même identifiant à l'écran.
		if (sessionId) await normalizeSessionLayout(ctx, sessionId);
		// Toucher updatedAt du programme (parent du 1er id) pour l'ordre de la liste.
		if (orderedIds[0]) {
			const first = await ctx.db.get(orderedIds[0]);
			if (first) {
				const session = await ctx.db.get(first.sessionId);
				if (session) await ctx.db.patch(session.programId, { updatedAt: Date.now() });
			}
		}
		return { ok: true };
	},
});

/* ═══════════ Import d'exercices entre séances ═══════════ */

/**
 * COPIE des exercices d'une séance source dans PLUSIEURS séances du programme
 * en cours, en une seule transaction.
 *
 * Rien n'est partagé avec la source : chaque cible reçoit de NOUVELLES lignes
 * (exercice + séries) avec toute la prescription (mode, tempo, consignes,
 * notes, phase, reps, charge, RIR, repos, durée). Un circuit de la source est
 * RECRÉÉ comme circuit distinct dans chaque cible : nouvel identifiant de
 * groupe, sans lien avec celui de la source ni avec un import précédent (deux
 * imports successifs ne fusionnent jamais deux circuits).
 *
 * Positions : les copies sont posées au début (avant tout) ou à la fin, puis
 * la mise en page canonique d'EDITEUR-DOUBLON (`planSessionLayout`) recolle
 * les circuits et réindexe 0..n-1 — aucune position dupliquée, aucun groupe
 * orphelin. Le programme source n'est jamais modifié.
 */
export const importSessionExercises = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		/** Séance source (programme du coach, jamais une copie assignée). */
		sourceSessionId: v.id("trainingSessions"),
		/** Exercices retenus dans la séance source (tous cochés par défaut). */
		sessionExerciseIds: v.array(v.id("trainingSessionExercises")),
		/** Séances cibles du programme en cours. */
		targetSessionIds: v.array(v.id("trainingSessions")),
		position: v.union(v.literal("start"), v.literal("end")),
		/** `keep` = phase d'origine ; `echauffement` = tout en échauffement. */
		phaseMode: v.union(v.literal("keep"), v.literal("echauffement")),
	},
	handler: async (ctx, { sessionToken, sourceSessionId, sessionExerciseIds, targetSessionIds, position, phaseMode }) => {
		const coach = await requireCoach(ctx, sessionToken);
		if (sessionExerciseIds.length === 0) throw new ConvexError("Sélectionne au moins un exercice à importer.");
		if (sessionExerciseIds.length > MAX_EXERCISES_PER_SESSION) {
			throw new ConvexError(`Maximum ${MAX_EXERCISES_PER_SESSION} exercices par séance.`);
		}
		if (new Set(sessionExerciseIds).size !== sessionExerciseIds.length) {
			throw new ConvexError("Exercices en double dans la sélection — opération refusée.");
		}
		const targetIds = [...new Set(targetSessionIds)];
		if (targetIds.length === 0) throw new ConvexError("Sélectionne au moins une séance cible.");

		// Source : propriété vérifiée comme partout (programme → séance).
		await requireSession(ctx, coach._id, sourceSessionId);
		const sourceRows = await ctx.db
			.query("trainingSessionExercises")
			.withIndex("by_session", (q) => q.eq("sessionId", sourceSessionId))
			.collect();
		sourceRows.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || a._id.localeCompare(b._id));
		const chosen = new Set(sessionExerciseIds);
		if (sourceRows.filter((r) => chosen.has(r._id)).length !== chosen.size) {
			throw new ConvexError("Exercice source introuvable dans la séance.");
		}
		const picked = sourceRows.filter((r) => chosen.has(r._id));

		// Séries de la source : lues UNE fois, recopiées dans chaque cible.
		const sourceSets = new Map<string, Doc<"trainingSets">[]>();
		for (const se of picked) {
			const sets = await ctx.db
				.query("trainingSets")
				.withIndex("by_sessionExercise", (q) => q.eq("sessionExerciseId", se._id))
				.collect();
			sets.sort((a, b) => a.order - b.order || a._creationTime - b._creationTime);
			sourceSets.set(se._id, sets);
		}

		// Cibles : même programme (celui en cours), appartenant au coach appelant.
		const targets: Doc<"trainingSessions">[] = [];
		for (const id of targetIds) targets.push(await requireSession(ctx, coach._id, id));
		const programId = targets[0].programId;
		if (!targets.every((t) => t.programId === programId)) {
			throw new ConvexError("Les séances cibles doivent appartenir au même programme.");
		}

		const now = Date.now();
		const sourceGroups = [...new Set(picked.map((r) => r.supersetGroup).filter((g): g is string => !!g))];

		for (const [ti, target] of targets.entries()) {
			const existing = await ctx.db
				.query("trainingSessionExercises")
				.withIndex("by_session", (q) => q.eq("sessionId", target._id))
				.collect();
			if (existing.length + picked.length > MAX_EXERCISES_PER_SESSION) {
				throw new ConvexError(`Maximum ${MAX_EXERCISES_PER_SESSION} exercices par séance.`);
			}
			// Un circuit source → un NOUVEAU groupe dans CETTE cible (jamais de
			// collision avec un groupe existant ni avec un import précédent).
			const taken = new Set(existing.map((r) => r.supersetGroup).filter((g): g is string => !!g));
			const fresh = new Map<string, string>();
			sourceGroups.forEach((g, gi) => {
				let id = `sup:imp${now.toString(36)}${ti}${gi}`;
				while (taken.has(id)) id += "x";
				taken.add(id);
				fresh.set(g, id);
			});

			// Place : les copies passent avant tout (start) ou après tout (end).
			existing.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || a._id.localeCompare(b._id));
			const start = position === "start";
			await Promise.all(
				existing.map((r, i) => ctx.db.patch(r._id, { order: start ? i + picked.length : i }))
			);

			for (const [i, se] of picked.entries()) {
				const group = se.supersetGroup ? fresh.get(se.supersetGroup) : undefined;
				const phase = phaseMode === "echauffement" ? "echauffement" : se.phase;
				const newId = await ctx.db.insert("trainingSessionExercises", {
					sessionId: target._id,
					exerciseId: se.exerciseId,
					order: (start ? 0 : existing.length) + i,
					mode: se.mode,
					tempo: se.tempo,
					coachNote: se.coachNote,
					techniqueNote: se.techniqueNote,
					...(phase ? { phase } : {}),
					...(group ? { supersetGroup: group } : {}),
					createdAt: now + i, // ordre déterministe entre les copies
				});
				for (const st of sourceSets.get(se._id) ?? []) {
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
			}
			// Mise en page canonique : circuits contigus, groupes orphelins
			// dissous, positions réindexées 0..n-1.
			await normalizeSessionLayout(ctx, target._id);
		}

		await ctx.db.patch(programId, { updatedAt: now });
		return {
			exerciseCount: picked.length,
			sessionCount: targets.length,
			targetSessionIds: targets.map((t) => t._id),
		};
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
