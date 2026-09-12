import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import { FOOD_SEARCH_CANDIDATES, rankFoods } from "./foodRanking";
import { resolveCoachPlanForDate } from "./mealPlans";
import { ciqualFoodSource } from "./ciqualSource";
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
		// Candidats élargis puis re-tri (foodRanking) : l'aliment brut (« tomate »,
		// « riz ») doit passer devant les produits de marque du classement BM25.
		const foods = await ctx.db
			.query("foods")
			.withSearchIndex("by_name", (sb) => sb.search("name", term))
			.take(FOOD_SEARCH_CANDIDATES);
		return rankFoods(foods.map(toHit), term).slice(0, 25);
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
		/** Fiche de RÉFÉRENCE Ciqual (ANSES) : libellé officiel exact — exclusif avec foodId. */
		ciqualLabel: v.optional(v.string()),
		qtyGrams: v.number(),
	},
	handler: async (ctx, { sessionToken, userId, date, meal, foodId, ciqualLabel, qtyGrams }) => {
		await resolveCoachTarget(ctx, sessionToken, userId);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		if (!isMeal(meal)) throw new ConvexError("Repas invalide.");
		if (!isFinite(qtyGrams) || qtyGrams <= 0 || qtyGrams > 5000) {
			throw new ConvexError("Quantité invalide (entre 1 et 5000 g).");
		}
		// Fiche de référence Ciqual (additif) : valeurs résolues côté serveur,
		// aucune donnée OFF lue ou fusionnée.
		const ciqualRef = ciqualLabel ? ciqualFoodSource(ciqualLabel) : null;
		if (ciqualLabel && !ciqualRef) throw new ConvexError("Cette référence Ciqual n'existe plus.");
		if (!foodId && !ciqualRef) throw new ConvexError("Aucun aliment fourni.");

		let name: string;
		let brand: string | undefined;
		let imageUrl: string | undefined;
		let kcal100: number;
		let carbs100: number;
		let protein100: number;
		let fat100: number;
		if (ciqualRef) {
			name = ciqualRef.name;
			kcal100 = ciqualRef.kcal100;
			carbs100 = ciqualRef.carbs100;
			protein100 = ciqualRef.protein100;
			fat100 = ciqualRef.fat100;
		} else {
			const food = await ctx.db.get(foodId as Id<"foods">);
			if (!food) throw new ConvexError("Cet aliment n'existe plus dans la base.");
			name = food.name;
			brand = food.brand;
			imageUrl = food.imageUrl;
			kcal100 = food.kcal100;
			carbs100 = food.carbs100;
			protein100 = food.protein100;
			fat100 = food.fat100;
		}

		const k = qtyGrams / 100;
		await ctx.db.insert("diaryEntries", {
			userId,
			date,
			meal,
			foodId: ciqualRef ? undefined : foodId,
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

/**
 * Forme de réponse de la recherche paginée : les produits arrivent par
 * tranches de 25 (le client charge la suite au défilement). `hasMore` dit
 * s'il reste des produits au-delà de la tranche renvoyée.
 */
export type SearchPage = { items: FoodHit[]; hasMore: boolean };

/** Recherche plein texte : base OFF + aliments personnels du client. */
export const searchLocal = query({
	args: {
		sessionToken: v.optional(v.string()),
		query: v.string(),
		/** Décalage dans le classement (0 = première page de 25). */
		offset: v.optional(v.number()),
		/** Taille de tranche (défaut 25 — l'UI charge 25 par 25). */
		limit: v.optional(v.number()),
	},
	handler: async (ctx, { sessionToken, query, offset = 0, limit = 25 }) => {
		const user = await requireClient(ctx, sessionToken);
		const term = query.trim().toLowerCase();
		if (term.length < 2) return { items: [] as FoodHit[], hasMore: false } as SearchPage;
		// Candidats élargis puis re-tri (foodRanking) : les aliments bruts passent
		// devant les produits de marque, sans modifier la base.
		const [foods, customs] = await Promise.all([
			ctx.db
				.query("foods")
				.withSearchIndex("by_name", (sb) => sb.search("name", term))
				.take(FOOD_SEARCH_CANDIDATES),
			ctx.db
				.query("customFoods")
				.withSearchIndex("by_name", (sb) => sb.search("name", term))
				.filter((q) => q.eq(q.field("userId"), user._id))
				.take(10),
		]);
		// Les aliments « Créés par moi » restent en fin de PREMIÈRE page (ordre
		// historique, pas paginés) : la pagination ne s'applique qu'aux produits
		// de la base OFF, sans jamais les dupliquer.
		const ranked = rankFoods(foods.map(toHit), term);
		return {
			items: [...ranked.slice(offset, offset + limit), ...(offset === 0 ? customs.map(toCustomHit) : [])],
			hasMore: offset + limit < ranked.length,
		};
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

/** Aliments « fréquents » : derniers aliments réellement consommés par la
 *  cliente (dédupliqués, résolus en hits complets) — alimente l'écran
 *  « Ajouter un aliment » avant toute saisie. Jamais de données inventées. */
export const recentFoods = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireClient(ctx, sessionToken);
		const recent = await ctx.db
			.query("diaryEntries")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.order("desc")
			.take(40);
		const seen = new Set<string>();
		const foodIds: Id<"foods">[] = [];
		const customIds: Id<"customFoods">[] = [];
		for (const e of recent) {
			const key = e.foodId ? `f:${e.foodId}` : e.customFoodId ? `c:${e.customFoodId}` : null;
			if (!key || seen.has(key)) continue;
			seen.add(key);
			if (e.foodId) foodIds.push(e.foodId);
			if (e.customFoodId) customIds.push(e.customFoodId);
			if (seen.size >= 12) break;
		}
		const [foodRows, customRows] = await Promise.all([
			Promise.all(foodIds.map((id) => ctx.db.get(id))),
			Promise.all(customIds.map((id) => ctx.db.get(id))),
		]);
		const hits: FoodHit[] = [];
		for (const f of foodRows) if (f) hits.push(toHit(f));
		for (const f of customRows) if (f) hits.push(toCustomHit(f));
		return hits;
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

/** Jour complet d'un client : objectifs + entrées consommées + items planifiés + totaux.
 *
 * PLANIFIÉ ≠ CONSOMMÉ (single source of truth) :
 * - `entries`/`totals` : UNIQUEMENT ce qui est réellement consommé (diaryEntries) ;
 * - `planned`/`plannedTotals` : propositions (plan coach + préparation cliente)
 *   — grises dans l'UI, zéro impact sur le header tant qu'elles ne sont pas validées.
 * Le plan coach actif est résolu (copy-on-write) AVANT la lecture — la mutation
 * `mealPlans.ensurePlanForDate` est appelée par l'endpoint juste avant.
 */
export const getDay = query({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
	},
	handler: async (ctx, { sessionToken, date }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");

		const [entries, goalsRow, plannedRows] = await Promise.all([
			ctx.db
				.query("diaryEntries")
				.withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", date))
				.order("asc")
				.collect(),
			ctx.db
				.query("clientGoals")
				.withIndex("by_userId", (q) => q.eq("userId", user._id))
				.first(),
			ctx.db
				.query("plannedEntries")
				.withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", date))
				.order("asc")
				.collect(),
		]);

		// Portion OFF (mode « portion » à l'édition) : on joint l'aliment de la
		// base ou l'aliment personnel associé à chaque entrée (consommée OU planifiée).
		const foodIds = [...new Set([...entries, ...plannedRows].map((e) => e.foodId).filter((x): x is Id<"foods"> => !!x))];
		const customIds = [...new Set([...entries, ...plannedRows].map((e) => e.customFoodId).filter((x): x is Id<"customFoods"> => !!x))];
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
		const plannedOut = plannedRows.map((e) => {
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
		// Totaux PRÉVUS — information secondaire uniquement (jamais le header).
		const plannedTotals = plannedRows.reduce(
			(acc, e) => {
				acc.kcal += e.kcal;
				acc.carbs += e.carbs;
				acc.protein += e.protein;
				acc.fat += e.fat;
				return acc;
			},
			{ kcal: 0, carbs: 0, protein: 0, fat: 0 }
		);
		for (const k of Object.keys(plannedTotals) as (keyof typeof plannedTotals)[]) {
			plannedTotals[k] = Math.round(plannedTotals[k] * 10) / 10;
		}

		return {
			date,
			goals: goalsRow ?? { userId: user._id, ...DEFAULT_GOALS },
			goalsSet: !!goalsRow,
			entries: entriesOut,
			totals,
			planned: plannedOut,
			plannedTotals,
		};
	},
});

/** Ajout LIBRE : aujourd'hui → consommé (comportement historique du tracker) ;
 *  date FUTURE → planifié (client_planned — grisé, zéro impact header). */
export const addEntry = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
		meal: v.string(),
		foodId: v.optional(v.id("foods")),
		customFoodId: v.optional(v.id("customFoods")),
		/** Fiche de RÉFÉRENCE Ciqual (ANSES) : libellé officiel EXACT — exclusif avec foodId/customFoodId. */
		ciqualLabel: v.optional(v.string()),
		qtyGrams: v.number(),
	},
	handler: async (ctx, { sessionToken, date, meal, foodId, customFoodId, ciqualLabel, qtyGrams }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		if (!isMeal(meal)) throw new ConvexError("Repas invalide.");
		if (!isFinite(qtyGrams) || qtyGrams <= 0 || qtyGrams > 5000) {
			throw new ConvexError("Quantité invalide (entre 1 et 5000 g).");
		}
		// Fiche de RÉFÉRENCE Ciqual (additif, jamais destructif) : le client ne
		// transmet qu'un LIBELLÉ officiel exact — le serveur résout les valeurs
		// /100 g depuis la table embarquée (jamais depuis le client). Aucune
		// donnée OFF n'est lue, modifiée ou fusionnée : uniquement un snapshot
		// journal comme pour tout autre aliment.
		const ciqualRef = ciqualLabel ? ciqualFoodSource(ciqualLabel) : null;
		if (ciqualLabel && !ciqualRef) {
			throw new ConvexError("Cette référence Ciqual n'existe plus.");
		}
		if (!foodId && !customFoodId && !ciqualRef) {
			throw new ConvexError("Aucun aliment fourni.");
		}

		// Résout le plan coach actif AVANT l'ajout (copy-on-write) : sur une date
		// future, les propositions apparaissent même si getDay n'a pas encore tourné.
		await resolveCoachPlanForDate(ctx, user._id, date);

		let name = '';
		let brand: string | undefined;
		let imageUrl: string | undefined;
		let kcal100 = 0;
		let carbs100 = 0;
		let protein100 = 0;
		let fat100 = 0;
		if (ciqualRef) {
			name = ciqualRef.name;
			kcal100 = ciqualRef.kcal100;
			carbs100 = ciqualRef.carbs100;
			protein100 = ciqualRef.protein100;
			fat100 = ciqualRef.fat100;
		} else if (foodId) {
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
		const today = localTodayOfTs();
		const future = date > today;
		if (future) {
			// JOUR FUTUR → PLANNED (client_planned) : jamais compté comme consommé.
			const entryId = await ctx.db.insert("plannedEntries", {
				userId: user._id,
				date,
				meal,
				source: "client_planned",
				name,
				brand,
				imageUrl,
				qtyGrams,
				kcal: Math.round(kcal100 * k),
				carbs: Math.round(carbs100 * k * 10) / 10,
				protein: Math.round(protein100 * k * 10) / 10,
				fat: Math.round(fat100 * k * 10) / 10,
				foodId: foodId ?? undefined,
				customFoodId: customFoodId ?? undefined,
				createdAt: Date.now(),
			});
			return { ok: true, entryId, planned: true };
		}
		// Aujourd'hui (ou passé) → entrée consommée classique.
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
		return { ok: true, entryId, planned: false };
	},
});

/** Jour ISO local du serveur (sert uniquement de frontière « futur → planifié »). */
function localTodayOfTs(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

/* ═══════════════════ Items PLANNED (planifiés, non consommés) ═══════════════════
 *
 * RÈGLE ABSOLUE — PLANIFIÉ ≠ CONSOMMÉ :
 * - une plannedEntry n'impacte JAMAIS le header (calories/macros/donuts/barre) ;
 * - la validation « Mangé » la transforme en diaryEntry (consommé, une seule
 *   source de vérité des calories) puis supprime la ligne planifiée ;
 * - « remettre en planifié » fait l'inverse, de façon parfaitement réversible ;
 * - la date du jour seule autorise la validation (pas de « mangé » dans le futur).
 */

async function requireOwnPlanned(
	ctx: Pick<QueryCtx, "db">,
	userId: Id<"users">,
	plannedId: Id<"plannedEntries">
): Promise<Doc<"plannedEntries">> {
	const row = await ctx.db.get(plannedId);
	if (!row || row.userId !== userId) throw new ConvexError("Aliment planifié introuvable.");
	return row;
}

/** Validation d'un item planifié : planned → diaryEntries (consommé). */
export const eatPlanned = mutation({
	args: { sessionToken: v.optional(v.string()), plannedId: v.id("plannedEntries") },
	handler: async (ctx, { sessionToken, plannedId }) => {
		const user = await requireClient(ctx, sessionToken);
		const p = await requireOwnPlanned(ctx, user._id, plannedId);
		if (!isValidDateISO(p.date)) throw new ConvexError("Date invalide.");
		if (!isMeal(p.meal)) throw new ConvexError("Repas invalide.");
		const today = localTodayOfTs();
		if (p.date > today) {
			throw new ConvexError("Impossible de valider « Mangé » sur une date future.");
		}
		const entryId = await ctx.db.insert("diaryEntries", {
			userId: user._id,
			date: p.date,
			meal: p.meal,
			foodId: p.foodId,
			customFoodId: p.customFoodId,
			name: p.name,
			brand: p.brand,
			imageUrl: p.imageUrl,
			qtyGrams: p.qtyGrams,
			kcal: p.kcal,
			carbs: p.carbs,
			protein: p.protein,
			fat: p.fat,
			source: "planned_eaten",
			createdAt: Date.now(),
		});
		await ctx.db.delete(plannedId);
		return { ok: true, entryId };
	},
});

/** Annulation : consommé → planifié (retrait immédiat des totaux, réversible). */
export const uneatEntry = mutation({
	args: { sessionToken: v.optional(v.string()), entryId: v.id("diaryEntries") },
	handler: async (ctx, { sessionToken, entryId }) => {
		const user = await requireClient(ctx, sessionToken);
		const entry = await ctx.db.get(entryId);
		if (!entry || entry.userId !== user._id) throw new ConvexError("Entrée introuvable.");
		const today = localTodayOfTs();
		// Une journée passée verrouille l'historique : on ne réécrit pas le passé.
		if (entry.date < today) throw new ConvexError("Impossible de dé-valider un jour passé.");
		await ctx.db.insert("plannedEntries", {
			userId: user._id,
			date: entry.date,
			meal: entry.meal,
			source: "client_planned",
			name: entry.name,
			brand: entry.brand,
			imageUrl: entry.imageUrl,
			qtyGrams: entry.qtyGrams,
			kcal: entry.kcal,
			carbs: entry.carbs,
			protein: entry.protein,
			fat: entry.fat,
			foodId: entry.foodId,
			customFoodId: entry.customFoodId,
			createdAt: Date.now(),
		});
		await ctx.db.delete(entryId);
		return { ok: true };
	},
});

/** Quantité d'un item PLANIFIÉ (reste planifié, zéro impact header). */
export const updatePlannedQty = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		plannedId: v.id("plannedEntries"),
		qtyGrams: v.number(),
		meal: v.optional(v.string()),
	},
	handler: async (ctx, { sessionToken, plannedId, qtyGrams, meal }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isFinite(qtyGrams) || qtyGrams <= 0 || qtyGrams > 5000) {
			throw new ConvexError("Quantité invalide (entre 1 et 5000 g).");
		}
		if (meal !== undefined && !isMeal(meal)) throw new ConvexError("Repas invalide.");
		const p = await requireOwnPlanned(ctx, user._id, plannedId);
		const k = qtyGrams / 100;
		const kcal100 = p.qtyGrams > 0 ? p.kcal / (p.qtyGrams / 100) : 0;
		const carbs100 = p.qtyGrams > 0 ? p.carbs / (p.qtyGrams / 100) : 0;
		const protein100 = p.qtyGrams > 0 ? p.protein / (p.qtyGrams / 100) : 0;
		const fat100 = p.qtyGrams > 0 ? p.fat / (p.qtyGrams / 100) : 0;
		await ctx.db.patch(plannedId, {
			qtyGrams,
			kcal: Math.round(kcal100 * k),
			carbs: Math.round(carbs100 * k * 10) / 10,
			protein: Math.round(protein100 * k * 10) / 10,
			fat: Math.round(fat100 * k * 10) / 10,
			...(meal !== undefined ? { meal } : {}),
		});
		return { ok: true };
	},
});

/** Supprime un item planifié (ce jour uniquement — le template coach reste intact). */
export const removePlanned = mutation({
	args: { sessionToken: v.optional(v.string()), plannedId: v.id("plannedEntries") },
	handler: async (ctx, { sessionToken, plannedId }) => {
		const user = await requireClient(ctx, sessionToken);
		await requireOwnPlanned(ctx, user._id, plannedId);
		await ctx.db.delete(plannedId);
		return { ok: true };
	},
});

/** Remplace un item planifié par un autre aliment (ce jour uniquement). */
export const replacePlanned = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		plannedId: v.id("plannedEntries"),
		foodId: v.optional(v.id("foods")),
		customFoodId: v.optional(v.id("customFoods")),
		qtyGrams: v.number(),
	},
	handler: async (ctx, { sessionToken, plannedId, foodId, customFoodId, qtyGrams }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isFinite(qtyGrams) || qtyGrams <= 0 || qtyGrams > 5000) {
			throw new ConvexError("Quantité invalide (entre 1 et 5000 g).");
		}
		if (!foodId && !customFoodId) throw new ConvexError("Aucun aliment fourni.");
		const p = await requireOwnPlanned(ctx, user._id, plannedId);

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
			if (!food || food.userId !== user._id) throw new ConvexError("Cet aliment ne t'appartient pas.");
			name = food.name;
			brand = food.brand;
			kcal100 = food.kcal100;
			carbs100 = food.carbs100;
			protein100 = food.protein100;
			fat100 = food.fat100;
		}
		const k = qtyGrams / 100;
		await ctx.db.patch(plannedId, {
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
		});
		return { ok: true };
	},
});

