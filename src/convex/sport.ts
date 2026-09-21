/**
 * Module Dépense sportive — CÔTÉ CLIENTE (espace /espace/depense-sportive).
 *
 * CRUD des activités sportives réalisées (saisie manuelle) + agrégats de la
 * page (semaine, récents). Les dépenses issues d'une séance G-FLUX sont
 * créées par trainingClient.completeSession — JAMAIS ici (une seule source
 * d'écriture par origine, idempotence par trainingSessionId).
 *
 * Rappels métier non négociables :
 * - les kcal sont un REPÈRE : aucune écriture alimentaire (journal, objectifs,
 *   plans) n'est jamais déclenchée ici ;
 * - le weightSnapshot est gelé : modifier une activité ne reprend JAMAIS un
 *   poids plus récent — seule la durée/intensité/sport peut être recalculée ;
 * - le catalogue refuse toute activité de type marche quotidienne.
 */

import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser, mondayISOof, addDaysISO, localTodayISO } from "./helpers";
import {
	SPORT_CATALOG,
	SPORT_CATEGORIES,
	SPORT_CATALOG_VERSION,
	SPORT_INTENSITY_LABELS,
	WALKING_PEDAGOGY_MESSAGE,
	isDailyWalkingBlocked,
	WALKING_SUGGESTION_ID,
	clampSportDuration,
	estimateSportActivity,
	getSportEntry,
	type SportIntensity,
} from "./sportCatalog";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const INTENSITIES = ["legere", "moderee", "intense"];

function isValidISO(s: string): boolean {
	return ISO_RE.test(s);
}

async function requireClient(
	ctx: Parameters<typeof getSessionUser>[0],
	sessionToken?: string | null
) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") throw new ConvexError("Cette page est réservée à l'espace cliente.");
	return user;
}

/** Dernier poids connu (tri par DATE de mesure — jamais la dernière saisie). */
export async function lastKnownWeight(
	ctx: Pick<MutationCtx, "db">,
	userId: Id<"users">
): Promise<number | null> {
	const rows = await ctx.db
		.query("bodyMetrics")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.order("asc")
		.collect();
	let last: number | null = null;
	for (const m of rows.sort((a, b) => a.date.localeCompare(b.date))) {
		if (m.weightKg != null) last = m.weightKg;
	}
	return last;
}

/** Valide {activityId, intensity, durationMinutes} et calcule l'estimation. */
function buildEstimation(args: {
	activityId: string;
	intensity?: string;
	durationMinutes: number;
	weightKg: number | null;
}) {
	if (isDailyWalkingBlocked(args.activityId)) {
		throw new ConvexError(WALKING_PEDAGOGY_MESSAGE);
	}
	const entry = getSportEntry(args.activityId);
	if (!entry) throw new ConvexError("Activité inconnue.");
	if (typeof entry.met !== "number") {
		// Activité à intensités : l'intensité est OBLIGATOIRE (aucun MET implicite).
		if (args.intensity === undefined || !INTENSITIES.includes(args.intensity)) {
			throw new ConvexError("Intensité requise pour cette activité.");
		}
	}
	const minutes = clampSportDuration(args.durationMinutes);
	return {
		minutes,
		est: estimateSportActivity({
			activityId: args.activityId,
			intensity: args.intensity,
			durationMinutes: minutes,
			weightKg: args.weightKg,
		}),
	};
}

/* ═══════════ Lecture : vue semaine ═══════════ */

/**
 * Vue semaine de la page Dépense sportive : activités du lundi → dimanche
 * affiché + totaux (activités, durée, kcal estimées, MET-minutes). Le front
 * passe `weekStart` (lundi ISO) — défaut : semaine courante.
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
		const start =
			weekStart && isValidISO(weekStart)
				? mondayISOof(weekStart)
				: mondayISOof(today);
		const end = addDaysISO(start, 6);

		const rows = await ctx.db
			.query("sportActivities")
			.withIndex("by_user_date", (q) => q.eq("userId", user._id).gte("date", start).lte("date", end))
			.collect();
		rows.sort((a, b) => a.date.localeCompare(b.date) || a._creationTime - b._creationTime);

		const totals = {
			count: rows.length,
			durationMin: rows.reduce((s, r) => s + r.durationMinutes, 0),
			kcal: rows.reduce((s, r) => s + (r.estimatedCalories ?? 0), 0),
			metMinutes: rows.reduce((s, r) => s + r.metMinutes, 0),
		};

		return {
			weekStart: start,
			weekEnd: end,
			today,
			activities: rows.map((r) => ({
				_id: r._id,
				date: r.date,
				activityId: r.activityId,
				name: r.activityNameSnapshot,
				durationMinutes: r.durationMinutes,
				intensity: r.intensity ?? null,
				estimatedCalories: r.estimatedCalories ?? null,
				metMinutes: r.metMinutes,
				source: r.source,
				trainingSessionId: r.trainingSessionId ?? null,
			})),
			totals,
		};
	},
});

/**
 * Dernières activités distinctes (ajout rapide) — au plus 8, la plus récente
 * d'abord, sans doublon d'activité.
 */
