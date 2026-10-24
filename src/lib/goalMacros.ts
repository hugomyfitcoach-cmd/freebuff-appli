/**
 * Cohérence du bloc « Appliquer à la fiche » : objectif = 4G + 4P + 9L.
 * MODULE PUR (testable sans écran, sans Convex).
 *
 * RÈGLE : les valeurs affichées (objectif kcal + macros) vérifient TOUJOURS
 * l'égalité EXACTE objectif = 4·G + 4·P + 9·L, en grammes entiers :
 *  - protéines ou lipides modifiés → glucides recalculés depuis l'OBJECTIF
 *    KCAL DE RÉFÉRENCE (`kcalReference`) : (objectif − 4P − 9L) ÷ 4 — jamais
 *    depuis la valeur précédemment affichée (qui porte déjà un réalignement) ;
 *    l'écart dû aux grammes entiers reste donc TOUJOURS de ±2 kcal max et
 *    ne s'accumule jamais, même après dix modifications successives ;
 *  - glucides modifiés → objectif kcal recalculé (somme exacte 4G + 4P + 9L),
 *    qui devient la nouvelle référence ;
 *  - objectif kcal modifié → la saisie devient la référence, glucides
 *    recalculés, puis même réalignement de ±2 kcal max.
 *
 * La référence est renvoyée (`kcalReference`) pour être réutilisée telle
 * quelle au prochain recalcul : seul un changement explicite d'objectif
 * (saisie kcal ou glucides) la déplace.
 *
 * Sous 100 g de glucides : l'information du calibrage (`alerteGlucidesPour`,
 * message unique partagé, discret et neutre). Glucides calculés négatifs :
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

/** Champ qui vient d'être modifié par le coach. */
export type ChampSaisi = 'kcal' | 'glucides' | 'proteines' | 'lipides';

export type RecalculObjectif = {
	/** Valeurs entières recalculées — objectif = 4G + 4P + 9L, exactement. */
	valeurs: SaisieObjectif;
	/**
	 * Objectif kcal de RÉFÉRENCE pour les prochains recalculs : saisie kcal
	 * quand l'objectif vient d'être édité, somme exacte après saisie glucides,
	 * sinon la référence transmise (jamais la valeur réalignée ±2).
	 */
	kcalReference: number;
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
 * `valeurs[champ]` est la valeur VENANT D'ÊTRE SAISIE ; les autres champs sont
 * ceux déjà affichés. Le champ déduit (glucides ou objectif kcal) est
 * recalculé selon la règle ci-dessus — jamais deviné autrement.
 *
 * `kcalReference` est l'objectif kcal de RÉFÉRENCE pour les saisies protéines /
 * lipides : les glucides valent (référence − 4P − 9L) ÷ 4. Sans référence
 * transmise, `valeurs.kcal` fait foi (usage unitaire) — mais l'appelant qui
 * enchaîne les modifications doit TOUJOURS repasser la référence renvoyée,
 * sinon l'écart d'arrondi se cumulerait de ±2 kcal à chaque saisie.
 */
export function recalculerObjectif(
	valeurs: SaisieObjectif,
	champ: ChampSaisi,
	kcalReference?: number
): RecalculObjectif {
	const proteinesG = entier(valeurs.proteinesG);
	const lipidesG = entier(valeurs.lipidesG);
	let glucidesG = entier(valeurs.glucidesG);
	let kcal: number;
	let reference: number;
	if (champ === 'glucides') {
		/* Glucides saisis : l'objectif kcal reprend la somme exacte, qui devient
		   la nouvelle référence. */
		kcal = kcalDepuisMacros({ glucidesG, proteinesG, lipidesG });
		reference = kcal;
	} else if (champ === 'kcal') {
		/* Objectif kcal saisi : la saisie devient la référence, les glucides
		   absorbent le reste (réalignement de ±2 kcal max affiché). */
		reference = entier(valeurs.kcal);
		const resteKcal = reference - KCAL_PAR_G_PROTEINES * proteinesG - KCAL_PAR_G_LIPIDES * lipidesG;
		glucidesG = Math.round(resteKcal / KCAL_PAR_G_GLUCIDES);
		kcal = kcalDepuisMacros({ glucidesG, proteinesG, lipidesG });
	} else {
		/* Protéines ou lipides saisis : glucides recalculés depuis l'OBJECTIF
		   kcal DE RÉFÉRENCE — (objectif − 4P − 9L) ÷ 4 — et non depuis la valeur
		   précédemment affichée (l'écart d'arrondi ne s'accumule donc jamais). */
		reference =
			typeof kcalReference === 'number' && Number.isFinite(kcalReference)
				? entier(kcalReference)
				: entier(valeurs.kcal);
		const resteKcal = reference - KCAL_PAR_G_PROTEINES * proteinesG - KCAL_PAR_G_LIPIDES * lipidesG;
		glucidesG = Math.round(resteKcal / KCAL_PAR_G_GLUCIDES);
		kcal = kcalDepuisMacros({ glucidesG, proteinesG, lipidesG });
	}
	const glucidesNegatifs = glucidesG < 0;
	return {
		valeurs: { kcal, glucidesG, proteinesG, lipidesG },
		kcalReference: reference,
		glucidesNegatifs,
		alerteGlucides: alerteGlucidesPour(glucidesG),
		messageBlocage: messageBlocageGlucides(glucidesG)
	};
}
