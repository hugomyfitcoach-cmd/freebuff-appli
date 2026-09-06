import { v } from "convex/values";

/**
 * Validateur commun des réponses du bilan hebdo.
 *
 * Tous les champs sont optionnels, comme dans le formulaire d'origine :
 * le client peut passer une étape sans répondre (seuls prénom/nom et la
 * catégorie du retour écrit sont exigés côté interface). Les clés absentes
 * ne sont simplement pas stockées.
 */
export const answersValidator = v.object({
	/** Motivation de la semaine (1 à 5). */
	motivation: v.optional(v.number()),
	/** Adhérence au plan calorique : "oui" | "partiel" | "non". */
	adherence: v.optional(v.string()),
	/** "non" | "peut-etre" | "oui" — posé si adherence !== "oui". */
	deficit_annule: v.optional(v.string()),
	/** Faim marquée / envies difficiles : "oui" | "non". */
	faim: v.optional(v.string()),
	/** "suffisante" | "variable" | "insuffisante". */
	hydratation: v.optional(v.string()),
	/** "ok" | "perturbee" | "ballonnements". */
	digestion: v.optional(v.string()),
	/** "moins5000" | "5000-8000" | "8000-10000" | "plus10000". */
	pas: v.optional(v.string()),
	/** Phase de cycle : "regles" | "folliculaire" | "ovulation" | "luteale" | "menopause" | "pilule" | "sais-pas". */
	cycle: v.optional(v.string()),
	/** "baisse" | "stable" | "hausse". */
	evolution: v.optional(v.string()),
	/** Semaine de mensurations : "oui" | "non". */
	mensurations: v.optional(v.string()),
	/** Semaine de photos : "oui" | "non". */
	photos: v.optional(v.string()),
	/** "rien" | "ecrit" | "appel". */
	besoin_retour: v.optional(v.string()),
	/** Catégories du retour écrit : "alimentation" | "sport" | "motivation" | "autre". */
	categorie_retour: v.optional(v.array(v.string())),
	/** Détail libre (retour écrit ou appel). */
	point_retour: v.optional(v.string()),
	/** Victoire / fierté de la semaine. */
	victoire: v.optional(v.string()),
});
