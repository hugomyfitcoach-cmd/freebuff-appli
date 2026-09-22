import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import { ciqualFoodSource } from "./ciqualSource";
import { attachThumbs, attachThumbsForFoodIds } from "./foodImages";
import { trustedClientToday } from "./journal";
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

import { guardedKcal100 } from "../lib/nutritionGuard";

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ─────────────────────────── Repas personnalisés ─────────────────────────── */

const ingredientInput = v.object({
	foodId: v.optional(v.id("foods")),
	customFoodId: v.optional(v.id("customFoods")),
	/** Fiche de RÉFÉRENCE Ciqual (libellé officiel exact) — exclusif avec foodId/customFoodId. */
	ciqualLabel: v.optional(v.string()),
	qtyGrams: v.number(),
});

/**
 * Composant d'un REPAS ANALYSÉ (photo IA) — mêmes identités qu'un ingrédient,
 * plus les valeurs /100 g de secours quand AUCUN match fiable n'a été trouvé
 * (composant « Estimation IA » : repères à valider, clairement étiquetés,
 * jamais masqués ni convertis en aliment).
 */
const analyzedComponentInput = v.object({
	foodId: v.optional(v.id("foods")),
	customFoodId: v.optional(v.id("customFoods")),
	ciqualLabel: v.optional(v.string()),
	name: v.string(),
	qtyGrams: v.number(),
	/** Valeurs IA /100 g de secours — utilisées UNIQUEMENT si aucune identité. */
	aiKcal100: v.optional(v.number()),
	aiCarbs100: v.optional(v.number()),
	aiProtein100: v.optional(v.number()),
	aiFat100: v.optional(v.number()),
});

/**
 * « Ajouter au Journal » d'un repas analysé : N composants en une mutation.
 *
 * Règles (exactement celles de `journal.addEntry`, appliquées en boucle) :
 * - identités résolues côté serveur (jamais de nutrition transmise par le
 *   client quand une identité existe) ; snapshots + garde-fou kcal↔macros ;
 * - composant SANS identité → estimation IA /100 g encadrée (0–900 kcal,
 *   0–100 g macro), enregistrée avec `source: "ai_estimation"` ;
 * - date future → plannedEntries (client_planned) comme l'ajout unitaire ;
 * - `source` porte aussi le RASSEMBLEMENT repas : chaque composant d'une
 *   même analyse partage `mealGroup` = "analyse:<timestamp>" — le Journal
 *   affiche UNE carte regroupée, les composants restent recalculables.
 */
