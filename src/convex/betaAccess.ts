import { query } from "./_generated/server";
import { v } from "convex/values";
import { getSessionUser } from "./helpers";

/**
 * ACCÈS BÊTA « Alimentation IA » — contrôle serveur UNIQUE.
 *
 * Fonctionnalités concernées :
 *  - `food_label_ai_beta` : photo d'étiquette → préremplissage (OpenAI) ;
 *  - `meal_photo_ai_beta` : photo de repas → composants + quantités (OpenAI).
 *
 * RÈGLES :
 *  - LANCEMENT GLOBAL (décision mission finale) : les fonctions IA sont
 *    OUVERTES à TOUTES les clientes en production. Le badge « BÊTA » reste
 *    affiché dans la PWA : il signale simplement que la fonction peut encore
 *    évoluer — il n'est plus un périmètre d'accès restreint ;
 *  - FILET DE SÉCURITÉ CONSERVÉ : le mécanisme de feature flag reste en place
 *    (double contrôle BFF + action Convex, kill switch instantané). Poser
 *    BETA_AI_DISABLED=1 sur le déploiement Convex repasse tout à OFF sans
 *    redéploiement (`npx convex env set BETA_AI_DISABLED 1 --prod`) ;
 *  - la sécurité n'est JAMAIS basée sur le nom affiché : l'état est résolu
 *    par la session serveur (jamais une valeur transmise par le client) ;
 *  - contrôle appliqué DEUX FOIS : côté BFF avant d'appeler Convex (réponse
 *    rapide, aucun coût) PUIS dans les actions Convex avant tout appel OpenAI
 *    (défense en profondeur — les endpoints ne sont pas un périmètre de
 *    confiance) ;
 *  - flags OFF = l'existant continue à 100 % (recherche, barcode, création
 *    manuelle, Journal) — désactiver l'IA ne supprime aucun code.
 */

/** Kill switch global (env Convex) — filet de sécurité, OFF par défaut. */
function betaAiDisabled(): boolean {
	return process.env.BETA_AI_DISABLED === "1";
}

export type AiBetaFlags = {
	/** Photo d'étiquette → préremplissage IA (`food_label_ai_beta`). */
	foodLabelAi: boolean;
	/** Photo de repas → composants IA (`meal_photo_ai_beta`). */
	mealPhotoAi: boolean;
};

/**
 * Flags bêta IA — source unique de vérité (jamais stockée : révocable
 * instantanément via BETA_AI_DISABLED). Ouverture globale : toute cliente
 * authentifiée est autorisée ; l'ancienne allowlist email (compte de test
 * contact@myfit-coach.fr) est remplacée par le kill switch env.
 */
export function aiBetaFlagsForEmail(email: string): AiBetaFlags {
	if (betaAiDisabled()) return { foodLabelAi: false, mealPhotoAi: false };
	return { foodLabelAi: true, mealPhotoAi: true };
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
