import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

/**
 * Suivi corporel (progression) : poids, tour de cou, tour de taille et
 * circonférence des fessiers, enregistrés par date (une ligne par jour),
 * plus la taille (cm) stockée sur le profil.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateISO(s: string): boolean {
	if (!DATE_RE.test(s)) return false;
	const [y, m, d] = s.split("-").map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

async function requireClient(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") {
		throw new ConvexError("Seuls les comptes clients peuvent enregistrer leur progression.");
	}
	return user;
}

/** Résout la cible d'une action coach : vérifie le rôle coach + le client visé. */
async function resolveCoachTarget(
	ctx: Pick<QueryCtx, "db">,
	sessionToken: string | undefined | null,
	userId: import("./_generated/dataModel").Id<"users">
): Promise<import("./_generated/dataModel").Doc<"users">> {
	const coach = await getSessionUser(ctx, sessionToken);
	if (!coach) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (coach.role !== "coach") throw new ConvexError("Réservé à la coach (CRM).");
	const target = await ctx.db.get(userId);
	if (!target || target.role !== "client") throw new ConvexError("Client introuvable.");
	return target;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function clampValue(n: number, min: number, max: number, label: string): number {
	if (!isFinite(n)) throw new ConvexError(`${label} invalide.`);
	if (n < min || n > max) throw new ConvexError(`${label} doit être entre ${min} et ${max}.`);
	return round1(n);
}

/** Une clé de métrique : poids ou l'une des trois mensurations. */
export const metricKey = v.union(
	v.literal("weightKg"),
	v.literal("neckCm"),
	v.literal("waistCm"),
	v.literal("hipCm")
);
type MetricKey = "weightKg" | "neckCm" | "waistCm" | "hipCm";

const METRIC_RANGE: Record<MetricKey, [number, number, string]> = {
	weightKg: [30, 350, "Le poids"],
	neckCm: [20, 80, "Le tour de cou"],
	waistCm: [40, 250, "Le tour de taille"],
	hipCm: [50, 300, "La circonférence des fessiers"],
};

function patchMetric(metric: MetricKey, value: number | undefined) {
	if (metric === "weightKg") return { weightKg: value };
	if (metric === "neckCm") return { neckCm: value };
	if (metric === "waistCm") return { waistCm: value };
	return { hipCm: value };
}

/* Variantes coach (CRM) : la coach consulte et corrige les mensurations/
   poids d'un client, « en doublon » avec lui. */

/** Toutes les prises d'un client donné (réservé coach). */
export const listForCoach = query({
	args: { sessionToken: v.optional(v.string()), userId: v.id("users") },
	handler: async (ctx, { sessionToken, userId }) => {
		const target = await resolveCoachTarget(ctx, sessionToken, userId);
		const rows = await ctx.db.query("bodyMetrics").withIndex("by_user", (q) => q.eq("userId", userId)).order("asc").collect();
		return { heightCm: target.heightCm ?? null, measurements: rows };
	},
});

/** Enregistre / met à jour une prise pour un client (réservé coach). */
export const upsertForCoach = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		date: v.string(),
		weightKg: v.optional(v.number()),
		neckCm: v.optional(v.number()),
		waistCm: v.optional(v.number()),
		hipCm: v.optional(v.number()),
	},
	handler: async (ctx, { sessionToken, userId, date, weightKg, neckCm, waistCm, hipCm }) => {
		await resolveCoachTarget(ctx, sessionToken, userId);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		const patch: Partial<Doc<"bodyMetrics">> = {};
		if (weightKg !== undefined) patch.weightKg = clampValue(weightKg, 30, 350, "Le poids");
		if (neckCm !== undefined) patch.neckCm = clampValue(neckCm, 20, 80, "Le tour de cou");
		if (waistCm !== undefined) patch.waistCm = clampValue(waistCm, 40, 250, "Le tour de taille");
		if (hipCm !== undefined) patch.hipCm = clampValue(hipCm, 50, 300, "La circonférence des fessiers");
		if (Object.keys(patch).length === 0) throw new ConvexError("Saisis au moins une mesure.");
		const existing = await ctx.db.query("bodyMetrics").withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date)).first();
		if (existing) await ctx.db.patch(existing._id, patch);
		else await ctx.db.insert("bodyMetrics", { userId, date, ...patch, createdAt: Date.now() });
		return { ok: true };
	},
});

/** Modifie UNE métrique d'une date pour un client (réservé coach). */
export const updateOneForCoach = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		date: v.string(),
		metric: metricKey,
		value: v.number(),
	},
	handler: async (ctx, { sessionToken, userId, date, metric, value }) => {
		await resolveCoachTarget(ctx, sessionToken, userId);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		const [min, max, label] = METRIC_RANGE[metric];
		const val = clampValue(value, min, max, label);
		const existing = await ctx.db.query("bodyMetrics").withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date)).first();
		const patch = patchMetric(metric, val);
		if (existing) await ctx.db.patch(existing._id, patch);
		else await ctx.db.insert("bodyMetrics", { userId, date, ...patch, createdAt: Date.now() });
		return { ok: true };
	},
});