export const myRecentActivities = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireClient(ctx, sessionToken);
		const rows = await ctx.db
			.query("sportActivities")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.order("desc")
			.take(40);
		const seen = new Set<string>();
		const recents: { activityId: string; name: string; intensity: string | null }[] = [];
		for (const r of rows) {
			if (seen.has(r.activityId)) continue;
			seen.add(r.activityId);
			recents.push({ activityId: r.activityId, name: r.activityNameSnapshot, intensity: r.intensity ?? null });
			if (recents.length >= 8) break;
		}
		return { recents };
	},
});

/**
 * Catalogue servi au frontend (une seule source — le client n'invente jamais
 * un MET ni un libellé). Inclut la référence marche (message pédagogique +
 * seule suggestion autorisée).
 */
export const catalog = query({
	args: {},
	handler: async () => {
		return {
			version: SPORT_CATALOG_VERSION,
			categories: SPORT_CATEGORIES,
			activities: SPORT_CATALOG.map((a) => ({
				id: a.id,
				name: a.name,
				category: a.category,
				hasIntensity: typeof a.met !== "number",
			})),
			walking: {
				message: WALKING_PEDAGOGY_MESSAGE,
				suggestionId: WALKING_SUGGESTION_ID,
			},
			intensityLabels: SPORT_INTENSITY_LABELS,
		};
	},
});

/* ═══════════ Écriture : ajout / modification / duplication / suppression ═══════════ */

/** Crée UNE activité (saisie manuelle) — weightSnapshot gelé à la création. */
export const addActivity = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
		activityId: v.string(),
		/** Intensité — obligatoire pour les activités à intensités. */
		intensity: v.optional(v.string()),
		durationMinutes: v.number(),
	},
	handler: async (ctx, { sessionToken, date, activityId, intensity, durationMinutes }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidISO(date)) throw new ConvexError("Date invalide.");
		const weight = await lastKnownWeight(ctx, user._id);
		const { minutes, est } = buildEstimation({ activityId, intensity, durationMinutes, weightKg: weight });
		const now = Date.now();
		const id = await ctx.db.insert("sportActivities", {
			userId: user._id,
			date,
			activityId: est.activityId,
			activityNameSnapshot: est.activityNameSnapshot,
			durationMinutes: minutes,
			intensity,
			metValue: est.metValue,
			coefficientSource: est.coefficientSource,
			coefficientVersion: est.coefficientVersion,
			...(weight != null ? { weightSnapshot: weight, estimatedCalories: est.estimatedCalories } : {}),
			metMinutes: est.metMinutes,
			source: "manual",
			createdAt: now,
			updatedAt: now,
		});
		return { _id: id };
	},
});

/**
 * Duplique une activité : mêmes paramètres (sport/intensité/durée), autre
 * date — la copie est une nouvelle ligne (l'originale reste en place).
 */
