/**
 * Fiche de calibrage (CRM coach) — ORCHESTRATION PURE, zéro formule ici.
 *
 * Chaque valeur affichée par l'onglet « Calibrage » vient du module
 * `./calibrage` (le SEUL module de calcul) ; le catalogue sport
 * (`../convex/sportCatalog`, source unique des coefficients) ne sert qu'à
 * résoudre le coût horaire d'une activité choisie — lui-même tenu du module
 * calibrage. Aucune formule n'est dupliquée : ce module enchaîne des appels.
 *
 * Importable à l'identique par le CRM (`src/routes/admin/+page.svelte`) et
 * par les tests node — c'est la couture qui vérifie « valeurs affichées =
 * valeurs du module » sans écran.
 */

import {
	ADAPTATION_AVERTISSEMENT,
	ADAPTATION_PCT_AVERTISSEMENT,
	JOURS_SEMAINE,
	PROTEINES_G_PAR_KG_MM,
	SEUIL_DISPONIBILITE_BAS,
	SEUIL_DISPONIBILITE_HAUT,
	VERSION_FORMULES_CALIBRAGE,
	adaptationEffetKcal,
	bilanObjectifSemaine,
	bilanSemaine,
	budgetSemaineKcal,
	CalibrageError,
	coefficientNeat,
	coefficientTotal,
	decimalFr,
	depenseSeanceKcal,
	disponibiliteEnergieKcal,
	macrosJour,
	masseMaigreBrute,
	profilCalibrage,
	sportSemaineKcal,
	supplementTravail,
	type MacrosJour
} from './calibrage';
import { getSportEntry, resolveSportCoefficient, SPORT_INTENSITY_LABELS } from '../convex/sportCatalog';

/** Déficit hebdomadaire par défaut de l'onglet (% du budget, borné 0–20). */
export const DEFICIT_PCT_DEFAUT = 12;

/** Ratio protéines par défaut (g par kg de masse maigre, borné 2 à 2,6). */
export const PROTEINES_PAR_KG_MM_DEFAUT = PROTEINES_G_PAR_KG_MM;

/** Bornes de la liste de séances du profil sportif habituel. */
const SEANCES_PAR_SEMAINE_MAX = 14;
const DUREE_SEANCE_MINUTES_MAX = 600;

/* ───────────────────────────── Types ───────────────────────────── */

/** Une séance du profil sportif habituel (activité du catalogue + choix). */
export type SeanceHabituelle = {
	/** Identifiant d'activité du catalogue (`SPORT_CATALOG`). */
	activiteId: string;
	/** Nombre de séances par semaine (0 à 14). */
	seancesParSemaine: number;
	/** Durée d'une séance, en minutes (0 à 600). */
	dureeMinutes: number;
	/** Intensité (musculation / activité douce) ou zone cardio. */
	choix: string;
};

/** Une séance résolue pour l'affichage (coût du barème + dépenses). */
export type SeanceCalculee = {
	activiteId: string;
	nom: string;
	seancesParSemaine: number;
	dureeMinutes: number;
	choix: string;
	/** Libellé lisible de l'intensité / zone choisie. */
	libelleChoix: string;
	/** Coût horaire du barème (kcal/kg/heure) — résolu par le catalogue. */
	coefficientKcalKgH: number;
	/** Dépense d'une séance (kcal). */
	depenseSeanceKcal: number;
	/** Dépense hebdomadaire de ce type de séance (kcal). */
	depenseSemaineKcal: number;
};

/** Entrées de l'onglet (toutes modifiables par la coach, pré-remplies côté CRM). */
export type EntreesFicheCalibrage = {
	/** P — poids (kg) : moyenne des pesées sur 7 jours, sinon dernière pesée. */
	poidsKg: number;
	/** MG% — taux de masse grasse : dernière estimation US Navy, sinon saisie. */
	mgPct: number;
	/** Moyenne de pas sur 14 jours (0 à 100 000). */
	pasMoyen: number;
	/** Heures par jour en mouvement constant au travail (0 à 12). */
	heuresTravail: number;
	/** Ajustement manuel du coach sur le supplément travail (0 à +0,05). */
	ajustementTravail?: number;
	/** A — adaptation métabolique (%), 0 par défaut. */
	adaptationPct?: number;
	/** Déficit choisi (% du budget), 12 par défaut, borné 0 à 20. */
	deficitPct?: number;
	/** Ratio protéines (g/kg de masse maigre), 2,3 par défaut, borné 2 à 2,6. */
	proteinesParKgMasseMaigre?: number;
	/** Profil sportif habituel (liste de séances, peut être vide). */
	seances: SeanceHabituelle[];
	/**
	 * Semaine type : un apport par jour (kcal), dans l'ordre lundi → dimanche.
	 * `null` = objectif journalier moyen (jour « type » non édité).
	 */
	apportsSemaine: (number | null)[];
};

