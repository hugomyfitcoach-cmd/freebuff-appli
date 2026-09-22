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

/** Objectifs de programme (module Entraînement) — liste fermée FR. */
export const programGoal = v.union(
	v.literal("hypertrophie"),
	v.literal("perte_de_gras"),
	v.literal("remise_en_forme"),
	v.literal("force"),
	v.literal("autre")
);
/** Niveaux de programme (module Entraînement) — liste fermée FR. */
export const programLevel = v.union(
	v.literal("debutante"),
	v.literal("intermediaire"),
	v.literal("avancee")
);
export const userRole = v.union(v.literal("coach"), v.literal("client"));
/**
 * Source d'une dépense sportive : saisie manuelle de la cliente ou création
 * automatique depuis une séance G-FLUX explicitement terminée.
 */
export const sportActivitySource = v.union(v.literal("manual"), v.literal("gflux_training"));
/**
 * Provenance de la durée d'une séance : mesurée (startedAt/completedAt
 * persistés) ou saisie manuellement par la cliente au moment de terminer.
 */
export const durationSourceKind = v.union(v.literal("tracked"), v.literal("manual"));
/**
 * Statut « candidat global G-FLUX » d'un aliment créé par une cliente :
 * - absent    : aliment privé (recette maison, saisie sans code-barres) ;
 * - candidate : produit emballé identifié par code-barres, PRIS comme
 *   candidat à la base globale — la publication (insert dans `foods`) est
 *   une action COACH/exploitation manuelle, JAMAIS automatique.
 */
export const customFoodGlobalStatus = v.union(v.literal("candidate"));
/**
 * PHASES d'une séance (module Entraînement) — un seul parcours, plusieurs
 * blocs affichés dans l'ordre : échauffement → principal → finisher.
 * Champ optionnel sur `trainingSessionExercises` : absent = "principal"
 * (compatibilité totale avec les programmes existants).
 */
export const trainingPhase = v.union(
	v.literal("echauffement"),
	v.literal("principal"),
	v.literal("finisher")
);
/**
 * Types d'événements du journal d'activité cliente (onglet Notifications du
 * CRM). Liste fermée : chaque type a son libellé, son icône et la section de
 * la Vision 360 qu'il ouvre (miroir côté client : src/lib/notifications.ts).
 * Les anciens types « bilan_envoye » / « bilan_manquant » ont été retirés à
 * la demande — le cron `notifications-tick` purge les lignes historiques.
 */
