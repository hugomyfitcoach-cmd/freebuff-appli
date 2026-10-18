/**
 * Mission C1-bis : DÉPENSE SPORTIVE et BUDGET DE LA SEMAINE — tests dorés.
 *
 * Objectif : ajouter au module pur `src/lib/calibrage.ts` le barème du tableau
 * G-FLUX (kcal/kg/heure), la dépense d'une séance (coût × poids × heures), le
 * sport de la semaine (somme des séances), le budget hebdomadaire
 * (7 × maintenance sans exercice + sport) et l'objectif hebdomadaire
 * (budget × (1 − déficit choisi)).
 *
 * Repère doré partagé avec la mission C1 : P 56,6 kg · MG% 26 · C 1,40 · A 0
 *   → MM 41,88 kg · MB 1 172 kcal · maintenance 1 641 kcal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const cal = await import(new URL('../src/lib/calibrage.ts', import.meta.url).href);

const P = 56.6;
const MAINTENANCE = 1641;

/* ── 1 · Barème : coûts fixes ── */

test('Barème : musculation récréative 2,2 · intensive 4,4 · séance G-FLUX 3,3', () => {
	assert.equal(cal.COUT_SPORT.musculationRecreative, 2.2);
	assert.equal(cal.COUT_SPORT.musculationIntensive, 4.4);
	assert.equal(cal.COUT_SPORT.seanceGflux, 3.3);
	assert.equal(cal.coutSportif({ sport: 'musculation' }).coefficientKcalKgH, 2.2, 'récréative par défaut');
	assert.equal(
		cal.coutSportif({ sport: 'musculation', intensite: 'recreative' }).coefficientKcalKgH,
		2.2
	);
	assert.equal(
		cal.coutSportif({ sport: 'musculation', intensite: 'intensive' }).coefficientKcalKgH,
		4.4
	);
	assert.equal(cal.coutSportif({ sport: 'gflux' }).coefficientKcalKgH, 3.3);
	assert.equal(cal.coutSportif({ sport: 'gflux' }).bande, null);
});

/* ── 2 · Barème : bandes cardio et valeurs par défaut ── */

test('Cardio : défauts du barème par bande BPM', () => {
	const defaut = (bpm) => cal.coutSportif({ sport: 'cardio', bpm }).coefficientKcalKgH;
	assert.equal(defaut(60), 3.8, 'moins de 130 BPM → 3,8');
	assert.equal(defaut(100), 3.8);
	assert.equal(defaut(129), 3.8);
	assert.equal(defaut(130), 5.5, '130 BPM bascule dans la bande 130–150 → 5,5');
	assert.equal(defaut(149), 5.5);
	assert.equal(defaut(150), 6.6, '150 BPM bascule dans la bande 150–160 → 6,6');
	assert.equal(defaut(155), 6.6);
	assert.equal(defaut(159), 6.6);
	assert.equal(defaut(160), 7.7, '160 BPM bascule dans la bande 160–180 → 7,7');
	assert.equal(defaut(180), 7.7);
	assert.equal(defaut(181), 8.8, 'au-delà de 180 BPM → plafond 8,8');
	assert.equal(defaut(200), 8.8);
});

test('Cardio : un coût précis n’est accepté que DANS la bande de la séance', () => {
	const cout = (bpm, coefficientKcalKgH) =>
		cal.coutSportif({ sport: 'cardio', bpm, coefficientKcalKgH }).coefficientKcalKgH;
	assert.equal(cout(120, 3.3), 3.3, 'borne basse de la bande < 130');
	assert.equal(cout(120, 4.3), 4.3, 'borne haute de la bande < 130');
	assert.equal(cout(140, 6.6), 6.6);
	assert.equal(cout(155, 6.6), 6.6, 'bande 150–160 : 6,6 est la seule valeur');
	assert.equal(cout(170, 6.6), 6.6);
	assert.equal(cout(170, 8.8), 8.8);
	assert.equal(cout(200, 8.8), 8.8, 'plafond respecté au-delà de 180');
});

