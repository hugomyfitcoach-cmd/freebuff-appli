/**
 * Validation PAR CHAMP des entrées de l'onglet Calibrage — MODULE PUR
 * (testable sans écran, sans Convex).
 *
 * RÈGLE (résilience de saisie) : une valeur vide ou hors limites affiche un
 * message SOUS SON CHAMP et ne vide JAMAIS l'écran des résultats — le calcul
 * reprend dès que la valeur redevient valide, les résultats restant entre-temps
 * la dernière valeur valide. Bornes STRICTEMENT partagées avec le module
 * `calibrage` (`BORNES`) : déficit 0 à 30 %, poids 20 à 400 kg, masse grasse
 * 5 à 60 %, pas 0 à 100 000, adaptation 0 à 20 %, protéines 2 à 2,6 g/kg.
 *
 * Message EXACT exigé : « Maximum 30 % » quand le déficit dépasse 30 %
 * (« Minimum 0 % » en symétrie) ; les autres champs affichent leur plage
 * d'attente (ex. « 20 à 400 kg attendu. »).
 */

import { BORNES } from './calibrage';

/** Entrées numériques de l'onglet, validées champ par champ. */
export type ChampCalibrage =
	| 'poidsKg'
	| 'mgPct'
	| 'pasMoyen'
	| 'adaptationPct'
	| 'proteinesParKgMasseMaigre'
	| 'deficitPct';

export const CHAMPS_CALIBRAGE: ChampCalibrage[] = [
	'poidsKg',
	'mgPct',
	'pasMoyen',
	'adaptationPct',
	'proteinesParKgMasseMaigre',
	'deficitPct'
];

/** Correspondance champ de l'onglet → bornes du module `calibrage`. */
const BORNES_PAR_CHAMP: Record<ChampCalibrage, (typeof BORNES)[keyof typeof BORNES]> = {
	poidsKg: BORNES.poids,
	mgPct: BORNES.mgPct,
	pasMoyen: BORNES.pas,
	adaptationPct: BORNES.adaptation,
	proteinesParKgMasseMaigre: BORNES.proteinesMasseMaigre,
	deficitPct: BORNES.deficitPct
};

/** Libellé « valeur requise » quand le champ est vide ou non numérique. */
const REQUIS: Record<ChampCalibrage, string> = {
	poidsKg: 'Poids requis.',
	mgPct: 'Masse grasse requise.',
	pasMoyen: 'Moyenne de pas requise.',
	adaptationPct: 'Adaptation requise.',
	proteinesParKgMasseMaigre: 'Protéines requises.',
	deficitPct: 'Déficit requis.'
};

/** Champs numériques saisis (les valeurs peuvent être vidées par la coach). */
export type SaisiesCalibrage = Partial<Record<ChampCalibrage, number | null | undefined>>;

/**
 * Message à afficher SOUS le champ (null = saisie valide) :
 *  - vide ou non numérique → « … requis. » ;
 *  - déficit au-delà de 30 % → « Maximum 30 % » (sous 0 % → « Minimum 0 % ») ;
 *  - autre champ hors limites → sa plage d'attente (ex. « 20 à 400 kg attendu. »).
 */
export function messageChampCalibrage(
	champ: ChampCalibrage,
	valeur: number | null | undefined
): string | null {
	if (valeur === null || valeur === undefined || typeof valeur !== 'number' || !Number.isFinite(valeur)) {
		return REQUIS[champ];
	}
	const bornes = BORNES_PAR_CHAMP[champ];
	if (valeur > bornes.max) {
		return champ === 'deficitPct' ? `Maximum ${bornes.max} %` : `${bornes.label} attendu.`;
	}
	if (valeur < bornes.min) {
		return champ === 'deficitPct' ? `Minimum ${bornes.min} %` : `${bornes.label} attendu.`;
	}
	return null;
}

/** Tous les messages de l'onglet d'un coup (null = champ valide). */
export function messagesChampsCalibrage(saisies: SaisiesCalibrage): Record<ChampCalibrage, string | null> {
	const out = {} as Record<ChampCalibrage, string | null>;
	for (const champ of CHAMPS_CALIBRAGE) {
		out[champ] = messageChampCalibrage(champ, saisies[champ]);
	}
	return out;
}

/** Vrai si toutes les entrées chiffrées de l'onglet sont valides. */
export function saisiesCalibrageValides(saisies: SaisiesCalibrage): boolean {
	return CHAMPS_CALIBRAGE.every((champ) => messageChampCalibrage(champ, saisies[champ]) === null);
}