export const coachNotifKind = v.union(
	v.literal("nouveau_poids"),
	v.literal("nouvelles_mesures"),
	v.literal("nouvelles_photos"),
	v.literal("bilan_envoye"),
	v.literal("plan_assigned"),
	v.literal("rdv_pris"),
	v.literal("rdv_annule"),
	v.literal("rdv_replanifie"),
	v.literal("onboarding_termine"),
	v.literal("inactivite")
);

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
	/** Dernière consultation de la section « Ressources » (Drive) par la
	 *  cliente — comparé à coachResources.sharedAt pour le badge « Drive » :
	 *  un contenu partagé APRÈS la dernière visite est un non-lu. */
	resourcesSeenAt: v.optional(v.number()),
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
		/** « Me le rappeler plus tard » carte Mensurations : masquée jusqu'à cet horodatage (ms) — 48 h par défaut. */
		measurementsSnoozeUntil: v.optional(v.number()),
		/** « Me le rappeler plus tard » carte Photos : masquée jusqu'à cet horodatage (ms) — 48 h par défaut. */
		photosSnoozeUntil: v.optional(v.number()),
		/**
		 * Legacy : dernière synchro Apple Santé réussie (ms). La synchronisation
		 * automatique a été retirée — ce champ n'est plus jamais lu ni écrit, il
		 * reste déclaré car des utilisateurs existants le portent encore (la
		 * validation de schéma refuserait un push si on le supprimait).
		 */
		lastHealthSyncAt: v.optional(v.number()),
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
		/** Composés à coefficient kcal ≠ 4 — garde-fou kcal↔macros (jamais affichés). */
		fiber100: v.optional(v.number()),
		polyols100: v.optional(v.number()),
		/** Alcool /100 g — convention OFF : % vol. */
		alcohol100: v.optional(v.number()),
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
		/** Composés à coefficient kcal ≠ 4 (cohérence du garde-fou kcal↔macros). */
		fiber100: v.optional(v.number()),
		/** Sel /100 g (information étiquette — jamais affiché dans les macros). */
		salt100: v.optional(v.number()),
		/** Portion suggérée (g), optionnelle — sert de quantité par défaut. */
		servingQty: v.optional(v.number()),
		/**
		 * Code-barres EAN/GTIN lu au scan — produit emballé identifié. Présent
		 * → l'aliment peut devenir « candidat global » (voir globalStatus).
		 * Un même code peut exister chez plusieurs clientes : la dédoublonnage
		 * à la publication globale relit l'index.
		 */
		barcode: v.optional(v.string()),
		/** "candidate" : pris pour un futur enrichissement global (jamais auto). */
		globalStatus: v.optional(customFoodGlobalStatus),
		/** Origine de la création : "manual" (défaut) ou "label_photo". */
		sourceKind: v.optional(v.string()),
		createdAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_barcode", ["barcode"])
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
		/** Regroupement repas analysé (photo IA) : les N composants d'une même
		 *  analyse partagent une clé "analyse:<timestamp>" — affichés comme UNE
		 *  carte dans le Journal, recalculables composant par composant. */
		mealGroup: v.optional(v.string()),
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
		/** Valeur EFFECTIVE utilisée partout (page « Mes pas », stats, graphes, objectifs, CRM). */
		count: v.number(),
		/**
		 * Legacy : dernière valeur importée d'Apple Santé (raccourci iOS). La
		 * synchro automatique a été retirée — plus jamais lue ni écrite, mais
		 * toujours déclarée car des lignes existantes la portent encore (la
		 * validation de schéma refuserait un push si on la supprimait).
		 */
		healthCount: v.optional(v.number()),
		/** Valeur de la saisie manuelle de la cliente (provenance de `count`). */
		manualCount: v.optional(v.number()),
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
				/** Fiche de RÉFÉRENCE Ciqual (ANSES) — libellé officiel exact ; les valeurs nutritionnelles restent un snapshot. */
				ciqualLabel: v.optional(v.string()),
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
		visibility: v.union(v.literal("private"), v.literal("shared")),						/** Fichier (kind = "file") — pointe vers le storage Convex. */
						storageId: v.optional(v.id("_storage")),
						mime: v.optional(v.string()),
						name: v.optional(v.string()),
						size: v.optional(v.number()),
						/** Pièces jointes (kind = "file", 1 à 5 fichiers dans la même entrée). */
						attachments: v.optional(
							v.array(
								v.object({
									storageId: v.id("_storage"),
									mime: v.string(),
									name: v.string(),
									size: v.number(),
								})
							)
						),
		createdAt: v.number(),
		updatedAt: v.number(),
		/** Horodatage du partage (privé → partagé) — null si jamais partagé ou
	 *  remis privé. Sert au badge « Drive » : tout contenu partagé après la
	 *  dernière consultation cliente (users.resourcesSeenAt) est un non-lu.
	 *  Posé dans la MÊME transaction que la bascule de visibilité. */
		sharedAt: v.optional(v.number()),
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
				/** Fiche de RÉFÉRENCE Ciqual (ANSES) — libellé officiel exact ; snapshot nutritionnel inchangé. */
				ciqualLabel: v.optional(v.string()),
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
		/** Fiche de RÉFÉRENCE Ciqual (ANSES) d'origine — info de source, valeurs en snapshot. */
		ciqualLabel: v.optional(v.string()),
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

	/**
	 * Notifications coach (CRM) — journal centralisé de l'activité cliente :
	 * nouveau poids / mensurations / photos, rendez-vous pris / annulés /
	 * replanifiés, bilan hebdo envoyé, bilan manquant et inactivité (aucune
	 * connexion depuis 4 jours). Une notification = cliente + événement +
	 * courte description + horodatage, avec un statut « à consulter / vue ».
	 *
	 * `dedupKey` porte la déduplication transactionnelle : le même événement
	 * (même période d'inactivité, même semaine de bilan manquant, même envoi)
	 * n'est jamais enregistré deux fois — la garde est relue DANS la même
	 * transaction que l'insertion (les mutations Convex sont sérialisables).
	 * Les alertes dérivées (inactivité, bilan manquant) sont posées par le
	 * cron `notifications-tick` ; les événements réels sont enregistrés
	 * directement dans les mutations qui les produisent.
	 */
	coachNotifications: defineTable({
		/** Cliente concernée par l'événement. */
		userId: v.id("users"),
		kind: coachNotifKind,
		/** Courte description affichée dans le CRM (ex. « Poids : 62,4 kg (−0,8) »). */
		description: v.string(),
		/** Statut de consultation : false = « À consulter », true = « Vue ». */
		read: v.boolean(),
		/** Clé de déduplication (ex. "inact:userId:2026-09-07") — absente pour les événements uniques. */
		dedupKey: v.optional(v.string()),
		/** Bilan concerné — conservé pour les lignes historiques. */
		checkinId: v.optional(v.id("checkins")),
		/** Rendez-vous concerné (rdv_*) — lien direct vers la source. */
		appointmentId: v.optional(v.id("appointments")),
		/** Semaine de référence ("yyyy-mm-dd", lundi) pour les événements bilan. */
		weekStart: v.optional(v.string()),
	})
		.index("by_user", ["userId"])
		.index("by_read", ["read"])
		.index("by_dedup", ["dedupKey"]),

	/**
	 * Événements « push » destinés à la cliente — signal du mécanisme central
	 * de propagation (polling 5 s, src/lib/notificationPoll.ts). Une ligne par
	 * événement nécessitant plus qu'un simple compteur de badge : la page
	 * concernée doit être rafraîchie automatiquement (ex. plan de repas assigné
	 * → propositions du Journal). Le poller relit les lignes créées depuis son
	 * dernier check (?since=) et invalide la donnée concernée — aucune action
	 * de la coach ne dépend plus d'une navigation. Purge : 7 jours (tick CRM).
	 */
	clientEvents: defineTable({
		/** Cliente destinataire. */
		userId: v.id("users"),
		/** Type d'événement ("plan_assigned" aujourd'hui — liste ouverte). */
		kind: v.string(),
		/** Libellé court (ex. nom du plan assigné). */
		label: v.optional(v.string()),
		createdAt: v.number(),
	}).index("by_user", ["userId"]),

	/**
	 * Miroir G-FLUX des miniatures alimentaires Open Food Facts (cache global,
	 * À LA DEMANDE — zéro import massif). Un seul document par offId :
	 * `pending` (réservation exclusive, course arbitraire par l'index by_offId)
	 * → `ready` (copie 100 px en storage, URL stable servie au navigateur) ou
	 * `failed` (OFF injoignable — retentable à la prochaine demande). OFF
	 * n'est plus jamais contacté à l'affichage : uniquement au premier cache
	 * miss. `lastUsedAt` permettra une purge future des images inutilisées
	 * sans toucher aux fiches aliments ni à l'historique nutritionnel.
	 */
	foodImageCache: defineTable({
		/** Code-barres OFF (EAN/GTIN) — clé de déduplication stricte. */
		offId: v.string(),
		/** Copie G-FLUX (miniature 100 px) — absent tant que pending/failed. */
		storageId: v.optional(v.id("_storage")),
		/** Source OFF d'origine (traçabilité, repli technique jamais prioritaire). */
		sourceUrl: v.optional(v.string()),
		/** URL OFF de la variante 100 px réellement téléchargée. */
		thumbnailSourceUrl: v.optional(v.string()),
		/** ready (servi) | pending (course en cours) | failed (retentable). */
		status: v.union(v.literal("ready"), v.literal("pending"), v.literal("failed")),
		/** Poids de la copie (octets) — contrôle du volume stocké. */
		bytes: v.optional(v.number()),
		contentType: v.optional(v.string()),
		/** Raison d'échec (off-timeout, off-too-big-…, off-http-404…). */
		failReason: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.optional(v.number()),
		/** Dernière utilisation — brique de la purge future, jamais pour l'UX. */
		lastUsedAt: v.optional(v.number()),
	})
		.index("by_offId", ["offId"])
		.index("by_status", ["status"]),

	/* ═══ Module Entraînement — bibliothèque d'exercices G-FLUX ═══ */

	/**
	 * BIBLIOTHÈQUE INTERNE G-FLUX d'exercices — socle du futur module
	 * Entraînement (bibliothèque coach, programmes, séances).
	 *
	 * Principe fort : le modèle est G-FLUX, JAMAIS la structure d'une source
	 * externe. Les banques tierces (ExerciseDB gratuit aujourd'hui, dataset
	 * commercial demain) sont importées via `source` + `sourceExerciseId`
	 * (clé d'import anti-doublon, idempotent) et normalisées vers le
	 * vocabulaire G-FLUX (muscles / équipements en français). Remplacer la
	 * source = réécrire le convertisseur du script d'import, rien d'autre :
	 * ni le schéma, ni les fonctions, ni le frontend ne dépendent des ids
	 * externes.
	 *
	 * Deux familles coexistent :
	 *  - `system: true`  → bibliothèque système (imports + futur dataset
	 *    commercial) — l'import met à jour, ne supprime JAMAIS ;
	 *  - `system: false` → exercices créés par la coach (`coachId`), sans
	 *    aucune source externe (`source: "gflux"`), jamais touchés par un
	 *    import.
	 *
	 * Troisième origine au sein de la famille système : la bibliothèque
	 * OFFICIELLE G-FLUX (`source: "gflux-official"`) — les exercices animés
	 * propriétaires produits dans le dépôt (`static/exercises/<slug>/`,
	 * registre généré `static/exercises/index.json`) et poussés vers cette
	 * table par `scripts/sync-gflux-exercises.mjs` (npm run exercises:sync).
	 * Même modèle, même clé d'upsert (source + slug) : une seule bibliothèque
	 * est exposée à l'application, aucune interface parallèle.
	 *
	 * Médias : pour le prototype, `mediaUrl` / `thumbnailUrl` conservent
	 * l'URL de la source (aucun téléchargement massif). Au passage en
	 * licence commerciale, ils pointeront vers notre stockage/CDN — le
	 * frontend ne lit que ces champs, jamais une URL codée en dur.
	 */
	exercises: defineTable({
		/** Identifiant G-FLUX portatif ("ex_" + hex déterministe) — stable même
		 *  si la source externe change, référencé par les futurs programmes. */
		gfluxExerciseId: v.string(),
		/** Nom d'affichage G-FLUX (éditable par la coach, survit aux imports). */
		name: v.string(),
		/** Nom original dans la source externe (traçabilité, si renommé). */
		sourceName: v.optional(v.string()),
		/** Groupe musculaire principal — vocabulaire G-FLUX FR (ex. "Pectoraux"). */
		muscleGroup: v.optional(v.string()),
		/** Muscles secondaires — même vocabulaire G-FLUX. */
		secondaryMuscles: v.optional(v.array(v.string())),
		/** Partie du corps — vocabulaire G-FLUX (ex. "Haut du corps"). */
		bodyPart: v.optional(v.string()),
		/** Équipement — vocabulaire G-FLUX (ex. "Haltères", "Poids du corps"). */
		equipment: v.optional(v.string()),
		/** Catégorie d'effort — vocabulaire G-FLUX (ex. "Renforcement", "Cardio"). */
		category: v.optional(v.string()),
		/** Instructions d'exécution (étapes), si fournies par la source. */
		instructions: v.optional(v.array(v.string())),
		/** Repères techniques courts (bloc pédagogique G-FLUX officiel). */
		cues: v.optional(v.array(v.string())),
		/** Erreurs classiques à éviter (bloc pédagogique G-FLUX officiel). */
		mistakes: v.optional(v.array(v.string())),
		/** Niveaux conseillés (ex. ["Débutant", "Intermédiaire", "Avancé"]). */
		levels: v.optional(v.array(v.string())),
		/** Respiration pédagogique (excentrique / concentrique). */
		breathing: v.optional(
			v.object({
				eccentric: v.optional(v.string()),
				concentric: v.optional(v.string()),
			})
		),
		/** Média principal (GIF/image) — URL interne G-FLUX une fois auto-hébergé,
		 *  sinon URL source (prototype). Le binaire ne vit JAMAIS ici. */
		mediaUrl: v.optional(v.string()),
		/** URL du média ORIGINAL chez la source (traçabilité, re-téléchargement,
		 *  bascule CDN) — conservée même après hébergement interne. */
		sourceMediaUrl: v.optional(v.string()),
		/** Média hébergé dans le file storage Convex — source de vérité du
		 *  binaire ; `mediaUrl` est son URL résolue. */
		mediaStorageId: v.optional(v.id("_storage")),
		/** Taille du média hébergé (octets) — info de volume. */
		mediaSizeBytes: v.optional(v.number()),
		/** Miniature si disponible. */
		thumbnailUrl: v.optional(v.string()),
		/** Médias complémentaires (vues multiples), si la source en fournit. */
		mediaUrls: v.optional(v.array(v.string())),
		/** Vignette statique (bibliothèque officielle G-FLUX : poster.webp). */
		posterUrl: v.optional(v.string()),
		/** Animation du mouvement (bibliothèque officielle G-FLUX : animation.mp4,
		 *  servie depuis le dépôt) — le GIF/vidéo reste hors de la table. */
		animationUrl: v.optional(v.string()),
		/** Origine : "gflux" (exercice coach) ou identifiant de source externe
		 *  (ex. "free-exercise-db"). Jamais un id de la source. */
		source: v.string(),
		/** Identifiant de l'exercice DANS la source — absent pour "gflux". */
		sourceExerciseId: v.optional(v.string()),
		/** Note de licence du média/des données (ex. "Domaine public"). */
		licenseNote: v.optional(v.string()),
		/** Actif (prêt à être proposé) — l'import ne le touche jamais. */
		active: v.boolean(),
		/** Masqué manuellement par la coach — préservé par les imports. */
		hidden: v.optional(v.boolean()),
		/** Bibliothèque système (imports) vs exercice personnalisé coach. */
		system: v.boolean(),
		/** Coach créatrice (system: false uniquement). */
		coachId: v.optional(v.id("users")),
		/** Lot d'import ("source@date") — repère de traçabilité, info. */
		importBatch: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_source_id", ["source", "sourceExerciseId"])
		.index("by_gfluxId", ["gfluxExerciseId"])
		.index("by_muscleGroup", ["muscleGroup"])
		.index("by_equipment", ["equipment"])
		.index("by_name", ["name"])
		.searchIndex("name_search", { searchField: "name" }),

	/* ═══ Module Entraînement — programmes, séances, prescription ═══ */

	/**
	 * PROGRAMME d'entraînement créé par la coach (CRM). Indépendant des
	 * clientes (l'assignation sera une table séparée, mission future) —
	 * un même programme réutilisable plusieurs fois, comme les plans de
	 * repas. Objectif et niveau : vocabulaire fermé FR affiché tel quel.
	 */
	trainingPrograms: defineTable({
		coachId: v.id("users"),
		name: v.string(),
		/**
		 * PROGRAMME ASSIGNÉ (copie indépendante) : présence de `clientId` ⇔ cette
		 * ligne est la copie d'un programme modèle pour UNE cliente. Les champs
		 * sont absents (undefined) sur les programmes modèles — modifier le modèle
		 * ne modifie JAMAIS rétroactivement une copie (duplication intégrale à
		 * l'assignation). `sourceProgramId` = traçabilité vers le modèle d'origine.
		 */
		clientId: v.optional(v.id("users")),
		sourceProgramId: v.optional(v.id("trainingPrograms")),
		description: v.optional(v.string()),
		/** "hypertrophie" | "perte_de_gras" | "remise_en_forme" | "force" | "autre". */
		goal: v.optional(programGoal),
		/** "debutante" | "intermediaire" | "avancee". */
		level: v.optional(programLevel),
		/** Image de couverture (Convex file storage) — optionnelle. */
		imageStorageId: v.optional(v.id("_storage")),
		/** Séances par semaine visées (ex. 3) — info de cadrage, indépendante du nombre de jours créés. */
		sessionsPerWeek: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_coach", ["coachId"])
		.index("by_coach_updated", ["coachId", "updatedAt"]),

	/**
	 * SÉANCE (jour) d'un programme — ordre porté par le champ `order`
	 * (réordonnancement drag & drop : patch des ordres en un lot).
	 */
	trainingSessions: defineTable({
		programId: v.id("trainingPrograms"),
		/** Nom affiché ("Jour 1 — Bas du corps"), éditable. */
		name: v.string(),
		order: v.number(),
		createdAt: v.number(),
	}).index("by_program", ["programId"]),

	/**
	 * EXERCICE posé dans une séance — référence la bibliothèque interne
	 * (`exercises.gfluxExerciseId` via `exerciseId`), jamais une source
	 * externe. La prescription vit sur cette ligne (mode, tempo, notes) et
	 * les séries dans `trainingSets` : remplacer la banque d'exercices ne
	 * touche pas les programmes.
	 */
	trainingSessionExercises: defineTable({
		sessionId: v.id("trainingSessions"),
		/** Exercice de la bibliothèque G-FLUX (system ou personnalisé coach). */
		exerciseId: v.id("exercises"),
		order: v.number(),
		/** "reps" (défaut) ou "time" (circuit/cardio). */
		mode: v.union(v.literal("reps"), v.literal("time")),
		/** Tempo facultatif (ex. "3-1-1-0"). */
		tempo: v.optional(v.string()),
		/** Note coach spécifique à cet exercice dans cette séance. */
		coachNote: v.optional(v.string()),
		/**
		 * Phase du parcours (échauffement → principal → finisher) — optionnel :
		 * absent = "principal" (les séances existantes restent inchangées).
		 */
		phase: v.optional(trainingPhase),
		/** Consigne technique affichée avec la prescription. */
		techniqueNote: v.optional(v.string()),
		createdAt: v.number(),
	}).index("by_session", ["sessionId"]),

	/**
	 * SÉRIE prescrite d'un exercice de séance. Mode reps : repsMin/repsMax
	 * (plage 8–12 = deux champs ; valeur fixe = min = max), charge cible kg
	 * libre et facultative, RIR 0–5 facultatif, repos en secondes.
	 * Mode time : durationSeconds (+ restSeconds = repos après l'exercice).
	 * Pas de %1RM en V1 (choix produit).
	 */
	trainingSets: defineTable({
		sessionExerciseId: v.id("trainingSessionExercises"),
		order: v.number(),
		repsMin: v.optional(v.number()),
		repsMax: v.optional(v.number()),
		/** Charge cible kg — valeur libre, facultative. */
		targetWeight: v.optional(v.number()),
		/** RIR cible 0–5, facultatif. */
		targetRir: v.optional(v.number()),
		/** Repos en secondes. */
		restSeconds: v.optional(v.number()),
		/** Durée en secondes (mode time). */
		durationSeconds: v.optional(v.number()),
	}).index("by_sessionExercise", ["sessionExerciseId"]),

	/* ═══ Module Entraînement — assignation & suivi d'exécution ═══ */

	/**
	 * ASSIGNATION d'un programme à une cliente. Le programme assigné est une
	 * COPIE indépendante (trainingPrograms.clientId présent) — retirer
	 * l'assignation n'efface jamais l'historique sportif déjà réalisé.
	 * Les séances planifiées vivent dans `trainingScheduledSessions`.
	 */
	trainingAssignments: defineTable({
		coachId: v.id("users"),
		userId: v.id("users"),
		/** Programme COPIE indépendante créée à l'assignation. */
		programId: v.id("trainingPrograms"),
		/** Programme MODÈLE d'origine (traçabilité — peut être supprimé ensuite). */
		sourceProgramId: v.optional(v.id("trainingPrograms")),
		/** Premier jour "yyyy-mm-dd" (heure locale de la cliente). */
		startDate: v.string(),
		/** Dernier jour couvert "yyyy-mm-dd" (borne inclus, ≤ 366 jours). */
		endDate: v.string(),
		/** Jours de semaine des séances : [1..7] = lundi..dimanche. */
		weekdays: v.array(v.number()),
		/** Retrait par la coach (ms) — l'historique réalisé reste intact. */
		removedAt: v.optional(v.number()),
		createdAt: v.number(),
	})
		.index("by_user", ["userId"])
		.index("by_coach", ["coachId"])
		.index("by_program", ["programId"]),

	/**
	 * SÉANCE PROGRAMMÉE — occurrence datée d'une séance du programme assigné
	 * pour UNE cliente. C'est la ligne que manipulent déplacer / dupliquer /
	 * supprimer (menu •••) et que la cliente voit dans son espace Entraînement.
	 * Annulée ≠ supprimée : une occurrence passée n'est JAMAIS détruite.
	 */
	trainingScheduledSessions: defineTable({
		userId: v.id("users"),
		assignmentId: v.id("trainingAssignments"),
		/** Séance du programme COPIE (trainingSessions._id). */
		sessionId: v.id("trainingSessions"),
		/** Date de la séance "yyyy-mm-dd" (heure locale de la cliente). */
		date: v.string(),
		/** "planned" | "completed" | "cancelled" (annulée = masquée, jamais détruite). */
		status: v.union(
			v.literal("planned"),
			v.literal("completed"),
			v.literal("cancelled")
		),
		/** Fin réelle (ms) — posée par completeScheduledSession. */
		completedAt: v.optional(v.number()),
		/** Durée réelle de la séance (min) — saisie/consolidée à la fin. */
		durationMin: v.optional(v.number()),
		/**
		 * DÉBUT RÉEL de la séance (ms) — posé UNIQUEMENT par le bouton
		 * « Commencer la séance » (jamais par l'ouverture de la page). Persisté
		 * côté backend : la durée réelle (completedAt − startedAt) survit au
		 * verrouillage iPhone / PWA en arrière-plan — aucun chrono JavaScript.
		 */
		startedAt: v.optional(v.number()),
		/** Provenance de la durée : "tracked" (timestamps) ou "manual" (saisie cliente). */
		durationSource: v.optional(durationSourceKind),
		/**
		 * « Je n'ai pas réalisé cette séance » (ms) : la cliente clôt la séance
		 * SANS l'avoir faite (consultée / séries cochées) — statut terminé mais
		 * AUCUNE dépense sportive créée.
		 */
		skippedAt: v.optional(v.number()),
		/** Difficulté ressentie 1–5 (option légère, posée par la cliente). */
		difficulty: v.optional(v.number()),
		/** Note libre de la cliente (option légère). */
		note: v.optional(v.string()),
		createdAt: v.number(),
	})
		.index("by_user_date", ["userId", "date"])
		.index("by_user", ["userId"])
		.index("by_assignment", ["assignmentId"])
		.index("by_session", ["sessionId"]),

	/**
	 * LOG DE SÉRIE — l'HISTORIQUE SPORTIF, autonome et intouchable. Écrit par
	 * les deux modes (libre et guidé) via les MÊMES mutations. Tout est en
	 * snapshot : remplacer/supprimer/éditer un programme ne réécrit jamais ces
	 * lignes. L'identité d'exercice (`exerciseId` + `gfluxExerciseId` + nom +
	 * médias) est copiée au moment de la log → progression et historique restent
	 * fiables même si la bibliothèque évolue.
	 */
	trainingSetLogs: defineTable({
		userId: v.id("users"),
		/** Occurrence réalisée (null si ligne annulée manuellement). */
		scheduledSessionId: v.optional(v.id("trainingScheduledSessions")),
		/** Exercice de la bibliothèque G-FLUX (référence vivante). */
		exerciseId: v.id("exercises"),
		/** Identité portable + snapshot d'affichage (jamais recalculeés). */
		gfluxExerciseId: v.optional(v.string()),
		exerciseName: v.string(),
		mediaUrl: v.optional(v.string()),
		posterUrl: v.optional(v.string()),
		/** "reps" | "time". */
		mode: v.union(v.literal("reps"), v.literal("time")),
		/** Prescription au moment de la séance (snapshot). */
		targetReps: v.optional(v.number()),
		targetWeight: v.optional(v.number()),
		targetDurationSeconds: v.optional(v.number()),
		/** Réalisé — reps et charge pour un exercice en reps ; durée pour "time". */
		reps: v.optional(v.number()),
		weightKg: v.optional(v.number()),
		durationSeconds: v.optional(v.number()),
		/** Série validée (faite) — false = ligne saisie non validée. */
		done: v.boolean(),
		/** Numéro de série au sein de l'exercice (0-based, ordre de prescription). */
		setOrder: v.number(),
		/** Date de la séance "yyyy-mm-dd" (heure locale de la cliente). */
		date: v.string(),
		createdAt: v.number(),
	})
		.index("by_user_exercise", ["userId", "exerciseId"])
		.index("by_user_date", ["userId", "date"])
		.index("by_session", ["scheduledSessionId"])
		.index("by_user", ["userId"]),

	/* ═══ Module Dépense sportive — activités sportives réalisées ═══ */

	/**
	 * DÉPENSE SPORTIVE — estimation du volume énergétique lié aux activités
	 * sportives RÉELLEMENT réalisées (saisie manuelle OU séance Entraînement
	 * explicitement terminée).
	 *
	 * RÈGLE MÉTIER FONDAMENTALE : ces kcal sont un REPÈRE uniquement — la
	 * dépense sportive est DÉJÀ prise en compte dans le calibrage calorique.
	 * Jamais ajoutées aux calories alimentaires, jamais de crédit calorique,
	 * jamais d'ajustement automatique du plan/macros/déficit.
	 *
	 * RÈGLE ANTI DOUBLE COMPTAGE : la marche quotidienne est déjà couverte par
	 * `dailySteps` + le niveau de marche du calibrage — le catalogue ne propose
	 * JAMAIS Marche / Marche rapide / Promenade / Balade (voir sportCatalog).
	 *
	 * Snapshots partout : activityNameSnapshot, metValue, coefficientSource,
	 * weightSnapshot — une évolution du catalogue ou une nouvelle pesée ne
	 * réécrit JAMAIS l'historique (même philosophie que trainingSetLogs).
	 *
	 * Idempotence : une séance G-FLUX ne génère JAMAIS deux dépenses —
	 * index `by_trainingSession` relu dans la même transaction que l'écriture.
	 */
	sportActivities: defineTable({
		userId: v.id("users"),
		/** Date de l'activité "yyyy-mm-dd" (heure locale de la cliente). */
		date: v.string(),
		/** Identifiant du catalogue centralisé ("musculation", "padel"…). */
		activityId: v.string(),
		/** Nom affiché au moment de l'enregistrement (survit aux renommages). */
		activityNameSnapshot: v.string(),
		/** Durée en minutes (clamp 1–600). */
		durationMinutes: v.number(),
		/** "legere" | "moderee" | "intense" — absent pour les activités sans intensité. */
		intensity: v.optional(v.string()),
		/** MET utilisé pour l'estimation (snapshot — jamais recalculé). */
		metValue: v.number(),
		/** "gflux_table" | "compendium" — source du coefficient (traçabilité). */
		coefficientSource: v.string(),
		/** Version du catalogue au moment de l'enregistrement (ex. "1"). */
		coefficientVersion: v.string(),
		/** Poids (kg) au moment de l'enregistrement — historique gelé ; absent si aucune pesée connue. */
		weightSnapshot: v.optional(v.number()),
		/** Estimation kcal (MET × poids × durée/60) — absent si pas de poids connu. */
		estimatedCalories: v.optional(v.number()),
		/** MET-minutes (MET × minutes) — suit le volume indépendamment du poids. */
		metMinutes: v.number(),
		/** "manual" | "gflux_training". */
		source: sportActivitySource,
		/** Séance G-FLUX à l'origine (source = gflux_training) — clé d'idempotence. */
		trainingSessionId: v.optional(v.id("trainingScheduledSessions")),
		/** Provenance de la durée (source = gflux_training) : "tracked" | "manual". */
		durationSource: v.optional(durationSourceKind),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_user_date", ["userId", "date"])
		.index("by_user", ["userId"])
		.index("by_trainingSession", ["trainingSessionId"]),

	/**
	 * TRAÇABILITÉ IA — une ligne par appel à OpenAI réussi (étiquette ou repas).
	 * JAMAIS de données personnelles : la photo n'est PAS stockée, seuls les
	 * compteurs techniques (modèle, tokens, durée, coût estimé) permettent de
	 * suivre la consommation. Table bornée par nature (un appel = une ligne).
	 */
	aiUsageLog: defineTable({
		/** "label" (étiquette nutritionnelle) | "meal" (photo de repas). */
		kind: v.union(v.literal("label"), v.literal("meal")),
		/** Modèle exact appelé (ex. "gpt-4o-mini"). */
		model: v.string(),
		inputTokens: v.optional(v.number()),
		outputTokens: v.optional(v.number()),
		/** Durée totale de l'appel (ms). */
		durationMs: v.number(),
		/** Statut : "ok" | "error" (timeout, JSON invalide, panne…). */
		status: v.union(v.literal("ok"), v.literal("error")),
		/** Coût estimé en USD (tarifs publics, à date) — info de pilotage. */
		estimatedCostUsd: v.optional(v.number()),
		/** Raison d'échec courte (tracabilité, jamais de message utilisateur). */
		failReason: v.optional(v.string()),
		createdAt: v.number(),
	}).index("by_kind", ["kind"]),

	/** Clé→valeur d'infrastructure (jamais de données métier). Version
	 *  sémantique du backend : `appVersion = { key: 'api', version: '3' }`.
	 *  Lue par le BFF à chaque déploiement (voir src/routes/api/app/version).
	 *  Un ancien bundle frontend qui parle à un backend plus récent est
	 *  détecté → bandeau « Une nouvelle version de G-FLUX est disponible »
	 *  au lieu d'un écran vide silencieux. */
	meta: defineTable({
		key: v.string(),
		/** Version sémantique du CONTRAT API backend (entier, incrémenté à chaque
		 *  breaking change volontaire, supportée par l'ancien client pendant la
		 *  fenêtre de migration). */
		version: v.number(),
		/** Libellé lisible (facultatif) — ex. « paginated food search ». */
		note: v.optional(v.string()),
	})		.index("by_key", ["key"]),
});