/** Validation en masse : plusieurs items planifiés → consommés (jour uniquement). */
export const eatManyPlanned = mutation({
	args: { sessionToken: v.optional(v.string()), plannedIds: v.array(v.id("plannedEntries")) },
	handler: async (ctx, { sessionToken, plannedIds }) => {
		const user = await requireClient(ctx, sessionToken);
		const today = localTodayOfTs();
		let eaten = 0;
		for (const plannedId of plannedIds.slice(0, 60)) {
			const p = await ctx.db.get(plannedId);
			if (!p || p.userId !== user._id) continue;
			if (p.date > today) continue; // jamais « mangé » dans le futur
			if (!isValidDateISO(p.date) || !isMeal(p.meal)) continue;
			await ctx.db.insert("diaryEntries", {
				userId: user._id,
				date: p.date,
				meal: p.meal,
				foodId: p.foodId,
				customFoodId: p.customFoodId,
				name: p.name,
				brand: p.brand,
				imageUrl: p.imageUrl,
				qtyGrams: p.qtyGrams,
				kcal: p.kcal,
				carbs: p.carbs,
				protein: p.protein,
				fat: p.fat,
				source: "planned_eaten",
				createdAt: Date.now(),
			});
			await ctx.db.delete(plannedId);
			eaten++;
		}
		return { ok: true, eaten };
	},
});