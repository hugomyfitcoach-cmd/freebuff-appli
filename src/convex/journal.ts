import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import type { QueryCtx } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";

/**
 * Journal alimentaire (tracking de calories).
 *
 * - `foods`       : base alimentaire locale (export Open Food Facts trié,
 *   France/Europe, ~780k produits) + compléments OFF en cache (valeurs /100 g).
 * - `diaryEntries`: aliments consommés (un jour, un repas).
 * - `clientGoals` : objectifs journaliers définis par la coach dans le CRM.
 *
 * La recherche (action `searchFoods`) vit dans `off.ts` : base locale d'abord
 * (index plein texte `by_name`), Open Food Facts en secours.
 */

export const MEALS = ["petit-dej", "dejeuner", "diner", "collation"] as const;
export type Meal = (typeof MEALS)[number];

/** Objectifs par défaut tant que la coach n'a pas défini le plan (CRM). */
export const DEFAULT_GOALS = { kcal: 2000, carbs: 250, protein: 90, fat: 65 };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateISO(s: string): boolean {
	if (!DATE_RE.test(s)) return false;
	const [y, m, d] = s.split("-").map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isMeal(m: string): m is Meal {
	return (MEALS as readonly string[]).includes(m);
}

async function requireClient(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") {
		throw new ConvexError("Seuls les comptes clients peuvent utiliser le journal alimentaire.");
	}
	return user;
}

/* ─────────────────────────── Queries du journal ─────────────────────────── */

export const checkSession = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await getSessionUser(ctx, sessionToken);
		return user ? { _id: user._id, role: user.role } : null;
	},
});

/** Recherche plein texte dans la base locale (`foods`, index by_name). */
export const searchLocal = query({
	args: { sessionToken: v.optional(v.string()), query: v.string() },
	handler: async (ctx, { sessionToken, query }) => {
		await requireClient(ctx, sessionToken);
		const term = query.trim().toLowerCase();
		if (term.length < 2) return [];
		return ctx.db.query("foods").withSearchIndex("by_name", (sb) => sb.search("name", term)).take(25);
	},
});

/** Recherche exacte par code-barres (offId = EAN/GTIN) dans la base locale. */
export const foodByBarcode = query({
	args: {
		sessionToken: v.optional(v.string()),
		barcode: v.string(),
	},
	handler: async (ctx, { sessionToken, barcode }) => {
		await requireClient(ctx, sessionToken);
		const code = barcode.replace(/\D/g, "");
		if (!code) return null;
		return (
			(await ctx.db
				.query("foods")
				.withIndex("by_offId", (q) => q.eq("offId", code))
				.first()) ?? null
		);
	},
});

/** Produits par ids (pour reconstituer un résultat de recherche). */
export const foodsByIds = query({
	args: { sessionToken: v.optional(v.string()), ids: v.array(v.id("foods")) },
	handler: async (ctx, { sessionToken, ids }) => {
		await requireClient(ctx, sessionToken);
		const foods = await Promise.all(ids.map((id) => ctx.db.get(id)));
		return foods.filter((f): f is Doc<"foods"> => f !== null);
	},
});

/** Upsert des produits OFF dans le cache local. */
export const cacheFoods = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		products: v.array(
			v.object({
				offId: v.string(),
				name: v.string(),
				brand: v.optional(v.string()),
				kcal100: v.number(),
				carbs100: v.number(),
				protein100: v.number(),
				fat100: v.number(),
				imageUrl: v.optional(v.string()),
				servingQty: v.optional(v.number()),
				servingUnit: v.optional(v.string()),
			})
		),
	},
	handler: async (ctx, { sessionToken, products }) => {
		await requireClient(ctx, sessionToken);
		const ids: Id<"foods">[] = [];
		for (const p of products) {
			const existing = await ctx.db
				.query("foods")
				.withIndex("by_offId", (q) => q.eq("offId", p.offId))
				.first();
			const id = existing ? existing._id : await ctx.db.insert("foods", p);
			ids.push(id);
		}
		return ids;
	},
});

/* ─────────────────────────── Objectifs (coach) ─────────────────────────── */

export const setClientGoals = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		kcal: v.number(),
		carbs: v.number(),
		protein: v.number(),
		fat: v.number(),
	},
	handler: async (ctx, { sessionToken, userId, kcal, carbs, protein, fat }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") {
			throw new ConvexError("Seule la coach peut définir les objectifs.");
		}
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") {
			throw new ConvexError("Ce compte client n'existe pas.");
		}
		if (
			!isFinite(kcal) || kcal < 800 || kcal > 6000 ||
			!isFinite(carbs) || carbs < 0 || carbs > 1000 ||
			!isFinite(protein) || protein < 0 || protein > 400 ||
			!isFinite(fat) || fat < 0 || fat > 300
		) {
			throw new ConvexError("Objectifs hors plage. Vérifie les valeurs (kcal 800-6000, macros en grammes).");
		}
		const goals = { userId, kcal, carbs, protein, fat };
		const existing = await ctx.db
			.query("clientGoals")
			.withIndex("by_userId", (q) => q.eq("userId", userId))
			.first();
		if (existing) await ctx.db.patch(existing._id, goals);
		else await ctx.db.insert("clientGoals", goals);
		return { ok: true };
	},
});