/** Niveau de disponibilité en énergie face aux seuils 30 / 24 kcal/kg de MM. */
export type NiveauDisponibilite = 'haute' | 'intermediaire' | 'basse';

/**
 * Avertissement de disponibilité en énergie : sous 30 kcal/kg de masse maigre
 * → « vigilance » ; sous 24 → « alerte » (le plus haut seuil franchi l'emporte).
 */
export type AvertissementDisponibilite = {
	niveau: 'vigilance' | 'alerte';
	message: string;
};

export type ResultatsFicheCalibrage = {
	/** Version des formules du module ayant produit ces résultats. */
	versionFormules: string;
	/** Coefficient des pas seul (1 + pas × 0,000025). */
	coefficientPas: number;
	/** Supplément travail (plafonné 0,6 + ajustement coach). */
	supplementTravail: number;
	/** C — coefficient total = coefficient des pas + supplément travail. */
	coefficient: number;
	/** MM (kg, 2 décimales) — valeur d'affichage (les calculs restent bruts). */
	masseMaigreKg: number;
	/** MG (kg, 2 décimales). */
	masseGrasseKg: number;
	/** MB (kcal, arrondi). */
	metabolismeBaseKcal: number;
	/** Maintenance SANS exercice (kcal) = arrondi(C × MB) − MB × A/100. */
	maintenanceKcal: number;
	/**
	 * Maintenance TOTALE (kcal/jour, sport habituel inclus) = budget de la
	 * semaine ÷ 7. C'est la valeur pré-remplie du champ « Maintenance » de
	 * « Appliquer à la fiche » et de la carte « Maintenance totale ».
	 */
	maintenanceFiletKcal: number;
	/**
	 * Détail de la maintenance totale : part sans exercice (arrondie au kcal) et
	 * part sport journalière — la SOMME des deux vaut exactement
	 * `maintenanceFiletKcal` (« dont sans exercice X kcal · sport Y kcal/jour »).
	 */
	maintenanceDetailKcal: { sansExerciceKcal: number; sportJournalierKcal: number };
	/** Sport de la semaine (kcal) = somme des dépenses des séances habituelles. */
	sportSemaineKcal: number;
	/** Budget de la semaine (kcal) = 7 × maintenance sans exercice + sport. */
	budgetSemaineKcal: number;
	/** Déficit choisi (% du budget). */
	deficitPct: number;
	/** Déficit de la semaine (kcal) = budget − objectif. */
	deficitSemaineKcal: number;
	/** Objectif de la semaine (kcal). */
	objectifSemaineKcal: number;
	/**
	 * Objectif journalier VISÉ (kcal) = objectif semaine ÷ 7 — base de calcul
	 * des macros, avant arrondi aux grammes entiers.
	 */
	objectifCibleKcal: number;
	/**
	 * Objectif journalier APPLIQUÉ (kcal) = somme exacte 4G + 4P + 9L des macros
	 * entières (`macros.kcalApplique`) — identique dans les résultats, les champs
	 * d'application, la confirmation, la Vision 360 et le journal.
	 */
	objectifJournalierKcal: number;
	/** Perte de graisse estimée (kg/semaine) = déficit semaine ÷ 7 700. */
	perteGraisseKg: number;
	/** Plafond Alpert (kg/semaine) = MG ÷ 20. */
	vitesseMaxAlpertKgSemaine: number;
	/** Plafond Macdonald (kg/semaine) = MG ÷ 15. */
	vitesseMaxMacdonaldKgSemaine: number;
	/**
	 * Avertissement « dépasse le rythme conseillé » — UNIQUEMENT quand la perte
	 * estimée dépasse le plafond Alpert ou Macdonald (null sinon).
	 */
	alertePlafonds: string | null;
	/** Avertissement NEUTRE au-delà de 15 % de déficit (null sinon). */
	avertissementDeficit: string | null;
	/** Effet de l'adaptation métabolique (kcal/jour) = MB × A/100 (affiché « −X kcal/jour »). */
	adaptationEffetKcal: number;
	/** Avertissement au-delà de 13 % d'adaptation (null sinon). */
	avertissementAdaptation: string | null;
	/** Vigilance (< 30 kcal/kg de MM) ou alerte (< 24) sur la disponibilité du jour type. */
	avertissementDisponibilite: AvertissementDisponibilite | null;
	/** Macros du jour type (protéines 2,3 g/kg de MM, réglable 2 à 2,6). */
	macros: MacrosJour;
	/** Exercice journalier moyen (kcal) = sport semaine ÷ 7. */
	exerciceJournalierKcal: number;
	/** Disponibilité en énergie du jour type = (objectif − exercice)/MM. */
	disponibiliteKcal: number;
	/** Seuils en kcal du jour : MM × 30 et MM × 24. */
	seuilsDisponibiliteKcal: { haut: number; bas: number };
	/** Niveau de la disponibilité du jour type (couleur). */
	niveauDisponibilite: NiveauDisponibilite;
	/** Profil sportif résolu (affichage séance par séance). */
	seances: SeanceCalculee[];
	/** Semaine type sur 7 jours. */
	semaine: {
		apportsKcal: number[];
		exerciceKcal: number;
		disponibilitesKcal: number[];
		niveauxDisponibilite: NiveauDisponibilite[];
		/** Déficit total de la semaine (kcal) — négatif en cas de déficit. */
		deficitSemaineKcal: number;
		/** Graisse estimée (kg) — négative en cas de déficit. */
		graisseKg: number;
	};
};

