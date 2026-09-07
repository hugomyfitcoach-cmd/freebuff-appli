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

/** Résout la cible d'une action coach : le coach ou le compte client visé. */
async function resolveCoachTarget(
	ctx: Pick<QueryCtx, "db">,
	sessionToken: string | undefined | null,
	userId: Id<"users">
): Promise<Doc<"users">> {
	const coach = await getSessionUser(ctx, sessionToken);
	if (!coach) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (coach.role !== "coach") throw new ConvexError("Réservé à la coach (CRM).");
	const target = await ctx.db.get(userId);
	if (!target || target.role !== "client") throw new ConvexError("Client introuvable.");
	return target;
}

/* Variantes coach (CRM) : la coach peut consulter et compléter le journal
   d'un client, « en doublon » avec lui. */

/** Jour complet d'un client donné (réservé coach). */
export const getDayForCoach = query({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		date: v.string(),
	},
	handler: async (ctx, { sessionToken, userId, date }) => {
		await resolveCoachTarget(ctx, sessionToken, userId);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		const [entries, goalsRow] = await Promise.all([
			ctx.db.query("diaryEntries").withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date)).order("asc").collect(),
			ctx.db.query("clientGoals").withIndex("by_userId", (q) => q.eq("userId", userId)).first(),
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
			goals: goalsRow ?? { userId, ...DEFAULT_GOALS },
			goalsSet: !!goalsRow,
			entries,
			totals,
		};
	},
});

/** Recherche d'aliments (base locale) — réservé coach (CRM). */
export const searchForCoach = query({
	args: { sessionToken: v.optional(v.string()), query: v.string() },
	handler: async (ctx, { sessionToken, query }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach (CRM).");
		const term = query.trim().toLowerCase();
		if (term.length < 2) return [] as FoodHit[];
		const foods = await ctx.db.query("foods").withSearchIndex("by_name", (sb) => sb.search("name", term)).take(25);
		return foods.map(toHit);
	},
});

/** Ajoute un aliment au journal d'un client (réservé coach). */
export const addEntryForCoach = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		date: v.string(),
		meal: v.string(),
		foodId: v.optional(v.id("foods")),
		qtyGrams: v.number(),
	},
	handler: async (ctx, { sessionToken, userId, date, meal, foodId, qtyGrams }) => {
		await resolveCoachTarget(ctx, sessionToken, userId);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		if (!isMeal(meal)) throw new ConvexError("Repas invalide.");
		if (!isFinite(qtyGrams) || qtyGrams <= 0 || qtyGrams > 5000) {
			throw new ConvexError("Quantité invalide (entre 1 et 5000 g).");
		}
		if (!foodId) throw new ConvexError("Aucun aliment fourni.");
		const food = await ctx.db.get(foodId);
		if (!food) throw new ConvexError("Cet aliment n'existe plus dans la base.");
		const k = qtyGrams / 100;
		await ctx.db.insert("diaryEntries", {
			userId,
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
		return { ok: true };
	},
});

/** Modifie la quantité d'une entrée d'un client (réservé coach). */
export const updateEntryQtyForCoach = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		entryId: v.id("diaryEntries"),
		qtyGrams: v.number(),
	},
	handler: async (ctx, { sessionToken, userId, entryId, qtyGrams }) => {
		await resolveCoachTarget(ctx, sessionToken, userId);
		if (!isFinite(qtyGrams) || qtyGrams <= 0 || qtyGrams > 5000) {
			throw new ConvexError("Quantité invalide (entre 1 et 5000 g).");
		}
		const entry = await ctx.db.get(entryId);
		if (!entry || entry.userId !== userId) throw new ConvexError("Entrée introuvable pour ce client.");
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

/** Supprime une entrée du journal d'un client (réservé coach). */
export const removeEntryForCoach = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		entryId: v.id("diaryEntries"),
	},
	handler: async (ctx, { sessionToken, userId, entryId }) => {
		await resolveCoachTarget(ctx, sessionToken, userId);
		const entry = await ctx.db.get(entryId);
		if (!entry || entry.userId !== userId) throw new ConvexError("Entrée introuvable pour ce client.");
		await ctx.db.delete(entryId);
		return { ok: true };
	},
});

/* ─────────────────────────── Queries du journal ─────────────────────────── */

/** Résultat de recherche unifié : aliment de la base OFF ou aliment personnel. */
export type FoodHit = {
	_id: string;
	custom: boolean;
	offId?: string;
	name: string;
	brand?: string;
	kcal100: number;
	carbs100: number;
	protein100: number;
	fat100: number;
	imageUrl?: string;
	servingQty?: number;
	servingUnit?: string;
};

