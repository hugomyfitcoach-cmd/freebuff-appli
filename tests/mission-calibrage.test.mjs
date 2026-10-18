/**
 * Mission C1 : MODULE DE CALIBRAGE — tests dorés.
 *
 * Objectif : verrouiller les formules du référentiel dans UN module pur
 * (`src/lib/calibrage.ts`), importable à l'identique par le serveur SvelteKit
 * et par les fonctions Convex (aucun import Convex/SvelteKit/DOM, aucun état).
 *
 * Repère doré : P 56,6 kg · MG% 26 · C 1,40 · A 0
 *   → MM 41,88 kg · MB 1 172 kcal · maintenance 1 641 kcal ·
 *     seuils de disponibilité 1 257 / 1 005 kcal · Alpert 0,74 ·
 *     Macdonald 0,98 kg/semaine.
 * Semaine dorée : R = 1 300 kcal chaque jour, E = 1 000 kcal un seul jour
 *   → déficit −3 387 kcal · graisse −0,44 kg ·
 *     disponibilité 7,16 kcal/kg MM le jour sport, 31,04 les autres.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

/** Module PUR importé directement (comme les fonctions Convex le feront). */
const cal = await import(new URL('../src/lib/calibrage.ts', import.meta.url).href);

/* Repère doré, partagé par les tests. */
const P = 56.6;
const MG_PCT = 26;
const C = 1.4;
const A = 0;
const MAINTENANCE = 1641;

const profil = cal.profilCalibrage({ poidsKg: P, mgPct: MG_PCT, coefficient: C, adaptationPct: A });

/* ── 1 · Composition corporelle, métabolisme de base, maintenance ── */

test('P 56,6 / MG% 26 → MM 41,88 kg et MG 14,72 kg', () => {
	assert.equal(profil.masseMaigreKg, 41.88);
	assert.equal(profil.masseGrasseKg, 14.72);
	/* Valeurs brutes (non arrondies) : 41,884 kg et 14,716 kg — l'arrondi n'a
	   lieu qu'en sortie, pour ne pas décaler les seuils calculés ensuite. */
	assert.equal(cal.masseMaigreBrute(P, MG_PCT), P * (1 - MG_PCT / 100));
	assert.equal(cal.masseGrasseBrute(P, MG_PCT), (P * MG_PCT) / 100);
});

test('P 56,6 / MG% 26 → MB 1 172 kcal (MM × 26,4 + MG × 4,5)', () => {
	/* 41,884 × 26,4 + 14,716 × 4,5 = 1 171,9596 → 1 172 */
	assert.equal(profil.metabolismeBaseKcal, 1172);
	assert.equal(Math.round(cal.metabolismeBaseBrut(P, MG_PCT)), 1172);
});

test('C 1,40 / A 0 → maintenance 1 641 kcal = arrondi(C × MB)', () => {
	assert.equal(profil.maintenanceKcal, MAINTENANCE);
	assert.equal(cal.maintenanceKcal({ poidsKg: P, mgPct: MG_PCT, coefficient: C }), MAINTENANCE);
});

test("A = 12 % → l'adaptation est retirée APRÈS l'arrondi de C × MB", () => {
	/* arrondi(1,40 × 1 171,9596) = 1 641 ; 1 641 − 1 171,9596 × 12/100 = 1 500,36 */
	assert.equal(cal.maintenanceKcal({ poidsKg: P, mgPct: MG_PCT, coefficient: C, adaptationPct: 12 }), 1500.36);
});

test('Objectif sans exercice = arrondi(maintenance − L × 7700/7)', () => {
	assert.equal(cal.objectifSansExerciceKcal(MAINTENANCE, 0.5), 1091); // 1 641 − 550
	assert.equal(cal.objectifSansExerciceKcal(MAINTENANCE, 1), 541); // 1 641 − 1 100
	assert.equal(cal.objectifSansExerciceKcal(MAINTENANCE, 0), MAINTENANCE);
	assert.equal(
		cal.profilCalibrage({ poidsKg: P, mgPct: MG_PCT, coefficient: C, perteKgSemaine: 0.5 })
			.objectifSansExerciceKcal,
		1091
	);
	assert.equal(profil.objectifSansExerciceKcal, null, 'sans perte visée, aucun objectif n’est inventé');
});

/* ── 2 · Seuils de disponibilité et vitesses maximales de perte ── */

test('Seuils de disponibilité = MM × 30 et MM × 24 (sur la masse maigre BRUTE)', () => {
	/* 41,884 × 30 = 1 256,52 → 1 257 ; 41,884 × 24 = 1 005,216 → 1 005 */
	assert.equal(profil.seuilDisponibiliteHautKcal, 1257);
	assert.equal(profil.seuilDisponibiliteBasKcal, 1005);
	assert.deepEqual(cal.seuilsDisponibiliteKcal(cal.masseMaigreBrute(P, MG_PCT)), {
		haut: 1257,
		bas: 1005
	});
});