export const commitAnalyzedMeal = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
		meal: v.string(),
		components: v.array(analyzedComponentInput),
		/** Date ISO locale du navigateur — frontière « futur » (fuseau client ≠ serveur UTC). */
		clientDate: v.optional(v.string()),
	},
	handler: async (ctx, { sessionToken, date, meal, components, clientDate }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		if (!isMeal(meal)) throw new ConvexError("Repas invalide.");
		if (components.length === 0) throw new ConvexError("Aucun composant à ajouter.");
		if (components.length > 12) throw new ConvexError("Maximum 12 composants par repas analysé.");

		const { resolveCoachPlanForDate } = await import("./mealPlans");
		await resolveCoachPlanForDate(ctx, user._id, date);
		const today = trustedClientToday(clientDate);
		const future = date > today;
		const mealGroup = `analyse:${Date.now()}`;
		const created: Id<"diaryEntries">[] = [];

		for (const c of components) {
			const qty = isFinite(c.qtyGrams) && c.qtyGrams > 0 && c.qtyGrams <= 5000 ? c.qtyGrams : 100;
			let name = "";
			let brand: string | undefined;
			let kcal100: number = 0;
			let carbs100: number = 0;
			let protein100: number = 0;
			let fat100: number = 0;
			let source: string | undefined;

			const ciqualRef = c.ciqualLabel ? ciqualFoodSource(c.ciqualLabel) : null;
			if (c.ciqualLabel && !ciqualRef) throw new ConvexError("Une référence Ciqual n'existe plus. Vérifie ce composant.");
			if (ciqualRef) {
				name = ciqualRef.name;
				kcal100 = ciqualRef.kcal100;
				carbs100 = ciqualRef.carbs100;
				protein100 = ciqualRef.protein100;
				fat100 = ciqualRef.fat100;
				source = undefined;
			} else if (c.foodId) {
				const food = await ctx.db.get(c.foodId);
				if (!food) throw new ConvexError("Un composant n'existe plus dans la base. Vérifie-le.");
				name = food.name;
				brand = food.brand;
				kcal100 = guardedKcal100(food);
				carbs100 = food.carbs100;
				protein100 = food.protein100;
				fat100 = food.fat100;
			} else if (c.customFoodId) {
				const food = await ctx.db.get(c.customFoodId);
				if (!food || food.userId !== user._id) throw new ConvexError("Un composant personnel n'existe plus. Vérifie-le.");
				name = food.name;
				brand = food.brand;
				kcal100 = food.kcal100;
				carbs100 = food.carbs100;
				protein100 = food.protein100;
				fat100 = food.fat100;
			} else {
				// Estimation IA (aucun match fiable) : repères /100 g encadrés,
				// jamais convertis en aliment, jamais dans « Créés par moi ».
				name = (c.name || "Composant").trim().slice(0, 80);
				const safe = (v: number | undefined, max: number) =>
					v !== undefined && isFinite(v) && v >= 0 ? Math.min(max, Math.round(v * 10) / 10) : 0;
				kcal100 = safe(c.aiKcal100, 900);
				carbs100 = safe(c.aiCarbs100, 100);
				protein100 = safe(c.aiProtein100, 100);
				fat100 = safe(c.aiFat100, 100);
				source = "ai_estimation";
			}

			const k = qty / 100;
			const row = {
				userId: user._id,
				date,
				meal,
				foodId: ciqualRef ? undefined : c.foodId,
				customFoodId: ciqualRef ? undefined : c.customFoodId,
				name,
				brand,
				qtyGrams: qty,
				kcal: Math.round(kcal100 * k),
				carbs: Math.round(carbs100 * k * 10) / 10,
				protein: Math.round(protein100 * k * 10) / 10,
				fat: Math.round(fat100 * k * 10) / 10,
				source,
				createdAt: Date.now(),
			};
			if (future) {
				// Jour FUTUR → planifié (client_planned), comme l'ajout unitaire.
				await ctx.db.insert("plannedEntries", {
					userId: user._id,
					date,
					meal,
					source: "client_planned",
					name,
					brand,
					qtyGrams: qty,
					kcal: row.kcal,
					carbs: row.carbs,
					protein: row.protein,
					fat: row.fat,
					foodId: row.foodId,
					customFoodId: row.customFoodId,
					createdAt: Date.now(),
				});
			} else {
				const id = await ctx.db.insert("diaryEntries", {
					...row,
					// Clé de regroupement : le Journal affiche UNE carte « repas
					// analysé », les composants restent des diaryEntries normaux
					// (modification/suppression unitaires possibles, totaux intacts).
					mealGroup,
				});
				created.push(id);
			}
		}
		return { ok: true, created: created.length, mealGroup };
	},
});

/**
 * Valide les ingrédients et construit le snapshot + les totaux du repas
 * (partagé par la création et la modification).
 */
