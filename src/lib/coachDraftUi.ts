/**
 * RÈGLES PURES DU BADGE « Brouillon IA — à relire » (M1-bis).
 *
 * Le badge est une information de TRAVAIL, réservée au CRM coach :
 *  - il suit le brouillon enregistré (`checkins.feedbackAiDraft`), donc il
 *    survit à un rechargement de page ;
 *  - il disparaît dès que le coach touche au texte (`aiDraftStillCurrent`
 *    compare le texte courant au texte exact préparé par l'IA) ;
 *  - il disparaît à la publication (`nextFeedbackAiDraft` ne persiste jamais
 *    le drapeau sur un retour envoyé).
 *
 * Rien ici ne lit ni n'écrit de données : module partagé par le serveur
 * Convex, l'interface CRM et les tests.
 */

/** Champs d'un bilan utiles au badge (jamais envoyés à la cliente). */
export type AiDraftCheckin = {
	status: 'nouveau' | 'retour_envoye';
	feedback?: string | null;
	feedbackAiDraft?: boolean;
};

/**
 * Le badge doit-il être affiché pour ce bilan rechargé depuis le serveur ?
 * Trois conditions : brouillon non publié, drapeau serveur, texte non vide.
 */
export function aiDraftBadgeFromCheckin(checkin: AiDraftCheckin): boolean {
	return (
		checkin.status !== 'retour_envoye' &&
		checkin.feedbackAiDraft === true &&
		typeof checkin.feedback === 'string' &&
		checkin.feedback.trim().length > 0
	);
}

/**
 * Le texte du champ est-il ENCORE exactement celui préparé par l'IA ?
 * La moindre modification (ajout, suppression, espace) rend `false` : le
 * badge disparaît immédiatement, sans attendre l'enregistrement.
 */
export function aiDraftStillCurrent(source: string | null, text: string): boolean {
	return typeof source === 'string' && source.length > 0 && text === source;
}

/**
 * Brouillon IA encore « à relire » : texte identique ET jamais touché.
 * `touched` fige la disparition dès la PREMIÈRE frappe : revenir au texte
 * d'origine (annuler une saisie) ne fait pas réapparaître le badge.
 */
export function aiDraftActive(source: string | null, text: string, touched: boolean): boolean {
	return touched !== true && aiDraftStillCurrent(source, text);
}

/** Valeur du champ caché `aiDraft` envoyé avec le formulaire (jamais publié). */
export function aiDraftFormFlag(
	source: string | null,
	text: string,
	published: boolean,
	touched = false
): boolean {
	return !published && aiDraftActive(source, text, touched);
}

/**
 * Drapeau à PERSISTER dans `checkins.feedbackAiDraft` après un enregistrement.
 * - publication → `undefined` (le champ est retiré : plus de badge) ;
 * - brouillon inchangé depuis la génération → `true` ;
 * - texte modifié, vide, ou simple enregistrement manuel → `undefined`.
 * `undefined` est la valeur rétrocompatible : les bilans existants n'ont pas
 * ce champ et restent valides (aucune migration).
 */
export function nextFeedbackAiDraft(args: {
	status: 'nouveau' | 'retour_envoye';
	feedback: string;
	aiDraft: boolean;
}): boolean | undefined {
	if (args.status === 'retour_envoye') return undefined;
	if (args.aiDraft !== true) return undefined;
	return args.feedback.trim().length > 0 ? true : undefined;
}

/**
 * Retire le drapeau d'un bilan avant de le renvoyer à la CLIENTE.
 * Copie sans mutation : le texte, le statut et les horodatages sont intacts.
 */
export function publicCheckin<T extends { feedbackAiDraft?: boolean }>(
	row: T
): Omit<T, 'feedbackAiDraft'> {
	const copy = { ...row };
	delete copy.feedbackAiDraft;
	return copy;
}
