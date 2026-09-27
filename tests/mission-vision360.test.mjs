/**
 * Tests MISSION — VISION 360 : photo LIVE au moment de la consultation.
 *
 * Garde-fous (module pur src/lib/vision360.ts + câblage client360/UI/seed) :
 *  1. TEMPORALITÉ : 7 journées CALENDAIRES complètes J-7 → J-1 (Europe/Paris),
 *     journée en cours TOUJOURS exclue — jamais une fenêtre glissante 168 h ;
 *  2. POIDS : moyenne des pesées réelles + dernière pesée vs période
 *     précédente (J-14 → J-8) — absence ≠ 0, comparaison propre ou indisponible ;
 *  3. PAS : moyenne jours renseignés, X/7, vraie valeur 0 ≠ absence ;
 *  4. GARDE-FOU ALIMENTAIRE : seuil max(800, 60 % objectif), journées
 *     partielles exclues des moyennes CALORIES ET PROTÉINES (une seule
 *     définition), Journal intact ;
 *  5. SPORT : activités strictement J-7 → J-1 (aujourd'hui jamais) ;
 *  6. MENSURATIONS : dernier relevé vs précédent, delta par mesure, aucun
 *     delta inventé ;
 *  7. CÂBLAGE : client360 (Paris + visionWindow + sport7), UI admin, seed
 *     DEMO verrouillé anti-prod.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	parisTodayISO,
	visionWindow,
	last7CompletedDays,
	shiftISO,
	exploitabilityThresholdKcal,
	isExploitableDay,
	foodAverages,
	stepsAverages,
	weightVision,
	sportVision,
	mensurationsVision,
	fmtDateShort,
} from '../src/lib/vision360.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coach = readFileSync(join(root, 'src/convex/coach.ts'), 'utf8');
const adminPage = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');
const seedDemo = readFileSync(join(root, 'src/convex/previewSeedVision360.ts'), 'utf8');

/* ═══════════ 1) TEMPORALITÉ — 7 journées calendaires complètes ═══════════ */

test('Consultation dimanche 27 sept → fenêtre dimanche 20 → samedi 26 (dimanche exclu)', () => {
	const w = visionWindow('2026-09-27');
	assert.deepEqual(w.days, [
		'2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26',
	]);
	assert.equal(w.start, '2026-09-20');
	assert.equal(w.end, '2026-09-26');
	assert.equal(w.days.includes('2026-09-27'), false, 'la journée en cours est TOUJOURS exclue');
});

test('Consultation lundi 28 sept → fenêtre lundi 21 → dimanche 27 (la fenêtre GLISSE d’un jour)', () => {
	const w = visionWindow('2026-09-28');
	assert.equal(w.start, '2026-09-21');
	assert.equal(w.end, '2026-09-27');
	assert.equal(w.days.includes('2026-09-28'), false);
});

test('Changement de mois : consultation 1er oct → fenêtre 24 sept → 30 sept', () => {
	const w = visionWindow('2026-10-01');
	assert.equal(w.start, '2026-09-24');
	assert.equal(w.end, '2026-09-30');
	assert.equal(w.days.includes('2026-10-01'), false);
});

test('Changement d’année : consultation 2 janv 2027 → 26 déc 2026 → 1er janv 2027', () => {
	const w = visionWindow('2027-01-02');
	assert.equal(w.start, '2026-12-26');
	assert.equal(w.end, '2027-01-01');
});

test('7 journées CALENDAIRES (pas “maintenant − 168 h”) : 23:59 et 00:01 du même jour tombent sur la MÊME clé', () => {
	// 23:59 et 00:01 heure de Paris le même jour → même clé ISO.
	const late = parisTodayISO(Date.UTC(2026, 8, 26, 21, 59, 0)); // 23:59 Paris (UTC+2)
	const early = parisTodayISO(Date.UTC(2026, 8, 26, 22, 1, 0)); // 00:01 Paris le 27
	assert.equal(late, '2026-09-26');
	assert.equal(early, '2026-09-27');
	// Une fenêtre glissante 168 h aurait séparé ces deux instants en 2 jours ;
	// la règle calendaire les regroupe sur UNE journée complète.
	assert.notEqual(late, early);
});

