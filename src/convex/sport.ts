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
	SPORT_CATALOG_VERSION_LEGACY,
	SPORT_CHOIX_DOUCES,
	SPORT_CHOIX_MUSCULATION,
	SPORT_INTENSITY_LABELS,
	SPORT_ZONES_CARDIO,
	WALKING_PEDAGOGY_MESSAGE,
	isDailyWalkingBlocked,
	WALKING_SUGGESTION_ID,
	choixValides,
	clampSportDuration,
	estimateSportActivity,
	getSportEntry,
	intensiteLegacyVersV2,
	verifieBpmMoyen,
} from "./sportCatalog";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

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

/**
 * Valide {activityId, choix, bpmMoyen?, durationMinutes} et calcule
 * l'estimation au barème v2. Le choix (zone cardio, intensité de musculation
 * ou intensité douce) est OBLIGATOIRE — sauf si une FC moyenne réelle est
 * saisie, qui choisit alors la zone pour toutes les activités : aucune zone
 * implicite n'est inventée à la place de la cliente.
 */
function buildEstimation(args: {
	activityId: string;
	intensity?: string;
	bpmMoyen?: number;
	durationMinutes: number;
	weightKg: number | null;
}) {
	if (isDailyWalkingBlocked(args.activityId)) {
		throw new ConvexError(WALKING_PEDAGOGY_MESSAGE);
	}
	const entry = getSportEntry(args.activityId);
	if (!entry) throw new ConvexError("Activité inconnue.");
	const bpm = args.bpmMoyen !== undefined && args.bpmMoyen !== null ? verifieBpmMoyen(args.bpmMoyen) : undefined;
	/* PWA en cache : les anciennes valeurs (legere/moderee/intense) sont
	   converties vers les choix v2 de l'activité — jamais de refus. */
	const intensity =
		args.intensity != null && args.intensity !== "" ? intensiteLegacyVersV2(entry, args.intensity) : args.intensity;
	if (bpm === undefined) {
		if (intensity === undefined || intensity === null || intensity === "") {
			throw new ConvexError("Zone ou intensité requise pour cette activité.");
		}
		if (!choixValides(entry).includes(intensity)) {
			throw new ConvexError("Zone ou intensité invalide pour cette activité.");
		}
	}
	const minutes = clampSportDuration(args.durationMinutes);
	return {
		minutes,
		est: estimateSportActivity({
			activityId: entry.id,
			intensity,
			...(bpm !== undefined ? { bpmMoyen: bpm } : {}),
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
				bpmMoyen: r.bpmMoyen ?? null,
				estimatedCalories: r.estimatedCalories ?? null,
				metMinutes: r.metMinutes,
				source: r.source,
				trainingSessionId: r.trainingSessionId ?? null,
				/** Barème de la ligne : "2" = G-FLUX kcal/kg/h, "1" = MET (historique). */
				coefficientVersion: r.coefficientVersion,
				/** Vrai pour une ligne ANTÉRIEURE au barème : son calcul est conservé. */
				legacy: r.coefficientVersion === SPORT_CATALOG_VERSION_LEGACY,
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
				/** Barème : "musculation" (récréative/intensive), "douce" (intensité
			 *  ressentie, hors zones) ou "cardio" (zones). */
				bareme: a.bareme,
				/** Choix acceptés (zones cardio, intensités de musculation ou douces). */
				choix: choixValides(a),
			})),
			choixMusculation: SPORT_CHOIX_MUSCULATION,
			choixDouces: SPORT_CHOIX_DOUCES,
			zonesCardio: SPORT_ZONES_CARDIO,
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
		/** Intensité — obligatoire pour les activités à intensités (sauf FC moyenne). */
		intensity: v.optional(v.string()),
		/** FC moyenne réellement mesurée (optionnelle) — choisit la zone pour
		 *  toutes les activités. */
		bpmMoyen: v.optional(v.number()),
		durationMinutes: v.number(),
	},
	handler: async (ctx, { sessionToken, date, activityId, intensity, bpmMoyen, durationMinutes }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidISO(date)) throw new ConvexError("Date invalide.");
		const weight = await lastKnownWeight(ctx, user._id);
		const { minutes, est } = buildEstimation({
			activityId,
			intensity,
			bpmMoyen,
			durationMinutes,
			weightKg: weight,
		});
		const now = Date.now();
		// NOUVELLE saisie → barème v2 (coût horaire stocké tel quel sur la ligne).
		const id = await ctx.db.insert("sportActivities", {
			userId: user._id,
			date,
			activityId: est.activityId,
			activityNameSnapshot: est.activityNameSnapshot,
			durationMinutes: minutes,
			intensity: est.intensity,
			metValue: est.metValue,
			...(est.bpmMoyen !== undefined ? { bpmMoyen: est.bpmMoyen } : {}),
			...(est.coutHoraireKcalKgH !== undefined
				? { coutHoraireKcalKgH: est.coutHoraireKcalKgH }
				: {}),
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
			...(row.bpmMoyen !== undefined ? { bpmMoyen: row.bpmMoyen } : {}),
			...(row.coutHoraireKcalKgH !== undefined
				? { coutHoraireKcalKgH: row.coutHoraireKcalKgH }
				: {}),
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
 * d'origine est CONSERVÉ (une nouvelle pesée ne réécrit jamais l'historique).
 * Une ligne v1 n'est JAMAIS recalculée (son MET et ses kcal d'origine restent
 * ceux enregistrés) ; elle bascule au barème v2 UNIQUEMENT si la cliente
 * change explicitement l'activité ou l'intensité.
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
		bpmMoyen: v.optional(v.number()),
		durationMinutes: v.optional(v.number()),
	},
	handler: async (ctx, { sessionToken, activityId, date, activityRef, intensity, bpmMoyen, durationMinutes }) => {
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

		// Poids GELÉ : celui du snapshot d'origine (jamais une pesée plus récente).
		const weight = row.weightSnapshot ?? null;
		// FC moyenne : bornes du barème — refus explicite et lisible hors bornes.
		if (bpmMoyen !== undefined) verifieBpmMoyen(bpmMoyen);

		/* La bascule de barème est EXPLICITE : seule la cliente qui change
		   d'ACTIVITÉ ou d'INTENSITÉ fait passer la ligne au barème v2 — jamais un
		   changement de durée, de date, ni de FC moyenne. */
		const choixChange = entry.id !== row.activityId || newIntensity !== row.intensity;
		/* FC moyenne effacée dès que la cliente repasse à une intensité manuelle
		   (une intensité fournie sans FC la supprime) — même règle qu'à la création. */
		const patchBpm =
			bpmMoyen !== undefined ? { bpmMoyen } : intensity !== undefined ? { bpmMoyen: undefined } : {};
		const legacy = row.coutHoraireKcalKgH === undefined;

		if (!choixChange && legacy) {
			/* Ligne ANTÉRIEURE au barème (v1, MET du Compendium) : JAMAIS
			   recalculée. date / durée s'éditent sans choisir de nouvelle intensité
			   et la ligne garde son MET et ses kcal d'origine — seule une nouvelle
			   activité ou une nouvelle intensité la fait basculer en v2. */
			const minutes = clampSportDuration(newDuration);
			await ctx.db.patch(activityId, {
				...(date !== undefined && isValidISO(date) ? { date } : {}),
				durationMinutes: minutes,
				...patchBpm,
				updatedAt: Date.now(),
			} as never);
			return { ok: true, bareme: "v1" as const };
		}

		/* Ligne v2 dont le choix N'A PAS changé : son coût horaire enregistré
		   reste la référence (seul le volume est recalculé). Une activité
		   passée au barème doux ne réécrit donc jamais un historique cardio. */
		if (!choixChange) {
			const minutes = clampSportDuration(newDuration);
			const cout = row.coutHoraireKcalKgH as number;
			const kcal =
				weight != null && weight > 0
					? Math.round(cout * weight * (minutes / 60))
					: undefined;
			await ctx.db.patch(activityId, {
				...(date !== undefined && isValidISO(date) ? { date } : {}),
				durationMinutes: minutes,
				metMinutes: Math.round(row.metValue * minutes),
				...(kcal !== undefined ? { estimatedCalories: kcal } : {}),
				...patchBpm,
				updatedAt: Date.now(),
			} as never);
			return { ok: true, bareme: "v2" as const };
		}

		/* Nouveau choix explicite (activité ou intensité) → barème v2 (ex. une
		   zone choisie sur une ligne v1), anciennes valeurs d'intensité incluses. */
		const bpmChoisi =
			bpmMoyen !== undefined ? bpmMoyen : intensity !== undefined ? undefined : row.bpmMoyen;
		const { minutes, est } = buildEstimation({
			activityId: entry.id,
			intensity: newIntensity,
			...(bpmChoisi !== undefined ? { bpmMoyen: bpmChoisi } : {}),
			durationMinutes: newDuration,
			weightKg: weight,
		});

		await ctx.db.patch(activityId, {
			...(date !== undefined && isValidISO(date) ? { date } : {}),
			activityId: est.activityId,
			activityNameSnapshot: est.activityNameSnapshot,
			durationMinutes: minutes,
			intensity: est.intensity,
			metValue: est.metValue,
			bpmMoyen: est.bpmMoyen,
			...(est.coutHoraireKcalKgH !== undefined
				? { coutHoraireKcalKgH: est.coutHoraireKcalKgH }
				: {}),
			coefficientSource: est.coefficientSource,
			coefficientVersion: est.coefficientVersion,
			metMinutes: est.metMinutes,
			...(weight != null ? { estimatedCalories: est.estimatedCalories } : {}),
			updatedAt: Date.now(),
		} as never);
		return { ok: true, bareme: "v2" as const };
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
	return intensity ? (SPORT_INTENSITY_LABELS[intensity] ?? null) : null;
}

export type SportActivityDoc = Doc<"sportActivities">;