async function buildMealData(
	ctx: Pick<QueryCtx, "db">,
	userId: Id<"users">,
	name: string,
	description: string | undefined,
	ingredients: {
		foodId?: Id<"foods">;
		customFoodId?: Id<"customFoods">;
		ciqualLabel?: string;
		qtyGrams: number;
		/** Repli optionnel (création depuis une sélection journal) : snapshot exact de la ligne d'origine,
		 *  utilisé si la fiche source n'existe plus — le repas reste fidèle au journal, jamais recalculé de travers. */
		snapshot?: {
			name?: string;
			brand?: string;
			imageUrl?: string;
			kcal?: number;
			carbs?: number;
			protein?: number;
			fat?: number;
		};
	}[],
) {
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
		// Fiche de RÉFÉRENCE Ciqual (additif) : valeurs officielles /100 g résolues
		// côté serveur depuis la table embarquée — aucune donnée OFF lue ni fusionnée.
		const ciqualFood = ing.ciqualLabel ? ciqualFoodSource(ing.ciqualLabel) : null;
		if (ing.ciqualLabel && !ciqualFood) {
			throw new ConvexError("Une référence Ciqual n'existe plus. Retire-la et réessaie.");
		}
		if (!ing.foodId && !ing.customFoodId && !ciqualFood && !ing.snapshot) {
			throw new ConvexError("Un ingrédient est invalide : aliment introuvable.");
		}
		// Résolution de l'identité : fiche Ciqual, base OFF ou aliment personnel.
		// Fiche introuvable mais snapshot du journal disponible (création depuis
		// une sélection) : on garde la ligne EXACTE vue par la cliente — identité
		// perdue assumée (la fiche source a disparu) — au lieu de rejeter tout.
		let food: { name: string; brand?: string; imageUrl?: string; kcal100: number; carbs100: number; protein100: number; fat100: number } | null = null;
		if (ciqualFood) {
			food = ciqualFood;
		} else if (ing.foodId) {
			const f = await ctx.db.get(ing.foodId);
			if (!f && !ing.snapshot) throw new ConvexError("Un ingrédient n'existe plus dans la base. Retire-le et réessaie.");
			food = f;
		} else if (ing.customFoodId) {
			const f = await ctx.db.get(ing.customFoodId);
			if ((!f || f.userId !== userId) && !ing.snapshot) {
				throw new ConvexError("Un ingrédient personnel n'existe plus. Retire-le et réessaie.");
			}
			food = f && f.userId === userId ? f : null;
		}
		// Garde-fou kcal ↔ macros (lecture seule) : kcal OFF aberrantes → théoriques
		// au snapshot ; la fiche en base n'est jamais modifiée. Ciqual (officielle)
		// et aliments personnels (étiquette saisie) ne passent JAMAIS par le
		// garde-fou — le 4/4/9 y serait trompeur (vins Ciqual, produits allégés).
		const kcal100 = food ? (ciqualFood || ing.customFoodId ? food.kcal100 : guardedKcal100(food)) : 0;
		const k = ing.qtyGrams / 100;
		const row = {
			foodId: food && !ciqualFood ? (ing.foodId ?? undefined) : undefined,
			customFoodId: food && !ciqualFood ? (ing.customFoodId ?? undefined) : undefined,
			ciqualLabel: ciqualFood ? ing.ciqualLabel : undefined,
			name: food?.name ?? ing.snapshot?.name?.trim() ?? "Aliment",
			brand: food?.brand ?? ing.snapshot?.brand,
			imageUrl: food?.imageUrl ?? ing.snapshot?.imageUrl,
			qtyGrams: ing.qtyGrams,
			kcal: food ? Math.round(kcal100 * k) : Math.round(ing.snapshot?.kcal ?? 0),
			carbs: food ? round1(food.carbs100 * k) : round1(ing.snapshot?.carbs ?? 0),
			protein: food ? round1(food.protein100 * k) : round1(ing.snapshot?.protein ?? 0),
			fat: food ? round1(food.fat100 * k) : round1(ing.snapshot?.fat ?? 0),
		};
		snapshot.push(row);
		totalWeight += ing.qtyGrams;
		kcal += row.kcal;
		carbs += row.carbs;
		protein += row.protein;
		fat += row.fat;
	}

	return {
		name: clean,
		description: description?.trim() || undefined,
		totalWeight: Math.round(totalWeight),
		kcal: Math.round(kcal),
		carbs: round1(carbs),
		protein: round1(protein),
		fat: round1(fat),
		ingredients: snapshot,
	};
}

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
		const data = await buildMealData(ctx, user._id, name, description, ingredients);
		const mealId = await ctx.db.insert("meals", {
			userId: user._id,
			...data,
			createdAt: Date.now(),
		});
		return { ok: true, mealId };
	},
});

