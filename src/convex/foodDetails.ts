import { query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import { resolveCiqualLabel } from "./ciqual";
import { resolveReferenceFood } from "./referenceFoods";
import { ciqualDetailsRows, type CiqualDetailRow } from "./ciqualDetails";
import { guardedKcal100 } from "../lib/nutritionGuard";
import type { Id, Doc } from "./_generated/dataModel";

/**
 * FICHE NUTRITIONNELLE DÉTAILLÉE (Mission R5a) — données uniquement.
 *
 * Une SEULE requête `foodDetails(source, id)` sert les valeurs /100 g de
 * n'importe quel aliment déjà exposé par les recherches existantes :
 *  - `ciqual`    : référence ANSES embarquée (module ciqualDetails.ts, chargé
 *                  transitivement par le module de recherche — importé ici, à
 *                  la différence des seules données compactes de ciqual) ;
 *  - `food`      : produit OFF de la base locale / du cache ;
 *  - `custom`    : aliment personnel de la cliente (« Créés par moi ») ;
 *  - `reference` : aliment de référence G-Flux du coach.
 *
 * RÈGLES DE VALEURS :
 *  - tout est ramené pour 100 g ; une valeur absente est `null` (jamais 0
 *    inventé) ;
 *  - OFF : sucres, fibres, AGS et sel viennent des champs du produit (facultatifs,
 *    complétés au plus une fois tous les 30 jours par `refreshOffDetails`) ;
 *  - Ciqual : sel = colonne « Sel » officielle (jamais recalculé) et micros
 *    complets (calcium, fer, magnésium, potassium, vitamines C et D) ;
 *  - le garde-fou kcal↔macros des lectures de `foods` est appliqué comme
 *    partout ailleurs (valeur affichée, la fiche en base reste intacte).
 *
 * CONTRÔLES D'ACCÈS (identiques aux requêtes aliments existantes) :
 *  - session obligatoire ;
 *  - `ciqual` / `food` : base commune, tout compte connecté (coach compris) ;
 *  - `custom` : propriétaire uniquement (isolation stricte du journal) ;
 *  - `reference` : même périmètre que la recherche (fiche de SON coach, ou
 *    la sienne pour le coach) via `resolveReferenceFood`.
 */

/** Provenance d'une fiche détaillée. */
export type FoodDetailsSource = "ciqual" | "food" | "custom" | "reference";

/** Micro-nutriments Ciqual (mg ou µg /100 g selon le nutriment). */
export type FoodMicros = {
	calcium: number | null;
	iron: number | null;
	magnesium: number | null;
	potassium: number | null;
	vitaminC: number | null;
	vitaminD: number | null;
};

/** Fiche nutritionnelle /100 g — `null` = valeur inconnue (jamais inventée). */
export type FoodDetails = {
	kcal: number | null;
	protein: number | null;
	carbs: number | null;
	fat: number | null;
	sugars: number | null;
	fiber: number | null;
	saturatedFat: number | null;
	salt: number | null;
	/** Ciqual uniquement — absent pour les autres provenances. */
	micros?: FoodMicros;
	source: FoodDetailsSource;
};

/** Index libellé officiel → tuple de détail (1re occurrence, comme la recherche). */
const DETAILS_BY_LABEL: Map<string, CiqualDetailRow> = (() => {
	const m = new Map<string, CiqualDetailRow>();
	for (const row of ciqualDetailsRows) {
		if (!m.has(row[0])) m.set(row[0], row);
	}
	return m;
})();

/**
 * Fiche Ciqual EXACTE (libellé officiel, comparaison normalisée identique à
 * `resolveCiqualLabel`) — `null` si le libellé n'existe pas dans la table.
 */
export function ciqualFoodDetails(label: string): FoodDetails | null {
	const resolved = resolveCiqualLabel(label);
	if (!resolved) return null;
	const row = DETAILS_BY_LABEL.get(resolved.label);
	if (!row) return null;
	return {
		kcal: row[1],
		protein: row[2],
		carbs: row[3],
		fat: row[4],
		sugars: row[5],
		fiber: row[6],
		saturatedFat: row[7],
		salt: row[8],
		micros: {
			calcium: row[9],
			iron: row[10],
			magnesium: row[11],
			potassium: row[12],
			vitaminC: row[13],
			vitaminD: row[14],
		},
		source: "ciqual",
	};
}

/** Produit OFF (`foods`) → fiche /100 g (champs de détail facultatifs → null). */
export function foodDetailsFromOffFood(
	food: Pick<
		Doc<"foods">,
		"kcal100" | "carbs100" | "protein100" | "fat100" | "sugars100" | "fiber100" | "saturatedFat100" | "salt100"
	>
): FoodDetails {
	return {
		kcal: guardedKcal100(food),
		protein: food.protein100,
		carbs: food.carbs100,
		fat: food.fat100,
		sugars: food.sugars100 ?? null,
		fiber: food.fiber100 ?? null,
		saturatedFat: food.saturatedFat100 ?? null,
		salt: food.salt100 ?? null,
		source: "food",
	};
}

/** Aliment personnel (« Créés par moi ») → fiche /100 g. */
export function foodDetailsFromCustomFood(food: Doc<"customFoods">): FoodDetails {
	return {
		kcal: food.kcal100,
		protein: food.protein100,
		carbs: food.carbs100,
		fat: food.fat100,
		// L'étiquette d'un aliment perso ne porte aujourd'hui que fibres et sel.
		sugars: null,
		fiber: food.fiber100 ?? null,
		saturatedFat: null,
		salt: food.salt100 ?? null,
		source: "custom",
	};
}

/** Aliment de référence G-Flux → fiche /100 g (4 champs facultatifs). */
export function foodDetailsFromReferenceFood(food: Doc<"referenceFoods">): FoodDetails {
	return {
		kcal: food.kcal,
		protein: food.proteinG,
		carbs: food.carbsG,
		fat: food.fatG,
		sugars: food.sugarsG ?? null,
		fiber: food.fiberG ?? null,
		saturatedFat: food.saturatedFatG ?? null,
		salt: food.saltG ?? null,
		source: "reference",
	};
}

/**
 * Détail nutritionnel /100 g d'un aliment (source + identifiant), `null` si
 * l'aliment est introuvable ou hors du périmètre du compte.
 */
export const foodDetails = query({
	args: {
		sessionToken: v.optional(v.string()),
		source: v.union(
			v.literal("ciqual"),
			v.literal("food"),
			v.literal("custom"),
			v.literal("reference")
		),
		id: v.string(),
	},
	handler: async (ctx, { sessionToken, source, id }): Promise<FoodDetails | null> => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");

		if (source === "ciqual") return ciqualFoodDetails(id);

		if (source === "food") {
			const foodId: Id<"foods"> | null = await ctx.db.normalizeId("foods", id);
			if (!foodId) return null;
			const food = await ctx.db.get(foodId);
			return food ? foodDetailsFromOffFood(food) : null;
		}

		if (source === "custom") {
			const customId: Id<"customFoods"> | null = await ctx.db.normalizeId("customFoods", id);
			if (!customId) return null;
			const food = await ctx.db.get(customId);
			// Isolation stricte : une cliente ne lit jamais la fiche d'une autre.
			if (!food || food.userId !== user._id) return null;
			return foodDetailsFromCustomFood(food);
		}

		// source === "reference" : résolution scopée au coach du compte.
		const food = await resolveReferenceFood(ctx, user, id);
		return food ? foodDetailsFromReferenceFood(food) : null;
	},
});
