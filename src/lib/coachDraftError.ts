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

/**
 * Cause : réponse coupée par la limite de sortie du modèle (statut
 * `incomplete` ou `finish_reason` « length »). Le texte tronqué n'est jamais
 * affiché — on invite à réessayer.
 */
export const DRAFT_CAUSE_INCOMPLETE = "Réponse incomplète de l'IA, réessaie";

/** Cause : arrêt d'urgence `AI_COACH_DRAFT_DISABLED` actif. */
export const DRAFT_CAUSE_DISABLED = 'Assistant désactivé';

/** Cause : tout le reste (panne inattendue, réponse vide, réseau). */
export const DRAFT_CAUSE_UNEXPECTED = 'Erreur inattendue';

/**
 * Refus de génération : un brouillon a déjà été préparé pour ce bilan il y a
 * moins de 30 secondes (protection anti-double-clic CÔTÉ SERVEUR).
 */
export const DRAFT_RATE_LIMITED =
	"Un brouillon vient d'être préparé pour ce bilan — réessaie dans quelques secondes";

/**
 * CODES COURTS tracés dans `aiUsageLog.failReason` — JAMAIS le message brut du
 * fournisseur (qui peut contenir une clé, un identifiant ou du détail
 * technique). C'est ce code, et lui seul, qui est persisté puis traduit ici.
 */
export type DraftFailReasonCode =
	| 'http_401'
	| 'http_429'
	| 'quota'
	| 'model'
	| 'timeout'
	| 'incomplete'
	| 'disabled'
	| 'consent'
	| 'unknown';

/** Code court → libellé constant affiché au coach. */
const CAUSE_BY_CODE: Record<DraftFailReasonCode, string> = {
	http_401: DRAFT_CAUSE_INVALID_KEY,
	http_429: DRAFT_CAUSE_NO_CREDIT,
	quota: DRAFT_CAUSE_NO_CREDIT,
	model: DRAFT_CAUSE_MODEL_REFUSED,
	timeout: DRAFT_CAUSE_TIMEOUT,
	incomplete: DRAFT_CAUSE_INCOMPLETE,
	disabled: DRAFT_CAUSE_DISABLED,
	consent: COACH_DRAFT_CONSENT_MISSING,
	unknown: DRAFT_CAUSE_UNEXPECTED,
};

/**
 * CLASSE une erreur serveur en code court — aucune donnée du message n'est
 * conservée : le texte sert uniquement à choisir le code, puis il est jeté.
 * Utilisé par l'action avant d'écrire `aiUsageLog.failReason`.
 */
export function draftFailReason(message: string | null | undefined): DraftFailReasonCode {
	const m = typeof message === 'string' ? message : '';
	if (!m.trim()) return 'unknown';

	// Arrêt d'urgence (valeur du kill switch dans le message).
	if (/AI_COACH_DRAFT_DISABLED|momentanément désactivée/i.test(m)) return 'disabled';

	// Réponse coupée par la limite de sortie.
	if (/incompl[èe]te|\bincomplete\b/i.test(m)) return 'incomplete';

	// Délai dépassé (client, abort, ou délai de l'appel).
	if (/timeout|timed out|abort|d[ée]lai/i.test(m)) return 'timeout';

	// Clé refusée / expirée.
	if (/\b401\b|invalid[_\s-]?api[_\s-]?key|incorrect api key|unauthori[sz]ed/i.test(m)) {
		return 'http_401';
	}

	// Quota / crédit / facturation : plus précis que le seul statut 429.
	if (/quota|billing|credit/i.test(m)) return 'quota';

	// Limite de débit passagère.
	if (/\b429\b|rate[_\s-]?limit|too many requests/i.test(m)) return 'http_429';

	// Modèle refusé ou inconnu.
	if (/\b404\b/.test(m) || (/\b400\b/.test(m) && /model|mod[èe]le|unsupported/i.test(m))) {
		return 'model';
	}

	// Consentement IA absent (refus volontaire, jamais un appel fournisseur).
	if (/consentement ia/i.test(m)) return 'consent';

	return 'unknown';
}

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

	// CODE COURT (M5-ter) — la seule forme écrite par l'action : traduction
	// directe, sans jamais réinterpréter un message de fournisseur.
	const code = reason.trim().toLowerCase();
	if (code in CAUSE_BY_CODE) return CAUSE_BY_CODE[code as DraftFailReasonCode];

	// Compatibilité des lignes historiques (messages bruts d'avant M5-ter).
	// Arrêt d'urgence : la valeur du kill switch est tracée telle quelle.
	if (/AI_COACH_DRAFT_DISABLED/i.test(reason)) return DRAFT_CAUSE_DISABLED;

	// Délai dépassé : timeout du client, abort, ou message « a dépassé le délai ».
	if (/timeout|timed out|abort|d[ée]lai|draft-timeout/i.test(reason)) return DRAFT_CAUSE_TIMEOUT;

	// Réponse coupée (limite de sortie) : cause tracée « incomplete ».
	if (/\bincomplete\b|incompl[èe]te/i.test(reason)) return DRAFT_CAUSE_INCOMPLETE;

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