/**
 * Crée un repas à partir d'une SÉLECTION du journal (« Créer un repas »).
 *
 * Chaque aliment est transmis avec son IDENTITÉ (foodId / customFoodId /
 * ciqualLabel) et son snapshot nutritionnel tel qu'affiché dans le journal :
 * buildMealData résout la fiche quand elle existe encore (totaux recalculés
 * exactement comme une création classique) et retombe sur le snapshot du
 * journal si la fiche a disparu entre-temps — le repas reste fidèle à ce que
 * la cliente voit. Aucune entrée du journal n'est modifiée.
 */
export const createMealFromSelection = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		name: v.string(),
		description: v.optional(v.string()),
		ingredients: v.array(
			v.object({
				foodId: v.optional(v.id("foods")),
				customFoodId: v.optional(v.id("customFoods")),
				ciqualLabel: v.optional(v.string()),
				qtyGrams: v.number(),
				/** Snapshot journal (kcal/macros de la ligne exacte) — repli si la fiche n'existe plus. */
				name: v.optional(v.string()),
				brand: v.optional(v.string()),
				imageUrl: v.optional(v.string()),
				kcal: v.optional(v.number()),
				carbs: v.optional(v.number()),
				protein: v.optional(v.number()),
				fat: v.optional(v.number()),
			})
		),
	},
	handler: async (ctx, { sessionToken, name, description, ingredients }) => {
		const user = await requireClient(ctx, sessionToken);
		if (ingredients.length === 0) throw new ConvexError("Sélectionne au moins un aliment du journal.");
		const data = await buildMealData(
			ctx,
			user._id,
			name,
			description,
			ingredients.map((ing) => ({
				foodId: ing.foodId,
				customFoodId: ing.customFoodId,
				ciqualLabel: ing.ciqualLabel,
				qtyGrams: ing.qtyGrams,
				/** Snapshot de secours : la fiche source peut avoir disparu (OFF, custom supprimé). */
				snapshot: {
					name: ing.name,
					brand: ing.brand,
					imageUrl: ing.imageUrl,
					kcal: ing.kcal,
					carbs: ing.carbs,
					protein: ing.protein,
					fat: ing.fat,
				},
			}))
		);
		const mealId = await ctx.db.insert("meals", {
			userId: user._id,
			...data,
			createdAt: Date.now(),
		});
		return { ok: true, mealId };
	},
});

/**
 * Modifie un repas du client (nom, description, ingrédients) : totaux et
 * snapshot recalculés intégralement côté serveur. Recette G-FLUX refusée
 * (elle vit telle quelle dans « Mes repas ») ; les entrées déjà consommées
 * conservent leur snapshot (l'historique n'est jamais réécrit).
 */
export const updateMeal = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		mealId: v.id("meals"),
		name: v.string(),
		description: v.optional(v.string()),
		ingredients: v.array(ingredientInput),
	},
	handler: async (ctx, { sessionToken, mealId, name, description, ingredients }) => {
		const user = await requireClient(ctx, sessionToken);
		const meal = await ctx.db.get(mealId);
		if (!meal || meal.userId !== user._id) throw new ConvexError("Repas introuvable.");
		if (meal.sourceType === "gflux_recipe") {
			throw new ConvexError("Les recettes G-FLUX ne peuvent pas être modifiées.");
		}
		const data = await buildMealData(ctx, user._id, name, description, ingredients);
		await ctx.db.patch(mealId, data);
		return { ok: true, mealId };
	},
});

