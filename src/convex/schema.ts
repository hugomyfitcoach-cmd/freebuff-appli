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
		/** Date de démarrage du suivi "yyyy-mm-dd" — ancre des échéances (mensurations 15 j, photos 1 mois). */
		startDate: v.optional(v.string()),
		/** Message du coach visible par la cliente sur son dashboard (jamais une note interne). */
		coachMessage: v.optional(v.string()),
		/** Jour "yyyy-mm-dd" pour lequel le message du coach est actif (le lendemain, il expire). */
		coachMessageDate: v.optional(v.string()),
		/** Message audio du coach du jour — pointe vers la ligne coachMedia correspondante (publique après publication). */
		coachMessageAudioId: v.optional(v.id("coachMedia")),
		/** Onboarding de démarrage exigé pour cette cliente (décidé par le coach). */
		onboardingEnabled: v.optional(v.boolean()),
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
		/** Horodatage de lecture du retour par la cliente — une publication relance l'état « non lu ». */
		feedbackReadAt: v.optional(v.number()),
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
		/** Nombre de portions (recette G-FLUX ou portion OFF) — optionnel, pour l'affichage. */
		portions: v.optional(v.number()),
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
		/** Maintenance calorique (filet de sécurité) — saisie manuelle par la coach, optionnelle. */
		maintenanceKcal: v.optional(v.number()),
		/** Objectif quotidien de pas — saisi manuellement par la coach, optionnel (ex. 10 000). */
		stepGoal: v.optional(v.number()),
	}).index("by_userId", ["userId"]),

	/** Pas quotidiens saisis par la cliente — une seule valeur par jour. */
	dailySteps: defineTable({
		userId: v.id("users"),
		/** Date "yyyy-mm-dd" (heure locale de la cliente). */
		date: v.string(),
		/** Nombre de pas réel de la journée. */
		count: v.number(),
		createdAt: v.number(),
	})
		.index("by_user_date", ["userId", "date"])
		.index("by_user", ["userId"]),

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
		/** Origine : recette interne G-FLUX transformée en repas réutilisable. */
		sourceType: v.optional(v.string()),
		/** Index de la recette source (ex. « DJ-04 ») quand sourceType = 'gflux_recipe'. */
		sourceRecipeId: v.optional(v.string()),
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

	/* ═══ Onboarding de démarrage (formulaire initial + étapes) ═══ */

	/**
	 * Formulaire de démarrage d'une cliente (un seul par cliente).
	 * Les réponses sont un dictionnaire clé → valeur (options codées, texte,
	 * nombres) versionné par l'UI — jamais de HTML brut, aucune redondance
	 * identité (le rattachement se fait par userId).
	 * Statuts : brouillon (jamais vu par le coach comme « soumis ») / soumis.
	 */
	intakes: defineTable({
		userId: v.id("users"),
		status: v.union(v.literal("draft"), v.literal("submitted")),
		/** Réponses du questionnaire : id de question → valeur (code option / texte / nombre). */
		answers: v.record(v.string(), v.union(v.string(), v.number(), v.null())),
		createdAt: v.number(),
		updatedAt: v.number(),
		/** Date de soumission finale (statut submitted). */
		submittedAt: v.optional(v.number()),
	}).index("by_user", ["userId"]),

	/* ═══ Médias coach → cliente (retours audio, pièces jointes, message audio) ═══ */

	/**
	 * Fichiers envoyés par la coach à une cliente. Les gros fichiers (audio,
	 * images optimisées, PDF) vivent dans le file storage Convex — cette table
	 * ne conserve que les métadonnées + le cycle de vie (brouillon → publié →
	 * expiré). Un brouillon n'est jamais visible côté cliente.
	 *
	 * Rétention audio : suppression 72 h après la première écoute réelle, ou
	 * au plus tard 14 jours après publication (première échéance atteinte).
	 * Les pièces jointes (images/PDF) sont conservées dans l'historique.
	 */
	coachMedia: defineTable({
		/** Cliente destinataire. */
		userId: v.id("users"),
		/** Coach à l'origine du fichier (optionnel, l'info vit déjà sur users.createdBy). */
		coachId: v.optional(v.id("users")),
		/** Contexte : retour de bilan (audio), pièce jointe d'un retour, message ponctuel. */
		source: v.union(
			v.literal("checkin_feedback_audio"),
			v.literal("checkin_attachment"),
			v.literal("coach_message_audio")
		),
		/** Bilan concerné (retours + pièces jointes uniquement). */
		checkinId: v.optional(v.id("checkins")),
		kind: v.union(v.literal("audio"), v.literal("image"), v.literal("pdf")),
		/** Fichier dans le file storage Convex (jamais le blob ici). */
		storageId: v.id("_storage"),
		mime: v.string(),
		name: v.string(),
		size: v.number(),
		/** Durée en ms (audio uniquement). */
		durationMs: v.optional(v.number()),
		/** brouillon (invisible cliente) → publié → expiré (fichier supprimé). */
		status: v.union(v.literal("draft"), v.literal("published"), v.literal("expired")),
		/** Date de publication explicite (bascule vers « visible cliente »). */
		publishedAt: v.optional(v.number()),
		/** Première écoute réelle du retour audio par la cliente — déclenche la rétention 72 h. */
		firstListenedAt: v.optional(v.number()),
		createdAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_user_source", ["userId", "source"])
		.index("by_checkin", ["checkinId"]),

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
		/** Taille (hauteur) en cm — journalisée à chaque changement (historique daté). */
		heightCm: v.optional(v.number()),
		createdAt: v.number(),
	})
		.index("by_user_date", ["userId", "date"])
		.index("by_user", ["userId"]),
});