/* ── 3 · Dépense d'une séance = coût × poids × heures ── */

test('Dépense d’une séance : coût × poids × heures, arrondie au kcal', () => {
	/* 2,2 × 56,6 × 1 = 124,52 → 125 */
	assert.equal(cal.depenseSportiveKcal({ sport: 'musculation', poidsKg: P, heures: 1 }), 125);
	/* 4,4 × 56,6 × 1 = 249,04 → 249 */
	assert.equal(
		cal.depenseSportiveKcal({ sport: 'musculation', intensite: 'intensive', poidsKg: P, heures: 1 }),
		249
	);
	/* 3,3 × 56,6 × 1,5 = 280,17 → 280 */
	assert.equal(cal.depenseSportiveKcal({ sport: 'gflux', poidsKg: P, heures: 1.5 }), 280);
	/* 5,5 × 56,6 × 1 = 311,3 → 311 (cardio 140 BPM, défaut de bande) */
	assert.equal(cal.depenseSportiveKcal({ sport: 'cardio', bpm: 140, poidsKg: P, heures: 1 }), 311);
	/* 7,7 × 56,6 × 0,5 = 217,91 → 218 (cardio 165 BPM, défaut de bande) */
	assert.equal(cal.depenseSportiveKcal({ sport: 'cardio', bpm: 165, poidsKg: P, heures: 0.5 }), 218);
	/* 8,8 × 56,6 × 0,5 = 249,04 → 249 (cardio 200 BPM, plafond) */
	assert.equal(cal.depenseSportiveKcal({ sport: 'cardio', bpm: 200, poidsKg: P, heures: 0.5 }), 249);
	/* Coût explicite dans la bande : 4,3 × 56,6 × 1 = 243,38 → 243 */
	assert.equal(
		cal.depenseSportiveKcal({
			sport: 'cardio',
			bpm: 120,
			coefficientKcalKgH: 4.3,
			poidsKg: P,
			heures: 1
		}),
		243
	);
	/* Durée nulle → 0 kcal (séance non comptée), jamais un refus. */
	assert.equal(cal.depenseSportiveKcal({ sport: 'gflux', poidsKg: P, heures: 0 }), 0);
});

test('Dépense d’une séance : la version brute prend un coût déjà résolu', () => {
	assert.equal(cal.depenseSeanceKcal({ coefficientKcalKgH: 2.2, poidsKg: P, heures: 1 }), 125);
	assert.equal(cal.depenseSeanceKcal({ coefficientKcalKgH: 3.3, poidsKg: 60, heures: 2 }), 396);
	assert.equal(cal.depenseSeanceKcal({ coefficientKcalKgH: 2.2, poidsKg: P, heures: 0 }), 0);
});

/* ── 4 · Semaine : sport, budget, objectif ── */

test('Sport de la semaine = somme des séances (0 pour une semaine vide)', () => {
	assert.equal(cal.sportSemaineKcal([]), 0);
	assert.equal(cal.sportSemaineKcal([125]), 125);
	assert.equal(cal.sportSemaineKcal([125, 249, 280]), 654);
	/* Semaine réaliste au repère P 56,6 : G-FLUX 1 h 30 + cardio 140 1 h + cardio 200 30 min */
	assert.equal(cal.sportSemaineKcal([280, 311, 249]), 840);
});

test('Budget de la semaine = 7 × maintenance sans exercice + sport de la semaine', () => {
	assert.equal(cal.budgetSemaineKcal({ maintenanceSansExercice: MAINTENANCE }), 11487);
	assert.equal(
		cal.budgetSemaineKcal({ maintenanceSansExercice: MAINTENANCE, sportSemaineKcal: 840 }),
		12327
	);
	/* Maintenance décimale (adaptation métabolique) : 1 500,36 × 7 = 10 502,52 */
	assert.equal(
		cal.budgetSemaineKcal({ maintenanceSansExercice: 1500.36, sportSemaineKcal: 0 }),
		10502.52
	);
	assert.equal(cal.budgetSemaineKcal({ maintenanceSansExercice: 0 }), 0);
});

