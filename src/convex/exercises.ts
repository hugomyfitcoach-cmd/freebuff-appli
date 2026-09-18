/**
 * Bibliothèque d'exercices G-FLUX — socle data du module Entraînement.
 *
 * Architecture (règle produit) : le modèle est G-FLUX, JAMAIS la structure
 * d'une source externe. Les exercices importés sont reconnus par le couple
 * (source, sourceExerciseId) — jamais par un id tiers — et normalisés vers
 * le vocabulaire G-FLUX (muscles / équipements en français). Remplacer la
 * banque gratuite (free-exercise-db) par un dataset commercial demain ne
 * touche que le script d'import, pas ce module ni le frontend.
 *
 * Accès : tout passe par la session (jeton transmis par le BFF SvelteKit —
 * le navigateur n'appelle jamais Convex directement). Les lectures et
 * écritures sont réservées à la COACH : les clientes n'ont pas encore de
 * surface Entraînement (missions suivantes).
 */

import { query, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";

/** Identifiant de la source gratuite de prototypage (ExerciseDB open data). */
export const FREE_SOURCE_ID = "free-exercise-db";

/** Référentiel des sources connues — l'UI ne codes jamais une source en dur. */
export const KNOWN_SOURCES: Record<string, string> = {
	"free-exercise-db": "ExerciseDB (open data, domaine public)",
	gflux: "Bibliothèque G-FLUX (exercices coach)",
};

/* ── Garde-fous de limite (volume bibliothèque ≈ 1500 exercices) ── */

const SEARCH_LIMIT = 60;
const LIST_LIMIT = 200;
const FACETS_LIMIT = 50;
/** Taille max d'un lot d'import (appelé en boucle par le script). */
export const IMPORT_BATCH_SIZE = 100;

/** Garde un exercice importé (ou crée-le) dans le vocabulaire G-FLUX. */
type ImportedExercise = {
	gfluxExerciseId: string;
	name: string;
	sourceName?: string;
	muscleGroup?: string;
	secondaryMuscles?: string[];
	bodyPart?: string;
	equipment?: string;
	category?: string;
	instructions?: string[];
	mediaUrl?: string;
	thumbnailUrl?: string;
	mediaUrls?: string[];
	licenseNote?: string;
};

/** Exercice normalisé renvoyé à la coach (fiche complète). */
export type ExerciseView = {
	_id: string;
	gfluxExerciseId: string;
	name: string;
	sourceName?: string;
	muscleGroup?: string;
	secondaryMuscles?: string[];
	bodyPart?: string;
	equipment?: string;
	category?: string;
	instructions?: string[];
	mediaUrl?: string;
	sourceMediaUrl?: string;
	mediaStorageId?: string;
	mediaSizeBytes?: number;
	thumbnailUrl?: string;
	mediaUrls?: string[];
	source: string;
	sourceLabel: string;
	sourceExerciseId?: string;
	licenseNote?: string;
	active: boolean;
	hidden: boolean;
	system: boolean;
	createdAt: number;
	updatedAt: number;
};

function sourceLabelOf(source: string): string {
	return KNOWN_SOURCES[source] ?? source;
}

function toView(e: {
	_id: string;
	gfluxExerciseId: string;
	name: string;
	sourceName?: string;
	muscleGroup?: string;
	secondaryMuscles?: string[];
	bodyPart?: string;
	equipment?: string;
	category?: string;
	instructions?: string[];
	mediaUrl?: string;
	sourceMediaUrl?: string;
	mediaStorageId?: string;
	mediaSizeBytes?: number;
	thumbnailUrl?: string;
	mediaUrls?: string[];
	source: string;
	sourceExerciseId?: string;
	licenseNote?: string;
	active: boolean;
	hidden?: boolean;
	system: boolean;
	createdAt: number;
	updatedAt: number;
}): ExerciseView {
	return {
		_id: e._id,
		gfluxExerciseId: e.gfluxExerciseId,
		name: e.name,
		sourceName: e.sourceName,
		muscleGroup: e.muscleGroup,
		secondaryMuscles: e.secondaryMuscles,
		bodyPart: e.bodyPart,
		equipment: e.equipment,
		category: e.category,
		instructions: e.instructions,
		mediaUrl: e.mediaUrl,
		sourceMediaUrl: e.sourceMediaUrl,
		mediaStorageId: e.mediaStorageId,
		mediaSizeBytes: e.mediaSizeBytes,
		thumbnailUrl: e.thumbnailUrl,
		mediaUrls: e.mediaUrls,
		source: e.source,
		sourceLabel: sourceLabelOf(e.source),
		sourceExerciseId: e.sourceExerciseId,
		licenseNote: e.licenseNote,
		active: e.active,
		hidden: e.hidden ?? false,
		system: e.system,
		createdAt: e.createdAt,
		updatedAt: e.updatedAt,
	};
}

/* ═══════════ Lectures (réservées coach) ═══════════ */

/**
 * Statistiques de la bibliothèque (page de validation) : total actif,
 * répartition par groupe musculaire, équipement et source.
 */
export const libraryStats = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (CRM).");

		const rows = await ctx.db.query("exercises").collect();
		const visible = rows.filter((e) => e.active && !(e.hidden ?? false));
		const countBy = (get: (e: (typeof rows)[number]) => string | undefined) => {
			const m = new Map<string, number>();
			for (const e of visible) {
				const k = get(e);
				if (!k) continue;
				m.set(k, (m.get(k) ?? 0) + 1);
			}
			return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"));
		};
		return {
			total: rows.length,
			active: visible.length,
			hidden: rows.filter((e) => e.hidden ?? false).length,
			custom: rows.filter((e) => !e.system).length,
			bySource: countBy((e) => e.source),
		byMuscleGroup: countBy((e) => e.muscleGroup),
		byEquipment: countBy((e) => e.equipment),
		byBodyPart: countBy((e) => e.bodyPart),
	};
	},
});

