/**
 * CAUSES LISIBLES D'UN ÉCHEC DE BROUILLON IA (M5).
 *
 * Le coach voit une cause en clair, jamais un message technique. La source est
 * la raison courte déjà tracée dans `aiUsageLog` (`failReason`) — jamais le
 * prompt, jamais le brouillon, jamais une valeur de clé. Chaque libellé est
 * une CONSTANTE : aucun texte dynamique ne peut donc transporter du contenu
 * client ou un secret.
 *
 * Module pur : aucune lecture de données, aucun état, testable directement.
 */

/** Consentement assistant IA non enregistré (coach → fiche cliente). */
export const COACH_DRAFT_CONSENT_MISSING = 'Consentement IA non enregistré pour cette cliente';

/** Cause : la clé OpenAI est absente, refusée ou expirée (HTTP 401). */
export const DRAFT_CAUSE_INVALID_KEY = 'Clé OpenAI invalide ou expirée';

/** Cause : plus de crédit ou limite de débit/quota atteinte (HTTP 429 / quota). */
export const DRAFT_CAUSE_NO_CREDIT = 'Crédit OpenAI épuisé ou limite atteinte';

/** Cause : le modèle configuré est refusé ou inconnu (HTTP 400 / 404 sur le modèle). */
export const DRAFT_CAUSE_MODEL_REFUSED = 'Modèle refusé par OpenAI';

/** Cause : délai dépassé (timeout réseau ou délai de l'appel). */
export const DRAFT_CAUSE_TIMEOUT = 'Délai dépassé, réessaie';

/** Cause : arrêt d'urgence `AI_COACH_DRAFT_DISABLED` actif. */
export const DRAFT_CAUSE_DISABLED = 'Assistant désactivé';

/** Cause : tout le reste (panne inattendue, réponse vide, réseau). */
export const DRAFT_CAUSE_UNEXPECTED = 'Erreur inattendue';

/**
 * Traduit une raison d'échec tracée en cause lisible pour le coach.
 *
 * Ordre volontaire : arrêt d'urgence, puis délai, puis authentification, puis
 * crédit/quota, puis modèle, sinon « Erreur inattendue ». Une raison absente
 * ou vide tombe sur « Erreur inattendue » — jamais un message technique.
 */
export function draftErrorCause(failReason: string | null | undefined): string {
	const reason = typeof failReason === 'string' ? failReason : '';
	if (!reason.trim()) return DRAFT_CAUSE_UNEXPECTED;

	// Arrêt d'urgence : la valeur du kill switch est tracée telle quelle.
	if (/AI_COACH_DRAFT_DISABLED/i.test(reason)) return DRAFT_CAUSE_DISABLED;

	// Délai dépassé : timeout du client, abort, ou message « a dépassé le délai ».
	if (/timeout|timed out|abort|d[ée]lai|draft-timeout/i.test(reason)) return DRAFT_CAUSE_TIMEOUT;

	// Clé refusée / expirée (OpenAI répond 401).
	if (/\b401\b|invalid[_\s-]?api[_\s-]?key|incorrect api key|unauthori[sz]ed/i.test(reason)) {
		return DRAFT_CAUSE_INVALID_KEY;
	}

	// Crédit épuisé ou limite atteinte (429, quota, facturation).
	if (/\b429\b|quota|rate[_\s-]?limit|insufficient[_\s-]?quota|billing|credit/i.test(reason)) {
		return DRAFT_CAUSE_NO_CREDIT;
	}

	// Modèle refusé : 404 (modèle inconnu) ou 400 qui cite explicitement le modèle.
	if (/\b404\b/.test(reason) || (/\b400\b/.test(reason) && /model|mod[èe]le|unsupported/i.test(reason))) {
		return DRAFT_CAUSE_MODEL_REFUSED;
	}

	return DRAFT_CAUSE_UNEXPECTED;
}