test('Objectif de la semaine = budget × (1 − déficit choisi), arrondi au kcal', () => {
	assert.equal(cal.objectifSemaineKcal({ budgetSemaineKcal: 11487 }), 11487, 'sans déficit : budget entier');
	assert.equal(cal.objectifSemaineKcal({ budgetSemaineKcal: 11487, deficitPct: 20 }), 9190); // 9 189,6
	assert.equal(cal.objectifSemaineKcal({ budgetSemaineKcal: 12327, deficitPct: 20 }), 9862); // 9 861,6
	assert.equal(cal.objectifSemaineKcal({ budgetSemaineKcal: 11487, deficitPct: 10 }), 10338); // 10 338,3
});

test('Chaîne complète au repère doré : maintenance → sport → budget → objectif', () => {
	const sport = cal.sportSemaineKcal([
		cal.depenseSportiveKcal({ sport: 'gflux', poidsKg: P, heures: 1.5 }),
		cal.depenseSportiveKcal({ sport: 'cardio', bpm: 140, poidsKg: P, heures: 1 }),
		cal.depenseSportiveKcal({ sport: 'cardio', bpm: 200, poidsKg: P, heures: 0.5 })
	]);
	assert.equal(sport, 840);
	const budget = cal.budgetSemaineKcal({ maintenanceSansExercice: MAINTENANCE, sportSemaineKcal: sport });
	assert.equal(budget, 12327);
	assert.equal(cal.objectifSemaineKcal({ budgetSemaineKcal: budget, deficitPct: 20 }), 9862);
});

/* ── 5 · Repères dorés de la mission (séances, macros, objectif) ── */

test('Repère doré : 60 kg, 3 × musculation intensive 1 h + 1 h 30 de cardio 140 BPM → 1 287 kcal', () => {
	const seances = [
		cal.depenseSportiveKcal({ sport: 'musculation', intensite: 'intensive', poidsKg: 60, heures: 1 }),
		cal.depenseSportiveKcal({ sport: 'musculation', intensite: 'intensive', poidsKg: 60, heures: 1 }),
		cal.depenseSportiveKcal({ sport: 'musculation', intensite: 'intensive', poidsKg: 60, heures: 1 }),
		cal.depenseSportiveKcal({ sport: 'cardio', bpm: 140, poidsKg: 60, heures: 1.5 })
	];
	/* 4,4 × 60 × 1 = 264 kcal par séance · 5,5 × 60 × 1,5 = 495 kcal (cardio 140) */
	assert.equal(seances[0], 264);
	assert.equal(seances[3], 495);
	assert.equal(cal.sportSemaineKcal(seances), 1287);
});

test('Repère doré : 60 kg, 3 séances G-FLUX d’1 h → 594 kcal (3,3 kcal/kg/heure)', () => {
	const seances = [1, 2, 3].map(() =>
		cal.depenseSportiveKcal({ sport: 'gflux', poidsKg: 60, heures: 1 })
	);
	assert.deepEqual(seances, [198, 198, 198]); // 3,3 × 60 = 198
	assert.equal(cal.sportSemaineKcal(seances), 594);
});

test('Repère doré : 60 kg, MG 26 %, 1 400 kcal → P 108 g · L 46,7 g · G 137 g (aucun signal)', () => {
	const macros = cal.macrosJour({ kcal: 1400, poidsKg: 60, mgPct: 26 });
	assert.equal(macros.proteinesG, 108); // 1,8 × 60
	assert.equal(macros.lipidesG, 46.7); // 30 % de 1 400 = 420 kcal → /9 = 46,67
	assert.equal(macros.glucidesG, 137); // (1 400 − 432 − 420,3)/4 = 136,9 → 137
	assert.equal(macros.glucidesSousSeuil, false);
	assert.equal(macros.alerteGlucides, null);
	assert.equal(macros.poidsReferenceKg, 60, 'MG 26 % ≤ 35 % : le poids courant sert de référence');
	assert.equal(macros.poidsObjectifDeduit, false);
});

