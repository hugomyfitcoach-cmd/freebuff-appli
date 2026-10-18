/**
 * Calibrage — calculs caloriques PURS, sans aucune dépendance.
 *
 * Aucun import Convex, SvelteKit, DOM, ni variable d'environnement : le MÊME
 * module est importable côté serveur SvelteKit (`$lib/calibrage`) et côté
 * fonctions Convex (`"../lib/calibrage"`), comme `$lib/cyclage` ou
 * `$lib/notifications`. Rien n'est stocké ni écrit ici — uniquement des
 * fonctions déterministes, appelables dans une transaction Convex.
 *
 * Conventions (identiques au référentiel de calibrage) :
 *   P = poids (kg) · MG% = taux de masse grasse · C = coefficient d'activité
 *   A = adaptation métabolique (%) · E = exercice du jour (kcal)
 *   R = apport réel du jour (kcal) · L = perte de graisse visée (kg/semaine)
 *
 * Précision : les enchaînements de calcul utilisent TOUJOURS les valeurs
 * BRUTES (jamais un intermédiaire arrondi). Arrondir la masse maigre avant de
 * calculer les seuils les décalerait : 41,884 × 30 = 1 256,52 → 1 257, alors
 * que 41,88 × 30 = 1 256,4 → 1 256. L'arrondi n'a lieu qu'en SORTIE, à la
 * précision documentée de chaque fonction.
 *
 * Entrées invalides : toute valeur négative, non finie, ou hors bornes
 * (notamment MG% hors 5–60 %) est REFUSÉE par une `CalibrageError` — jamais
 * de NaN ni de valeur aberrante propagée silencieusement.
 */

export class CalibrageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CalibrageError';
	}
}

/* ───────────────────────────── Constantes ───────────────────────────── */

/** Énergie d'un kilogramme de masse grasse (kcal) — base du déficit hebdo. */
export const KCAL_PAR_KG_GRAISSE = 7700;

/** Jours d'une semaine de bilan. */
export const JOURS_SEMAINE = 7;

/** Coefficient NEAT par pas quotidien : 1 + pas × 0,000025. */
export const COEFF_PAS = 0.000025;

/**
 * Coefficients horaires du mode de vie (points de coefficient par heure) :
 * assise en remuant 0,026 · debout statique 0,0065 · debout en remuant 0,05.
 */
export const COEFF_MODE_VIE = {
	assiseEnRemuant: 0.026,
	deboutStatique: 0.0065,
	deboutEnRemuant: 0.05
} as const;

/** Bornes de sécurité du taux de masse grasse (%). */
export const MG_PCT_MIN = 5;
export const MG_PCT_MAX = 60;

/** Seuils de disponibilité énergétique, en kcal par kg de masse maigre. */
export const SEUIL_DISPONIBILITE_HAUT = 30;
export const SEUIL_DISPONIBILITE_BAS = 24;

/** Coefficients de la masse métabolique : MB = MM × 26,4 + MG × 4,5. */
export const COEFF_MB_MASSE_MAIGRE = 26.4;
export const COEFF_MB_MASSE_GRASSE = 4.5;

/** Diviseurs des vitesses maximales de perte (kg/semaine) : Alpert 20 · Macdonald 15. */
export const DIVISEUR_ALPERT = 20;
export const DIVISEUR_MACDONALD = 15;