/* ───────────────────────── Aides d'affichage ───────────────────────── */

/**
 * Niveau d'une disponibilité en énergie (kcal/kg de masse maigre) face aux
 * seuils du référentiel : ≥ 30 haute · ≥ 24 intermédiaire · < 24 basse.
 */
export function niveauDisponibilite(dispoKcal: number): NiveauDisponibilite {
	if (dispoKcal >= SEUIL_DISPONIBILITE_HAUT) return 'haute';
	if (dispoKcal >= SEUIL_DISPONIBILITE_BAS) return 'intermediaire';
	return 'basse';
}

/** Libellés et couleurs associés aux niveaux de disponibilité (UI CRM). */
export const DISPONIBILITE_NIVEAUX: Record<
	NiveauDisponibilite,
	{ label: string; couleur: string; pastille: string }
> = {
	haute: {
		label: `≥ ${SEUIL_DISPONIBILITE_HAUT} kcal/kg de masse maigre`,
		couleur: 'text-brand-dark',
		pastille: 'bg-brand'
	},
	intermediaire: {
		label: `${SEUIL_DISPONIBILITE_BAS} à ${SEUIL_DISPONIBILITE_HAUT} kcal/kg de masse maigre`,
		couleur: 'text-warn',
		pastille: 'bg-warn'
	},
	basse: {
		label: `< ${SEUIL_DISPONIBILITE_BAS} kcal/kg de masse maigre`,
		couleur: 'text-danger',
		pastille: 'bg-danger'
	}
};

/* ───────────────────────── Agrégat du module ───────────────────────── */

function nombre(value: unknown, nom: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new CalibrageError(`${nom} invalide : un nombre fini est attendu.`);
	}
	return value;
}

/** Une séance du profil sportif, résolue par le catalogue puis le barème. */
function calculerSeance(seance: SeanceHabituelle, poidsKg: number): SeanceCalculee {
	const entry = getSportEntry(seance.activiteId);
	if (!entry) {
		throw new CalibrageError(
			`Activité inconnue : « ${String(seance.activiteId)} » n'appartient pas au catalogue sport.`
		);
	}
	const seancesParSemaine = nombre(seance.seancesParSemaine, 'Séances par semaine');
	if (seancesParSemaine < 0 || seancesParSemaine > SEANCES_PAR_SEMAINE_MAX) {
		throw new CalibrageError(
			`Séances par semaine invalides : 0 à ${SEANCES_PAR_SEMAINE_MAX} attendu (reçu ${seancesParSemaine}).`
		);
	}
	const dureeMinutes = nombre(seance.dureeMinutes, 'Durée de la séance');
	if (dureeMinutes < 0 || dureeMinutes > DUREE_SEANCE_MINUTES_MAX) {
		throw new CalibrageError(
			`Durée de séance invalide : 0 à ${DUREE_SEANCE_MINUTES_MAX} minutes attendu (reçu ${dureeMinutes}).`
		);
	}
	/* Le catalogue est la source unique des coefficients (lui-même tenu du
	   module calibrage) — un choix hors barème est refusé, jamais deviné. */
	let resolu;
	try {
		resolu = resolveSportCoefficient(seance.activiteId, seance.choix);
	} catch (e) {
		throw new CalibrageError(e instanceof Error ? e.message : 'Zone ou intensité invalide.');
	}
	const depense = depenseSeanceKcal({
		coefficientKcalKgH: resolu.coefficientKcalKgH,
		poidsKg,
		heures: dureeMinutes / 60
	});
	return {
		activiteId: seance.activiteId,
		nom: entry.name,
		seancesParSemaine,
		dureeMinutes,
		choix: seance.choix,
		libelleChoix: SPORT_INTENSITY_LABELS[seance.choix] ?? seance.choix,
		coefficientKcalKgH: resolu.coefficientKcalKgH,
		depenseSeanceKcal: depense,
		depenseSemaineKcal: depense * seancesParSemaine
	};
}

