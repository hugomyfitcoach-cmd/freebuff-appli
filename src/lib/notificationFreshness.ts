/**
 * RÈGLES DE FRAÎCHEUR PARTAGÉES des notifications cliente.
 *
 * Mission « cohérence badge ↔ cartes » : le badge de la barre du bas
 * (dashboard.notificationCounts → /api/live) et les cartes de l'Accueil
 * (dashboard.getDashboard) doivent obéir aux MÊMES règles — une seule
 * définition ici, importée par les deux requêtes Convex. Jamais de copie
 * locale de ces règles : toute divergence re-synchroniserait les deux
 * surfaces (l'audit iPhone : badge « 1 » mais carte absente).
 */

/** Durée de vie de secours d'un message sans horodatage d'expiration : 24 h. */
export const MSG_TTL_MS = 24 * 3600 * 1000;

/** Champs utilisateur utiles à la fraîcheur du message du coach. */
export type CoachMessageFreshFields = {
	coachMessageAt?: number | null;
	coachMessageExpiresAt?: number | null;
	coachMessageDate?: string | null;
	coachMessageReadAt?: number | null;
};

/**
 * Message du coach du jour encore frais (actif sur l'Accueil) :
 * - horodatage d'expiration (minuit LOCAL de la cliente) → strictement avant ;
 * - sinon publication horodatée → moins de 24 h ;
 * - sinon (anciens messages) → jour exact.
 * `day` = journée locale de référence (getDashboard passe celle du loader,
 * notificationCounts passe localTodayISO(now)) — même règle des deux côtés.
 */
export function coachMessageFresh(u: CoachMessageFreshFields, ts: number, day: string): boolean {
	if (u.coachMessageExpiresAt != null) return ts < u.coachMessageExpiresAt;
	if (u.coachMessageAt != null) return ts - u.coachMessageAt < MSG_TTL_MS;
	return u.coachMessageDate === day;
}

/**
 * Message frais ET pas encore marqué « Vu » (badge message + carte « Ton coach »).
 * Un message sans horodatage de publication n'est jamais « non lu ».
 */
export function coachMessageUnread(u: CoachMessageFreshFields, ts: number, day: string): boolean {
	const at = u.coachMessageAt ?? null;
	return coachMessageFresh(u, ts, day) && at != null && (u.coachMessageReadAt ?? 0) < at;
}

/** Champs d'un bilan utiles au non-lu du retour coach. */
export type FeedbackFreshFields = {
	status: string;
	feedbackReadAt?: number | null;
	feedbackAt?: number | null;
	_creationTime: number;
};

/**
 * Retour coach publié non consulté : publication postérieure à la dernière
 * consultation (jamais un simple « 1 » codé en dur).
 */
export function isUnreadFeedback(c: FeedbackFreshFields): boolean {
	return (
		c.status === 'retour_envoye' &&
		(c.feedbackReadAt == null || c.feedbackReadAt < (c.feedbackAt ?? c._creationTime))
	);
}

/** Champs d'une entrée du Dossier utiles au non-lu Drive. */
export type DriveFreshFields = {
	visibility: string;
	sharedAt?: number | null;
};

/**
 * Contenus du Dossier partagés depuis la dernière consultation de la section
 * Ressources. Le filtre `visibility === "shared"` est PARTAGÉ : seuls les
 * contenus réellement partagés comptent (un retour en privé éteint le badge).
 */
export function driveUnreadCount(rows: DriveFreshFields[], seenAt: number | null | undefined): number {
	const seen = seenAt ?? 0;
	return rows.filter((r) => r.visibility === 'shared' && (r.sharedAt ?? 0) > seen).length;
}
