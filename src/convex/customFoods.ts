import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

/**
 * Aliments créés par le client (« Créés par moi »).
 *
 * Quand un produit n'est pas dans la base (repas commandé avec étiquette
 * nutritionnelle, recette maison…), le client saisit ses valeurs pour 100 g :
 * l'aliment est alors intégré à SA base — journalisable, utilisable dans les
 * repas personnalisés, et retrouvable par recherche.
 */

async function requireClient(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") {
		throw new ConvexError("Seuls les comptes clients peuvent créer des aliments.");
	}
	return user;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function clamp(n: number, min: number, max: number, label: string): number {
	if (!isFinite(n)) throw new ConvexError(`${label} invalide.`);
	if (n < min || n > max) throw new ConvexError(`${label} doit être entre ${min} et ${max}.`);
	return round1(n);
}

/** Champs communs création / édition (validés une seule fois, mêmes règles). */
const foodFields = {
	name: v.string(),
	brand: v.optional(v.string()),
	kcal100: v.number(),
	carbs100: v.number(),
	protein100: v.number(),
	fat100: v.number(),
	servingQty: v.optional(v.number()),
};

/** Valide et normalise les champs saisies (identique à la création). */
function normalizeFields(fields: {
	name: string;
	brand?: string;
	kcal100: number;
	carbs100: number;
	protein100: number;
	fat100: number;
	servingQty?: number;
}) {
	const clean = fields.name.trim();
	if (clean.length < 2 || clean.length > 80) {
		throw new ConvexError("Donne un nom à ton aliment (entre 2 et 80 caractères).");
	}
	const kcal = clamp(fields.kcal100, 0, 900, "Les calories");
	const carbs = clamp(fields.carbs100, 0, 100, "Les glucides");
	const protein = clamp(fields.protein100, 0, 100, "Les protéines");
	const fat = clamp(fields.fat100, 0, 100, "Les lipides");
	if (kcal === 0 && carbs === 0 && protein === 0 && fat === 0) {
		throw new ConvexError("Renseigne au moins une valeur nutritionnelle.");
	}
	let qty: number | undefined;
	if (fields.servingQty !== undefined && fields.servingQty !== null) {
		qty = clamp(fields.servingQty, 1, 2000, "La portion");
	}
	return { name: clean, brand: fields.brand?.trim() || undefined, kcal100: kcal, carbs100: carbs, protein100: protein, fat100: fat, servingQty: qty };
}

/** Crée un aliment personnel (valeurs pour 100 g). */
export const create = mutation({
	args: { sessionToken: v.optional(v.string()), ...foodFields },
	handler: async (ctx, { sessionToken, ...fields }) => {
		const user = await requireClient(ctx, sessionToken);
		const clean = normalizeFields(fields);
		const id = await ctx.db.insert("customFoods", {
			userId: user._id,
			...clean,
			createdAt: Date.now(),
		});
		return { ok: true, customFoodId: id };
	},
});

/**
 * Modifie un aliment personnel existant (propriétaire uniquement).
 * Ne touche qu'à la fiche : les entrées du journal déjà enregistrées
 * conservent leur snapshot (nom, marque, valeurs) tel quel.
 */
export const update = mutation({
	args: { sessionToken: v.optional(v.string()), customFoodId: v.id("customFoods"), ...foodFields },
	handler: async (ctx, { sessionToken, customFoodId, ...fields }) => {
		const user = await requireClient(ctx, sessionToken);
		const food = await ctx.db.get(customFoodId);
		if (!food || food.userId !== user._id) throw new ConvexError("Aliment introuvable.");
		await ctx.db.patch(customFoodId, normalizeFields(fields));
		return { ok: true, customFoodId };
	},
});

/** Les aliments personnels du client (du plus récent au plus ancien). */
export const list = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireClient(ctx, sessionToken);
		return ctx.db
			.query("customFoods")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.order("desc")
			.collect();
	},
});

/** Supprime un aliment personnel (propriétaire uniquement). */
export const remove = mutation({
	args: { sessionToken: v.optional(v.string()), customFoodId: v.id("customFoods") },
	handler: async (ctx, { sessionToken, customFoodId }) => {
		const user = await requireClient(ctx, sessionToken);
		const food = await ctx.db.get(customFoodId);
		if (!food || food.userId !== user._id) throw new ConvexError("Aliment introuvable.");
		await ctx.db.delete(customFoodId);
		return { ok: true };
	},
});

/** Aliments personnels par ids (pour reconstituer des résultats de recherche). */
export const byIds = query({
	args: { sessionToken: v.optional(v.string()), ids: v.array(v.id("customFoods")) },
	handler: async (ctx, { sessionToken, ids }) => {
		const user = await requireClient(ctx, sessionToken);
		const foods = await Promise.all(ids.map((id) => ctx.db.get(id)));
		return foods.filter((f): f is Doc<"customFoods"> => f !== null && f.userId === user._id);
	},
});