/**
 * Résultats complets de l'onglet Calibrage — UNIQUEMENT des appels au module
 * `calibrage.ts` (plus la résolution catalogue des séances). Toute valeur
 * affichée par le CRM sort d'ici : le test « valeurs affichées = module »
 * compare ce retour aux fonctions unitaires du module.
 */
export function resultatsFiche(entrees: EntreesFicheCalibrage): ResultatsFicheCalibrage {
	const poidsKg = nombre(entrees.poidsKg, 'Poids');
	const mgPct = nombre(entrees.mgPct, 'Masse grasse');
	const pasMoyen = nombre(entrees.pasMoyen, 'Moyenne de pas');

	/* Coefficient total = coefficient des pas + supplément travail. */
	const coefficientPas = coefficientNeat({ pas: pasMoyen });
	const supplement = supplementTravail({
		heures: entrees.heuresTravail,
		ajustementCoach: entrees.ajustementTravail
	});
	const coefficient = coefficientTotal({
		pas: pasMoyen,
		heuresTravail: entrees.heuresTravail,
		ajustementTravail: entrees.ajustementTravail
	});

	const profil = profilCalibrage({
		poidsKg,
		mgPct,
		coefficient,
		adaptationPct: entrees.adaptationPct
	});
	const masseMaigre = masseMaigreBrute(poidsKg, mgPct);

	/* Profil sportif : résolution catalogue + barème du module. */
	const seances = (entrees.seances ?? []).map((s) => calculerSeance(s, poidsKg));
	/* Sport de la semaine = somme des dépenses des séances (module). */
	const sport = sportSemaineKcal(seances.map((s) => s.depenseSemaineKcal));

	const budget = budgetSemaineKcal({
		maintenanceSansExercice: profil.maintenanceKcal,
		sportSemaineKcal: sport
	});
	const deficitPct = entrees.deficitPct ?? DEFICIT_PCT_DEFAUT;
	const bilan = bilanObjectifSemaine({ budgetSemaineKcal: budget, deficitPct });
	/* Objectif visé = semaine ÷ 7 ; les macros ENTIÈRES en découlent, puis
	   l'objectif APPLIQUÉ = somme exacte 4G + 4P + 9L (`macros.kcalApplique`) :
	   la même valeur est affichée, appliquée, confirmée, résumée dans la
	   Vision 360 et lue par le journal — jamais d'écart d'arrondi. */
	const objectifCibleKcal = Math.round(bilan.objectifSemaineKcal / JOURS_SEMAINE);
	const macros = macrosJour({
		kcal: objectifCibleKcal,
		poidsKg,
		mgPct,
		proteinesParKgMasseMaigre: entrees.proteinesParKgMasseMaigre
	});
	const objectifJournalierKcal = macros.kcalApplique;

	/* Convention documentée de la semaine type : le sport habituel est réparti
	   linéairement sur les 7 jours (aucun jour de séance n'est connu). La
	   disponibilité en énergie tient compte de cet exercice : (R − E)/MM. */
	const exerciceJournalierKcal = sport / JOURS_SEMAINE;
	const disponibiliteKcal = disponibiliteEnergieKcal({
		apportKcal: objectifJournalierKcal,
		exerciceKcal: exerciceJournalierKcal,
		masseMaigreKg: masseMaigre
	});
	const seuils = { haut: profil.seuilDisponibiliteHautKcal, bas: profil.seuilDisponibiliteBasKcal };

	/* Semaine type : un apport par jour (null = objectif journalier moyen). */
	const apports = entrees.apportsSemaine ?? [];
	if (!Array.isArray(apports) || apports.length !== JOURS_SEMAINE) {
		throw new CalibrageError(
			`Semaine type invalide : ${JOURS_SEMAINE} apports journaliers sont attendus (reçu ${Array.isArray(apports) ? apports.length : 0}).`
		);
	}
	const apportsKcal = apports.map((a) =>
		a === null || a === undefined ? objectifJournalierKcal : nombre(a, 'Apport du jour')
	);
	const semaine = bilanSemaine({
		jours: apportsKcal.map((apportKcal) => ({ apportKcal, exerciceKcal: exerciceJournalierKcal })),
		maintenance: profil.maintenanceKcal,
		masseMaigreKg: masseMaigre
	});

	/* Plafonds de vitesse de perte (Alpert < Macdonald) — SEULS cas où le
	   « rythme conseillé » est jugé (le déficit au-delà de 15 % reste neutre). */
	const alpert = profil.vitesseMaxAlpertKgSemaine;
	const macdonald = profil.vitesseMaxMacdonaldKgSemaine;
	const perte = bilan.perteGraisseKg;
	const alertePlafonds =
		perte > macdonald
			? `Perte estimée de ${decimalFr(perte)} kg/semaine : elle dépasse le rythme conseillé — plafond Alpert (${decimalFr(alpert)} kg/semaine) et plafond Macdonald (${decimalFr(macdonald)} kg/semaine) dépassés.`
			: perte > alpert
				? `Perte estimée de ${decimalFr(perte)} kg/semaine : elle dépasse le rythme conseillé — plafond Alpert (${decimalFr(alpert)} kg/semaine) dépassé, plafond Macdonald (${decimalFr(macdonald)} kg/semaine) non dépassé.`
				: null;

	/* Disponibilité en énergie du jour type : sous 30 kcal/kg de MM → vigilance,
	   sous 24 → alerte (seuils du référentiel, le plus haut franchi l'emporte). */
	const avertissementDisponibilite: AvertissementDisponibilite | null =
		disponibiliteKcal < SEUIL_DISPONIBILITE_BAS
			? {
					niveau: 'alerte',
					message: `Disponibilité en énergie sous ${SEUIL_DISPONIBILITE_BAS} kcal/kg de masse maigre : alerte.`
				}
			: disponibiliteKcal < SEUIL_DISPONIBILITE_HAUT
				? {
						niveau: 'vigilance',
						message: `Disponibilité en énergie sous ${SEUIL_DISPONIBILITE_HAUT} kcal/kg de masse maigre : vigilance.`
					}
				: null;

	/* Maintenance totale = budget ÷ 7 (sport habituel INCLUS) — même valeur que
	   le champ « Maintenance » de « Appliquer à la fiche ». La carte l'affiche
	   avec son détail « dont sans exercice X · sport Y » dont la somme vaut
	   EXACTEMENT le total (arrondis cohérents). */
	const maintenanceFiletKcal = Math.round(budget / JOURS_SEMAINE);
	const sansExerciceKcal = Math.round(profil.maintenanceKcal);
	const adaptationPct = entrees.adaptationPct ?? 0;

	return {
		versionFormules: VERSION_FORMULES_CALIBRAGE,
		coefficientPas,
		supplementTravail: supplement,
		coefficient,
		masseMaigreKg: profil.masseMaigreKg,
		masseGrasseKg: profil.masseGrasseKg,
		metabolismeBaseKcal: profil.metabolismeBaseKcal,
		maintenanceKcal: profil.maintenanceKcal,
		maintenanceFiletKcal,
		maintenanceDetailKcal: {
			sansExerciceKcal,
			sportJournalierKcal: maintenanceFiletKcal - sansExerciceKcal
		},
		sportSemaineKcal: sport,
		budgetSemaineKcal: budget,
		deficitPct: bilan.deficitPct,
		deficitSemaineKcal: bilan.deficitSemaineKcal,
		objectifSemaineKcal: bilan.objectifSemaineKcal,
		objectifCibleKcal,
		objectifJournalierKcal,
		perteGraisseKg: bilan.perteGraisseKg,
		vitesseMaxAlpertKgSemaine: alpert,
		vitesseMaxMacdonaldKgSemaine: macdonald,
		alertePlafonds,
		avertissementDeficit: bilan.avertissement,
		adaptationEffetKcal: adaptationEffetKcal({ poidsKg, mgPct, adaptationPct }),
		avertissementAdaptation:
			adaptationPct > ADAPTATION_PCT_AVERTISSEMENT ? ADAPTATION_AVERTISSEMENT : null,
		avertissementDisponibilite,
		macros,
		exerciceJournalierKcal,
		disponibiliteKcal,
		seuilsDisponibiliteKcal: seuils,
		niveauDisponibilite: niveauDisponibilite(disponibiliteKcal),
		seances,
		semaine: {
			apportsKcal,
			exerciceKcal: exerciceJournalierKcal,
			disponibilitesKcal: semaine.disponibilitesKcal,
			niveauxDisponibilite: semaine.disponibilitesKcal.map((d) => niveauDisponibilite(d)),
			deficitSemaineKcal: semaine.deficitSemaineKcal,
			graisseKg: semaine.graisseKg
		}
	};
}
