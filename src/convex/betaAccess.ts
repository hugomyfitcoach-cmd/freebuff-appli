import { query } from "./_generated/server";
import { v } from "convex/values";
import { getSessionUser, normalizeEmail } from "./helpers";

/**
 * ACCÈS BÊTA « Alimentation IA » — contrôle serveur UNIQUE.
 *
 * Fonctionnalités concernées :
 *  - `food_label_ai_beta` : photo d'étiquette → préremplissage (OpenAI) ;
 *  - `meal_photo_ai_beta` : photo de repas → composants + quantités (OpenAI).
 *
 * RÈGLES :
 *  - état initial : OFF pour TOUTES les clientes — allowlist stricte d'emails
 *    (compte de test Hugo GOURHEUX uniquement pendant la bêta) ;
 *  - la sécurité n'est JAMAIS basée sur le nom affiché : l'email normalisé du
 *    compte résolu par session (jamais une valeur transmise par le client) ;
 *  - contrôle appliqué DEUX FOIS : côté BFF avant d'appeler Convex (réponse
 *    rapide, aucun coût) PUIS dans les actions Convex avant tout appel OpenAI
 *    (défense en profondeur — les endpoints ne sont pas un périmètre de
 *    confiance) ;
 *  - flags OFF = l'existant continue à 100 % (recherche, barcode, création
 *    manuelle, Journal) — désactiver l'IA ne supprime aucun code : il suffit
 *    de vider BETA_ACCOUNTS.
 */

/** Comptes autorisés pendant la bêta (emails normalisés, minuscules). */
const BETA_ACCOUNTS: ReadonlySet<string> = new Set(["contact@myfit-coach.fr"]);

export type AiBetaFlags = {
	/** Photo d'étiquette → préremplissage IA (`food_label_ai_beta`). */
	foodLabelAi: boolean;
	/** Photo de repas → composants IA (`meal_photo_ai_beta`). */
	mealPhotoAi: boolean;
};

/** Flags bêta d'un email — source unique de vérité (jamais stockée : révocable instantanément). */
export function aiBetaFlagsForEmail(email: string): AiBetaFlags {
	const allowed = BETA_ACCOUNTS.has(normalizeEmail(email));
	return { foodLabelAi: allowed, mealPhotoAi: allowed };
}

/**
 * Flags bêta de la session courante — lu par le BFF (refus tôt des comptes
 * non autorisés) et par les actions Convex (garde AVANT tout appel OpenAI).
 * Renvoie tout à `false` pour une session inconnue, expirée ou non cliente.
 */
export const flags = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user || user.role !== "client") {
			return { foodLabelAi: false, mealPhotoAi: false };
		}
		return aiBetaFlagsForEmail(user.email);
	},
});