/** Objectifs d'un client — réservé à la coach (CRM). */
export const getClientGoals = query({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
	},
	handler: async (ctx, { sessionToken, userId }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") {
			throw new ConvexError("Réservé à la coach.");
		}
		const row = await ctx.db
			.query("clientGoals")
			.withIndex("by_userId", (q) => q.eq("userId", userId))
			.first();
		return row ?? { userId, ...DEFAULT_GOALS };
	},
});

/* ─────────────────────────── Journal ─────────────────────────── */

/** Jour complet d'un client : objectifs + entrées + totaux. */
export const getDay = query({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
	},
	handler: async (ctx, { sessionToken, date }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");

		const [entries, goalsRow] = await Promise.all([
			ctx.db
				.query("diaryEntries")
				.withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", date))
				.order("asc")
				.collect(),
			ctx.db
				.query("clientGoals")
				.withIndex("by_userId", (q) => q.eq("userId", user._id))
				.first(),
		]);

		const totals = entries.reduce(
			(acc, e) => {
				acc.kcal += e.kcal;
				acc.carbs += e.carbs;
				acc.protein += e.protein;
				acc.fat += e.fat;
				return acc;
			},
			{ kcal: 0, carbs: 0, protein: 0, fat: 0 }
		);
		for (const k of Object.keys(totals) as (keyof typeof totals)[]) {
			totals[k] = Math.round(totals[k] * 10) / 10;
		}

		return {
			date,
			goals: goalsRow ?? { userId: user._id, ...DEFAULT_GOALS },
			goalsSet: !!goalsRow,
			entries,
			totals,
		};
	},
});

/** Ajoute un aliment au journal. Les macros sont recalculées côté serveur. */
export const addEntry = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
		meal: v.string(),
		foodId: v.id("foods"),
		qtyGrams: v.number(),
	},
	handler: async (ctx, { sessionToken, date, meal, foodId, qtyGrams }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		if (!isMeal(meal)) throw new ConvexError("Repas invalide.");
		if (!isFinite(qtyGrams) || qtyGrams <= 0 || qtyGrams > 5000) {
			throw new ConvexError("Quantité invalide (entre 1 et 5000 g).");
		}
		const food = await ctx.db.get(foodId);
		if (!food) throw new ConvexError("Cet aliment n'existe plus dans la base.");

		const k = qtyGrams / 100;
		const entryId = await ctx.db.insert("diaryEntries", {
			userId: user._id,
			date,
			meal,
			foodId,
			name: food.name,
			brand: food.brand,
			imageUrl: food.imageUrl,
			qtyGrams,
			kcal: Math.round(food.kcal100 * k),
			carbs: Math.round(food.carbs100 * k * 10) / 10,
			protein: Math.round(food.protein100 * k * 10) / 10,
			fat: Math.round(food.fat100 * k * 10) / 10,
			createdAt: Date.now(),
		});
		return { ok: true, entryId };
	},
});

/** Modifie la quantité d'une entrée (les macros sont recalculées). */
export const updateEntryQty = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		entryId: v.id("diaryEntries"),
		qtyGrams: v.number(),
	},
	handler: async (ctx, { sessionToken, entryId, qtyGrams }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isFinite(qtyGrams) || qtyGrams <= 0 || qtyGrams > 5000) {
			throw new ConvexError("Quantité invalide (entre 1 et 5000 g).");
		}
		const entry = await ctx.db.get(entryId);
		if (!entry || entry.userId !== user._id) throw new ConvexError("Entrée introuvable.");
		const k = qtyGrams / 100;
		const kcal100 = entry.kcal / (entry.qtyGrams / 100);
		const carbs100 = entry.carbs / (entry.qtyGrams / 100);
		const protein100 = entry.protein / (entry.qtyGrams / 100);
		const fat100 = entry.fat / (entry.qtyGrams / 100);
		await ctx.db.patch(entryId, {
			qtyGrams,
			kcal: Math.round(kcal100 * k),
			carbs: Math.round(carbs100 * k * 10) / 10,
			protein: Math.round(protein100 * k * 10) / 10,
			fat: Math.round(fat100 * k * 10) / 10,
		});
		return { ok: true };
	},
});

/** Supprime une entrée du journal (propriétaire uniquement). */
export const removeEntry = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		entryId: v.id("diaryEntries"),
	},
	handler: async (ctx, { sessionToken, entryId }) => {
		const user = await requireClient(ctx, sessionToken);
		const entry = await ctx.db.get(entryId);
		if (!entry || entry.userId !== user._id) throw new ConvexError("Entrée introuvable.");
		await ctx.db.delete(entryId);
		return { ok: true };
	},
});