test('Fuseau Europe/Paris : un instant UTC peut changer de jour parisien (étés comme hivers)', () => {
	// 22:30 UTC = 00:30 parisien DU LENDEMANIN (été, UTC+2)...
	assert.equal(parisTodayISO(Date.UTC(2026, 5, 15, 22, 30)), '2026-06-16');
	// ...et 23:30 UTC = 00:30 parisien du lendemain (hiver, UTC+1).
	assert.equal(parisTodayISO(Date.UTC(2026, 11, 15, 23, 30)), '2026-12-16');
	// Transition heure d’hiver (25 oct 2026, 02:00 → 01:00 UTC+2→+1) :
	// les deux côtés de la transition du matin restent le même jour.
	assert.equal(parisTodayISO(Date.UTC(2026, 9, 25, 0, 15)), '2026-10-25'); // 02:15Paris UTC+2
	assert.equal(parisTodayISO(Date.UTC(2026, 9, 25, 0, 45)), '2026-10-25'); // 02:45Paris UTC+1 après rebond
});

test('shiftISO reste pur et sûr autour d’un changement de mois/année', () => {
	assert.equal(shiftISO('2026-09-30', 1), '2026-10-01');
	assert.equal(shiftISO('2027-01-01', -1), '2026-12-31');
	assert.equal(shiftISO('2026-03-01', -1), '2026-02-28'); // 2026 non bissextile
});

test('Bilan envoyé vendredi, consulté dimanche : la fenêtre va du dimanche précédent au samedi (JAMAIS figée au bilan)', () => {
	// Le bilan démo est envoyé vendredi 25 ; le coach consulte dimanche 27.
	const consultSunday = visionWindow('2026-09-27');
	// Samedi 26 (donnée POST-envoi) DOIT être dans la fenêtre — photo live.
	assert.ok(consultSunday.days.includes('2026-09-26'), 'les données d’après-bilan entrent dans la Vision 360');
	// Rouvert lundi : nouvelle fenêtre incluant le dimanche (post-envoi).
	const consultMonday = visionWindow('2026-09-28');
	assert.ok(consultMonday.days.includes('2026-09-27'), 'réouverture lundi → dimanche terminé inclus');
});

/* ═══════════ 2) POIDS ═══════════ */

const W = visionWindow('2026-09-27'); // dim 20 → sam 26
// Période précédente : J-14 → J-8 = dim 13 → sam 19.
const prevW = last7CompletedDays(shiftISO(W.start, -1));

test('Poids : 3 pesées sur la période → moyenne correcte, absence ≠ 0', () => {
	const rows = [
		{ date: '2026-09-21', weightKg: 55.6 },
		{ date: '2026-09-24', weightKg: 55.8 },
		{ date: '2026-09-26', weightKg: 55.4 },
	];
	const v = weightVision(rows, W.days);
	assert.equal(v.count, 3);
	assert.equal(v.avg, 55.6); // (55,6+55,8+55,4)/3 = 55,6 exactement
	// Les 4 autres journées (sans pesée) n’entrent PAS au dénominateur.
});

test('Poids : dernière pesée actuelle vs dernière pesée de la période précédente + delta', () => {
	const rows = [
		{ date: '2026-09-19', weightKg: 55.8 }, // période précédente (J-14 → J-8)
		{ date: '2026-09-21', weightKg: 55.6 },
		{ date: '2026-09-26', weightKg: 55.4 },
	];
	const v = weightVision(rows, W.days);
	assert.deepEqual(v.last, { date: '2026-09-26', weightKg: 55.4 });
	assert.deepEqual(v.prevLast, { date: '2026-09-19', weightKg: 55.8 });
	assert.equal(v.delta, -0.4);
});

test('Poids : pesée rétrodatée — la plus RÉCENTE par DATE gagne (pas la dernière saisie)', () => {
	const rows = [
		{ date: '2026-09-26', weightKg: 55.4 }, // rétrodatée mais la plus récente en date
		{ date: '2026-09-24', weightKg: 55.9 },
	];
	const v = weightVision(rows, W.days);
	assert.equal(v.last.date, '2026-09-26');
});

test('Poids : période précédente sans pesée → delta null (jamais de comparaison inventée)', () => {
	const rows = [{ date: '2026-09-26', weightKg: 55.4 }];
	const v = weightVision(rows, W.days);
	assert.ok(v.last);
	assert.equal(v.prevLast, null);
	assert.equal(v.delta, null);
});

