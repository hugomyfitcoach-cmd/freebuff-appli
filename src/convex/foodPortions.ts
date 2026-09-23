import { internalMutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * PORTION MÉMORISÉE — repère personnel d'une cliente pour un aliment.
 *
 * RÈGLES FONDAMENTALES (mission hotfix) :
 * - préférence UTILISATEUR : ne modifie JAMAIS les données nutritionnelles
 *   de l'aliment (OFF, Ciqual, base commune G-FLUX, fiche perso) ni la
 *   portion vue par les autres clientes ;
 * - mémorisée UNIQUEMENT à la validation « Ajouter au Journal » (jamais sur
 *   une recherche abandonnée, un scan annulé ou une fiche consultée) ;
 * - DERNIÈRE quantité validée : chaque validation remplace la précédente
 *   (100 g jour 1 → 150 g jour 2 → 150 g proposées jour 3) ;
 * - liaison minimale cliente + aliment (identifiant stable selon la source :
 *   foodId / customFoodId / ciqualLabel) — isolation stricte par cliente ;
 * - pour les portions nommées, on conserve repas/portions en plus des
 *   grammes afin de restaurer une expérience cohérente — mais les calculs
 *   nutritionnels ne reposent QUE sur la quantité réelle en grammes.
 *
 * Table `foodPortions` (voir schema.ts) : une ligne par cliente × aliment.
 * Changement ADDITIF : table nouvelle, aucune donnée existante touchée.
 */

/** Bornes de quantité identiques au Journal (diaryEntries). */
const MIN_QTY = 1;
const MAX_QTY = 5000;

/** Clé stable de l'aliment — exactement un des trois identifiants. */
type FoodKey = {
	foodId?: Id<"foods">;
	customFoodId?: Id<"customFoods">;
	ciqualLabel?: string;
};

/** Index de la table à utiliser selon la clé fournie. */
function indexFor(k: FoodKey): "by_user_food" | "by_user_custom" | "by_user_ciqual" {
	if (k.foodId) return "by_user_food";
	if (k.customFoodId) return "by_user_custom";
	return "by_user_ciqual";
}

function fieldFor(index: ReturnType<typeof indexFor>): "foodId" | "customFoodId" | "ciqualLabel" {
	return index === "by_user_food" ? "foodId" : index === "by_user_custom" ? "customFoodId" : "ciqualLabel";
}

function valueFor(k: FoodKey): string {
	return k.foodId ?? k.customFoodId ?? k.ciqualLabel ?? "";
}

async function requireClient(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") {
		throw new ConvexError("Seuls les comptes clients peuvent utiliser le journal alimentaire.");
	}
	return user;
}

/** Lecture d'une ligne (clientId + identifiant alimentaire stable). */
async function findRow(
	ctx: Pick<QueryCtx, "db">,
	userId: Id<"users">,
	k: FoodKey
) {
	const index = indexFor(k);
	const field = fieldFor(index);
	return ctx.db
		.query("foodPortions")
		.withIndex(index, (q) => q.eq("userId", userId).eq(field, valueFor(k) as never))
		.first();
}

/**
 * Lit la portion mémorisée de la cliente pour un aliment (réservé client,
 * isolation stricte : jamais les portions d'une autre cliente).
 */
export const getPortion = query({
	args: {
		sessionToken: v.optional(v.string()),
		foodId: v.optional(v.id("foods")),
		customFoodId: v.optional(v.id("customFoods")),
		ciqualLabel: v.optional(v.string()),
	},
	handler: async (ctx, { sessionToken, ...k }) => {
		const user = await requireClient(ctx, sessionToken);
		const count = (k.foodId ? 1 : 0) + (k.customFoodId ? 1 : 0) + (k.ciqualLabel ? 1 : 0);
		if (count !== 1) return null;
		return findRow(ctx, user._id, k);
	},
});

/**
 * MÉMORISE (upsert) la dernière portion validée « Ajouter au Journal ».
 * Réservé aux mutations du Journal — JAMAIS appelé directement par l'UI :
 * une quantité simplement saisie/testée dans la feuille n'est jamais
 * mémorisée. No-op silencieux si l'aliment n'a pas de clé exploitable
 * (snapshot sans identité, coach CRM…) : la mémoire ne doit jamais faire
 * échouer un ajout.
 */
export const upsertInternal = internalMutation({
	args: {
		userId: v.id("users"),
		foodId: v.optional(v.id("foods")),
		customFoodId: v.optional(v.id("customFoods")),
		ciqualLabel: v.optional(v.string()),
		qtyGrams: v.number(),
		meal: v.optional(v.string()),
		portions: v.optional(v.number()),
	},
	handler: async (ctx, { userId, foodId, customFoodId, ciqualLabel, qtyGrams, meal, portions }) => {
		const k: FoodKey = { foodId, customFoodId, ciqualLabel };
		const count = (foodId ? 1 : 0) + (customFoodId ? 1 : 0) + (ciqualLabel ? 1 : 0);
		if (count !== 1) return;
		const qty = Math.round(qtyGrams * 10) / 10;
		if (!isFinite(qty) || qty < MIN_QTY || qty > MAX_QTY) return;
		const existing = await findRow(ctx, userId, k);
		const patch = { qtyGrams: qty, meal, portions, updatedAt: Date.now() };
		if (existing) {
			await ctx.db.patch(existing._id, patch);
		} else {
			await ctx.db.insert("foodPortions", { userId, foodId, customFoodId, ciqualLabel, ...patch });
		}
	},
});