test('Vitesse maximale de perte : Alpert 0,74 et Macdonald 0,98 kg/semaine', () => {
	/* Alpert : 56,6 × 26/20/100 = 0,7358 → 0,74 · Macdonald : /15 → 0,981 → 0,98 */
	assert.equal(profil.vitesseMaxAlpertKgSemaine, 0.74);
	assert.equal(profil.vitesseMaxMacdonaldKgSemaine, 0.98);
});

/* ── 3 · Déficit journalier, semaine, graisse, disponibilité ── */

test('Déficit du jour = R − (maintenance + E)', () => {
	assert.equal(cal.deficitJourKcal({ apportKcal: 1300, maintenance: MAINTENANCE }), -341);
	assert.equal(cal.deficitJourKcal({ apportKcal: 1300, maintenance: MAINTENANCE, exerciceKcal: 1000 }), -1341);
	assert.equal(cal.deficitJourKcal({ apportKcal: 2000, maintenance: MAINTENANCE }), 359);
});

test('Semaine R = 1 300 chaque jour, E = 1 000 un seul jour → déficit −3 387 kcal · graisse −0,44 kg', () => {
	const semaine = cal.bilanSemaine({
		jours: [
			{ apportKcal: 1300, exerciceKcal: 1000 },
			{ apportKcal: 1300 },
			{ apportKcal: 1300 },
			{ apportKcal: 1300 },
			{ apportKcal: 1300 },
			{ apportKcal: 1300 },
			{ apportKcal: 1300 }
		],
		maintenance: MAINTENANCE,
		masseMaigreKg: cal.masseMaigreBrute(P, MG_PCT)
	});
	assert.equal(semaine.deficitSemaineKcal, -3387); // −1 341 + 6 × (−341)
	assert.equal(semaine.graisseKg, -0.44); // −3 387 / 7 700
	assert.equal(semaine.disponibilitesKcal.length, 7);
});

test('Disponibilité en énergie = (R − E)/MM → 7,16 le jour sport, 31,04 les autres', () => {
	const mm = cal.masseMaigreBrute(P, MG_PCT);
	assert.equal(cal.disponibiliteEnergieKcal({ apportKcal: 1300, exerciceKcal: 1000, masseMaigreKg: mm }), 7.16);
	assert.equal(cal.disponibiliteEnergieKcal({ apportKcal: 1300, masseMaigreKg: mm }), 31.04);

	const semaine = cal.bilanSemaine({
		jours: [
			{ apportKcal: 1300, exerciceKcal: 1000 },
			{ apportKcal: 1300 },
			{ apportKcal: 1300 },
			{ apportKcal: 1300 },
			{ apportKcal: 1300 },
			{ apportKcal: 1300 },
			{ apportKcal: 1300 }
		],
		maintenance: MAINTENANCE,
		masseMaigreKg: mm
	});
	assert.equal(semaine.disponibilitesKcal[0], 7.16);
	for (const jour of [1, 2, 3, 4, 5, 6]) {
		assert.equal(semaine.disponibilitesKcal[jour], 31.04);
	}
});

/* ── 4 · Coefficient NEAT ── */

test('NEAT pas : 10 000 → 1,25 et 16 000 → 1,40 (1 + pas × 0,000025)', () => {
	assert.equal(cal.coefficientNeat({ pas: 10000 }), 1.25);
	assert.equal(cal.coefficientNeat({ pas: 16000 }), 1.4);
	assert.equal(cal.coefficientNeat({}), 1, 'aucune activité → coefficient neutre 1');
});

test('NEAT mode de vie : 10 000 pas + 5 h debout en remuant + 5 h assise en remuant → 1,63', () => {
	assert.equal(
		cal.coefficientNeat({ pas: 10000, heuresDeboutEnRemuant: 5, heuresAssiseEnRemuant: 5 }),
		1.63
	);
	/* Coefficients horaires du référentiel, vérifiés un par un. */
	assert.equal(cal.coefficientNeat({ heuresAssiseEnRemuant: 10 }), 1.26);
	assert.equal(cal.coefficientNeat({ heuresDeboutStatique: 8 }), 1.052);
	assert.equal(cal.coefficientNeat({ heuresDeboutEnRemuant: 8 }), 1.4);
	/* Supplément « mode de vie » saisi (points de coefficient) — cumulable. */
	assert.equal(cal.coefficientNeat({ pas: 10000, supplementModeVie: 0.1 }), 1.35);
	assert.equal(cal.coefficientNeat({ supplementModeVie: 0.05 }), 1.05);
});

/* ── 5 · MG% par mensurations (US Navy) ── */

test('US Navy femme : cou 31 · taille 70 · hanches 94 · stature 161 → 25,9 %', () => {
	assert.equal(
		cal.masseGrasseUSNavy({
			sexe: 'femme',
			tourCouCm: 31,
			tourTailleCm: 70,
			tourHanchesCm: 94,
			statureCm: 161
		}),
		25.9
	);
});