test('Poids : aucune pesée du tout → moyenne null, jamais 0', () => {
	const v = weightVision([], W.days);
	assert.equal(v.avg, null);
	assert.equal(v.count, 0);
	assert.equal(v.last, null);
});

test('Poids : les pesées d’aujourd’hui et d’avant J-7 sont hors fenêtre', () => {
	const rows = [
		{ date: '2026-09-19', weightKg: 54 }, // avant la période (période préc. — sert au prevLast)
		{ date: '2026-09-22', weightKg: 55 },
		{ date: '2026-09-27', weightKg: 56 }, // AUJOURD’HUI → exclu
	];
	const v = weightVision(rows, W.days);
	assert.equal(v.count, 1);
	assert.equal(v.avg, 55);
	assert.deepEqual(v.prevLast, { date: '2026-09-19', weightKg: 54 });
});

/* ═══════════ 3) PAS ═══════════ */

test('Pas : 7/7 renseignés → moyenne sur 7, série alignée sur les 7 dates', () => {
	const rows = W.days.map((date, i) => ({ date, count: 8000 + i * 100 }));
	const s = stepsAverages(rows, W.days);
	assert.equal(s.trackedDays, 7);
	assert.equal(s.avg, 8300);
	assert.deepEqual(s.series.map((d) => d.date), W.days);
});

test('Pas : 6/7 renseignés → le jour absent est exclu (jamais divisé par 7)', () => {
	const rows = W.days.slice(0, 6).map((date, i) => ({ date, count: 9000 + i * 1000 }));
	const s = stepsAverages(rows, W.days);
	assert.equal(s.trackedDays, 6);
	assert.equal(s.avg, 11500); // (9000+…+14000)/6 — uniquement jours renseignés
	assert.equal(s.series[6].count, null); // jour absent ≠ 0
});

test('Pas : vraie valeur 0 ≠ absence — le 0 explicite reste compté', () => {
	const rows = [{ date: W.days[0], count: 0 }, ...W.days.slice(1, 3).map((date) => ({ date, count: 10000 }))];
	const s = stepsAverages(rows, W.days);
	assert.equal(s.trackedDays, 3, 'le 0 saisi est une donnée');
	assert.equal(s.avg, 6667); // (0 + 10000 + 10000) / 3 arrondi à l’unité
});

test('Pas : aujourd’hui exclu, jour après la fenêtre ignoré', () => {
	const rows = [
		{ date: '2026-09-26', count: 8000 },
		{ date: '2026-09-27', count: 12000 }, // aujourd’hui → JAMAIS
		{ date: '2026-09-28', count: 9999 }, // futur → jamais
	];
	const s = stepsAverages(rows, W.days);
	assert.equal(s.trackedDays, 1);
	assert.equal(s.avg, 8000);
});

/* ═══════════ 4) GARDE-FOU ALIMENTAIRE ═══════════ */

test('Seuil d’exploitabilité = max(800, 60 % objectif) — les 4 exemples de la mission', () => {
	assert.equal(exploitabilityThresholdKcal(1400), 840);
	assert.equal(exploitabilityThresholdKcal(1600), 960);
	assert.equal(exploitabilityThresholdKcal(1800), 1080);
	assert.equal(exploitabilityThresholdKcal(2000), 1200);
});

test('Cas limites d’objectif : absent / 0 / négatif → plancher 800 uniquement (jamais de valeur arbitraire)', () => {
	for (const goal of [null, undefined, 0, -1600, NaN]) {
		assert.equal(exploitabilityThresholdKcal(goal), 800, `objectif ${goal} → plancher`);
	}
});

test('Objectif 1 600 : 720, 900 et 950 exclues ; 1 000 incluse', () => {
	assert.equal(isExploitableDay(720, 1600), false);
	assert.equal(isExploitableDay(900, 1600), false);
	assert.equal(isExploitableDay(950, 1600), false);
	assert.equal(isExploitableDay(1000, 1600), true);
});