/** Supprime UNE métrique d'une date pour un client (réservé coach). */
export const deleteOneForCoach = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		date: v.string(),
		metric: metricKey,
	},
	handler: async (ctx, { sessionToken, userId, date, metric }) => {
		await resolveCoachTarget(ctx, sessionToken, userId);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		const existing = await ctx.db.query("bodyMetrics").withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date)).first();
		if (!existing) return { ok: true };
		await ctx.db.patch(existing._id, patchMetric(metric, undefined));
		const after = await ctx.db.get(existing._id);
		if (after && after.weightKg === undefined && after.neckCm === undefined && after.waistCm === undefined && after.hipCm === undefined) {
			await ctx.db.delete(existing._id);
		}
		return { ok: true };
	},
});

/** Enregistre la taille (cm) d'un client (réservé coach). */
export const saveHeightForCoach = mutation({
	args: { sessionToken: v.optional(v.string()), userId: v.id("users"), heightCm: v.number() },
	handler: async (ctx, { sessionToken, userId, heightCm }) => {
		await resolveCoachTarget(ctx, sessionToken, userId);
		const h = clampValue(heightCm, 80, 250, "La taille");
		await ctx.db.patch(userId, { heightCm: h });
		return { ok: true };
	},
});

/** Toutes les prises de mesures du client (du plus ancien au plus récent) + sa taille. */
export const list = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireClient(ctx, sessionToken);
		const rows = await ctx.db
			.query("bodyMetrics")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.order("asc")
			.collect();
		return { heightCm: user.heightCm ?? null, measurements: rows };
	},
});

/**
 * Enregistre / met à jour la prise du jour. On ne fournit que les champs à
 * écrire : une ligne par date, les champs déjà saisis sont conservés.
 */
export const upsert = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
		weightKg: v.optional(v.number()),
		neckCm: v.optional(v.number()),
		waistCm: v.optional(v.number()),
		hipCm: v.optional(v.number()),
	},
	handler: async (ctx, { sessionToken, date, weightKg, neckCm, waistCm, hipCm }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");

		const patch: Partial<Doc<"bodyMetrics">> = {};
		if (weightKg !== undefined) patch.weightKg = clampValue(weightKg, 30, 350, "Le poids");
		if (neckCm !== undefined) patch.neckCm = clampValue(neckCm, 20, 80, "Le tour de cou");
		if (waistCm !== undefined) patch.waistCm = clampValue(waistCm, 40, 250, "Le tour de taille");
		if (hipCm !== undefined) patch.hipCm = clampValue(hipCm, 50, 300, "La circonférence des fessiers");
		if (Object.keys(patch).length === 0) {
			throw new ConvexError("Saisis au moins une mesure.");
		}

		const existing = await ctx.db
			.query("bodyMetrics")
			.withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", date))
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, patch);
		} else {
			await ctx.db.insert("bodyMetrics", {
				userId: user._id,
				date,
				...patch,
				createdAt: Date.now(),
			});
		}
		return { ok: true };
	},
});

/**
 * Modifie UNE métrique sur une date donnée (les autres du même jour sont
 * conservées). Sert à corriger une valeur erronée depuis la courbe.
 */
export const updateOne = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
		metric: metricKey,
		value: v.number(),
	},
	handler: async (ctx, { sessionToken, date, metric, value }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		const [min, max, label] = METRIC_RANGE[metric];
		const val = clampValue(value, min, max, label);
		const existing = await ctx.db
			.query("bodyMetrics")
			.withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", date))
			.first();
		const patch = patchMetric(metric, val);
		if (existing) {
			await ctx.db.patch(existing._id, patch);
		} else {
			await ctx.db.insert("bodyMetrics", { userId: user._id, date, ...patch, createdAt: Date.now() });
		}
		return { ok: true };
	},
});

/**
 * Supprime UNE métrique d'une date donnée. Si le jour n'a plus aucune
 * mesure, la ligne entière est supprimée.
 */
export const deleteOne = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
		metric: metricKey,
	},
	handler: async (ctx, { sessionToken, date, metric }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		const existing = await ctx.db
			.query("bodyMetrics")
			.withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", date))
			.first();
		if (!existing) return { ok: true };
		await ctx.db.patch(existing._id, patchMetric(metric, undefined));
		const after = await ctx.db.get(existing._id);
		if (
			after &&
			after.weightKg === undefined &&
			after.neckCm === undefined &&
			after.waistCm === undefined &&
			after.hipCm === undefined
		) {
			await ctx.db.delete(existing._id);
		}
		return { ok: true };
	},
});

/** Enregistre la taille (cm) sur le profil du client. */
export const saveHeight = mutation({
	args: { sessionToken: v.optional(v.string()), heightCm: v.number() },
	handler: async (ctx, { sessionToken, heightCm }) => {
		const user = await requireClient(ctx, sessionToken);
		const h = clampValue(heightCm, 80, 250, "La taille");
		await ctx.db.patch(user._id, { heightCm: h });
		return { ok: true };
	},
});