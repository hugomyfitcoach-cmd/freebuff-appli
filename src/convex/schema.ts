import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { answersValidator } from "./answers";

/**
 * Schéma de la base Convex du suivi coaching G-Flux.
 *
 * - `users`    : comptes email + mot de passe. Rôle `coach` (CRM admin)
 *                ou `client` (bilan hebdo + espace de suivi).
 * - `sessions`: jetons de session (stockés hashés) pour rester connecté.
 * - `checkins` : un bilan hebdo (une ligne par client et par semaine),
 *                avec l'état du retour coach (feedback).
 */
export const checkinStatus = v.union(v.literal("nouveau"), v.literal("retour_envoye"));
export const userRole = v.union(v.literal("coach"), v.literal("client"));

export default defineSchema({
	users: defineTable({
		/** Email normalisé (minuscules, sans espaces) — identifiant de connexion. */
		email: v.string(),
		/** Mot de passe hashé : "scrypt:<sel hex>:<hash hex>". Jamais en clair. */
		passwordHash: v.string(),
		role: userRole,
		prenom: v.string(),
		disabled: v.optional(v.boolean()),
		/** Coach qui a créé le compte (pour les clients). */
		createdBy: v.optional(v.id("users")),
		/** Taille (cm) du client — saisie une fois, utilisée pour l'IMC. */
		heightCm: v.optional(v.number()),
		/** Date de naissance "yyyy-mm-dd" (fiche client CRM). */
		birthDate: v.optional(v.string()),
		/** Dernière activité connue (timestamp) — tri du CRM par dernière connexion. */
		lastSeenAt: v.optional(v.number()),
	}).index("by_email", ["email"]),

	sessions: defineTable({
		userId: v.id("users"),
		/** SHA-256 hex du jeton brut (le jeton lui-même n'est jamais stocké). */
		tokenHash: v.string(),
		expiresAt: v.number(),
	}).index("by_tokenHash", ["tokenHash"]),

	checkins: defineTable({
		userId: v.id("users"),
		/** Lundi de la semaine concernée, au format ISO "yyyy-mm-dd". */
		weekStart: v.string(),
		/** Libellé affiché : "S37 - 07 sept. 2026". */
		weekLabel: v.string(),
		answers: answersValidator,
		status: checkinStatus,
		/** Retour écrit du coach, visible par le client dans son historique. */
		feedback: v.optional(v.string()),
		feedbackAt: v.optional(v.number()),
	})
		.index("by_user_week", ["userId", "weekStart"])
		.index("by_weekStart", ["weekStart"]),

	/* ════ Journal alimentaire (tracking de calories) ════ */

	/** Cache des produits Open Food Facts (valeurs pour 100 g). */
	foods: defineTable({
		/** Identifiant OFF du produit (code-barres le plus souvent). */
		offId: v.string(),
		name: v.string(),
		brand: v.optional(v.string()),
		kcal100: v.number(),
		carbs100: v.number(),
		protein100: v.number(),
		fat100: v.number(),
		imageUrl: v.optional(v.string()),
		/** Portion suggérée par OFF (g/ml), quand elle existe. */
		servingQty: v.optional(v.number()),
		servingUnit: v.optional(v.string()),
	})
		.index("by_offId", ["offId"])
		.searchIndex("by_name", { searchField: "name" }),

	/** Aliments créés par les clients (produit non présent dans la base OFF). */
	customFoods: defineTable({
		userId: v.id("users"),
		name: v.string(),
		brand: v.optional(v.string()),
		/** Valeurs nutritionnelles pour 100 g (saisies depuis l'étiquette). */
		kcal100: v.number(),
		carbs100: v.number(),
		protein100: v.number(),
		fat100: v.number(),
		/** Portion suggérée (g), optionnelle — sert de quantité par défaut. */
		servingQty: v.optional(v.number()),
		createdAt: v.number(),
	})
		.index("by_user", ["userId"])
		.searchIndex("by_name", { searchField: "name" }),

	/** Lignes du journal : un aliment consommé, un jour, un repas. */
	diaryEntries: defineTable({
		userId: v.id("users"),
		/** Date du jour au format "yyyy-mm-dd" (heure locale du client). */
		date: v.string(),
		/** Repas : "petit-dej" | "dejeuner" | "diner" | "collation". */
		meal: v.string(),
		foodId: v.optional(v.id("foods")),
		/** Aliment créé par le client, quand l'entrée vient d'un custom food. */
		customFoodId: v.optional(v.id("customFoods")),
		/** Repas personnalisé du client (portion), quand l'entrée vient d'un repas. */
		mealId: v.optional(v.id("meals")),
		name: v.string(),
		brand: v.optional(v.string()),
		imageUrl: v.optional(v.string()),
		/** Quantité consommée en grammes (ou ml pour les liquides). */
		qtyGrams: v.number(),
		/** Valeurs calculées à l'ajout (snapshot, pour des totaux rapides). */
		kcal: v.number(),
		carbs: v.number(),
		protein: v.number(),
		fat: v.number(),
		createdAt: v.number(),
	})
		.index("by_user_date", ["userId", "date"])
		.index("by_user", ["userId"]),

	/** Objectifs journaliers d'un client (définis par la coach dans le CRM). */
	clientGoals: defineTable({
		userId: v.id("users"),
		kcal: v.number(),
		carbs: v.number(),
		protein: v.number(),
		fat: v.number(),
	}).index("by_userId", ["userId"]),

	/* ═══ Repas personnalisés & favoris ═══ */

	/** Repas « créés par moi » : recette + totaux calculés côté serveur. */
	meals: defineTable({
		userId: v.id("users"),
		name: v.string(),
		description: v.optional(v.string()),
		/** Poids total du plat (somme des ingrédients, g) — base du calcul de portion. */
		totalWeight: v.number(),
		/** Totaux pour le plat entier. */
		kcal: v.number(),
		carbs: v.number(),
		protein: v.number(),
		fat: v.number(),
		/** Ingrédients avec snapshot des valeurs /100 g + quantité. */
		ingredients: v.array(
			v.object({
				foodId: v.optional(v.id("foods")),
				customFoodId: v.optional(v.id("customFoods")),
				name: v.string(),
				brand: v.optional(v.string()),
				imageUrl: v.optional(v.string()),
				qtyGrams: v.number(),
				kcal: v.number(),
				carbs: v.number(),
				protein: v.number(),
				fat: v.number(),
			})
		),
		createdAt: v.number(),
	}).index("by_user", ["userId"]),

	/** Aliments favoris d'un client (raccourci de saisie). */
	favorites: defineTable({
		userId: v.id("users"),
		foodId: v.id("foods"),
		createdAt: v.number(),
	})
		.index("by_user_food", ["userId", "foodId"])
		.index("by_user", ["userId"]),

	/* ═══ Suivi corporel (progression) ═══ */

	/* ═══ Photos de suivi (envoyées par le client, visibles par la coach) ═══ */

	/**
	 * Une série de photos de suivi envoyée par un client à un moment donné
	 * (démarrage, mois 1…6). Les images sont stockées dans le file storage
	 * Convex (jamais accessibles au client après envoi) ; la coach les voit
	 * dans le CRM. Chaque série est conservée définitivement.
	 */
	progressPhotos: defineTable({
		userId: v.id("users"),
		/** Moment : "demarrage" | "mois1"…"mois6". */
		step: v.string(),
		/** Date d'envoi "yyyy-mm-dd". */
		date: v.string(),
		/** Photos : un storageId Convex + un libellé (face, profil, dos…). */
		photos: v.array(
			v.object({
				storageId: v.id("_storage"),
				label: v.string(),
			})
		),
		createdAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_user_date", ["userId", "date"]),

	/** Une prise de mesures par date (poids, tour de cou, taille, fessier). */
	bodyMetrics: defineTable({
		userId: v.id("users"),
		/** Date de la prise au format "yyyy-mm-dd" (heure locale du client). */
		date: v.string(),
		/** Poids en kg. */
		weightKg: v.optional(v.number()),
		/** Tour de cou en cm. */
		neckCm: v.optional(v.number()),
		/** Tour de taille (partie la plus fine) en cm. */
		waistCm: v.optional(v.number()),
		/** Circonférence des fessiers en cm. */
		hipCm: v.optional(v.number()),
		createdAt: v.number(),
	})
		.index("by_user_date", ["userId", "date"])
		.index("by_user", ["userId"]),
});