/**
 * Recherche + filtres de la bibliothèque (page de validation, pagination
 * offset simple). La recherche texte utilise le searchIndex `name_search` ;
 * les filtres exacts (groupe musculaire / équipement / source) s'appliquent
 * ensuite sur le même jeu. `includeHidden` laisse la coach voir ce qu'elle a
 * masqué (page de validation uniquement).
 */
export const searchExercises = query({
	args: {
		sessionToken: v.optional(v.string()),
		query: v.optional(v.string()),
		muscleGroup: v.optional(v.string()),
		equipment: v.optional(v.string()),
		bodyPart: v.optional(v.string()),
		source: v.optional(v.string()),
		includeHidden: v.optional(v.boolean()),
		offset: v.optional(v.number()),
		limit: v.optional(v.number()),
	},
	handler: async (
		ctx,
		{ sessionToken, query, muscleGroup, equipment, bodyPart, source, includeHidden, offset = 0, limit = 24 }
	) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (CRM).");
		if (limit < 1 || limit > LIST_LIMIT) throw new ConvexError("Limite invalide.");

		const term = (query ?? "").trim();
		// Deux chemins de lecture : searchIndex quand il y a un terme (le plus
		// sélectif), index alphanumérique `by_name` sinon (tri stable nom croissant).
		let candidates;
		if (term.length >= 2) {
			candidates = await ctx.db
				.query("exercises")
				.withSearchIndex("name_search", (sb) => sb.search("name", term))
				.take(SEARCH_LIMIT);
		} else {
			candidates = await ctx.db
				.query("exercises")
				.withIndex("by_name", (q) => q.gte("name", ""))
				.order("asc")
				.collect();
		}

		const filtered = candidates.filter((e) => {
			if (!e.active) return false;
			if (!includeHidden && (e.hidden ?? false)) return false;
			if (muscleGroup && e.muscleGroup !== muscleGroup) return false;
			if (equipment && e.equipment !== equipment) return false;
			if (bodyPart && e.bodyPart !== bodyPart) return false;
			if (source && e.source !== source) return false;
			return true;
		});
		// Tri déterministe (alphabetique FR, insensible à la casse).
		filtered.sort((a, b) => a.name.localeCompare(b.name, "fr"));

		const total = filtered.length;
		const items = filtered.slice(offset, offset + limit).map(toView);
		return { items, total, hasMore: offset + limit < total };
	},
});