test('US Navy homme : formule sans tour de hanches (taille − cou)', () => {
	/* 495/(1,0324 − 0,19077 × log10(88 − 38) + 0,15456 × log10(178)) − 450 = 18,70 → 18,7 % */
	assert.equal(
		cal.masseGrasseUSNavy({ sexe: 'homme', tourCouCm: 38, tourTailleCm: 88, statureCm: 178 }),
		18.7
	);
});

/* ── 6 · Refus propres des entrées invalides ── */

const refuse = (fn, motif) => {
	assert.throws(fn, (err) => {
		assert.equal(err.name, 'CalibrageError', `erreur explicite attendue (${motif})`);
		assert.ok(err.message.length > 0, 'le refus doit être expliqué');
		return true;
	});
};

test('Les entrées négatives sont refusées (poids, pas, heures, kcal, perte visée)', () => {
	refuse(() => cal.profilCalibrage({ poidsKg: -56.6, mgPct: MG_PCT, coefficient: C }), 'poids négatif');
	refuse(() => cal.masseMaigreBrute(56.6, -1), 'MG% négative');
	refuse(() => cal.coefficientNeat({ pas: -1 }), 'pas négatifs');
	refuse(() => cal.coefficientNeat({ heuresAssiseEnRemuant: -2 }), 'heures négatives');
	refuse(() => cal.coefficientNeat({ supplementModeVie: -0.1 }), 'supplément négatif');
	refuse(() => cal.deficitJourKcal({ apportKcal: -1300, maintenance: MAINTENANCE }), 'apport négatif');
	refuse(() => cal.deficitJourKcal({ apportKcal: 1300, maintenance: -1 }), 'maintenance négative');
	refuse(() => cal.objectifSansExerciceKcal(MAINTENANCE, -0.5), 'perte visée négative');
	refuse(
		() =>
			cal.bilanSemaine({
				jours: [
					{ apportKcal: 1300 },
					{ apportKcal: 1300 },
					{ apportKcal: 1300 },
					{ apportKcal: -1300 },
					{ apportKcal: 1300 },
					{ apportKcal: 1300 },
					{ apportKcal: 1300 }
				],
				maintenance: MAINTENANCE,
				masseMaigreKg: 41.884
			}),
		'jour négatif'
	);
});

test('MG% hors 5–60 est refusée (entrée comme résultat de mensurations)', () => {
	for (const valeur of [4.9, 0, 61, 100]) {
		refuse(() => cal.profilCalibrage({ poidsKg: P, mgPct: valeur, coefficient: C }), `MG% ${valeur}`);
	}
	refuse(
		() => cal.masseGrasseUSNavy({ sexe: 'femme', tourCouCm: 90, tourTailleCm: 70, tourHanchesCm: 94, statureCm: 161 }),
		'mensurations incohérentes (cou > taille + hanches − cou)'
	);
});

test('Coefficient, adaptation, valeurs non finies et sexe inconnu sont refusés', () => {
	refuse(() => cal.profilCalibrage({ poidsKg: P, mgPct: MG_PCT, coefficient: 0 }), 'coefficient 0');
	refuse(() => cal.profilCalibrage({ poidsKg: P, mgPct: MG_PCT, coefficient: 99 }), 'coefficient absurde');
	refuse(
		() => cal.profilCalibrage({ poidsKg: P, mgPct: MG_PCT, coefficient: C, adaptationPct: -5 }),
		'adaptation négative'
	);
	refuse(() => cal.masseMaigreBrute(Number.NaN, MG_PCT), 'NaN');
	refuse(() => cal.masseMaigreBrute(P, Number.POSITIVE_INFINITY), 'infini');
	refuse(
		() => cal.masseGrasseUSNavy({ sexe: 'autre', tourCouCm: 31, tourTailleCm: 70, statureCm: 161 }),
		'sexe inconnu'
	);
});

test('Une semaine incomplète est refusée (le bilan se calcule sur 7 jours pleins)', () => {
	refuse(
		() =>
			cal.bilanSemaine({
				jours: [{ apportKcal: 1300 }, { apportKcal: 1300 }],
				maintenance: MAINTENANCE,
				masseMaigreKg: 41.884
			}),
		'2 jours au lieu de 7'
	);
});

/* ── 7 · Module partageable SvelteKit ↔ Convex (pureté) ── */

test('Le module est PUR : aucun import Convex / SvelteKit / DOM / env, aucun état', () => {
	const source = readFileSync(join(root, 'src/lib/calibrage.ts'), 'utf8');
	/* Les commentaires décrivent le partage (et citent `$lib/`) : on ne teste
	   que le CODE réellement exécuté. */
	const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
	for (const interdit of [
		'convex/',
		'./_generated',
		'$app/',
		'$env/',
		'$lib/',
		'window.',
		'globalThis',
		'process.env',
		'import.meta.env'
	]) {
		assert.ok(!code.includes(interdit), `aucune dépendance « ${interdit} » dans un module partagé`);
	}
	assert.equal(/^\s*import\s/m.test(code), false, 'le module n’importe rien : même code des deux côtés');
	assert.equal(code.includes('export default'), false, 'exports nommés uniquement (Convex et Vite les résolvent pareil)');
});
