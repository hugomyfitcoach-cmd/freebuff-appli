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

/**
 * Version des formules du module — stockée dans chaque instantané de calibrage
 * (table `calibrageSnapshots`) pour savoir, plus tard, avec quelles formules
 * un résultat a été produit. À incrémenter à TOUT changement de formule.
 */
export const VERSION_FORMULES_CALIBRAGE = '1';

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

/**
 * Supplément « activité au travail » : `0,05 + 0,05 × heures de mouvement
 * constant au travail`, plafonné à 0,6 — auquel s'ajoute l'ajustement manuel
 * du coach (0 à +0,05), appliqué APRÈS le plafond (le plafond protège la part
 * calculée ; l'ajustement reste borné à 0,05).
 */
export const SUPPLEMENT_TRAVAIL_BASE = 0.05;
export const SUPPLEMENT_TRAVAIL_PAR_HEURE = 0.05;
export const SUPPLEMENT_TRAVAIL_PLAFOND = 0.6;
/** Ajustement manuel du coach ajouté au supplément travail (0 à +0,05). */
export const AJUSTEMENT_TRAVAIL_MAX = 0.05;

/** Bornes de la fréquence cardiaque (BPM) — saisie API et Convex. */
export const BPM_MIN = 40;
export const BPM_MAX = 240;

/** Bornes plausibles (garde-fous de saisie) — messages d'erreur en clair. */
const BORNES = {
	poids: { min: 20, max: 400, label: '20 à 400 kg' },
	mgPct: { min: MG_PCT_MIN, max: MG_PCT_MAX, label: '5 à 60 %' },
	coefficient: { min: 0.8, max: 3, label: '0,8 à 3' },
	adaptation: { min: 0, max: 20, label: '0 à 20 %' },
	pas: { min: 0, max: 100_000, label: '0 à 100 000 pas' },
	heures: { min: 0, max: 24, label: '0 à 24 h' },
	kcal: { min: 0, max: 20_000, label: '0 à 20 000 kcal' },
	perte: { min: 0, max: 3, label: '0 à 3 kg/semaine' },
	stature: { min: 50, max: 260, label: '50 à 260 cm' },
	cou: { min: 10, max: 100, label: '10 à 100 cm' },
	tourTaille: { min: 30, max: 250, label: '30 à 250 cm' },
	hanches: { min: 30, max: 250, label: '30 à 250 cm' },
	supplement: { min: 0, max: 5, label: '0 à 5 de coefficient' },
	masseMaigre: { min: 5, max: 300, label: '5 à 300 kg' },
	bpm: { min: BPM_MIN, max: BPM_MAX, label: '40 à 240 BPM' },
	proteinesMasseMaigre: { min: 2, max: 2.6, label: '2 à 2,6 g/kg de masse maigre' },
	coutHoraire: { min: 1, max: 15, label: '1 à 15 kcal/kg/heure' },
	heuresTravail: { min: 0, max: 12, label: '0 à 12 h' },
	ajustementTravail: { min: 0, max: 0.05, label: '0 à 0,05' },
	budgetSemaine: { min: 0, max: 140_000, label: '0 à 140 000 kcal' },
	deficitPct: { min: 0, max: 20, label: '0 à 20 % (0 = maintenance)' }
} as const;

type Bornes = { min: number; max: number; label: string };

/** Arrondi métier (décimales maîtrisées) — évite le bruit binaire (1,6300000000000001). */
function arrondi(valeur: number, decimales: number): number {
	const facteur = 10 ** decimales;
	return Math.round(valeur * facteur) / facteur;
}

/**
 * Décimales françaises pour l'AFFICHAGE uniquement (0,46 et non 0.46) —
 * jamais utilisé dans un calcul, jamais de séparateur de milliers ajouté.
 */
