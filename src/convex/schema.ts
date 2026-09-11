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
		/** Nom de famille — distinguer deux clientes au même prénom (fiche CRM). */
		nom: v.optional(v.string()),
		/** Lien vers le tableur Google Sheets G-FLUX de la cliente — usage coach uniquement, jamais exposé côté client. */
		gsheetUrl: v.optional(v.string()),
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
		/** Jour "yyyy-mm-dd" pour lequel le message du coach a été publié (info CRM). */
		coachMessageDate: v.optional(v.string()),
		/** Horodatage (ms) de publication — le message est éphémère : il expire au minuit local de la cliente. */
		coachMessageAt: v.optional(v.number()),
		/** Minuit local (ms UTC) suivant la publication, dans le fuseau de la cliente — visibilité + nettoyage. */
		coachMessageExpiresAt: v.optional(v.number()),
		/** Dernière consultation réelle du message par la cliente ("Vu") — badge non lu tant que vide/antérieur à coachMessageAt. */
		coachMessageReadAt: v.optional(v.number()),
		/** Fuseau horaire IANA de la cliente ("Europe/Paris" par défaut) — rafraîchi à sa connexion. */
		timeZone: v.optional(v.string()),
		/** Dernier état de permission notifications déclaré par son navigateur (rappel 12 h : push si "granted"). */
		pushPermission: v.optional(
			v.union(v.literal("granted"), v.literal("denied"), v.literal("unsupported"), v.literal("default"))
		),
		/** Moment (ms) du dernier changement de permission — info, jamais bloquant. */
		pushPermissionAskedAt: v.optional(v.number()),
		/** Message audio du coach du jour — pointe vers la ligne coachMedia correspondante (publique après publication). */
		coachMessageAudioId: v.optional(v.id("coachMedia")),
		/** Onboarding de démarrage exigé pour cette cliente (décidé par le coach). */
		onboardingEnabled: v.optional(v.boolean()),
		/** Moment (ms) où la cliente a terminé TOUTES les étapes — horodaté une seule fois, sert à la confirmation 24 h puis à la disparition automatique de la carte (jamais recalculé à chaque rendu). */
		onboardingCompletedAt: v.optional(v.number()),
		/** Onboarding installation PWA : "not_seen" | "skipped" | "tutorial_completed" | "installed_confirmed" — lié au COMPTE (survit au logout). */
		pwaInstallStatus: v.optional(
			v.union(
				v.literal("not_seen"),
				v.literal("skipped"),
				v.literal("tutorial_completed"),
				v.literal("installed_confirmed")
			)
		),
		/** Plateforme du tutoriel suivi ("ios" | "android") — info, la détection locale reste prioritaire (nouvel appareil). */
		pwaInstallPlatform: v.optional(v.union(v.literal("ios"), v.literal("android"))),
		/** Moment (ms) où l'installation a été réellement confirmée (lancement standalone ou événement appinstalled). */
		pwaInstallConfirmedAt: v.optional(v.number()),
		/** Dernière activité connue (timestamp) — tri du CRM par dernière connexion. */
		lastSeenAt: v.optional(v.number()),
		/** Suivi de cycle (carte Accueil cliente + Vision 360 coach) — mêmes questions et formule que l'outil historique. */
		cycle: v.optional(
			v.object({
				contra: v.union(v.literal("none"), v.literal("iud-hormonal"), v.literal("hormonal")),
				/** « Je n'ai plus de règles régulières » — aucune estimation affichée. */
				noDate: v.boolean(),
				/** Premier jour des dernières règles "yyyy-mm-dd". */
				lmp: v.optional(v.string()),
				/** Durée moyenne du cycle en jours (21–32). */
				len: v.optional(v.number()),
				updatedAt: v.number(),
			})
		),
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
		/** « planned_eaten » : validé depuis un item planifié (✓ affiché dans le Journal). */
		source: v.optional(v.string()),
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

	/**
	 * Abonnements aux notifications push Web (service worker + VAPID).
	 * Un enregistrement par endpoint — la clé privée VAPID reste côté serveur
	 * SvelteKit, jamais ici. L'endpoint et les clés p256dh/auth permettent
	 * d'envoyer une notification chiffrée à l'appareil de la cliente.
	 */
	pushSubscriptions: defineTable({
		userId: v.id("users"),
		/** Endpoint fourni par le navigateur (push service). */
		endpoint: v.string(),
		/** Clé publique P-256 du client (chiffrement RFC 8291). */
		p256dh: v.string(),
		/** Secret d'authentification du client. */
		auth: v.string(),
		createdAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_user_endpoint", ["userId", "endpoint"])
		.index("by_endpoint", ["endpoint"]),

	/**
	 * Journal des messages du coach envoyés à une cliente (Vision 360 CRM).
	 * Une ligne par publication : texte et/ou audio, horodatée, avec l'état
	 * « lu » réel (Vu côté cliente). L'audio référencé est conservé pour la
	 * réécoute dans le CRM — seul l'état actif du message du jour est éphémère.
	 */
	coachMessages: defineTable({
		userId: v.id("users"),
		/** Texte du message (si publié avec du texte). */
		text: v.optional(v.string()),
		/** Audio publié avec le message (conservé pour la réécoute CRM). */
		audioId: v.optional(v.id("coachMedia")),
		/** Horodatage (ms) de la publication. */
		publishedAt: v.number(),
		/** Jour "yyyy-mm-dd" de publication (repère CRM). */
		publishedDay: v.string(),
		/** Première consultation réelle par la cliente (« Vu »). */
		readAt: v.optional(v.number()),
		/** Ligne issue d'un message global (Tableau de bord) — étiquette CRM. */
		broadcastId: v.optional(v.id("coachBroadcasts")),
	})
		.index("by_user", ["userId"])
		.index("by_user_day", ["userId", "publishedDay"])
		.index("by_broadcast", ["broadcastId"]),

	/**
	 * Message global coach → toutes les clientes actives (CRM, Tableau de bord).
	 * Une seule ligne ACTIVE à la fois : l'envoi d'un nouveau message retire
	 * automatiquement le précédent. Un unique appel `sendCoachBroadcast` inscrit
	 * l'étampage du message du jour chez chaque cliente visée (même système que
	 * la Vision 360 — aucune différence d'affichage côté cliente) et note les
	 * destinataires dans `sentTo` pour éviter tout doublon d'envoi.
	 */
	coachBroadcasts: defineTable({
		/** Texte du message global (max 500 — même limite que la Vision 360). */
		text: v.string(),
		/** Horodatage (ms) de la publication. */
		publishedAt: v.number(),
		/** Jour "yyyy-mm-dd" de publication (repère CRM). */
		publishedDay: v.string(),
		/** Minuit local (ms UTC) de la cliente — la fenêtre suit SON fuseau. */
		expiresAt: v.number(),
		/** Fuseau IANA utilisé pour calculer expiresAt (Europe/Paris par défaut). */
		timeZone: v.string(),
		/** Ids des clientes étampées (v.activeCoachBroadcast réarme ce qui manque). */
		sentTo: v.array(v.id("users")),
		/** Null après retrait manuel — l'historique CRM garde la trace. */
		withdrawnAt: v.optional(v.number()),
	})
		.index("by_published", ["publishedAt"]),

	/**
	 * Dossier de la cliente (CRM coach) : notes privées et ressources partagées.
	 * Chaque entrée porte sa visibilité — par défaut « private » (note interne,
	 * jamais envoyée) ; seules les entrées « shared » apparaissent dans la page
	 * cliente « Ressources ». Un seul fichier / une seule entrée : la visibilité
	 * détermine qui peut y accéder, sans duplication physique.
	 */
	coachResources: defineTable({
		userId: v.id("users"),
		/** « note » (texte) ou « file » (fichier stocké sur Convex storage). */
		kind: v.union(v.literal("note"), v.literal("file")),
		/** Titre court affiché côté CRM et côté cliente (ressources partagées). */
		title: v.string(),
		/** Corps de la note (kind = "note"). */
		body: v.optional(v.string()),
		/** Visibilité : « private » = note/doc privé coach ; « shared » = visible cliente. */
		visibility: v.union(v.literal("private"), v.literal("shared")),
		/** Fichier (kind = "file") — pointe vers le storage Convex. */
		storageId: v.optional(v.id("_storage")),
		mime: v.optional(v.string()),
		name: v.optional(v.string()),
		size: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_user", ["userId"]),

	/* ═══ Plans de repas coach + planification (client & coach) ═══ */

	/**
	 * TEMPLATE de plan de repas créé par la coach (bibliothèque globale CRM).
	 * Un template est indépendant des clientes : le même plan peut être assigné
	 * à plusieurs clientes sans copie par cliente. Une seule journée type —
	 * la répétition est faite par l'assignation (dates + jours concernés).
	 * JAMAIS modifié par une cliente ; les ajustements passent par les
	 * `plannedEntries` (overrides journaliers, snapshot inclus).
	 */
	mealPlanTemplates: defineTable({
		/** Coach propriétaire du plan. */
		coachId: v.id("users"),
		name: v.string(),
		description: v.optional(v.string()),
		/** Items du plan : 1 journée type, snacks inclus (snapshot nutritionnel). */
		items: v.array(
			v.object({
				meal: v.string(),
				foodId: v.optional(v.id("foods")),
				customFoodId: v.optional(v.id("customFoods")),
				name: v.string(),
				brand: v.optional(v.string()),
				imageUrl: v.optional(v.string()),
				qtyGrams: v.number(),
				/** Valeurs calculées pour la quantité donnée (snapshot, jamais recalculées). */
				kcal: v.number(),
				carbs: v.number(),
				protein: v.number(),
				fat: v.number(),
			})
		),
		/** Totaux du plan complet (somme des items, cachés pour la liste). */
		totalKcal: v.number(),
		totalCarbs: v.number(),
		totalProtein: v.number(),
		totalFat: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_coach", ["coachId"])
		.index("by_coach_updated", ["coachId", "updatedAt"]),

	/**
	 * Assignation d'un plan à une cliente : période + jours concernés.
	 * Actif pour une date D ssi start ≤ D ≤ end ET weekday(D) ∈ weekdays ET
	 * removedAt est vide (retrait par la coach). Retirer n'efface jamais les
	 * données passées : les overrides et consommations restent intacts.
	 */
	mealPlanAssignments: defineTable({
		userId: v.id("users"),
		templateId: v.id("mealPlanTemplates"),
		coachId: v.id("users"),
		/** Premier jour concerné "yyyy-mm-dd" (heure locale de la cliente). */
		startDate: v.string(),
		/** Dernier jour concerné "yyyy-mm-dd" — la période est toujours bornée. */
		endDate: v.string(),
		/** Jours de semaine concernés : [1..7] = lundi..dimanche (tous par défaut). */
		weekdays: v.optional(v.array(v.number())),
		/** Retrait par la coach (ms) — l'historique consommé reste intact. */
		removedAt: v.optional(v.number()),
		createdAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_template", ["templateId"]),

	/**
	 * Aliment PLANIFIÉ — dans le journal d'une journée, mais PAS encore
	 * consommé : zéro impact calories/macros tant qu'il n'est pas validé.
	 *
	 * Sources : `coach_plan` (proposition issue du plan assigné — résolue à la
	 * volée depuis le template, jamais dupliquée en base) et `client_planned`
	 * (préparation volontaire de la cliente sur une date future).
	 *
	 * Overrides journaliers (quantity changed / deleted / replaced) portés par
	 * cette table — le template coach n'est JAMAIS modifié par une cliente.
	 * La validation « Mangé » transforme la ligne en entrée `diaryEntries`
	 * normale (single source of truth des calories consommées) puis supprime
	 * cette ligne planned. Le coach peut tout lire, jamais écrire.
	 */
	plannedEntries: defineTable({
		userId: v.id("users"),
		/** Date visée "yyyy-mm-dd" (heure locale de la cliente) — peut être future. */
		date: v.string(),
		meal: v.string(),
		/** "coach_plan" | "client_planned". */
		source: v.union(v.literal("coach_plan"), v.literal("client_planned")),
		/** Pour coach_plan : la ligne de template résolue ce jour-là (copy-on-write). */
		templateId: v.optional(v.id("mealPlanTemplates")),
		/** Index de l'item dans le template (stabilité malgré les éditions coach). */
		templateItemKey: v.optional(v.string()),
		/** Override éventuel du nom (remplacement : l'ancien item est supprimé, celui-ci est créé). */
		name: v.string(),
		brand: v.optional(v.string()),
		imageUrl: v.optional(v.string()),
		qtyGrams: v.number(),
		/** Snapshot nutritionnel — un changement OFF/template futur ne réécrit jamais l'historique. */
		kcal: v.number(),
		carbs: v.number(),
		protein: v.number(),
		fat: v.number(),
		/** Aliment d'origine (pour éditer la quantité avec la bonne portion). */
		foodId: v.optional(v.id("foods")),
		customFoodId: v.optional(v.id("customFoods")),
		createdAt: v.number(),
	})
		.index("by_user_date", ["userId", "date"])
		.index("by_user", ["userId"]),

	/**
	 * Compte Google Calendar connecté du COACH (CRM) — système de rendez-vous.
	 * Le refresh token est stocké chiffré AES-256-GCM (clé GOOGLE_ENC_KEY
	 * détenue par le serveur SvelteKit, jamais par Convex ni par le client) —
	 * cette table ne contient jamais de token en clair.
	 */
	googleAccounts: defineTable({
		/** Coach propriétaire de la connexion (un compte Google par coach). */
		coachId: v.id("users"),
		/** Email du compte Google connecté (affichage CRM). */
		email: v.string(),
		/** Refresh token chiffré AES-256-GCM (base64 : iv | tag | ciphertext). */
		encRefreshToken: v.string(),
		/** Access token chiffré (base64) — optionnel, ré-échangé à expiration. */
		encAccessToken: v.optional(v.string()),
		/** Expiration de l'access token (ms epoch) — 0 si inconnue. */
		expiry: v.optional(v.number()),
		/** Scopes accordés (espace séparé, ex. calendar.events calendar.freebusy). */
		scope: v.string(),
		/** Moment (ms) de la connexion (ou de la dernière reconnexion). */
		connectedAt: v.number(),
	}).index("by_coach", ["coachId"]),

	/**
	 * Système de rendez-vous — disponibilités de la coach (créneaux par jour
	 * de semaine). Le module de gestion vit dans le système de rendez-vous ;
	 * la déclaration ici préserve la table et ses données existantes.
	 */
	bookingSettings: defineTable({
		coachId: v.id("users"),
		/** Créneaux ouverts : [{ day: 1..7 (lundi..dimanche), start: "09:00", end: "12:30" }]. */
		ranges: v.array(v.object({ day: v.number(), start: v.string(), end: v.string() })),
		updatedAt: v.number(),
	}).index("by_coach", ["coachId"]),

	/**
	 * Système de rendez-vous — rendez-vous entre la coach et une cliente.
	 * Statuts : `on_book` (confirmé, événement Google créé) / `client_request`
	 * (statut historique conservé pour les anciennes données — plus créé) /
	 * `cancelled` (annulé, historique conservé).
	 * `bookedBy` + `bookingSource` portent l'origine : coach ou cliente.
	 * L'origine n'est JAMAIS un droit : une cliente peut replanifier un RDV
	 * créé par elle ou par la coach (`lastModifiedBy` trace le dernier geste).
	 */
	appointments: defineTable({
		coachId: v.id("users"),
		clientId: v.id("users"),
		/** Date "yyyy-mm-dd" (fuseau de la coach, Europe/Paris). */
		date: v.string(),
		/** Heure de début "HH:mm". */
		time: v.string(),
		/** Heure de fin "HH:mm". */
		endTime: v.string(),
		/** Type de rendez-vous ("Suivi" 15 min, "Démarrage" 60 min ; anciens types conservés). */
		kind: v.string(),
		status: v.union(v.literal("on_book"), v.literal("client_request"), v.literal("cancelled")),
		/** Origine de la réservation : coach ou cliente. */
		bookedBy: v.id("users"),
		/** Origine conceptuelle de la réservation initiale ("coach" | "client"). */
		bookingSource: v.optional(v.union(v.literal("coach"), v.literal("client"))),
		/** Dernier auteur d'une modification (replanification / annulation). */
		lastModifiedBy: v.optional(v.id("users")),
		createdAt: v.number(),
		updatedAt: v.optional(v.number()),
		/** Nombre de replanifications (info CRM). */
		rescheduleCount: v.optional(v.number()),
		/** Pour une demande de replanification cliente : le RDV confirmé source. */
		sourceId: v.optional(v.id("appointments")),
		/** Événement Google Calendar associé (créé/mis à jour par le BFF). */
		googleEventId: v.optional(v.string()),
		cancelledAt: v.optional(v.number()),
		cancelledBy: v.optional(v.id("users")),
		/** Rappel 12 h : moment d'envoi (ms) — protection anti-doublon (idempotence). */
		reminder12hSentAt: v.optional(v.number()),
		/** startAt (ms UTC) pour lequel le rappel a été envoyé — une replanification réarme le rappel. */
		reminder12hForStartAt: v.optional(v.number()),
	}).index("by_coach", ["coachId"]).index("by_client", ["clientId"]),

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