/**
 * Fiche complète d'un exercice — accepte l'id interne Convex OU le
 * `gfluxExerciseId` portable (ex_…) : c'est celui-ci que l'application
 * cliente et les partages utilisent (stable même si la source change).
 */
export const exerciseById = query({
	args: { sessionToken: v.optional(v.string()), id: v.string() },
	handler: async (ctx, { sessionToken, id }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (CRM).");
		const e = id.startsWith("ex_")
			? await ctx.db
					.query("exercises")
					.withIndex("by_gfluxId", (q) => q.eq("gfluxExerciseId", id))
					.unique()
			: await ctx.db.get(id as Id<"exercises">);
		return e ? toView(e) : null;
	},
});

/**
 * Crée un exercice PERSONNALISÉ de la coach (sans source externe) — le cas
 * d'usage « plus tard, la coach crée ses propres exercices » est prévu dès
 * maintenant dans le modèle (system: false, source: "gflux").
 */
export const createCustomExercise = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		name: v.string(),
		muscleGroup: v.optional(v.string()),
		secondaryMuscles: v.optional(v.array(v.string())),
		bodyPart: v.optional(v.string()),
		equipment: v.optional(v.string()),
		category: v.optional(v.string()),
		instructions: v.optional(v.array(v.string())),
		mediaUrl: v.optional(v.string()),
		thumbnailUrl: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ sessionToken, name, muscleGroup, secondaryMuscles, bodyPart, equipment, category, instructions, mediaUrl, thumbnailUrl }
	) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (CRM).");
		const clean = name.trim().slice(0, 120);
		if (clean.length < 2) throw new ConvexError("Le nom de l'exercice est trop court.");

		const now = Date.now();
		const gfluxExerciseId = `ex_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
		const id = await ctx.db.insert("exercises", {
			gfluxExerciseId,
			name: clean,
			muscleGroup: muscleGroup || undefined,
			secondaryMuscles: secondaryMuscles?.length ? secondaryMuscles : undefined,
			bodyPart: bodyPart || undefined,
			equipment: equipment || undefined,
			category: category || undefined,
			instructions: instructions?.length ? instructions : undefined,
			mediaUrl: mediaUrl || undefined,
			thumbnailUrl: thumbnailUrl || undefined,
			source: "gflux",
			active: true,
			system: false,
			coachId: coach._id,
			createdAt: now,
			updatedAt: now,
		});
		return { id, gfluxExerciseId };
	},
});

/** Bascule « masqué » d'un exercice (jamais de suppression en masse). */
export const setHidden = mutation({
	args: { sessionToken: v.optional(v.string()), id: v.id("exercises"), hidden: v.boolean() },
	handler: async (ctx, { sessionToken, id, hidden }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (CRM).");
		const e = await ctx.db.get(id);
		if (!e) throw new ConvexError("Exercice introuvable.");
		await ctx.db.patch(id, { hidden, updatedAt: Date.now() });
		return { ok: true };
	},
});

/**
 * Masque (ou réaffiche) en un lot tous les exercices d'une source — utilisé
 * par le script d'import (`--hide-old-source`) pour retirer de l'affichage
 * les anciennes sources de prototype. RÉVERSIBLE (hidden = drapeau, jamais
 * une suppression) : les exercices coach (source "gflux") ne sont JAMAIS
 * concernés, et l'import ne touche pas ce drapeau par la suite.
 */
export const hideBySource = mutation({
	args: { sessionToken: v.optional(v.string()), source: v.string(), hidden: v.boolean() },
	handler: async (ctx, { sessionToken, source, hidden }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (script d'import authentifié).");
		if (!source) throw new ConvexError("Source requise.");
		const rows = await ctx.db.query("exercises").collect();
		const targets = rows.filter((e) => e.source === source && (e.hidden ?? false) !== hidden);
		await Promise.all(targets.map((e) => ctx.db.patch(e._id, { hidden, updatedAt: Date.now() })));
		return { hidden: targets.length };
	},
});

/* ═══════════ Hébergement interne des médias (script, auth coach) ═══════════ */

/**
 * Liste paginée des exercices d'une source pour l'auto-hébergement des médias
 * (script `host-exercise-media.mjs`) : ne renvoie que les champs nécessaires
 * (ids + URLs), ordonnée par `_creationTime` → pagination stable.
 */
export const listForMediaHosting = query({
	args: {
		sessionToken: v.optional(v.string()),
		source: v.string(),
		limit: v.optional(v.number()),
		cursor: v.optional(v.number()),
	},
	handler: async (ctx, { sessionToken, source, limit = 100, cursor = 0 }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (script authentifié).");
		const rows = await ctx.db.query("exercises").collect();
		const mine = rows
			.filter((e) => e.source === source)
			.sort((a, b) => a._creationTime - b._creationTime);
		const page = mine.slice(cursor, cursor + limit).map((e) => ({
			_id: e._id,
			gfluxExerciseId: e.gfluxExerciseId,
			sourceExerciseId: e.sourceExerciseId,
			sourceMediaUrl: e.sourceMediaUrl ?? e.mediaUrl,
			mediaStorageId: e.mediaStorageId,
			mediaSizeBytes: e.mediaSizeBytes,
			/** Miniature actuelle — sert au script à repérer celles qui pointent
			 *  encore vers la source (passe de réparation sans ré-upload). */
			thumbnailUrl: e.thumbnailUrl,
		}));
		return { items: page, total: mine.length, hasMore: cursor + limit < mine.length };
	},
});

/** URL d'upload courte durée pour un GIF d'exercice (le BFF/script poste le fichier). */
export const generateMediaUploadUrl = mutation({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (script authentifié).");
		return await ctx.storage.generateUploadUrl();
	},
});

/**
 * Attache un média hébergé à un lot d'exercices (script d'auto-hébergement).
 * `mediaUrl` est remplacé UNIQUEMENT si le stockage a réussi (le script ne
 * soumet jamais un storageId inexistant) ; `sourceMediaUrl` conserve l'URL
 * d'origine. Idempotent : ré-attacher les mêmes valeurs est sans effet.
 */
export const attachMediaBatch = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		items: v.array(
			v.object({
				exerciseId: v.id("exercises"),
				storageId: v.id("_storage"),
				mediaSizeBytes: v.number(),
			})
		),
	},
	handler: async (ctx, { sessionToken, items }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (script authentifié).");
		if (items.length === 0 || items.length > IMPORT_BATCH_SIZE) {
			throw new ConvexError(`Un lot doit contenir entre 1 et ${IMPORT_BATCH_SIZE} items.`);
		}
		let attached = 0;
		const errors: { exerciseId: string; error: string }[] = [];
		for (const it of items) {
			try {
				const e = await ctx.db.get(it.exerciseId);
				if (!e) throw new Error("exercice introuvable");
				// URL interne résolue depuis le storage (CDN G-FLUX à l'avenir).
				const url = await ctx.storage.getUrl(it.storageId);
				await ctx.db.patch(it.exerciseId, {
					// La source d'origine est figée au premier hébergement (jamais écrasée).
					sourceMediaUrl: e.sourceMediaUrl ?? e.mediaUrl,
					mediaStorageId: it.storageId,
					mediaUrl: url ?? undefined,
					// La miniature sert le MÊME média interne (la source ne fournit
					// qu'un GIF) — la grille ne charge plus le domaine source.
					thumbnailUrl: url ?? undefined,
					mediaSizeBytes: it.mediaSizeBytes,
					updatedAt: Date.now(),
				});
				attached++;
			} catch (err) {
				errors.push({ exerciseId: it.exerciseId, error: err instanceof Error ? err.message : String(err) });
			}
		}
		return { attached, errors };
	},
});

/* ═══════════ Import (réservé au script, auth coach) ═══════════ */

/**
 * Upsert d'un lot d'exercices importés (script `import-exercises.mjs`).
 *
 * - Reconnaissance par (source, sourceExerciseId) via l'index `by_source_id`
 *   → jamais de doublon, un ré-import MET À JOUR au lieu de recréer ;
 * - Les champs portés par la coach (`hidden`, `name` renommé) sont PRÉSERVÉS :
 *   on met à jour `sourceName` mais on n'écrase jamais un nom déjà édité ;
 * - Aucune suppression : les exercices G-FLUX existants restent intacts,
 *   même s'ils disparaissent de la source ;
 * - Idempotent côté gfluxExerciseId : un id déterministe (hash source+id)
 *   garanti unique évite toute collision de clé.
 */
export const importBatch = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		/** Id de source (ex. "free-exercise-db"). */
		source: v.string(),
		/** Repère du lot ("source@yyyy-mm-dd") — traçabilité. */
		importBatch: v.string(),
		licenseNote: v.optional(v.string()),
		items: v.array(
			v.object({
				sourceExerciseId: v.string(),
				name: v.string(),
				sourceName: v.optional(v.string()),
				muscleGroup: v.optional(v.string()),
				secondaryMuscles: v.optional(v.array(v.string())),
				bodyPart: v.optional(v.string()),
				equipment: v.optional(v.string()),
				category: v.optional(v.string()),
				instructions: v.optional(v.array(v.string())),
				mediaUrl: v.optional(v.string()),
				thumbnailUrl: v.optional(v.string()),
				mediaUrls: v.optional(v.array(v.string())),
			})
		),
	},
	handler: async (ctx, { sessionToken, source, importBatch, licenseNote, items }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") {
			throw new ConvexError("Réservé à la coach (script d'import authentifié).");
		}
		if (source === "gflux") throw new ConvexError("Source réservée aux exercices coach.");
		if (items.length === 0 || items.length > IMPORT_BATCH_SIZE) {
			throw new ConvexError(`Un lot doit contenir entre 1 et ${IMPORT_BATCH_SIZE} exercices.`);
		}

		const now = Date.now();
		let imported = 0;
		let updated = 0;
		let unchanged = 0;
		const errors: { sourceExerciseId: string; error: string }[] = [];

		for (const item of items) {
			const name = item.name.trim().slice(0, 120);
			if (!item.sourceExerciseId || name.length < 2) {
				errors.push({ sourceExerciseId: item.sourceExerciseId ?? "", error: "Nom ou id source invalide." });
				continue;
			}
			try {
				// Détacher les undefined (Convex n'accepte pas les clés undefined
				// dans un patch : on ne patche que les champs réellement présents).
				const normalized: ImportedExercise = {
					gfluxExerciseId: "", // posé ci-dessous
					name,
					...(item.sourceName?.trim() ? { sourceName: item.sourceName.trim().slice(0, 120) } : {}),
					...(item.muscleGroup ? { muscleGroup: item.muscleGroup } : {}),
					...(item.secondaryMuscles?.length ? { secondaryMuscles: item.secondaryMuscles } : {}),
					...(item.bodyPart ? { bodyPart: item.bodyPart } : {}),
					...(item.equipment ? { equipment: item.equipment } : {}),
					...(item.category ? { category: item.category } : {}),
					...(item.instructions?.length ? { instructions: item.instructions } : {}),
					...(item.mediaUrl ? { mediaUrl: item.mediaUrl } : {}),
					...(item.thumbnailUrl ? { thumbnailUrl: item.thumbnailUrl } : {}),
					...(item.mediaUrls?.length ? { mediaUrls: item.mediaUrls } : {}),
				};
				normalized.gfluxExerciseId = await stableGfluxId(source, item.sourceExerciseId);

				const existing = await ctx.db
					.query("exercises")
					.withIndex("by_source_id", (q) =>
						q.eq("source", source).eq("sourceExerciseId", item.sourceExerciseId)
					)
					.unique();

				if (existing) {
					// Comparaison (coût faible, bibliothèque ≈ 1500 lignes) : ne
					// compte « mis à jour » que si quelque chose change vraiment.
					const patch: Partial<ImportedExercise> & { licenseNote?: string; active?: boolean } = {};
					if (existing.name !== normalized.name) patch.name = normalized.name;
					if (item.sourceName && existing.sourceName !== normalized.sourceName) patch.sourceName = normalized.sourceName;
					if (normalized.muscleGroup && existing.muscleGroup !== normalized.muscleGroup) patch.muscleGroup = normalized.muscleGroup;
					if (normalized.secondaryMuscles && JSON.stringify(existing.secondaryMuscles ?? []) !== JSON.stringify(normalized.secondaryMuscles)) {
						patch.secondaryMuscles = normalized.secondaryMuscles;
					}
					if (normalized.bodyPart && existing.bodyPart !== normalized.bodyPart) patch.bodyPart = normalized.bodyPart;
					if (normalized.equipment && existing.equipment !== normalized.equipment) patch.equipment = normalized.equipment;
					if (normalized.category && existing.category !== normalized.category) patch.category = normalized.category;
					if (normalized.instructions && JSON.stringify(existing.instructions ?? []) !== JSON.stringify(normalized.instructions)) {
						patch.instructions = normalized.instructions;
					}
					if (normalized.mediaUrl && existing.mediaUrl !== normalized.mediaUrl) patch.mediaUrl = normalized.mediaUrl;
					if (normalized.thumbnailUrl && existing.thumbnailUrl !== normalized.thumbnailUrl) patch.thumbnailUrl = normalized.thumbnailUrl;
					if (normalized.mediaUrls && JSON.stringify(existing.mediaUrls ?? []) !== JSON.stringify(normalized.mediaUrls)) {
						patch.mediaUrls = normalized.mediaUrls;
					}
					if (licenseNote && existing.licenseNote !== licenseNote) patch.licenseNote = licenseNote;
					// Réactivation implicite : une source qui revient réactive un
					// exercice passé en actif=false (jamais un hidden coach).
					let reactivated = false;
					if (!existing.active) {
						patch.active = true;
						reactivated = true;
					}
					if (Object.keys(patch).length > 0) {
						await ctx.db.patch(existing._id, { ...patch, updatedAt: now });
						updated++;
					} else {
						unchanged++;
					}
					void reactivated;
				} else {
					await ctx.db.insert("exercises", {
						...normalized,
						gfluxExerciseId: normalized.gfluxExerciseId,
						source,
						sourceExerciseId: item.sourceExerciseId,
						licenseNote: licenseNote || undefined,
						active: true,
						system: true,
						importBatch,
						createdAt: now,
						updatedAt: now,
					});
					imported++;
				}
			} catch (e) {
				errors.push({
					sourceExerciseId: item.sourceExerciseId,
					error: e instanceof Error ? e.message : String(e),
				});
			}
		}
		return { imported, updated, unchanged, errors };
	},
});

/**
 * gfluxExerciseId déterministe : hash SHA-256 de (source, sourceExerciseId)
 * → « ex_ » + 20 hex. Stable d'un import à l'autre, indépendant de la source
 * (deux sources différentes → deux ids différents grâce au préfixe source).
 */
async function stableGfluxId(source: string, sourceExerciseId: string): Promise<string> {
	const data = new TextEncoder().encode(`${source}:${sourceExerciseId}`);
	const digest = await crypto.subtle.digest("SHA-256", data);
	const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
	return `ex_${hex.slice(0, 20)}`;
}

/* ═══════════ Audit & purge par source (script, auth coach) ═══════════ */

/**
 * Audit AVANT purge d'une source : compte les exercices de la source et les
 * programmes qui référencent au moins un de ces exercices. Lecture seule —
 * la décision de suppression reste explicite côté coach/script.
 */
export const auditSourcePurge = query({
	args: { sessionToken: v.optional(v.string()), source: v.string() },
	handler: async (ctx, { sessionToken, source }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (script authentifié).");
		if (!source || source === "gflux") throw new ConvexError("Source invalide pour une purge.");

		const rows = await ctx.db.query("exercises").collect();
		const targets = rows.filter((e) => e.source === source);
		const targetIds = new Set(targets.map((e) => e._id));

		// Lignes de séances qui référencent le périmètre → programmes concernés.
		const ses = await ctx.db.query("trainingSessionExercises").collect();
		const touchingSessionIds = new Set(ses.filter((s) => targetIds.has(s.exerciseId)).map((s) => s.sessionId));
		const sessions = await ctx.db.query("trainingSessions").collect();
		const touchingProgramIds = new Set(sessions.filter((s) => touchingSessionIds.has(s._id)).map((s) => s.programId));
		const programs = await ctx.db.query("trainingPrograms").collect();
		const touching = programs.filter((p) => touchingProgramIds.has(p._id));

		return {
			exercises: targets.length,
			customAtRisk: 0, // les exercices coach (source "gflux") ne sont jamais dans le périmètre
			programsReferencing: touching.map((p) => ({
				_id: p._id,
				name: p.name,
				sessionCount: sessions.filter((s) => s.programId === p._id && touchingSessionIds.has(s._id)).length,
			})),
		};
	},
});

/**
 * PURGE DÉFINITIVE des exercices d'une source (script d'import, auth coach).
 *
 * Garde-fous :
 *  - la source "gflux" (exercices personnalisés coach) est INTTOUCHABLE ;
 *  - `dryRun: true` ne supprime rien (compte seulement) ;
 *  - les lignes `trainingSessionExercises` (+ séries) qui référencent les
 *    exercices purgés sont supprimées en cascade — SEULEMENT celles-là ;
 *  - les séances/programmes vides qui en résultent sont conservés (aucun
 *    programme n'est supprimé automatiquement).
 */
export const purgeSource = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		source: v.string(),
		dryRun: v.optional(v.boolean()),
	},
	handler: async (ctx, { sessionToken, source, dryRun }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (script authentifié).");
		if (!source || source === "gflux") throw new ConvexError("La source \"gflux\" (exercices coach) ne peut pas être purgée.");

		const rows = await ctx.db.query("exercises").collect();
		const targets = rows.filter((e) => e.source === source);
		const targetIds = new Set(targets.map((e) => e._id));

		// Lignes de programmes qui référencent le périmètre.
		const ses = await ctx.db.query("trainingSessionExercises").collect();
		const touching = ses.filter((s) => targetIds.has(s.exerciseId));

		if (dryRun) {
			return { deletedExercises: targets.length, deletedSessionExercises: touching.length, deletedSets: 0, dryRun: true };
		}

		let deletedSets = 0;
		for (const se of touching) {
			const sets = await ctx.db
				.query("trainingSets")
				.withIndex("by_sessionExercise", (q) => q.eq("sessionExerciseId", se._id))
				.collect();
			for (const st of sets) {
				await ctx.db.delete(st._id);
				deletedSets++;
			}
			await ctx.db.delete(se._id);
		}
		for (const e of targets) {
			await ctx.db.delete(e._id);
		}
		return { deletedExercises: targets.length, deletedSessionExercises: touching.length, deletedSets, dryRun: false };
	},
});
