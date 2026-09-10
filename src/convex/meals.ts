import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import type { QueryCtx } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";

/**
 * Repas personnalisés (« créés par moi ») et aliments favoris.
 *
 * - `meals`     : recette du client (ingrédients en snapshot + totaux pour le
 *   plat entier). Une portion = totaux × (portion / poids total du plat).
 * - `favorites` : aliments mis en favori pour un ajout rapide.
 */

const MEALS = ["petit-dej", "dejeuner", "diner", "collation"] as const;
type Meal = (typeof MEALS)[number];

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

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ─────────────────────────── Repas personnalisés ─────────────────────────── */

const ingredientInput = v.object({
	foodId: v.optional(v.id("foods")),
	customFoodId: v.optional(v.id("customFoods")),
	qtyGrams: v.number(),
});

/** Crée un repas : totaux calculés côté serveur à partir de la base. */
export const createMeal = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		name: v.string(),
		description: v.optional(v.string()),
		ingredients: v.array(ingredientInput),
	},
	handler: async (ctx, { sessionToken, name, description, ingredients }) => {
		const user = await requireClient(ctx, sessionToken);
		const clean = name.trim();
		if (clean.length < 2 || clean.length > 80) {
			throw new ConvexError("Donne un nom à ton repas (entre 2 et 80 caractères).");
		}
		if (description && description.trim().length > 300) {
			throw new ConvexError("Description trop longue (300 caractères max).");
		}
		if (ingredients.length === 0) {
			throw new ConvexError("Ajoute au moins un ingrédient à ton repas.");
		}
		if (ingredients.length > 30) {
			throw new ConvexError("Maximum 30 ingrédients par repas.");
		}

		let totalWeight = 0;
		let kcal = 0;
		let carbs = 0;
		let protein = 0;
		let fat = 0;

		const snapshot = [];
		for (const ing of ingredients) {
			if (!isFinite(ing.qtyGrams) || ing.qtyGrams <= 0 || ing.qtyGrams > 5000) {
				throw new ConvexError("Quantité d'ingrédient invalide (entre 1 et 5000 g).");
			}
			if (!ing.foodId && !ing.customFoodId) {
				throw new ConvexError("Un ingrédient est invalide : aliment introuvable.");
			}
			let food: { name: string; brand?: string; imageUrl?: string; kcal100: number; carbs100: number; protein100: number; fat100: number } | null = null;
			if (ing.foodId) {
				const f = await ctx.db.get(ing.foodId);
				if (!f) throw new ConvexError("Un ingrédient n'existe plus dans la base. Retire-le et réessaie.");
				food = f;
			} else if (ing.customFoodId) {
				const f = await ctx.db.get(ing.customFoodId);
				if (!f || f.userId !== user._id) {
					throw new ConvexError("Un ingrédient personnel n'existe plus. Retire-le et réessaie.");
				}
				food = f;
			}
			if (!food) throw new ConvexError("Ingrédient invalide : aliment introuvable.");
			const k = ing.qtyGrams / 100;
			const row = {
				foodId: ing.foodId ?? undefined,
				customFoodId: ing.customFoodId ?? undefined,
				name: food.name,
				brand: food.brand,
				imageUrl: food.imageUrl,
				qtyGrams: ing.qtyGrams,
				kcal: Math.round(food.kcal100 * k),
				carbs: round1(food.carbs100 * k),
				protein: round1(food.protein100 * k),
				fat: round1(food.fat100 * k),
			};
			snapshot.push(row);
			totalWeight += ing.qtyGrams;
			kcal += row.kcal;
			carbs += row.carbs;
			protein += row.protein;
			fat += row.fat;
		}

		const mealId = await ctx.db.insert("meals", {
			userId: user._id,
			name: clean,
			description: description?.trim() || undefined,
			totalWeight: Math.round(totalWeight),
			kcal: Math.round(kcal),
			carbs: round1(carbs),
			protein: round1(protein),
			fat: round1(fat),
			ingredients: snapshot,
			createdAt: Date.now(),
		});
		return { ok: true, mealId };
	},
});

/** Les repas du client (du plus récent au plus ancien). */
export const listMeals = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireClient(ctx, sessionToken);
		const meals = await ctx.db
			.query("meals")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.order("desc")
			.collect();
		return meals;
	},
});

/** Supprime un repas (propriétaire uniquement). */
export const deleteMeal = mutation({
	args: { sessionToken: v.optional(v.string()), mealId: v.id("meals") },
	handler: async (ctx, { sessionToken, mealId }) => {
		const user = await requireClient(ctx, sessionToken);
		const meal = await ctx.db.get(mealId);
		if (!meal || meal.userId !== user._id) throw new ConvexError("Repas introuvable.");
		await ctx.db.delete(mealId);
		return { ok: true };
	},
});

/** Journalise une portion de repas : macros = totaux × (portion / poids du plat). */
export const addMealEntry = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
		meal: v.string(),
		mealId: v.id("meals"),
		portionGrams: v.number(),
	},
	handler: async (ctx, { sessionToken, date, meal, mealId, portionGrams }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		if (!isMeal(meal)) throw new ConvexError("Repas invalide.");
		if (!isFinite(portionGrams) || portionGrams <= 0 || portionGrams > 5000) {
			throw new ConvexError("Quantité invalide (entre 1 et 5000 g).");
		}
		const rec = await ctx.db.get(mealId);
		if (!rec || rec.userId !== user._id) throw new ConvexError("Repas introuvable.");
		if (rec.totalWeight <= 0) throw new ConvexError("Ce repas a un poids total invalide.");

		const ratio = portionGrams / rec.totalWeight;
		const entryId = await ctx.db.insert("diaryEntries", {
			userId: user._id,
			date,
			meal,
			mealId,
			name: rec.name,
			imageUrl: rec.ingredients[0]?.imageUrl,
			qtyGrams: portionGrams,
			kcal: Math.round(rec.kcal * ratio),
			carbs: round1(rec.carbs * ratio),
			protein: round1(rec.protein * ratio),
			fat: round1(rec.fat * ratio),
			createdAt: Date.now(),
		});
		return { ok: true, entryId };
	},
});

/* ─────────────────────────── Favoris ─────────────────────────── */

/** Ajoute/retire un aliment des favoris. Retourne le nouvel état. */
export const toggleFavorite = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		foodId: v.id("foods"),
	},
	handler: async (ctx, { sessionToken, foodId }) => {
		const user = await requireClient(ctx, sessionToken);
		const food = await ctx.db.get(foodId);
		if (!food) throw new ConvexError("Cet aliment n'existe plus dans la base.");
		const existing = await ctx.db
			.query("favorites")
			.withIndex("by_user_food", (q) => q.eq("userId", user._id).eq("foodId", foodId))
			.first();
		if (existing) {
			await ctx.db.delete(existing._id);
			return { favorite: false };
		}
		await ctx.db.insert("favorites", { userId: user._id, foodId, createdAt: Date.now() });
		return { favorite: true };
	},
});

/** Les aliments favoris du client (documents complets, du plus récent au plus ancien). */
export const listFavorites = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireClient(ctx, sessionToken);
		const rows = await ctx.db
			.query("favorites")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.order("desc")
			.collect();
		const foods = await Promise.all(rows.map((r) => ctx.db.get(r.foodId)));
		return foods.filter((f): f is Doc<"foods"> => f !== null);
	},
});