export function toHit(f: Doc<"foods">): FoodHit {
	return {
		_id: f._id,
		custom: false,
		offId: f.offId,
		name: f.name,
		brand: f.brand,
		kcal100: f.kcal100,
		carbs100: f.carbs100,
		protein100: f.protein100,
		fat100: f.fat100,
		imageUrl: f.imageUrl,
		servingQty: f.servingQty,
		servingUnit: f.servingUnit,
	};
}

function toCustomHit(f: Doc<"customFoods">): FoodHit {
	return {
		_id: f._id,
		custom: true,
		name: f.name,
		brand: f.brand,
		kcal100: f.kcal100,
		carbs100: f.carbs100,
		protein100: f.protein100,
		fat100: f.fat100,
		servingQty: f.servingQty,
	};
}

export const checkSession = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await getSessionUser(ctx, sessionToken);
		return user ? { _id: user._id, role: user.role } : null;
	},
});

/** Recherche plein texte : base OFF + aliments personnels du client. */
export const searchLocal = query({
	args: { sessionToken: v.optional(v.string()), query: v.string() },
	handler: async (ctx, { sessionToken, query }) => {
		const user = await requireClient(ctx, sessionToken);
		const term = query.trim().toLowerCase();
		if (term.length < 2) return [] as FoodHit[];
		const [foods, customs] = await Promise.all([
			ctx.db.query("foods").withSearchIndex("by_name", (sb) => sb.search("name", term)).take(25),
			ctx.db
				.query("customFoods")
				.withSearchIndex("by_name", (sb) => sb.search("name", term))
				.filter((q) => q.eq(q.field("userId"), user._id))
				.take(10),
		]);
		return [...foods.map(toHit), ...customs.map(toCustomHit)];
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
		/** Maintenance calorique (filet de sécurité) — optionnelle, saisie manuelle par la coach. */
		maintenanceKcal: v.optional(v.number()),
		/** True pour effacer la maintenance enregistrée (champ vidé côté CRM). */
		clearMaintenance: v.optional(v.boolean()),
		/** Objectif quotidien de pas — optionnel, saisi manuellement par la coach (ex. 10 000). */
		stepGoal: v.optional(v.number()),
		/** True pour retirer l'objectif de pas enregistré (champ vidé côté CRM). */
		clearStepGoal: v.optional(v.boolean()),
	},
	handler: async (ctx, { sessionToken, userId, kcal, carbs, protein, fat, maintenanceKcal, clearMaintenance, stepGoal, clearStepGoal }) => {
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
		if (
			maintenanceKcal !== undefined &&
			maintenanceKcal !== null &&
			(!isFinite(maintenanceKcal) || maintenanceKcal < kcal || maintenanceKcal > 10000)
		) {
			throw new ConvexError("Maintenance invalide : elle doit être supérieure à l'objectif calorique (et ≤ 10000 kcal).");
		}
		if (
			stepGoal !== undefined &&
			stepGoal !== null &&
			(!Number.isInteger(stepGoal) || stepGoal < 500 || stepGoal > 100000)
		) {
			throw new ConvexError("Objectif de pas invalide (entre 500 et 100 000 pas).");
		}
		// Valeurs optionnelles réellement à écrire (les champs absents ne sont
		// jamais écrasés ; un clear explicite les retire).
		const opt: { maintenanceKcal?: number; stepGoal?: number } = {};
		if (maintenanceKcal !== undefined && maintenanceKcal !== null) opt.maintenanceKcal = maintenanceKcal;
		if (stepGoal !== undefined && stepGoal !== null) opt.stepGoal = stepGoal;

		const existing = await ctx.db
			.query("clientGoals")
			.withIndex("by_userId", (q) => q.eq("userId", userId))
			.first();
		if (existing) {
			const p: Partial<Doc<"clientGoals">> = { kcal, carbs, protein, fat };
			if (clearMaintenance) p.maintenanceKcal = undefined;
			else if (opt.maintenanceKcal !== undefined) p.maintenanceKcal = opt.maintenanceKcal;
			if (clearStepGoal) p.stepGoal = undefined;
			else if (opt.stepGoal !== undefined) p.stepGoal = opt.stepGoal;
			await ctx.db.patch(existing._id, p);
		} else {
			await ctx.db.insert("clientGoals", { userId, kcal, carbs, protein, fat, ...opt });
		}
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

		// Portion OFF (mode « portion » à l'édition) : on joint l'aliment de la
		// base ou l'aliment personnel associé à chaque entrée du jour.
		const foodIds = [...new Set(entries.map((e) => e.foodId).filter((x): x is Id<"foods"> => !!x))];
		const customIds = [...new Set(entries.map((e) => e.customFoodId).filter((x): x is Id<"customFoods"> => !!x))];
		const [foodRows, customRows] = await Promise.all([
			Promise.all(foodIds.map((id) => ctx.db.get(id))),
			Promise.all(customIds.map((id) => ctx.db.get(id))),
		]);
		const servingByFood = new Map<string, { qty?: number; unit?: string }>();
		for (const f of foodRows) if (f) servingByFood.set(f._id, { qty: f.servingQty, unit: f.servingUnit });
		for (const f of customRows) if (f) servingByFood.set(f._id, { qty: f.servingQty });
		const entriesOut = entries.map((e) => {
			const info = e.foodId ? servingByFood.get(e.foodId) : e.customFoodId ? servingByFood.get(e.customFoodId) : undefined;
			return {
				...e,
				servingQty: info?.qty ?? undefined,
				servingUnit: info?.unit ?? undefined,
			};
		});

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
			entries: entriesOut,
			totals,
		};
	},
});