/** Bornes plausibles (garde-fous de saisie) — messages d'erreur en clair. */
const BORNES = {
	poids: { min: 20, max: 400, label: '20 à 400 kg' },
	mgPct: { min: MG_PCT_MIN, max: MG_PCT_MAX, label: '5 à 60 %' },
	coefficient: { min: 0.8, max: 3, label: '0,8 à 3' },
	adaptation: { min: 0, max: 60, label: '0 à 60 %' },
	pas: { min: 0, max: 100_000, label: '0 à 100 000 pas' },
	heures: { min: 0, max: 24, label: '0 à 24 h' },
	kcal: { min: 0, max: 20_000, label: '0 à 20 000 kcal' },
	perte: { min: 0, max: 3, label: '0 à 3 kg/semaine' },
	stature: { min: 50, max: 260, label: '50 à 260 cm' },
	cou: { min: 10, max: 100, label: '10 à 100 cm' },
	tourTaille: { min: 30, max: 250, label: '30 à 250 cm' },
	hanches: { min: 30, max: 250, label: '30 à 250 cm' },
	supplement: { min: 0, max: 5, label: '0 à 5 de coefficient' },
	masseMaigre: { min: 5, max: 300, label: '5 à 300 kg' }
} as const;

type Bornes = { min: number; max: number; label: string };

/** Arrondi métier (décimales maîtrisées) — évite le bruit binaire (1,6300000000000001). */
function arrondi(valeur: number, decimales: number): number {
	const facteur = 10 ** decimales;
	return Math.round(valeur * facteur) / facteur;
}

/** Contrôle d'une entrée numérique : finie, dans les bornes, sinon refus explicite. */
function verifier(valeur: number, nom: string, bornes: Bornes): number {
	if (typeof valeur !== 'number' || !Number.isFinite(valeur)) {
		throw new CalibrageError(`${nom} invalide : un nombre fini est attendu.`);
	}
	if (valeur < bornes.min || valeur > bornes.max) {
		throw new CalibrageError(`${nom} invalide : ${bornes.label} attendu (reçu ${valeur}).`);
	}
	return valeur;
}

/** Contrôle d'une option : absente → valeur par défaut, sinon vérifiée. */
function verifierOption(valeur: number | undefined, nom: string, bornes: Bornes, defaut: number): number {
	if (valeur === undefined || valeur === null) return defaut;
	return verifier(valeur, nom, bornes);
}

/* ───────────────────── 1 · Coefficient d'activité (NEAT) ───────────────────── */

export type EntreeNeat = {
	/** Pas quotidiens : coefficient NEAT = 1 + pas × 0,000025. */
	pas?: number;
	/** Heures par jour en position assise en remuant (× 0,026). */
	heuresAssiseEnRemuant?: number;
	/** Heures par jour debout statique (× 0,0065). */
	heuresDeboutStatique?: number;
	/** Heures par jour debout en remuant (× 0,05). */
	heuresDeboutEnRemuant?: number;
	/** Supplément « mode de vie » saisi (points de coefficient, ex. 0,05). */
	supplementModeVie?: number;
};

/**
 * Coefficient d'activité NEAT : `1 + pas × 0,000025`, augmenté des heures de
 * mode de vie — `(assise en remuant 0,026 + debout statique 0,0065 + debout en
 * remuant 0,05) × heures par jour` — et/ou d'un supplément « mode de vie »
 * saisi (les deux se cumulent s'ils sont tous les deux fournis).
 *
 * Repères : 10 000 pas → 1,25 · 16 000 pas → 1,40 ·
 * 10 000 pas + 5 h debout en remuant + 5 h assise en remuant → 1,63.
 */
export function coefficientNeat(entree: EntreeNeat = {}): number {
	const pas = verifierOption(entree.pas, 'Nombre de pas', BORNES.pas, 0);
	const heuresAssise = verifierOption(
		entree.heuresAssiseEnRemuant,
		'Heures assise en remuant',
		BORNES.heures,
		0
	);
	const heuresDeboutStatique = verifierOption(
		entree.heuresDeboutStatique,
		'Heures debout statique',
		BORNES.heures,
		0
	);
	const heuresDeboutEnRemuant = verifierOption(
		entree.heuresDeboutEnRemuant,
		'Heures debout en remuant',
		BORNES.heures,
		0
	);
	const supplement = verifierOption(
		entree.supplementModeVie,
		'Supplément mode de vie',
		BORNES.supplement,
		0
	);

	const modeDeVie =
		COEFF_MODE_VIE.assiseEnRemuant * heuresAssise +
		COEFF_MODE_VIE.deboutStatique * heuresDeboutStatique +
		COEFF_MODE_VIE.deboutEnRemuant * heuresDeboutEnRemuant;

	return arrondi(1 + pas * COEFF_PAS + modeDeVie + supplement, 6);
}