test('Repère doré : même profil à 1 100 kcal → signal glucides < 100 g', () => {
	const macros = cal.macrosJour({ kcal: 1100, poidsKg: 60, mgPct: 26 });
	assert.equal(macros.proteinesG, 108);
	assert.equal(macros.lipidesG, 36.7); // 30 % de 1 100 = 330 kcal → /9 = 36,67
	assert.equal(macros.glucidesG, 84); // (1 100 − 432 − 330,3)/4 = 84,4 → 84
	assert.equal(macros.glucidesSousSeuil, true);
	assert.ok(macros.alerteGlucides?.includes('84'), 'le signal cite les glucides estimés');
});

test('Macros : plancher de lipides 0,6 g/kg et glucides jamais négatifs', () => {
	/* 80 kg : le plancher 0,6 × 80 = 48 g prime sur 30 % de 900 kcal (30 g) */
	const macros = cal.macrosJour({ kcal: 900, poidsKg: 80, mgPct: 26 });
	assert.equal(macros.proteinesG, 144); // 1,8 × 80
	assert.equal(macros.lipidesG, 48); // plancher, pas 30 %
	assert.equal(macros.glucidesG, 0, 'reste négatif → 0 g, jamais affiché négatif');
	assert.equal(macros.glucidesSousSeuil, true);
});

test('Macros : MG > 35 % → référence sur le poids objectif (fourni ou déduit)', () => {
	/* Poids objectif fourni : 1,8 × 70 = 126 g, plancher lipides 0,6 × 70 = 42 g */
	const fourni = cal.macrosJour({ kcal: 1900, poidsKg: 100, mgPct: 40, poidsObjectifKg: 70 });
	assert.equal(fourni.proteinesG, 126);
	assert.equal(fourni.poidsReferenceKg, 70);
	assert.equal(fourni.poidsObjectifDeduit, false);
	assert.equal(fourni.lipidesG, 63.3); // 30 % de 1 900 = 570 kcal → 63,33
	/* Poids objectif déduit : MM 60 kg ramenée à 35 % de MG → 60/0,65 = 92,31 kg */
	const deduit = cal.macrosJour({ kcal: 1900, poidsKg: 100, mgPct: 40 });
	assert.equal(deduit.poidsReferenceKg, 92.31);
	assert.equal(deduit.poidsObjectifDeduit, true);
	assert.equal(deduit.proteinesG, 166); // 1,8 × 92,3077 = 166,15
});

/* ── 6 · Objectif de la semaine : déficit, avertissement, perte estimée ── */

test('Objectif de la semaine : déficit borné 0–20 %, 0 = maintenance', () => {
	assert.equal(cal.objectifSemaineKcal({ budgetSemaineKcal: 11487, deficitPct: 0 }), 11487);
	assert.equal(cal.objectifSemaineKcal({ budgetSemaineKcal: 11487, deficitPct: 15 }), 9764); // 9 763,95
	assert.equal(cal.objectifSemaineKcal({ budgetSemaineKcal: 11487, deficitPct: 20 }), 9190);
	refuse(() => cal.objectifSemaineKcal({ budgetSemaineKcal: 11487, deficitPct: 21 }), 'déficit > 20 %');
});

test('Bilan de la semaine : déficit en kcal, perte estimée et avertissement > 15 %', () => {
	const doux = cal.bilanObjectifSemaine({ budgetSemaineKcal: 12327, deficitPct: 15 });
	assert.equal(doux.objectifSemaineKcal, 10478); // 12 327 × 0,85 = 10 477,95
	assert.equal(doux.deficitSemaineKcal, 1849); // 12 327 − 10 478
	assert.equal(doux.perteGraisseKg, 0.24); // 1 849/7 700 = 0,2401
	assert.equal(doux.avertissement, null, '15 % reste dans le rythme conseillé');

	const fort = cal.bilanObjectifSemaine({ budgetSemaineKcal: 12327, deficitPct: 20 });
	assert.equal(fort.objectifSemaineKcal, 9862);
	assert.equal(fort.deficitSemaineKcal, 2465);
	assert.equal(fort.perteGraisseKg, 0.32); // 2 465/7 700 = 0,3201
	assert.ok(fort.avertissement?.includes('15'), 'l’avertissement cite le seuil de 15 %');
	assert.ok(fort.avertissement?.includes('0.32'), 'l’avertissement cite la perte estimée');

	const maintenance = cal.bilanObjectifSemaine({ budgetSemaineKcal: 11487 });
	assert.equal(maintenance.deficitSemaineKcal, 0);
	assert.equal(maintenance.perteGraisseKg, 0);
	assert.equal(maintenance.avertissement, null);
});