/** Ajoute un aliment au journal (base OFF ou aliment personnel). */
export const addEntry = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
		meal: v.string(),
		foodId: v.optional(v.id("foods")),
		customFoodId: v.optional(v.id("customFoods")),
		qtyGrams: v.number(),
	},
	handler: async (ctx, { sessionToken, date, meal, foodId, customFoodId, qtyGrams }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		if (!isMeal(meal)) throw new ConvexError("Repas invalide.");
		if (!isFinite(qtyGrams) || qtyGrams <= 0 || qtyGrams > 5000) {
			throw new ConvexError("Quantité invalide (entre 1 et 5000 g).");
		}
		if (!foodId && !customFoodId) {
			throw new ConvexError("Aucun aliment fourni.");
		}

		let name = '';
		let brand: string | undefined;
		let imageUrl: string | undefined;
		let kcal100 = 0;
		let carbs100 = 0;
		let protein100 = 0;
		let fat100 = 0;
		if (foodId) {
			const food = await ctx.db.get(foodId);
			if (!food) throw new ConvexError("Cet aliment n'existe plus dans la base.");
			name = food.name;
			brand = food.brand;
			imageUrl = food.imageUrl;
			kcal100 = food.kcal100;
			carbs100 = food.carbs100;
			protein100 = food.protein100;
			fat100 = food.fat100;
		} else if (customFoodId) {
			const food = await ctx.db.get(customFoodId);
			if (!food) throw new ConvexError("Cet aliment n'existe plus dans ta base.");
			if (food.userId !== user._id) throw new ConvexError("Cet aliment ne t'appartient pas.");
			name = food.name;
			brand = food.brand;
			kcal100 = food.kcal100;
			carbs100 = food.carbs100;
			protein100 = food.protein100;
			fat100 = food.fat100;
		}

		const k = qtyGrams / 100;
		const entryId = await ctx.db.insert("diaryEntries", {
			userId: user._id,
			date,
			meal,
			foodId: foodId ?? undefined,
			customFoodId: customFoodId ?? undefined,
			name,
			brand,
			imageUrl,
			qtyGrams,
			kcal: Math.round(kcal100 * k),
			carbs: Math.round(carbs100 * k * 10) / 10,
			protein: Math.round(protein100 * k * 10) / 10,
			fat: Math.round(fat100 * k * 10) / 10,
			createdAt: Date.now(),
		});
		return { ok: true, entryId };
	},
});

/** Modifie la quantité (et éventuellement le repas) d'une entrée — les macros sont recalculées. */
export const updateEntryQty = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		entryId: v.id("diaryEntries"),
		qtyGrams: v.number(),
		meal: v.optional(v.string()),
	},
	handler: async (ctx, { sessionToken, entryId, qtyGrams, meal }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isFinite(qtyGrams) || qtyGrams <= 0 || qtyGrams > 5000) {
			throw new ConvexError("Quantité invalide (entre 1 et 5000 g).");
		}
		if (meal !== undefined && !isMeal(meal)) throw new ConvexError("Repas invalide.");
		const entry = await ctx.db.get(entryId);
		if (!entry || entry.userId !== user._id) throw new ConvexError("Entrée introuvable.");
		const k = qtyGrams / 100;
		const kcal100 = entry.kcal / (entry.qtyGrams / 100);
		const carbs100 = entry.carbs / (entry.qtyGrams / 100);
		const protein100 = entry.protein / (entry.qtyGrams / 100);
		const fat100 = entry.fat / (entry.qtyGrams / 100);
		const patch: {
			qtyGrams: number;
			kcal: number;
			carbs: number;
			protein: number;
			fat: number;
			meal?: string;
		} = {
			qtyGrams,
			kcal: Math.round(kcal100 * k),
			carbs: Math.round(carbs100 * k * 10) / 10,
			protein: Math.round(protein100 * k * 10) / 10,
			fat: Math.round(fat100 * k * 10) / 10,
		};
		if (meal !== undefined) patch.meal = meal;
		await ctx.db.patch(entryId, patch);
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