/* ───────────────────── 2 · Composition corporelle et métabolisme ───────────────────── */

/** MG = P × MG%/100 — valeur BRUTE (non arrondie). */
export function masseGrasseBrute(poidsKg: number, mgPct: number): number {
	const poids = verifier(poidsKg, 'Poids', BORNES.poids);
	const pct = verifier(mgPct, 'Masse grasse', BORNES.mgPct);
	return (poids * pct) / 100;
}

/** MM = P × (1 − MG%/100) — valeur BRUTE (non arrondie). */
export function masseMaigreBrute(poidsKg: number, mgPct: number): number {
	const poids = verifier(poidsKg, 'Poids', BORNES.poids);
	const pct = verifier(mgPct, 'Masse grasse', BORNES.mgPct);
	return poids * (1 - pct / 100);
}

/**
 * MB = MM × 26,4 + MG × 4,5 (kcal) — valeur BRUTE, bâtie sur les MM/MG non
 * arrondies ; l'arrondi d'affichage est fait par `profilCalibrage`.
 */
export function metabolismeBaseBrut(poidsKg: number, mgPct: number): number {
	return (
		masseMaigreBrute(poidsKg, mgPct) * COEFF_MB_MASSE_MAIGRE +
		masseGrasseBrute(poidsKg, mgPct) * COEFF_MB_MASSE_GRASSE
	);
}

/* ───────────────────── 3 · Maintenance et objectif ───────────────────── */

/**
 * Maintenance = `arrondi(C × MB) − MB × A/100` (kcal).
 *
 * L'arrondi porte sur `C × MB` AVANT la soustraction de l'adaptation
 * métabolique, exactement comme dans le référentiel. Résultat arrondi à
 * 2 décimales (entier quand A = 0 : 1 641 dans le jeu de référence).
 */
export function maintenanceKcal(entree: {
	poidsKg: number;
	mgPct: number;
	coefficient: number;
	adaptationPct?: number;
}): number {
	const coefficient = verifier(entree.coefficient, "Coefficient d'activité", BORNES.coefficient);
	const adaptation = verifierOption(
		entree.adaptationPct,
		'Adaptation métabolique',
		BORNES.adaptation,
		0
	);
	const mb = metabolismeBaseBrut(entree.poidsKg, entree.mgPct);
	return arrondi(Math.round(coefficient * mb) - (mb * adaptation) / 100, 2);
}

/**
 * Objectif sans exercice = `arrondi(maintenance − L × 7700/7)` (kcal) —
 * la maintenance est celle de la fonction ci-dessus (valeur brute autorisée).
 */
export function objectifSansExerciceKcal(maintenance: number, perteKgSemaine: number): number {
	const maintenanceVerifiee = verifier(maintenance, 'Maintenance', {
		min: 0,
		max: 20_000,
		label: '0 à 20 000 kcal'
	});
	const perte = verifierOption(perteKgSemaine, 'Perte visée', BORNES.perte, 0);
	return Math.round(maintenanceVerifiee - (perte * KCAL_PAR_KG_GRAISSE) / JOURS_SEMAINE);
}

/* ───────────────────── 4 · Déficit et disponibilité énergétique ───────────────────── */

export type JourBilan = {
	/** R = apport réel du jour (kcal). */
	apportKcal: number;
	/** E = exercice du jour (kcal), 0 par défaut. */
	exerciceKcal?: number;
};