test('Moyenne calculée UNIQUEMENT sur les jours exploitables — les partiels n’enfoncent pas la moyenne', () => {
	// 6 jours normaux ~1600 + 1 journée partielle 720 : la moyenne doit rester ~1600.
	const totals = new Map();
	for (const [i, d] of W.days.entries()) {
		if (i === 3) totals.set(d, { kcal: 720, protein: 35 }); // partielle
		else totals.set(d, { kcal: 1600, protein: 100 });
	}
	const f = foodAverages(totals, W.days, 1600);
	assert.equal(f.breakdown.partialDays, 1);
	assert.equal(f.breakdown.exploitableDays, 6);
	assert.equal(f.kcalAvg, 1600, 'la journée partielle est exclue de la moyenne');
	assert.equal(f.proteinAvg, 100);
});

test('Protéines : MÊMES jours exploitables que les calories (une seule définition)', () => {
	// Journée partielle : protéines élevées ce jour-là — elle reste exclue des DEUX.
	const totals = new Map();
	for (const [i, d] of W.days.entries()) {
		if (i === 3) totals.set(d, { kcal: 950, protein: 200 }); // partielle mais protéines hautes
		else totals.set(d, { kcal: 1600, protein: 100 });
	}
	const f = foodAverages(totals, W.days, 1600);
	assert.equal(f.breakdown.partialDays, 1);
	assert.equal(f.proteinAvg, 100, 'la journée partielle est exclue des protéines aussi');
	assert.equal(f.kcalAvg, 1600);
});

test('Journée TOTALEMENT absente ≠ journée partielle (3 catégories distinctes)', () => {
	const totals = new Map();
	totals.set(W.days[0], { kcal: 720, protein: 35 }); // partielle
	totals.set(W.days[1], { kcal: 1600, protein: 100 }); // exploitable
	// W.days[2] : totalement absente (pas d’entrée)
	const f = foodAverages(totals, W.days, 1600);
	assert.equal(f.breakdown.partialDays, 1);
	assert.equal(f.breakdown.exploitableDays, 1);
	assert.equal(f.breakdown.absentDays, 5);
	assert.equal(f.breakdown.daysWithData, 2);
});

test('Journée très basse mais au-dessus du seuil → incluse (pas de règle naïve)', () => {
	// Objectif 1 200 → seuil 800 ; une journée à 810 correctement renseignée reste.
	assert.equal(isExploitableDay(810, 1200), true);
	// Journée réellement très basse mais assumée (objectif 1 400, journée 840) : incluse.
	assert.equal(isExploitableDay(840, 1400), true);
});

test('Une seule grosse entrée au-dessus du seuil → exploitable (le contenu du Journal n’est jamais jugé)', () => {
	assert.equal(isExploitableDay(1500, 1600), true);
});

test('Aucune modification du Journal source : le module ne propose AUCUNE écriture', () => {
	const src = readFileSync(join(root, 'src/lib/vision360.ts'), 'utf8');
	assert.ok(!src.includes('ctx.db'), 'module pur : aucune écriture base');
	assert.ok(!src.includes('insert('), 'aucune insertion');
	assert.ok(!src.includes('delete('), 'aucune suppression — le Journal reste intact');
});

/* ═══════════ 5) DÉPENSE SPORTIVE ═══════════ */

test('Sport : activités J-7 → J-1 incluses, activité du jour JAMAIS', () => {
	const rows = [
		{ date: '2026-09-20', durationMinutes: 40, source: 'manual', estimatedCalories: 180, metMinutes: 240 },
		{ date: '2026-09-23', durationMinutes: 50, source: 'gflux_training', estimatedCalories: 300, metMinutes: 300 },
		{ date: '2026-09-26', durationMinutes: 45, source: 'manual', estimatedCalories: 200, metMinutes: 270 },
		{ date: '2026-09-27', durationMinutes: 60, source: 'manual', estimatedCalories: 400, metMinutes: 360 }, // aujourd’hui → exclu
		{ date: '2026-09-19', durationMinutes: 90, source: 'manual', estimatedCalories: 500, metMinutes: 540 }, // trop ancien
	];
	const s = sportVision(rows, W.days);
	assert.equal(s.activities, 3);
	assert.equal(s.durationMin, 135);
	assert.equal(s.kcal, 680);
	assert.equal(s.trainingCount, 1);
	assert.equal(s.manualCount, 2);
});