export const duplicateActivity = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		activityId: v.id("sportActivities"),
		date: v.string(),
	},
	handler: async (ctx, { sessionToken, activityId, date }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidISO(date)) throw new ConvexError("Date invalide.");
		const row = await ctx.db.get(activityId);
		if (!row || row.userId !== user._id) throw new ConvexError("Activité introuvable.");
		const now = Date.now();
		// Le weightSnapshot d'ORIGINE est conservé (duplication = copie fidèle).
		const id = await ctx.db.insert("sportActivities", {
			userId: user._id,
			date,
			activityId: row.activityId,
			activityNameSnapshot: row.activityNameSnapshot,
			durationMinutes: row.durationMinutes,
			...(row.intensity !== undefined ? { intensity: row.intensity } : {}),
			metValue: row.metValue,
			coefficientSource: row.coefficientSource,
			coefficientVersion: row.coefficientVersion,
			...(row.weightSnapshot !== undefined
				? { weightSnapshot: row.weightSnapshot, estimatedCalories: row.estimatedCalories }
				: {}),
			metMinutes: row.metMinutes,
			source: row.source,
			...(row.trainingSessionId !== undefined ? { trainingSessionId: row.trainingSessionId } : {}),
			...(row.durationSource !== undefined ? { durationSource: row.durationSource } : {}),
			createdAt: now,
			updatedAt: now,
		});
		return { _id: id };
	},
});

/**
 * Modifie sport / date / durée / intensité d'une activité — le weightSnapshot
 * d'origine est CONSERVÉ (une nouvelle pesée ne réécrit jamais l'historique)
 * et les kcal/MET-minutes sont recalculés avec CE poids gelé.
 * Les dépenses liées à une séance G-FLUX ne passent PAS ici (la durée d'une
 * séance se corrige depuis Entraînement, qui met à jour la dépense existante).
 */
export const updateActivity = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		activityId: v.id("sportActivities"),
		date: v.optional(v.string()),
		activityRef: v.optional(v.string()),
		intensity: v.optional(v.string()),
		durationMinutes: v.optional(v.number()),
	},
	handler: async (ctx, { sessionToken, activityId, date, activityRef, intensity, durationMinutes }) => {
		const user = await requireClient(ctx, sessionToken);
		const row = await ctx.db.get(activityId);
		if (!row || row.userId !== user._id) throw new ConvexError("Activité introuvable.");

		const newActivityRef = activityRef ?? row.activityId;
		const newIntensity =
			intensity !== undefined ? intensity : row.intensity !== undefined ? row.intensity : undefined;
		const newDuration = durationMinutes !== undefined ? durationMinutes : row.durationMinutes;

		if (isDailyWalkingBlocked(newActivityRef)) {
			throw new ConvexError(WALKING_PEDAGOGY_MESSAGE);
		}
		const entry = getSportEntry(newActivityRef);
		if (!entry) throw new ConvexError("Activité inconnue.");
		if (typeof entry.met !== "number" && !INTENSITIES.includes(newIntensity ?? "")) {
			throw new ConvexError("Intensité requise pour cette activité.");
		}

		// Poids GELÉ : celui du snapshot d'origine (jamais une pesée plus récente).
		const weight = row.weightSnapshot ?? null;
		const { minutes, est } = buildEstimation({
			activityId: entry.id,
			intensity: newIntensity,
			durationMinutes: newDuration,
			weightKg: weight,
		});

		await ctx.db.patch(activityId, {
			...(date !== undefined && isValidISO(date) ? { date } : {}),
			activityId: est.activityId,
			activityNameSnapshot: est.activityNameSnapshot,
			durationMinutes: minutes,
			...(newIntensity !== undefined ? { intensity: newIntensity } : { intensity: undefined }),
			metValue: est.metValue,
			coefficientSource: est.coefficientSource,
			coefficientVersion: est.coefficientVersion,
			metMinutes: est.metMinutes,
			...(weight != null ? { estimatedCalories: est.estimatedCalories } : {}),
			updatedAt: Date.now(),
		} as never);
		return { ok: true };
	},
});

/** Supprime une activité (confirmation légère côté UI) — recalcul immédiat. */
export const deleteActivity = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		activityId: v.id("sportActivities"),
	},
	handler: async (ctx, { sessionToken, activityId }) => {
		const user = await requireClient(ctx, sessionToken);
		const row = await ctx.db.get(activityId);
		if (!row || row.userId !== user._id) throw new ConvexError("Activité introuvable.");
		await ctx.db.delete(activityId);
		return { ok: true };
	},
});

/** Utilitaires exposés pour les tests et l'agrégat Vision 360. */
export function intensityLabelOf(intensity?: string | null): string | null {
	return intensity && INTENSITIES.includes(intensity)
		? SPORT_INTENSITY_LABELS[intensity as SportIntensity]
		: null;
}

export type SportActivityDoc = Doc<"sportActivities">;