/** Déficit du jour = R − (maintenance + E) — négatif en cas de déficit. */
export function deficitJourKcal(entree: {
	apportKcal: number;
	maintenance: number;
	exerciceKcal?: number;
}): number {
	const apport = verifier(entree.apportKcal, 'Apport du jour', BORNES.kcal);
	const maintenance = verifier(entree.maintenance, 'Maintenance', BORNES.kcal);
	const exercice = verifierOption(entree.exerciceKcal, "Exercice du jour", BORNES.kcal, 0);
	return arrondi(apport - (maintenance + exercice), 2);
}

/**
 * Disponibilité en énergie = (R − E)/MM, en kcal par kg de masse maigre.
 *
 * `masseMaigreKg` doit être la masse maigre BRUTE (`masseMaigreBrute`) : un MM
 * déjà arrondi fausse les seuils et les comparaisons de grille. Une
 * disponibilité nulle ou négative (exercice du jour ≥ apport réel) est
 * RETOURNÉE telle quelle — elle signale une journée hors grille, jamais
 * masquée par un plancher arbitraire (la grille de cyclage la traite ensuite
 * comme « hors référentiel »).
 */
export function disponibiliteEnergieKcal(entree: {
	apportKcal: number;
	exerciceKcal?: number;
	masseMaigreKg: number;
}): number {
	const apport = verifier(entree.apportKcal, 'Apport du jour', BORNES.kcal);
	const exercice = verifierOption(entree.exerciceKcal, "Exercice du jour", BORNES.kcal, 0);
	const mm = verifier(entree.masseMaigreKg, 'Masse maigre', BORNES.masseMaigre);
	return arrondi((apport - exercice) / mm, 2);
}

/** Seuils de disponibilité : MM × 30 (haut) et MM × 24 (bas), arrondis en kcal. */
export function seuilsDisponibiliteKcal(masseMaigreKg: number): { haut: number; bas: number } {
	const mm = verifier(masseMaigreKg, 'Masse maigre', BORNES.masseMaigre);
	return {
		haut: Math.round(mm * SEUIL_DISPONIBILITE_HAUT),
		bas: Math.round(mm * SEUIL_DISPONIBILITE_BAS)
	};
}

/**
 * Bilan d'une semaine de 7 jours :
 *  - déficit de la semaine = somme des 7 déficits journaliers ;
 *  - graisse estimée = déficit semaine / 7700 (kg, arrondi 2 décimales) ;
 *  - disponibilité en énergie de chaque jour (même ordre que `jours`).
 *
 * Une semaine incomplète (≠ 7 jours) est refusée : le référentiel se calcule
 * sur 7 jours pleins — une semaine partielle donnerait un déficit tronqué.
 */
export function bilanSemaine(entree: {
	jours: JourBilan[];
	maintenance: number;
	masseMaigreKg: number;
}): { deficitSemaineKcal: number; graisseKg: number; disponibilitesKcal: number[] } {
	const jours = entree.jours;
	if (!Array.isArray(jours) || jours.length !== JOURS_SEMAINE) {
		throw new CalibrageError(
			`Bilan hebdomadaire invalide : ${JOURS_SEMAINE} jours sont attendus (reçu ${Array.isArray(jours) ? jours.length : 0}).`
		);
	}
	const maintenance = verifier(entree.maintenance, 'Maintenance', BORNES.kcal);

	let deficitSemaine = 0;
	const disponibilites: number[] = [];
	for (const jour of jours) {
		deficitSemaine += deficitJourKcal({
			apportKcal: jour.apportKcal,
			maintenance,
			exerciceKcal: jour.exerciceKcal
		});
		disponibilites.push(
			disponibiliteEnergieKcal({
				apportKcal: jour.apportKcal,
				exerciceKcal: jour.exerciceKcal,
				masseMaigreKg: entree.masseMaigreKg
			})
		);
	}

	return {
		deficitSemaineKcal: arrondi(deficitSemaine, 2),
		graisseKg: arrondi(deficitSemaine / KCAL_PAR_KG_GRAISSE, 2),
		disponibilitesKcal: disponibilites
	};
}