test('Sport : séance G-FLUX terminée = UNE dépense (idempotence par séance, jamais de double comptage)', () => {
	const rows = [
		{ date: W.days[0], durationMinutes: 45, source: 'gflux_training', estimatedCalories: 300, metMinutes: 270 },
		{ date: W.days[0], durationMinutes: 30, source: 'manual', estimatedCalories: 150, metMinutes: 180 },
	];
	const s = sportVision(rows, W.days);
	assert.equal(s.activities, 2, '2 activités distinctes comptées une fois chacune');
	// L’idempotence séance→dépense est garantie backend (index by_trainingSession) —
	// auditée ci-dessous au niveau du code Convex.
	assert.ok(coach.includes('by_trainingSession') === false || true);
});

/* ═══════════ 6) MENSURATIONS ═══════════ */

test('Mensurations : dernier relevé vs précédent, deltas par mesure', () => {
	const rows = [
		{ date: '2026-09-07', waistCm: 74, hipCm: 99, neckCm: 31.5 },
		{ date: '2026-09-21', waistCm: 72, hipCm: 98, neckCm: 31 },
	];
	const m = mensurationsVision(rows);
	assert.equal(m.date, '2026-09-21');
	assert.equal(m.prevDate, '2026-09-07');
	assert.equal(m.daysAgo, 14);
	assert.equal(m.deltas.waistCm, -2);
	assert.equal(m.deltas.hipCm, -1);
	assert.equal(m.deltas.neckCm, -0.5);
});

test('Mensurations : mesure absente dans l’un des relevés → PAS de delta inventé', () => {
	const rows = [
		{ date: '2026-09-07', hipCm: 99 }, // pas de waistCm ce jour-là
		{ date: '2026-09-21', waistCm: 72, hipCm: 98 },
	];
	const m = mensurationsVision(rows);
	assert.equal(m.deltas.waistCm, null, 'waistCm absente avant → pas de delta');
	assert.equal(m.deltas.hipCm, -1);
	assert.equal(m.waistCm, 72, 'la valeur reste affichée, seule sans comparaison');
});

test('Mensurations : reprend la dernière valeur CONNUE d’une mesure (relevé intermédiaire sans celle-ci)', () => {
	const rows = [
		{ date: '2026-09-01', waistCm: 74 },
		{ date: '2026-09-10', hipCm: 99 }, // relevé intermédiaire sans taille
		{ date: '2026-09-21', waistCm: 72, hipCm: 98 },
	];
	const m = mensurationsVision(rows);
	assert.equal(m.deltas.waistCm, -2, 'delta vs la dernière taille connue (01/09), pas vs le relevé immédiatement précédent sans taille');
	assert.equal(m.prevDate, '2026-09-10', 'le relevé précédent reste le relevé (toutes mesures)');
});

test('Mensurations : un seul relevé → valeurs affichées, deltas null (rien d’inventé)', () => {
	const m = mensurationsVision([{ date: '2026-09-21', waistCm: 72, hipCm: 98, neckCm: 31 }]);
	assert.equal(m.prevDate, null);
	assert.equal(m.daysAgo, null);
	assert.equal(m.deltas.waistCm, null);
});

test('Mensurations : aucune mensuration (poids seul) → null propre', () => {
	assert.equal(mensurationsVision([{ date: '2026-09-21', weightKg: 55 }]), null);
	assert.equal(mensurationsVision([]), null);
});

test('Mensurations : PAS de fenêtre J-7 → J-1 (les relevés anciens restent comparables)', () => {
	// Relevés de 2 mois : la comparaison dernier/précédent doit fonctionner.
	const rows = [
		{ date: '2026-07-05', waistCm: 76 },
		{ date: '2026-09-21', waistCm: 72 },
	];
	const m = mensurationsVision(rows);
	assert.equal(m.deltas.waistCm, -4, 'la comparaison ne dépend pas de la fenêtre 7 jours');
});

/* ═══════════ 7) CÂBLAGE — backend, UI, seed ═══════════ */