/**
 * Ajoute une recette interne G-FLUX aux « Mes repas » du client.
 *
 * La recette devient un repas réutilisable : 1 portion = 100 (unité arbitraire
 * qui sert de base au moteur `addMealEntry` — portionGrams = portions × 100).
 * Les valeurs nutritionnelles de LA recette (1 portion) sont copiées telles
 * quelles ; l'origine est conservée (sourceType + sourceRecipeId) pour
 * distinguer un repas créé à la main d'une recette G-FLUX. Aucun doublon :
 * si la recette est déjà dans « Mes repas », on renvoie le repas existant.
 */
export const addGFluxRecipe = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		/** Index de la recette dans le guide (ex. « DJ-04 »). */
		recipeIndex: v.string(),
		name: v.string(),
		/** Valeurs pour 1 portion (issues du guide G-FLUX). */
		kcal: v.number(),
		carbs: v.number(),
		protein: v.number(),
		fat: v.number(),
	},
	handler: async (ctx, { sessionToken, recipeIndex, name, kcal, carbs, protein, fat }) => {
		const user = await requireClient(ctx, sessionToken);
		const clean = name.trim();
		if (clean.length < 2 || clean.length > 80) {
			throw new ConvexError("Nom de recette invalide.");
		}
		if (!isFinite(kcal) || kcal < 0 || kcal > 3000) throw new ConvexError("Calories de la recette invalides.");
		if (!isFinite(carbs) || carbs < 0 || carbs > 300) throw new ConvexError("Glucides de la recette invalides.");
		if (!isFinite(protein) || protein < 0 || protein > 300) throw new ConvexError("Protéines de la recette invalides.");
		if (!isFinite(fat) || fat < 0 || fat > 300) throw new ConvexError("Lipides de la recette invalides.");

		// Anti-doublon : une seule copie par recette dans « Mes repas ».
		const existing = await ctx.db
			.query("meals")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.collect();
		const dup = existing.find((m) => m.sourceType === "gflux_recipe" && m.sourceRecipeId === recipeIndex);
		if (dup) return { ok: true, alreadyExists: true, mealId: dup._id };

		// totalWeight = 100 : le moteur existant calcule portionGrams / 100,
		// donc « 1 portion = 100 g » et « 2 portions = 200 g » → macros × 2.
		const mealId = await ctx.db.insert("meals", {
			userId: user._id,
			name: clean,
			totalWeight: 100,
			kcal: Math.round(kcal),
			carbs: round1(carbs),
			protein: round1(protein),
			fat: round1(fat),
			ingredients: [],
			sourceType: "gflux_recipe",
			sourceRecipeId: recipeIndex,
			createdAt: Date.now(),
		});
		return { ok: true, alreadyExists: false, mealId };
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
		// Miniature miroir du PREMIER ingrédient (vignette du repas) : lecture
		// pure par foodId → offId → miroir (sinon fallback OFF dans FoodImg).
		const withThumbs = await attachThumbsForFoodIds(
			ctx,
			meals.map((m) => ({ ...m, foodId: m.ingredients.find((i) => i.foodId)?.foodId }))
		);
		return withThumbs.map(({ foodId: _foodId, thumbUrl, ...m }) => {
			void _foodId;
			return thumbUrl ? { ...m, ingredients: m.ingredients.map((i, idx) => (idx === 0 ? { ...i, thumbUrl } : i)) } : m;
		});
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
		/** Nombre de portions consommées (recette G-FLUX) — optionnel, pour l'affichage. */
		portions: v.optional(v.number()),
	},
	handler: async (ctx, { sessionToken, date, meal, mealId, portionGrams, portions }) => {
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
			portions: portions !== undefined && portions !== null ? round1(portions) : undefined,
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
			.collect();	const foods = await Promise.all(rows.map((r) => ctx.db.get(r.foodId)));
	// Garde-fou kcal ↔ macros (lecture seule) : kcal aberrantes corrigées à la
	// volée, jamais en base. Miniatures miroir G-FLUX → thumbUrl.
	return attachThumbs(
		ctx,
		foods
			.filter((f): f is Doc<"foods"> => f !== null)
			.map((f) => ({ ...f, kcal100: guardedKcal100(f) }))
	);
},
});