/* ───────────────────── 5 · Vitesse maximale de perte ───────────────────── */

/**
 * Vitesses maximales de perte de graisse (kg/semaine) :
 *  - Alpert   = P × MG%/20/100 ;
 *  - Macdonald = P × MG%/15/100.
 */
export function vitesseMaxPerte(poidsKg: number, mgPct: number): {
	alpertKgSemaine: number;
	macdonaldKgSemaine: number;
} {
	const masseGrasse = masseGrasseBrute(poidsKg, mgPct);
	return {
		alpertKgSemaine: arrondi(masseGrasse / DIVISEUR_ALPERT, 2),
		macdonaldKgSemaine: arrondi(masseGrasse / DIVISEUR_MACDONALD, 2)
	};
}

/* ───────────────────── 6 · MG% par mensurations (US Navy) ───────────────────── */

export type EntreeUSNavyFemme = {
	sexe: 'femme';
	/** Tour de cou (cm). */
	tourCouCm: number;
	/** Tour de taille (cm). */
	tourTailleCm: number;
	/** Tour de hanches (cm). */
	tourHanchesCm: number;
	/** Stature / hauteur (cm). */
	statureCm: number;
};

export type EntreeUSNavyHomme = {
	sexe: 'homme';
	tourCouCm: number;
	tourTailleCm: number;
	statureCm: number;
};

export type EntreeUSNavy = EntreeUSNavyFemme | EntreeUSNavyHomme;

/** Coefficients US Navy (mensurations en cm, log10). */
export const COEFF_US_NAVY = {
	femme: { constante: 1.29579, tourTaille: 0.35004, stature: 0.221 },
	homme: { constante: 1.0324, tourTaille: 0.19077, stature: 0.15456 }
} as const;

/**
 * MG% par mensurations (US Navy, cm) :
 *  - femme : 495/(1,29579 − 0,35004 × log10(tour de taille + hanches − cou)
 *            + 0,221 × log10(stature)) − 450 ;
 *  - homme : 495/(1,0324 − 0,19077 × log10(tour de taille − cou)
 *            + 0,15456 × log10(stature)) − 450.
 *
 * Repère : femme, cou 31, tour de taille 70, hanches 94, stature 161 → 25,9 %.
 * Un résultat hors 5–60 % signale des mensurations incohérentes : refusé.
 */
export function masseGrasseUSNavy(entree: EntreeUSNavy): number {
	if (entree.sexe !== 'femme' && entree.sexe !== 'homme') {
		throw new CalibrageError(
			'Sexe inconnu : « femme » ou « homme » attendu (la grille de mensurations en dépend).'
		);
	}
	const stature = verifier(entree.statureCm, 'Stature', BORNES.stature);
	const cou = verifier(entree.tourCouCm, 'Tour de cou', BORNES.cou);
	const tourTaille = verifier(entree.tourTailleCm, 'Tour de taille', BORNES.tourTaille);

	let pourcentage: number;
	if (entree.sexe === 'femme') {
		const hanches = verifier(entree.tourHanchesCm, 'Tour de hanches', BORNES.hanches);
		const circonference = tourTaille + hanches - cou;
		if (!(circonference > 0)) {
			throw new CalibrageError(
				'Mensurations incohérentes : tour de taille + hanches − cou doit être strictement positif.'
			);
		}
		const c = COEFF_US_NAVY.femme;
		pourcentage =
			495 / (c.constante - c.tourTaille * Math.log10(circonference) + c.stature * Math.log10(stature)) -
			450;
	} else {
		const circonference = tourTaille - cou;
		if (!(circonference > 0)) {
			throw new CalibrageError(
				'Mensurations incohérentes : tour de taille − cou doit être strictement positif.'
			);
		}
		const c = COEFF_US_NAVY.homme;
		pourcentage =
			495 / (c.constante - c.tourTaille * Math.log10(circonference) + c.stature * Math.log10(stature)) -
			450;
	}

	if (!Number.isFinite(pourcentage) || pourcentage < MG_PCT_MIN || pourcentage > MG_PCT_MAX) {
		throw new CalibrageError(
			`Mensurations incohérentes : ${arrondi(pourcentage, 1)} % de masse grasse hors de la plage plausible ${MG_PCT_MIN}–${MG_PCT_MAX} %.`
		);
	}
	return arrondi(pourcentage, 1);
}

