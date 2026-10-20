/**
 * Cohérence du bloc « Appliquer à la fiche » : objectif = 4G + 4P + 9L.
 * MODULE PUR (testable sans écran, sans Convex).
 *
 * RÈGLE : les valeurs affichées (objectif kcal + macros) vérifient TOUJOURS
 * l'égalité EXACTE objectif = 4·G + 4·P + 9·L, en grammes entiers :
 *  - protéines ou lipides modifiés → glucides recalculés, l'objectif kcal
 *    reste inchangé (réaligné de ±2 kcal MAX uniquement quand le reste n'est
 *    pas divisible par 4 — sinon l'égalité exacte serait impossible en grammes
 *    entiers) ;
 *  - glucides modifiés → objectif kcal recalculé (somme exacte 4G + 4P + 9L) ;
 *  - objectif kcal modifié → glucides recalculés, puis même réalignement.
 *
 * Sous 100 g de glucides : l'avertissement EXISTANT du calibrage
 * (`alerteGlucidesPour`, message unique partagé). Glucides calculés négatifs :
 * l'application est bloquée (`messageBlocageGlucides`) — les protéines et les
 * lipides dépassent alors l'objectif calorique.
 */

import {
	alerteGlucidesPour,
	KCAL_PAR_G_GLUCIDES,
	KCAL_PAR_G_LIPIDES,
	KCAL_PAR_G_PROTEINES
} from './calibrage';

/* Message d'avertissement existant : ré-exporté pour que le bloc « Appliquer
   à la fiche » n'ait qu'un seul module à importer. */
export { alerteGlucidesPour };

/** Saisie du bloc « Appliquer à la fiche » — kcal et grammes entiers. */
export type SaisieObjectif = {
	/** Objectif journalier (kcal). */
	kcal: number;
	/** Glucides (g). */
	glucidesG: number;
	/** Protéines (g). */
	proteinesG: number;
	/** Lipides (g). */
	lipidesG: number;
};

/** Champ qui vient d'être modifié par la coach. */
export type ChampSaisi = 'kcal' | 'glucides' | 'proteines' | 'lipides';

export type RecalculObjectif = {
	/** Valeurs entières recalculées — objectif = 4G + 4P + 9L, exactement. */
	valeurs: SaisieObjectif;
	/** Vrai si les glucides calculés sont négatifs → application bloquée. */
	glucidesNegatifs: boolean;
	/** Avertissement existant des glucides sous 100 g (null sinon). */
	alerteGlucides: string | null;
	/** Message de blocage (null = application possible). */
	messageBlocage: string | null;
};

/** Somme EXACTE 4G + 4P + 9L des grammes affichés. */
export function kcalDepuisMacros(v: { glucidesG: number; proteinesG: number; lipidesG: number }): number {
	return (
		KCAL_PAR_G_GLUCIDES * v.glucidesG + KCAL_PAR_G_PROTEINES * v.proteinesG + KCAL_PAR_G_LIPIDES * v.lipidesG
	);
}

/** Blocage « glucides négatifs » (null si l'application est possible). */
export function messageBlocageGlucides(glucidesG: number): string | null {
	return glucidesG < 0
		? `Application bloquée : les glucides calculés sont négatifs (${glucidesG} g) — les protéines et les lipides dépassent l'objectif calorique. Baisse les protéines ou les lipides, ou augmente l'objectif kcal avant d'appliquer.`
		: null;
}

/** Valeur saisie ramenée en entier fini (une saisie vide/invalide vaut 0). */
function entier(n: number | undefined): number {
	return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * Recalcule la saisie pour que objectif = 4G + 4P + 9L exactement.
 * `valeurs[champ]` est la valeur VENANT D'ÊTRE SAISIE par la coach ; les
 * autres champs sont ceux déjà affichés. Le champ déduit (glucides ou objectif
 * kcal) est recalculé selon la règle ci-dessus — jamais deviné autrement.
 */
export function recalculerObjectif(valeurs: SaisieObjectif, champ: ChampSaisi): RecalculObjectif {
	const kcalSaisie = entier(valeurs.kcal);
	const proteinesG = entier(valeurs.proteinesG);
	const lipidesG = entier(valeurs.lipidesG);
	let glucidesG = entier(valeurs.glucidesG);
	let kcal: number;
	if (champ === 'glucides') {
		/* Glucides saisis : l'objectif kcal reprend la somme exacte. */
		kcal = kcalDepuisMacros({ glucidesG, proteinesG, lipidesG });
	} else {
		/* Objectif kcal, protéines ou lipides saisis : les glucides absorbent
		   le reste (kcal inchangées pour P/L — réalignées de ±2 kcal max quand
		   le reste n'est pas divisible par 4). */
		const resteKcal = kcalSaisie - KCAL_PAR_G_PROTEINES * proteinesG - KCAL_PAR_G_LIPIDES * lipidesG;
		glucidesG = Math.round(resteKcal / KCAL_PAR_G_GLUCIDES);
		kcal = kcalDepuisMacros({ glucidesG, proteinesG, lipidesG });
	}
	const glucidesNegatifs = glucidesG < 0;
	return {
		valeurs: { kcal, glucidesG, proteinesG, lipidesG },
		glucidesNegatifs,
		alerteGlucides: alerteGlucidesPour(glucidesG),
		messageBlocage: messageBlocageGlucides(glucidesG)
	};
}
