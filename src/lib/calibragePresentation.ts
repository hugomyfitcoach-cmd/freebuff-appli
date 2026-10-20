/**
 * Messages du « Mode présentation » de l'onglet Calibrage — MODULE PUR.
 *
 * Le coach montre l'onglet à la cliente pendant l'appel de démarrage : les
 * formulations du mode normal (« alerte », « dépasse le rythme conseillé »,
 * « à prendre en compte ») sont écrites POUR LE COACH et peuvent l'inquiéter.
 * En mode présentation, la cliente ne voit que des messages d'accompagnement
 * neutres et rassurants :
 *  - disponibilité en énergie ≥ 30 kcal/kg de MM → repère chiffré positif ;
 *  - disponibilité de 24 à 30 → « Zone à surveiller… » ;
 *  - déficit de 15 à 30 % → « Rythme soutenu… » ;
 *  - disponibilité sous 24, OU perte estimée au-dessus des plafonds
 *    Alpert/Macdonald → AUCUN message côté cliente ; le coach voit alors, en
 *    mode normal uniquement, la mention « À ajuster avant de présenter ».
 *
 * JAMAIS en mode présentation : les mots « alerte », « risque », « dépasse »,
 * « exceptionnelle », ni les noms Alpert / Macdonald.
 *
 * Zéro dépendance UI : importable par le CRM (`src/routes/admin/+page.svelte`)
 * et par les tests node, exactement comme `$lib/calibrageFiche`.
 */

import {
	SEUIL_DISPONIBILITE_BAS,
	SEUIL_DISPONIBILITE_HAUT,
	decimalFr
} from './calibrage';

/** Mention affichée au COACH (mode normal) quand la fiche n'est pas présentable. */
export const MENTION_AJUSTER_AVANT_DE_PRESENTER = 'À ajuster avant de présenter';

/**
 * Mots interdits dans tout texte du mode présentation — garde-fou de test :
 * la cliente ne doit jamais y lire d'alerte ni le nom des plafonds.
 */
export const PRESENTATION_MOTS_INTERDITS = [
	'alerte',
	'risque',
	'dépasse',
	'exceptionnelle',
	'alpert',
	'macdonald'
] as const;

/** Résultats nécessaires aux messages (sortie de `resultatsFiche`). */
export type EntreesMessagesPresentation = {
	/** Disponibilité en énergie du jour type (kcal/kg de masse maigre). */
	disponibiliteKcal: number;
	/** Déficit choisi (% du budget, 0 à 30). */
	deficitPct: number;
	/** Perte de graisse estimée (kg/semaine). */
	perteGraisseKg: number;
	/** Plafond Alpert (kg/semaine). */
	vitesseMaxAlpertKgSemaine: number;
};

export type MessagesPresentation = {
	/** Message sur la disponibilité en énergie (null si rien à afficher). */
	energie: string | null;
	/** Message sur le rythme de déficit (null si rien à afficher). */
	rythme: string | null;
};

/**
 * Vrai quand la fiche n'est PAS présentable en l'état : disponibilité sous
 * 24 kcal/kg de masse maigre, ou perte estimée au-dessus des plafonds
 * Alpert/Macdonald (dès le premier plafond franchi — le même seuil que
 * `alertePlafonds` dans `calibrageFiche`). Dans ce cas, AUCUN message côté
 * cliente, et le coach voit la mention « À ajuster avant de présenter ».
 */
export function mentionAjusterAvantDePresenter(r: EntreesMessagesPresentation): boolean {
	return (
		r.disponibiliteKcal < SEUIL_DISPONIBILITE_BAS ||
		r.perteGraisseKg > r.vitesseMaxAlpertKgSemaine
	);
}

/**
 * Messages de la cliente en mode présentation — neutres, jamais alarmants.
 * Les quatre règles du référentiel :
 *  - disponibilité ≥ 30 → repère chiffré rassurant (« …ton corps a de quoi
 *    bien fonctionner. ») ;
 *  - disponibilité de 24 à 30 → « Zone à surveiller… » ;
 *  - déficit de 15 à 30 % → « Rythme soutenu… » ;
 *  - disponibilité sous 24 ou perte au-dessus des plafonds → aucun message.
 */
export function messagesPresentation(r: EntreesMessagesPresentation): MessagesPresentation {
	if (mentionAjusterAvantDePresenter(r)) return { energie: null, rythme: null };

	const energie =
		r.disponibiliteKcal >= SEUIL_DISPONIBILITE_HAUT
			? `Ton énergie disponible : ${decimalFr(r.disponibiliteKcal)} kcal/kg de masse maigre. ` +
				`Au-dessus du seuil de sécurité de ${SEUIL_DISPONIBILITE_HAUT} : ton corps a de quoi bien fonctionner.`
			: `Zone à surveiller : on suivra ton énergie et ta récupération chaque semaine.`;

	/* Déficit de 15 à 30 % (30 = borne haute de saisie du déficit). */
	const rythme =
		r.deficitPct >= 15 && r.deficitPct <= 30
			? `Rythme soutenu, choisi pour toi, avec un suivi rapproché.`
			: null;

	return { energie, rythme };
}