export function decimalFr(valeur: number): string {
	return String(valeur).replace('.', ',');
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

/* ───────────── 1 bis · Supplément « activité au travail » et coefficient total ───────────── */

/**
 * Supplément « activité au travail » (points de coefficient) :
 * `min(0,05 + 0,05 × heures, 0,6) + ajustement du coach (0 à +0,05)`.
 *
 * Les heures sont celles passées chaque jour EN MOUVEMENT CONSTANT au travail
 * (champ libre borné 0 à 12 h) ; l'ajustement manuel du coach est un filet de
 * ±0,05 points posé APRÈS le plafond de 0,6.
 *
 * Repères (ajustement 0) : 0 h → 0,05 · 2 h → 0,15 · 6 h → 0,35 ·
 * 10 h → 0,55 · 12 h → 0,6 (12 h calculerait 0,65 : le plafond ramène à 0,6).
 * Avec l'ajustement maximal, 12 h → 0,65.
 */
export function supplementTravail(entree: {
	heures: number;
	ajustementCoach?: number;
}): number {
	const heures = verifier(entree.heures, 'Heures de mouvement au travail', BORNES.heuresTravail);
	const ajustement = verifierOption(
		entree.ajustementCoach,
		'Ajustement du coach',
		BORNES.ajustementTravail,
		0
	);
	const calcule = SUPPLEMENT_TRAVAIL_BASE + SUPPLEMENT_TRAVAIL_PAR_HEURE * heures;
	const plafonne = Math.min(calcule, SUPPLEMENT_TRAVAIL_PLAFOND);
	return arrondi(plafonne + ajustement, 6);
}

/**
 * Coefficient total du calibrage = coefficient des pas + supplément travail.
 *
 * Le coefficient des pas est celui de `coefficientNeat` (1 + pas × 0,000025,
 * sans mode de vie) ; le supplément travail (`supplementTravail`) s'y AJOUTE —
 * les deux se cumulent, jamais recalculés ailleurs.
 */
export function coefficientTotal(entree: {
	pas?: number;
	heuresTravail?: number;
	ajustementTravail?: number;
}): number {
	const coefficientPas = coefficientNeat({ pas: entree.pas });
	const supplement = supplementTravail({
		heures: entree.heuresTravail ?? 0,
		ajustementCoach: entree.ajustementTravail
	});
	return arrondi(coefficientPas + supplement, 6);
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
 * Repères de l'adaptation métabolique (A, % du métabolisme de base) — affichés
 * sous le champ de saisie pour guider la coach :
 *  - 0 % : poids stable à son poids habituel, aucune restriction en cours ;
 *  - 10 % : en déficit depuis 2 à 3 mois ou plus, ou perte déjà importante
 *    (même stabilisée) ;
 *  - 13 % : déficit prolongé ou masse grasse basse.
 */
export const ADAPTATION_REPERES: { pct: number; texte: string }[] = [
	{ pct: 0, texte: 'poids stable à son poids habituel, aucune restriction en cours' },
	{
		pct: 10,
		texte: 'en déficit depuis 2 à 3 mois ou plus, ou perte déjà importante (même stabilisée)'
	},
	{ pct: 13, texte: 'déficit prolongé ou masse grasse basse' }
];

/** Aide affichée sous le champ d'adaptation métabolique. */
export const ADAPTATION_AIDE =
	'Corrige la baisse de dépense que les pas ne mesurent pas. ' +
	'Estimation de départ, corrigée ensuite par la tendance réelle du poids.';

/** Seuil d'avertissement de l'adaptation métabolique (strictement au-delà). */
export const ADAPTATION_PCT_AVERTISSEMENT = 13;

/** Avertissement affiché au-delà de 13 % d'adaptation métabolique. */
export const ADAPTATION_AVERTISSEMENT =
	"Valeur exceptionnelle : vérifier qu'aucun facteur médical n'est en cause.";

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
 * Effet de l'adaptation métabolique (kcal/jour) = MB × A/100 — exactement la
 * valeur retranchée de la maintenance par `maintenanceKcal` (le calcul de la
 * maintenance ne change pas). Affichée « −X kcal/jour ».
 */
export function adaptationEffetKcal(entree: {
	poidsKg: number;
	mgPct: number;
	adaptationPct?: number;
}): number {
	const adaptation = verifierOption(
		entree.adaptationPct,
		'Adaptation métabolique',
		BORNES.adaptation,
		0
	);
	return arrondi((metabolismeBaseBrut(entree.poidsKg, entree.mgPct) * adaptation) / 100, 2);
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

/* ───────────────── 8 · Dépense d'une séance sportive ───────────────── */

/**
 * Coûts horaires fixes du barème G-FLUX (kcal par kg et par heure) :
 * musculation récréative 2,2 · musculation modérée 3,3 · musculation intensive
 * 4,4 · séance du programme G-FLUX 3,3 · activité douce 2,2 (légère/modérée)
 * et 3,3 (élevée). Le cardio dépend de la fréquence cardiaque : voir
 * `BANDES_CARDIO`. La musculation modérée est un AJOUT : aucune valeur
 * existante n'est modifiée (2,2 et 4,4 inchangés, anciennes lignes compatibles).
 */
export const COUT_SPORT = {
	musculationRecreative: 2.2,
	/** Musculation « Modérée » — ajoutée entre récréative et intensive. */
	musculationModeree: 3.3,
	musculationIntensive: 4.4,
	seanceGflux: 3.3,
	/** Activité douce (yoga, Pilates, aquagym, étirements, mobilité). */
	activiteDouce: 2.2,
	/** Activité douce menée à intensité élevée. */
	activiteDouceElevee: 3.3,
	/** Plafond cardio, appliqué au-delà de 180 BPM. */
	cardioPlafond: 8.8
} as const;

/**
 * Bandes cardio du barème : les bornes se REJOIGNENT sans trou ni recouvrement
 * (zones continues) — la borne basse est incluse ; la borne haute est exclue,
 * sauf la bande 160–180 qui est FERMÉE à 180 (180 BPM en fait partie) : tout
 * ce qui est au-delà de 180 — y compris 180,5 — tombe sur le plafond 8,8.
 * `min`/`max` encadrent le coût horaire (kcal/kg/heure) et `defaut` est la
 * valeur retenue quand aucun coût précis n'est fourni :
 *  - moins de 130 BPM : 3,3 à 4,3 (défaut 3,8) ;
 *  - 130 à moins de 150 BPM : 4,4 à 6,6 (défaut 5,5) ;
 *  - 150 à moins de 160 BPM : 6,6 (valeur unique) ;
 *  - 160 à 180 BPM inclus : 6,6 à 8,8 (défaut 7,7) ;
 *  - au-delà de 180 BPM : plafond 8,8 (défaut 8,8).
 *
 * Chaque bande porte un `id` stable (saisie cliente : choix de zone) et
 * l'intensité RESSENTIE équivalente (affichage sans cardiofréquencemètre).
 */
export const BANDES_CARDIO = [
	{ id: 'sous-130', intensite: 'Légère', bpmMin: 0, bpmMax: 130, maxInclus: false, min: 3.3, max: 4.3, defaut: 3.8, libelle: 'moins de 130 BPM' },
	{ id: '130-150', intensite: 'Modérée', bpmMin: 130, bpmMax: 150, maxInclus: false, min: 4.4, max: 6.6, defaut: 5.5, libelle: '130 à moins de 150 BPM' },
	{ id: '150-160', intensite: 'Soutenue', bpmMin: 150, bpmMax: 160, maxInclus: false, min: 6.6, max: 6.6, defaut: 6.6, libelle: '150 à moins de 160 BPM' },
	{ id: '160-180', intensite: 'Intense', bpmMin: 160, bpmMax: 180, maxInclus: true, min: 6.6, max: 8.8, defaut: 7.7, libelle: '160 à 180 BPM' },
	{ id: 'plus-180', intensite: 'Très intense', bpmMin: 180, bpmMax: Number.POSITIVE_INFINITY, maxInclus: true, min: 6.6, max: 8.8, defaut: 8.8, libelle: 'plus de 180 BPM (plafond 8,8)' }
] as const;

export type BandeCardio = (typeof BANDES_CARDIO)[number];

/** Identifiants des zones cardio (choix de zone en saisie cliente). */
export const ZONES_CARDIO_IDS = BANDES_CARDIO.map((b) => b.id);

/**
 * Zone cardio par identifiant (`sous-130` … `plus-180`) — refus explicite d'un
 * identifiant inconnu plutôt qu'une zone silencieusement choisie à la place.
 */
export function zoneCardioParId(id: string): BandeCardio {
	const zone = BANDES_CARDIO.find((b) => b.id === id);
	if (!zone) {
		throw new CalibrageError(
			`Zone cardio inconnue : ${ZONES_CARDIO_IDS.map((z) => `« ${z} »`).join(', ')} attendu (reçu « ${String(id)} »).`
		);
	}
	return zone;
}

/**
 * Intensités de la musculation saisie à la main : récréative (2,2) ·
 * modérée (3,3) · intensive (4,4). L'ordre est celui de l'affichage.
 */
export const INTENSITES_MUSCULATION = ['recreative', 'moderee', 'intensive'] as const;
export type IntensiteMusculation = (typeof INTENSITES_MUSCULATION)[number];

/**
 * Intensités des activités DOUCES (yoga, Pilates, aquagym, étirements,
 * mobilité) : légère et modérée valent 2,2 kcal/kg/h, élevée 3,3. Ces
 * activités ne passent PAS par les zones cardio.
 */
export const INTENSITES_DOUCES = ['legere', 'moderee', 'elevee'] as const;
export type IntensiteDouce = (typeof INTENSITES_DOUCES)[number];

/**
 * Bande cardio d'une fréquence cardiaque (bornes vérifiées ici). Les bandes
 * se suivent sans trou ni recouvrement : 180 BPM appartient à « 160 à 180 »
 * (bande fermée) et 180,5 BPM est au-delà de 180 → plafond 8,8.
 */
export function bandeCardio(bpm: number): BandeCardio {
	const frequence = verifier(bpm, 'Fréquence cardiaque', BORNES.bpm);
	for (const bande of BANDES_CARDIO) {
		if (frequence < bande.bpmMin) continue;
		if (bande.maxInclus ? frequence <= bande.bpmMax : frequence < bande.bpmMax) return bande;
	}
	/* Inatteignable : la dernière bande n'a pas de borne haute. */
	throw new CalibrageError(`Fréquence cardiaque hors barème (reçu ${frequence} BPM).`);
}

/**
 * Une séance du barème : musculation (récréative par défaut), séance du
 * programme G-FLUX, activité douce, ou cardio décrit par sa fréquence
 * cardiaque. Pour le cardio, `coefficientKcalKgH` permet de préciser le coût
 * DANS la bande (ex. 4,3 pour un cardio sous 130 BPM) ; hors bande, le refus
 * est explicite.
 *
 * `bpmMoyen` est une fréquence cardiaque MOYENNE réellement mesurée : quand
 * elle est fournie, elle choisit la zone pour TOUTES les activités (la FC
 * mesurée prime sur la catégorie et sur l'intensité ressentie).
 */
export type EntreeCoutSportif =
	| { sport: 'musculation'; intensite?: IntensiteMusculation; bpmMoyen?: number }
	| { sport: 'gflux'; bpmMoyen?: number }
	| { sport: 'douce'; intensite?: IntensiteDouce; bpmMoyen?: number }
	| { sport: 'cardio'; bpm: number; coefficientKcalKgH?: number };

export type CoutSportif = {
	/** Coût horaire retenu (kcal/kg/heure). */
	coefficientKcalKgH: number;
	/** Bande cardio utilisée (null pour musculation, G-FLUX et activité douce). */
	bande: BandeCardio | null;
	/** Libellé lisible de la règle appliquée (traçabilité UI / coach). */
	libelle: string;
};

/** Coût cardio d'une fréquence cardiaque (avec un coût précis facultatif). */
function coutCardio(bpm: number, precis: number | undefined): CoutSportif {
	const bande = bandeCardio(bpm);
	if (precis === undefined || precis === null) {
		return {
			coefficientKcalKgH: bande.defaut,
			bande,
			libelle: `Cardio ${bande.libelle} (${bande.defaut} kcal/kg/h)`
		};
	}
	verifier(precis, 'Coût horaire du cardio', {
		min: bande.min,
		max: bande.max,
		label: `${bande.min} à ${bande.max} kcal/kg/heure (cardio ${bande.libelle})`
	});
	return {
		coefficientKcalKgH: precis,
		bande,
		libelle: `Cardio ${bande.libelle} (${precis} kcal/kg/h précisé)`
	};
}

/**
 * Coût horaire d'une séance selon le barème (kcal/kg/heure). Les valeurs par
 * défaut sont celles du barème ; un coût précis n'est accepté que s'il tombe
 * DANS la bande de la séance (aucune valeur inventée hors barème).
 */
export function coutSportif(entree: EntreeCoutSportif): CoutSportif {
	/* FC moyenne réellement mesurée : elle choisit la zone pour toutes les
	   activités — la catégorie et l'intensité ressentie ne la remplacent pas. */
	if (entree.sport !== 'cardio' && entree.bpmMoyen !== undefined && entree.bpmMoyen !== null) {
		const cardio = coutCardio(entree.bpmMoyen, undefined);
		return {
			...cardio,
			libelle: `Cardio ${cardio.bande?.libelle} (${cardio.coefficientKcalKgH} kcal/kg/h · FC moyenne ${entree.bpmMoyen} BPM)`
		};
	}
	switch (entree.sport) {
		case 'musculation': {
			const intensite = entree.intensite ?? 'recreative';
			if (intensite === INTENSITES_MUSCULATION[0]) {
				return {
					coefficientKcalKgH: COUT_SPORT.musculationRecreative,
					bande: null,
					libelle: 'Musculation récréative (2,2 kcal/kg/h)'
				};
			}
			if (intensite === INTENSITES_MUSCULATION[1]) {
				return {
					coefficientKcalKgH: COUT_SPORT.musculationModeree,
					bande: null,
					libelle: 'Musculation modérée (3,3 kcal/kg/h)'
				};
			}
			if (intensite === INTENSITES_MUSCULATION[2]) {
				return {
					coefficientKcalKgH: COUT_SPORT.musculationIntensive,
					bande: null,
					libelle: 'Musculation intensive (4,4 kcal/kg/h)'
				};
			}
			throw new CalibrageError(
				`Intensité de musculation inconnue : « recreative », « moderee » ou « intensive » attendu (reçu « ${String(intensite)} »).`
			);
		}
		case 'gflux':
			return {
				coefficientKcalKgH: COUT_SPORT.seanceGflux,
				bande: null,
				libelle: 'Séance du programme G-FLUX (3,3 kcal/kg/h)'
			};
		case 'douce': {
			const intensite = entree.intensite ?? 'legere';
			const libelles: Record<IntensiteDouce, string> = {
				legere: 'légère',
				moderee: 'modérée',
				elevee: 'élevée'
			};
			if (intensite === INTENSITES_DOUCES[0] || intensite === INTENSITES_DOUCES[1]) {
				return {
					coefficientKcalKgH: COUT_SPORT.activiteDouce,
					bande: null,
					libelle: `Activité douce — ${libelles[intensite]} (${COUT_SPORT.activiteDouce} kcal/kg/h)`
				};
			}
			if (intensite === INTENSITES_DOUCES[2]) {
				return {
					coefficientKcalKgH: COUT_SPORT.activiteDouceElevee,
					bande: null,
					libelle: `Activité douce — ${libelles[intensite]} (${COUT_SPORT.activiteDouceElevee} kcal/kg/h)`
				};
			}
			throw new CalibrageError(
				`Intensité d'activité douce inconnue : « legere », « moderee » ou « elevee » attendu (reçu « ${String(intensite)} »).`
			);
		}
		case 'cardio':
			return coutCardio(entree.bpm, entree.coefficientKcalKgH);
		default: {
			const inconnu = entree as { sport?: unknown };
			throw new CalibrageError(
				`Sport inconnu : « musculation », « gflux », « douce » ou « cardio » attendu (reçu « ${String(inconnu.sport)} »).`
			);
		}
	}
}

/**
 * Dépense d'une séance = coût horaire (kcal/kg/heure) × poids × heures,
 * arrondie au kcal. Une durée nulle donne 0 kcal (séance non renseignée),
 * jamais un refus : l'appelant peut simplement ne rien compter.
 */
export function depenseSeanceKcal(entree: {
	coefficientKcalKgH: number;
	poidsKg: number;
	heures: number;
}): number {
	const coefficient = verifier(entree.coefficientKcalKgH, 'Coût horaire', BORNES.coutHoraire);
	const poids = verifier(entree.poidsKg, 'Poids', BORNES.poids);
	const heures = verifier(entree.heures, 'Durée', BORNES.heures);
	return Math.round(coefficient * poids * heures);
}

/**
 * Dépense d'une séance décrite par son barème (musculation / G-FLUX /
 * activité douce / cardio) : `coutSportif()` puis `depenseSeanceKcal()`.
 * Repère : 1 h de musculation récréative à 56,6 kg → 2,2 × 56,6 × 1 = 124,52
 * → 125 kcal.
 */
export function depenseSportiveKcal(
	entree: EntreeCoutSportif & { poidsKg: number; heures: number }
): number {
	return depenseSeanceKcal({
		coefficientKcalKgH: coutSportif(entree).coefficientKcalKgH,
		poidsKg: entree.poidsKg,
		heures: entree.heures
	});
}

/* ───────────────── 9 · Semaine sportive : sport, budget, objectif ───────────────── */

/**
 * Sport de la semaine = SOMME des dépenses des séances (kcal). Une liste vide
 * vaut 0 (semaine sans sport) ; chaque dépense est vérifiée (bornes kcal),
 * jamais une somme silencieusement faussée par une valeur aberrante.
 */
export function sportSemaineKcal(depensesKcal: number[]): number {
	if (!Array.isArray(depensesKcal)) {
		throw new CalibrageError('Sport de la semaine invalide : la liste des séances est attendue.');
	}
	let total = 0;
	depensesKcal.forEach((depense, index) => {
		total += verifier(depense, `Dépense de la séance ${index + 1}`, BORNES.kcal);
	});
	return arrondi(total, 2);
}

/**
 * Budget de la semaine = 7 × maintenance sans exercice + sport de la semaine.
 *
 * La maintenance est celle `sans exercice` (`maintenanceKcal`), multipliée par
 * les 7 jours de la semaine ; la dépense sportive réelle vient s'y AJOUTER,
 * puisque l'exercice est compté à part du mode de vie. Arrondi à 2 décimales
 * (la maintenance peut l'être : 1 500,36 → 10 502,52).
 */
export function budgetSemaineKcal(entree: {
	maintenanceSansExercice: number;
	sportSemaineKcal?: number;
}): number {
	const maintenance = verifier(
		entree.maintenanceSansExercice,
		'Maintenance sans exercice',
		BORNES.kcal
	);
	const sport = verifierOption(entree.sportSemaineKcal, 'Sport de la semaine', BORNES.kcal, 0);
	return arrondi(JOURS_SEMAINE * maintenance + sport, 2);
}

/**
 * Objectif de la semaine = budget × (1 − déficit choisi), le déficit étant
 * exprimé en POUR CENT du budget (défaut 0 : budget intégralement consommable,
 * c'est-à-dire maintenance). Borné à 0–20 % ; au-delà de 15 % un avertissement
 * explicite accompagne le résultat (`bilanObjectifSemaine`). Arrondi au kcal.
 * Repère : budget 11 487 kcal et 20 % de déficit → 9 190 kcal.
 */
export function objectifSemaineKcal(entree: {
	budgetSemaineKcal: number;
	deficitPct?: number;
}): number {
	const budget = verifier(entree.budgetSemaineKcal, 'Budget de la semaine', BORNES.budgetSemaine);
	const deficit = verifierOption(entree.deficitPct, 'Déficit choisi', BORNES.deficitPct, 0);
	return Math.round(budget * (1 - deficit / 100));
}

/** Déficit hebdomadaire au-delà duquel un avertissement est délivré (%). */
export const DEFICIT_PCT_AVERTISSEMENT = 15;

export type BilanObjectifSemaine = {
	/** Budget de la semaine (kcal) — 7 × maintenance sans exercice + sport. */
	budgetSemaineKcal: number;
	/** Déficit choisi (% du budget, 0 = maintenance). */
	deficitPct: number;
	/** Déficit de la semaine (kcal) = budget − objectif. */
	deficitSemaineKcal: number;
	/** Objectif de la semaine (kcal) — arrondi au kcal. */
	objectifSemaineKcal: number;
	/** Perte de graisse estimée (kg/semaine) = déficit semaine / 7 700. */
	perteGraisseKg: number;
	/** Avertissement au-delà de 15 % de déficit (null sinon) — message NEUTRE :
	 *  le rythme de perte n'est jamais jugé ici (il relève des plafonds
	 *  Alpert / Macdonald, voir `alertePlafonds` dans `calibrageFiche`). */
	avertissement: string | null;
};

/**
 * Bilan complet de l'objectif hebdomadaire : objectif kcal, déficit de la
 * semaine, perte de graisse estimée ET avertissement au-delà de 15 % de
 * déficit — le coach voit ainsi l'objectif et le rythme de perte induit.
 *
 * Le déficit affiché est la différence RÉELLE entre budget et objectif (les
 * deux arrondis restent cohérents) ; la perte de graisse est arrondie à
 * 2 décimales (repère : budget 12 327 kcal et 20 % → objectif 9 862 kcal,
 * déficit 2 465 kcal, perte estimée 0,32 kg/semaine).
 */
export function bilanObjectifSemaine(entree: {
	budgetSemaineKcal: number;
	deficitPct?: number;
}): BilanObjectifSemaine {
	const budget = verifier(entree.budgetSemaineKcal, 'Budget de la semaine', BORNES.budgetSemaine);
	const deficitPct = verifierOption(entree.deficitPct, 'Déficit choisi', BORNES.deficitPct, 0);
	const objectif = objectifSemaineKcal({ budgetSemaineKcal: budget, deficitPct });
	const deficitSemaine = arrondi(budget - objectif, 2);
	return {
		budgetSemaineKcal: budget,
		deficitPct,
		deficitSemaineKcal: deficitSemaine,
		objectifSemaineKcal: objectif,
		perteGraisseKg: arrondi(deficitSemaine / KCAL_PAR_KG_GRAISSE, 2),
		avertissement:
			deficitPct > DEFICIT_PCT_AVERTISSEMENT
				? `Déficit supérieur à la règle de 10 à 15 % : décision du coach.`
				: null
	};
}

/* ───────────────── 10 · Macros du jour ───────────────── */

/**
 * Protéines : 2,3 g par kg de MASSE MAIGRE (identique femmes et hommes) —
 * 1,8 g/kg de poids total indexait les protéines sur la masse grasse.
 */
export const PROTEINES_G_PAR_KG_MM = 2.3;
/** Réglage autorisé du ratio protéines (g par kg de masse maigre). */
export const PROTEINES_G_PAR_KG_MM_MIN = 2;
export const PROTEINES_G_PAR_KG_MM_MAX = 2.6;
/** Lipides : 30 % des calories… */
export const LIPIDES_PCT_KCAL = 30;
/** …avec un minimum de 0,6 g par kg de poids corporel. */
export const LIPIDES_MIN_G_PAR_KG = 0.6;
/** Seuil de signal sur les glucides (g/jour). */
export const GLUCIDES_SIGNAL_G = 100;
export const KCAL_PAR_G_PROTEINES = 4;
export const KCAL_PAR_G_GLUCIDES = 4;
export const KCAL_PAR_G_LIPIDES = 9;

export type MacrosJour = {
	/** Objectif calorique du jour (kcal) — entrée, recopiée pour l'agrégat. */
	kcal: number;
	/**
	 * Objectif kcal RÉELLEMENT APPLIQUÉ = somme exacte 4G + 4P + 9L des macros
	 * entières ci-dessous — la SEULE valeur envoyée à la fiche : identique dans
	 * les résultats, les champs d'application, la confirmation, la Vision 360
	 * et le journal (jamais d'écart dû à un demi-gramme).
	 */
	kcalApplique: number;
	proteinesG: number;
	lipidesG: number;
	glucidesG: number;
	/** Masse maigre utilisée pour les protéines : poids × (1 − MG%/100). */
	masseMaigreKg: number;
	/** Ratio appliqué (g de protéines par kg de masse maigre), borné 2 à 2,6. */
	proteinesParKgMasseMaigre: number;
	/** Vrai si les glucides passent sous 100 g. */
	glucidesSousSeuil: boolean;
	/** Signal explicite (null si rien à signaler). */
	alerteGlucides: string | null;
};

/**
 * Macros du jour d'un objectif calorique :
 *  - protéines = 2,3 g par kg de MASSE MAIGRE (poids × (1 − MG%/100)), même
 *    règle pour les femmes et les hommes, réglable de 2 à 2,6 — AUCUNE
 *    exception de « poids objectif » : la masse grasse n'est jamais comptée
 *    comme du muscle, sans avoir à inventer un poids cible ;
 *  - lipides = 30 % des calories, avec un plancher de 0,6 g/kg de poids ;
 *  - glucides = le reste, avec un signal explicite sous 100 g.
 *
 * Macros en GRAMMES ENTIERS (protéines et lipides arrondis, glucides = reste
 * arrondi) ; l'objectif kcal appliqué = somme exacte 4G + 4P + 9L
 * (`kcalApplique`), identique dans le calibrage, l'application, la Vision 360
 * et le journal.
 *
 * Repères : 60 kg, MG 26 % (MM 44,4 kg), 1 400 kcal → 102 g de protéines,
 * 47 g de lipides, 142 g de glucides (1 399 kcal appliquées) ; le même profil
 * à 1 100 kcal → 102 / 37 / 90 g avec signal « glucides < 100 g ».
 */
export function macrosJour(entree: {
	kcal: number;
	poidsKg: number;
	mgPct: number;
	/** Réglage du ratio protéines (2 à 2,6 g/kg de masse maigre, défaut 2,3). */
	proteinesParKgMasseMaigre?: number;
}): MacrosJour {
	const kcal = verifier(entree.kcal, 'Objectif calorique', BORNES.kcal);
	const poids = verifier(entree.poidsKg, 'Poids', BORNES.poids);
	const mgPct = verifier(entree.mgPct, 'Masse grasse', BORNES.mgPct);
	const ratio = verifierOption(
		entree.proteinesParKgMasseMaigre,
		'Protéines par kg de masse maigre',
		BORNES.proteinesMasseMaigre,
		PROTEINES_G_PAR_KG_MM
	);

	const masseMaigre = masseMaigreBrute(poids, mgPct);
	const proteinesG = Math.round(ratio * masseMaigre);
	/* Plancher de lipides sur le POIDS corporel (et non la masse maigre) :
	   les lipides restent inchangés, seule la base des protéines change. */
	const lipidesPlancherG = LIPIDES_MIN_G_PAR_KG * poids;
	/* Lipides arrondis en grammes ENTIERS (plus de demi-grammes). */
	const lipidesG = Math.round(
		Math.max(((LIPIDES_PCT_KCAL / 100) * kcal) / KCAL_PAR_G_LIPIDES, lipidesPlancherG)
	);
	/* Reste en kcal après protéines et lipides AFFICHÉS (cohérence des libellés) ;
	   un reste négatif donne 0 g de glucides + signal, jamais un négatif affiché. */
	const resteKcal =
		kcal - proteinesG * KCAL_PAR_G_PROTEINES - lipidesG * KCAL_PAR_G_LIPIDES;
	const glucidesG = Math.max(0, Math.round(resteKcal / KCAL_PAR_G_GLUCIDES));
	const glucidesSousSeuil = glucidesG < GLUCIDES_SIGNAL_G;

	return {
		kcal,
		kcalApplique:
			glucidesG * KCAL_PAR_G_GLUCIDES + proteinesG * KCAL_PAR_G_PROTEINES + lipidesG * KCAL_PAR_G_LIPIDES,
		proteinesG,
		lipidesG,
		glucidesG,
		masseMaigreKg: arrondi(masseMaigre, 2),
		proteinesParKgMasseMaigre: ratio,
		glucidesSousSeuil,
		alerteGlucides: glucidesSousSeuil
			? `Glucides estimés à ${glucidesG} g (< ${GLUCIDES_SIGNAL_G} g) : objectif calorique, volume d'entraînement ou sommeil à réinterroger avec la coach.`
			: null
	};
}