/* ───────────────────── 7 · Profil complet (agrégat) ───────────────────── */

export type EntreeProfil = {
	poidsKg: number;
	mgPct: number;
	/** C — coefficient d'activité (issu du NEAT ou saisi). */
	coefficient: number;
	/** A — adaptation métabolique (%), 0 par défaut. */
	adaptationPct?: number;
	/** L — perte de graisse visée (kg/semaine) ; sans valeur, pas d'objectif calculé. */
	perteKgSemaine?: number;
};

export type ProfilCalibrage = {
	/** MG = P × MG%/100 (kg, 2 décimales). */
	masseGrasseKg: number;
	/** MM = P × (1 − MG%/100) (kg, 2 décimales) — valeur d'affichage. */
	masseMaigreKg: number;
	/** MB arrondi au kcal (1 172 pour P 56,6 / MG% 26). */
	metabolismeBaseKcal: number;
	/** arrondi(C × MB) − MB × A/100 (kcal). */
	maintenanceKcal: number;
	/** arrondi(maintenance − L × 7700/7), null si L n'est pas fournie. */
	objectifSansExerciceKcal: number | null;
	/** MM × 30 (kcal). */
	seuilDisponibiliteHautKcal: number;
	/** MM × 24 (kcal). */
	seuilDisponibiliteBasKcal: number;
	/** Alpert : P × MG%/20/100 (kg/semaine). */
	vitesseMaxAlpertKgSemaine: number;
	/** Macdonald : P × MG%/15/100 (kg/semaine). */
	vitesseMaxMacdonaldKgSemaine: number;
};

/**
 * Profil complet de calibrage en un appel — MÊMES formules que les fonctions
 * unitaires ci-dessus, enchaînées sur les valeurs brutes. Repère de référence
 * (P 56,6 · MG% 26 · C 1,40 · A 0) : MM 41,88 · MB 1 172 · maintenance 1 641 ·
 * seuils 1 257 / 1 005 · Alpert 0,74 · Macdonald 0,98.
 */
export function profilCalibrage(entree: EntreeProfil): ProfilCalibrage {
	const verifierProfil = () => {
		verifier(entree.poidsKg, 'Poids', BORNES.poids);
		verifier(entree.mgPct, 'Masse grasse', BORNES.mgPct);
	};
	verifierProfil();

	const masseGrasse = masseGrasseBrute(entree.poidsKg, entree.mgPct);
	const masseMaigre = masseMaigreBrute(entree.poidsKg, entree.mgPct);
	const mb = metabolismeBaseBrut(entree.poidsKg, entree.mgPct);
	const maintenance = maintenanceKcal(entree);
	const seuils = seuilsDisponibiliteKcal(masseMaigre);
	const vitesses = vitesseMaxPerte(entree.poidsKg, entree.mgPct);

	return {
		masseGrasseKg: arrondi(masseGrasse, 2),
		masseMaigreKg: arrondi(masseMaigre, 2),
		metabolismeBaseKcal: Math.round(mb),
		maintenanceKcal: maintenance,
		objectifSansExerciceKcal:
			entree.perteKgSemaine === undefined
				? null
				: objectifSansExerciceKcal(maintenance, entree.perteKgSemaine),
		seuilDisponibiliteHautKcal: seuils.haut,
		seuilDisponibiliteBasKcal: seuils.bas,
		vitesseMaxAlpertKgSemaine: vitesses.alpertKgSemaine,
		vitesseMaxMacdonaldKgSemaine: vitesses.macdonaldKgSemaine
	};
}