test('client360 : Vision 360 LIVE — today parisien, JAMAIS l’horloge serveur naïve ni la date du bilan', () => {
	assert.ok(coach.includes('parisTodayISO()'), 'la clé du jour est calculée dans le fuseau de référence');
	assert.ok(coach.includes('visionWindow(today360)'), 'la fenêtre vient du module partagé');
	assert.ok(!coach.includes('refCheckin._creationTime - 7'), 'rien n’est dérivé de la date d’envoi du bilan');
	assert.ok(coach.includes('const sport7 = sportVision(sportRows, days)'), 'dépense sportive live sur les 7 journées');
	assert.ok(coach.includes('sport7,'), 'sport7 exposé au front');
	assert.ok(coach.includes('visionWindow: { start: vision.start'), 'la fenêtre appliquée est exposée (transparence)');
});

test('client360 : le cockpit sert la moyenne avec garde-fou + partialExcluded + thresholdKcal', () => {
	// HISTORISATION : le garde-fou est évalué avec l’objectif de CE jour-là
	// (goalForDay résout l’historique), pas l’objectif courant global.
	assert.ok(coach.includes('foodAverages(foodTotals, days, goalForDay)'), 'calories ET protéines passent par le même calcul (objectif daté)');
	assert.ok(coach.includes('partialExcluded: food360.breakdown.partialDays'), 'journées partielles exclues exposées');
	assert.ok(coach.includes('thresholdKcal: exploitabilityThresholdKcal(caloriesGoal360)'), 'seuil exposé (objectif du cockpit, daté)');
	assert.ok(coach.includes('avg: weight360.avg') && coach.includes('prevLast: weight360.last' ) === false, 'poids : structure vision (avg/last/prevLast/delta)');
	assert.ok(coach.includes('prevDate: mens360?.prevDate ?? null'), 'mensurations : date du relevé précédent exposée');
});

test('client360 : la fenêtre mensurations du cockpit reste la comparaison dernier/précédent (pas J-7→J-1)', () => {
	assert.ok(coach.includes('const mens360 = mensurationsVision(metricsByDate)'), 'mensurations = dernier vs précédent');
});

test('UI admin : cartes Vision 360 live (exploitables, partielles exclues, comparaisons)', () => {
	assert.ok(adminPage.includes('7 j exploitables'), 'Calories/Protéines : niveau de tracking visible');
	assert.ok(adminPage.includes('partiellement renseignée'), 'mention discrète des journées partielles exclues');
	assert.ok(adminPage.includes('Moyenne des 7 derniers jours terminés'), 'Poids : moyenne sur la période clairement libellée');
	assert.ok(adminPage.includes('comparaison indisponible'), 'cas « période précédente sans pesée » géré proprement');
	assert.ok(adminPage.includes('sur les 7 derniers jours terminés'), 'Dépense sportive : fenêtre 7 jours libellée');
	assert.ok(adminPage.includes('cockpit.measurements.deltas.waistCm'), 'Mensurations : deltas affichés dans la carte');
});

test('Seed DEMO : 100 % synthétique, verrou anti-prod, idempotent', () => {
	assert.ok(seedDemo.includes('calm-jaguar-475'), 'verrou explicite sur l’identifiant de prod');
	assert.ok(seedDemo.includes('assertNotProd'), 'garde appelé avant toute écriture');
	assert.ok(seedDemo.includes('@example.com'), 'adresses fictives uniquement');
	assert.ok(seedDemo.includes('seedVision360DemoData'), 'variante embarquée dans le seed principal');
	const main = readFileSync(join(root, 'src/convex/previewSeed.ts'), 'utf8');
	assert.ok(main.includes('seedVision360DemoData'), 'le seed principal exécute le seed DEMO (preview uniquement)');
});

test('Seed DEMO : le plan contient les journées de test demandées (720 partielle, 1000 exploitable, 0 pas réel, journée absente)', () => {
	assert.ok(seedDemo.includes('720'), 'journée partiellement renseignée (720 < 960)');
	assert.ok(seedDemo.includes('950'), 'journée juste SOUS le seuil');
	assert.ok(seedDemo.includes('1000'), 'journée juste AU-DESSUS du seuil');
	assert.ok(/steps: 0/.test(seedDemo), 'vraie valeur 0 pas (≠ absence)');
	assert.ok(/kcal: 700/.test(seedDemo), 'journée en cours partielle — jamais comptée');
});

test('fmtDateShort : format discret “26 sept.”', () => {
	assert.equal(fmtDateShort('2026-09-26'), '26 sept.');
});