/* ── 7 · Refus propres des entrées invalides ── */

const refuse = (fn, motif) => {
	assert.throws(fn, (err) => {
		assert.equal(err.name, 'CalibrageError', `erreur explicite attendue (${motif})`);
		assert.ok(err.message.length > 0, 'le refus doit être expliqué');
		return true;
	});
};

test('Séances invalides refusées : BPM hors bornes, coût hors bande, sport ou intensité inconnus', () => {
	refuse(() => cal.coutSportif({ sport: 'cardio', bpm: 10 }), 'BPM trop bas');
	refuse(() => cal.coutSportif({ sport: 'cardio', bpm: 300 }), 'BPM trop haut');
	refuse(() => cal.coutSportif({ sport: 'cardio', bpm: Number.NaN }), 'BPM non fini');
	refuse(() => cal.coutSportif({ sport: 'cardio', bpm: 120, coefficientKcalKgH: 4.4 }), 'coût hors bande < 130');
	refuse(() => cal.coutSportif({ sport: 'cardio', bpm: 140, coefficientKcalKgH: 3.3 }), 'coût hors bande 130–150');
	refuse(() => cal.coutSportif({ sport: 'cardio', bpm: 155, coefficientKcalKgH: 7.7 }), 'coût hors bande 150–160');
	refuse(() => cal.coutSportif({ sport: 'cardio', bpm: 170, coefficientKcalKgH: 8.9 }), 'coût au-dessus du plafond');
	refuse(() => cal.coutSportif({ sport: 'musculation', intensite: 'extreme' }), 'intensité inconnue');
	refuse(() => cal.coutSportif({ sport: 'natation' }), 'sport inconnu');
});

test('Dépenses et semaines invalides refusées : poids, durée, listes, bornes', () => {
	refuse(() => cal.depenseSportiveKcal({ sport: 'gflux', poidsKg: -56.6, heures: 1 }), 'poids négatif');
	refuse(() => cal.depenseSportiveKcal({ sport: 'gflux', poidsKg: P, heures: -1 }), 'durée négative');
	refuse(() => cal.depenseSportiveKcal({ sport: 'gflux', poidsKg: P, heures: 25 }), 'durée hors bornes');
	refuse(() => cal.depenseSeanceKcal({ coefficientKcalKgH: 0, poidsKg: P, heures: 1 }), 'coût nul');
	refuse(() => cal.depenseSeanceKcal({ coefficientKcalKgH: Number.POSITIVE_INFINITY, poidsKg: P, heures: 1 }), 'coût infini');
	refuse(() => cal.sportSemaineKcal([125, -1]), 'séance négative');
	refuse(() => cal.sportSemaineKcal(null), 'liste absente');
	refuse(() => cal.budgetSemaineKcal({ maintenanceSansExercice: -1 }), 'maintenance négative');
	refuse(() => cal.budgetSemaineKcal({ maintenanceSansExercice: MAINTENANCE, sportSemaineKcal: -1 }), 'sport négatif');
	refuse(() => cal.objectifSemaineKcal({ budgetSemaineKcal: -1 }), 'budget négatif');
	refuse(() => cal.objectifSemaineKcal({ budgetSemaineKcal: 11487, deficitPct: -10 }), 'déficit négatif');
	refuse(() => cal.objectifSemaineKcal({ budgetSemaineKcal: 11487, deficitPct: 70 }), 'déficit hors bornes');
});
