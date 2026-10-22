/**
 * MISSION M4-3 — LE BROUILLON ET LA CARTE DU BILAN AFFICHENT LES MÊMES CHIFFRES.
 *
 * Aucun appel réseau, aucune donnée réelle, aucune écriture Convex :
 *  - la VRAIE query `coachDraft.loadContext` et la VRAIE query
 *    `coach.client360` (source de la carte du bilan) sont exécutées contre la
 *    même base Convex simulée, le MÊME jour ;
 *  - les fenêtres sont vérifiées : calories, protéines, jours exploitables,
 *    pas, sport et poids moyen sur les 7 derniers jours terminés (J-7 → J-1,
 *    aujourd'hui exclu), comparaison sur J-14 → J-8 ;
 *  - la dernière pesée et l'écart sont les DEUX pesées les plus récentes,
 *    toutes dates, aujourd'hui inclus ;
 *  - la phase de cycle est la même que celle affichée par la carte.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadContext } from '../src/convex/coachDraft.ts';
import { client360 } from '../src/convex/coach.ts';
import { hashToken, addDaysISO } from '../src/convex/helpers.ts';
import { last7CompletedDays, parisTodayISO, shiftISO } from '../src/lib/vision360.ts';
import { cycleState } from '../src/lib/cycle.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ═════════════ 0) BASE CONVEX SIMULÉE (get + withIndex + order) ═════════════ */

function makeDb(tables) {
	const query = (table) => {
		let rows = (tables[table] ?? []).map((r) => ({ ...r }));
		const chain = {
			withIndex(_name, builder) {
				const constraints = [];
				const recorder = {};
				for (const op of ['eq', 'gte', 'lte', 'gt', 'lt']) {
					recorder[op] = (field, value) => {
						constraints.push([field, op, value]);
						return recorder;
					};
				}
				builder(recorder);
				rows = rows.filter((r) =>
					constraints.every(([field, op, value]) => {
						const v = r[field];
						if (op === 'eq') return v === value;
						if (op === 'gte') return v >= value;
						if (op === 'lte') return v <= value;
						if (op === 'gt') return v > value;
						return v < value;
					})
				);
				return chain;
			},
			order(dir) {
				rows = [...rows].sort((a, b) => (a._creationTime - b._creationTime) * (dir === 'desc' ? -1 : 1));
				return chain;
			},
			collect: async () => rows,
			first: async () => rows[0] ?? null,
			unique: async () => rows[0] ?? null,
		};
		return chain;
	};
	return {
		query,
		async get(id) {
			for (const rows of Object.values(tables)) {
				const found = rows.find((r) => r._id === id);
				if (found) return { ...found };
			}
			return null;
		},
	};
}

/* ═════════════ 1) JEU DE DONNÉES — MÊME JOUR, DEUX FENÊTRES ═════════════ */

// Le jour de référence est celui de la carte (Europe/Paris), pas une date
// figée : les fenêtres restent relatives au jour de la consultation.
const todayISO = parisTodayISO();
const day = (offset) => addDaysISO(todayISO, offset);

const coach = {
	_id: 'coach1',
	_creationTime: 1,
	email: 'hugo@coaching.test',
	nom: 'Dupont',
	prenom: 'Hugo',
	role: 'coach',
	passwordHash: 'x',
};
const lea = {
	_id: 'client1',
	_creationTime: 2,
	email: 'lea@cliente.test',
	nom: 'Élise',
	prenom: 'Léa',
	role: 'client',
	passwordHash: 'x',
	createdBy: 'coach1',
	cycle: { contra: 'none', noDate: false, lmp: day(-12), len: 28, updatedAt: 1 },
};
const session = {
	_id: 's1',
	_creationTime: 1,
	tokenHash: await hashToken('tok-coach'),
	userId: 'coach1',
	expiresAt: Date.now() + 86_400_000,
};
const checkin = {
	_id: 'checkin1',
	_creationTime: 100,
	userId: 'client1',
	weekStart: '2026-10-05',
	weekLabel: 'S41 - 05 oct. 2026',
	status: 'nouveau',
	answers: {},
};

/** Entrée de journal : `date`, kcal et protéines répartis sur un repas. */
let entrySeq = 0;
const entry = (date, kcal, protein, mealGroup) => ({
	_id: `e${++entrySeq}`,
	_creationTime: 200 + entrySeq,
	userId: 'client1',
	date,
	meal: 'dejeuner',
	name: 'Plat',
	qtyGrams: 100,
	carbs: 0,
	fat: 0,
	kcal,
	protein,
	...(mealGroup ? { mealGroup } : {}),
});

// Objectif calorique 1 800 kcal jusqu'à J-3, puis 1 700 : la fenêtre traverse
// un changement d'objectif → seuil d'exploitabilité évalué JOUR PAR JOUR.
const diaryEntries = [
	entry(day(-7), 900, 60, 'analyse:a1'), // 1 100 kcal → exploitable (seuil 1 080)
	entry(day(-7), 200, 10),
	entry(day(-6), 1500, 120), // exploitable
	entry(day(-5), 1000, 80), // partiel (< 1 080)
	entry(day(-4), 1600, 130), // exploitable
	entry(day(-3), 1050, 95), // exploitable seulement avec le seuil de 1 020
	entry(day(-2), 900, 70), // partiel (< 1 020)
	entry(day(-1), 1100, 100), // exploitable
	entry(day(0), 2000, 150), // AUJOURD'HUI : jamais dans la fenêtre
	entry(day(-14), 1200, 90), // fenêtre de comparaison
	entry(day(-9), 1300, 100),
];

const bodyMetrics = [
	// Mensurations : dernier relevé vs précédent (fenêtre indépendante).
	{ _id: 'm0', _creationTime: 1, userId: 'client1', date: day(-30), weightKg: 63, waistCm: 75, createdAt: 1 },
	{ _id: 'm1', _creationTime: 2, userId: 'client1', date: day(-9), weightKg: 62, createdAt: 2 },
	{ _id: 'm2', _creationTime: 3, userId: 'client1', date: day(-4), weightKg: 61.6, createdAt: 3 },
	{ _id: 'm3', _creationTime: 4, userId: 'client1', date: day(-1), weightKg: 61.2, waistCm: 72, hipCm: 96, neckCm: 30, createdAt: 4 },
	// Pesée du JOUR : elle compte pour la dernière pesée et l'écart (carte
	// comme brouillon), jamais dans la moyenne des 7 jours terminés.
	{ _id: 'm4', _creationTime: 5, userId: 'client1', date: day(0), weightKg: 61, createdAt: 5 },
];

const tables = {
	users: [coach, lea],
	sessions: [session],
	checkins: [checkin],
	diaryEntries,
	clientGoals: [{ _id: 'g1', _creationTime: 1, userId: 'client1', kcal: 1800, carbs: 200, protein: 120, fat: 60, stepGoal: 10000 }],
	clientGoalHistory: [{ _id: 'gh1', _creationTime: 1, userId: 'client1', kcal: 1700, effectiveFrom: day(-3) }],
	dailySteps: [
		{ _id: 'st1', _creationTime: 1, userId: 'client1', date: day(-7), count: 9000 },
		{ _id: 'st2', _creationTime: 2, userId: 'client1', date: day(-6), count: 11000 },
		{ _id: 'st3', _creationTime: 3, userId: 'client1', date: day(-5), count: 8000 },
		{ _id: 'st4', _creationTime: 4, userId: 'client1', date: day(-3), count: 12000 },
		{ _id: 'st5', _creationTime: 5, userId: 'client1', date: day(-1), count: 7000 },
		{ _id: 'st6', _creationTime: 6, userId: 'client1', date: day(0), count: 15000 },
		{ _id: 'st7', _creationTime: 7, userId: 'client1', date: day(-14), count: 6000 },
		{ _id: 'st8', _creationTime: 8, userId: 'client1', date: day(-9), count: 8000 },
	],
	bodyMetrics,
	sportActivities: [
		{ _id: 'sp1', _creationTime: 1, userId: 'client1', date: day(-7), durationMinutes: 60, source: 'gflux_training', estimatedCalories: 400, metMinutes: 360 },
		{ _id: 'sp2', _creationTime: 2, userId: 'client1', date: day(-3), durationMinutes: 30, source: 'manual', estimatedCalories: 200, metMinutes: 180 },
		{ _id: 'sp3', _creationTime: 3, userId: 'client1', date: day(-1), durationMinutes: 45, source: 'manual', estimatedCalories: 300, metMinutes: 250 },
		{ _id: 'sp4', _creationTime: 4, userId: 'client1', date: day(0), durationMinutes: 90, source: 'manual', estimatedCalories: 700, metMinutes: 600 },
		{ _id: 'sp5', _creationTime: 5, userId: 'client1', date: day(-11), durationMinutes: 30, source: 'manual', estimatedCalories: 250, metMinutes: 180 },
	],
	appointments: [],
};

const runLoadContext = () =>
	loadContext._handler({ db: makeDb(tables) }, { sessionToken: 'tok-coach', checkinId: 'checkin1' });

const runClient360 = () =>
	client360._handler({ db: makeDb(tables) }, { sessionToken: 'tok-coach', userId: 'client1' });

/* ═══════════════════ 2) IDENTITÉ DES CHIFFRES, MÊME JOUR ═══════════════════ */

test('Brouillon et carte du bilan : mêmes fenêtres, mêmes chiffres le même jour', async () => {
	const draft = await runLoadContext();
	const card = await runClient360();
	const cockpit = card.cockpit;
	assert.ok(cockpit, 'la carte du bilan est calculée pour le bilan le plus récent');

	// FENÊTRES — 7 derniers jours terminés (J-7 → J-1) et J-14 → J-8.
	const currentDays = last7CompletedDays(todayISO);
	assert.deepEqual(draft.stats.week.days, currentDays, 'brouillon : J-7 → J-1');
	assert.equal(cockpit.visionWindow.start, currentDays[0], 'carte : début de la fenêtre');
	assert.equal(cockpit.visionWindow.end, currentDays[currentDays.length - 1], 'carte : fin de la fenêtre');
	assert.equal(cockpit.visionWindow.today, todayISO, 'carte : jour de consultation');
	assert.equal(draft.stats.previousWeek.start, shiftISO(currentDays[0], -7), 'brouillon : J-14');
	assert.equal(draft.stats.previousWeek.end, shiftISO(currentDays[0], -1), 'brouillon : J-8');

	// CALORIES / PROTÉINES / JOURS EXPLOITABLES — mêmes valeurs des deux côtés.
	assert.equal(draft.stats.week.food.kcalAvg, cockpit.calories.avg);
	assert.equal(draft.stats.week.food.exploitableDays, cockpit.calories.trackedDays);
	assert.equal(draft.stats.week.food.partialDays, cockpit.calories.partialExcluded);
	assert.equal(draft.stats.week.food.absentDays, cockpit.calories.absentDays);
	assert.equal(draft.stats.week.food.goalKcal, cockpit.calories.goal);
	assert.equal(draft.stats.week.food.thresholdKcal, cockpit.calories.thresholdKcal);
	assert.equal(draft.stats.week.food.proteinAvg, cockpit.protein.avg);
	assert.equal(draft.stats.week.food.goalProtein, cockpit.protein.goal);

	// PAS ET SPORT.
	assert.equal(draft.stats.week.steps.avg, cockpit.steps.avg);
	assert.equal(draft.stats.week.steps.trackedDays, cockpit.steps.trackedDays);
	assert.equal(draft.stats.week.steps.goal, cockpit.steps.goal);
	assert.equal(draft.stats.week.sport.activities, card.sport7.activities);
	assert.equal(draft.stats.week.sport.durationMin, card.sport7.durationMin);
	assert.equal(draft.stats.week.sport.kcal, card.sport7.kcal);
	assert.equal(draft.stats.week.sport.metMinutes, card.sport7.metMinutes);

	// POIDS — moyenne des 7 jours terminés, puis les DEUX pesées les plus
	// récentes (aujourd'hui inclus) pour la dernière pesée et l'écart.
	assert.equal(draft.stats.week.weight.avg, cockpit.weight.avg);
	assert.equal(draft.stats.week.weight.count, cockpit.weight.count);
	assert.deepEqual(draft.stats.week.weight.last, cockpit.weight.last);
	assert.deepEqual(draft.stats.week.weight.prevLast, cockpit.weight.prevLast);
	assert.equal(draft.stats.week.weight.delta, cockpit.weight.delta);
	assert.deepEqual(draft.stats.weightTrend.last, cockpit.weight.last);
	assert.equal(draft.stats.weightTrend.gapKg, cockpit.weight.delta);

	// Valeurs attendues, calculées à la main : le test n'est pas complaisant
	// (deux fenêtres vides donneraient aussi null === null).
	assert.equal(cockpit.calories.avg, 1270, 'moyenne des 5 journées exploitables');
	assert.equal(cockpit.calories.trackedDays, 5);
	assert.equal(cockpit.calories.partialExcluded, 2);
	assert.equal(cockpit.calories.absentDays, 0);
	assert.equal(cockpit.calories.goal, 1700, 'objectif de la dernière journée de la fenêtre');
	assert.equal(cockpit.calories.thresholdKcal, 1020, 'max(800 ; 60 % de 1 700)');
	assert.deepEqual(cockpit.calories.distinctGoals, [1800, 1700], 'changement d’objectif dans la fenêtre');
	assert.equal(cockpit.calories.goalChanged, true);
	assert.equal(cockpit.protein.avg, 103);
	assert.equal(cockpit.steps.avg, 9400);
	assert.equal(cockpit.steps.trackedDays, 5);
	assert.deepEqual(
		{ activities: card.sport7.activities, durationMin: card.sport7.durationMin, kcal: card.sport7.kcal, metMinutes: card.sport7.metMinutes },
		{ activities: 3, durationMin: 135, kcal: 900, metMinutes: 790 }
	);
	assert.equal(cockpit.weight.avg, 61.4, 'moyenne des pesées de J-7 → J-1');
	assert.equal(cockpit.weight.count, 2);
	assert.deepEqual(cockpit.weight.last, { date: todayISO, weightKg: 61 }, 'pesée du jour incluse');
	assert.deepEqual(cockpit.weight.prevLast, { date: day(-1), weightKg: 61.2 });
	assert.equal(cockpit.weight.delta, -0.2, 'écart entre les deux pesées les plus récentes');
	// La journée en cours ne pèse pas dans la fenêtre : 2 000 kcal et 15 000
	// pas saisis aujourd'hui ne modifient ni les moyennes ni les totaux.
	assert.notEqual(draft.stats.week.food.kcalAvg, 1392);
	assert.notEqual(cockpit.steps.avg, 10333);

	// Semaine de comparaison : J-14 → J-8.
	assert.equal(draft.stats.previousWeek.food.kcalAvg, 1250);
	assert.equal(draft.stats.previousWeek.food.proteinAvg, 95);
	assert.equal(draft.stats.previousWeek.steps.avg, 7000);
	assert.equal(draft.stats.previousWeek.sport.durationMin, 30);
	assert.equal(draft.stats.deltas.kcalAvg, 20);
	assert.equal(draft.stats.deltas.proteinAvg, 8);
	assert.equal(draft.stats.deltas.stepsAvg, 2400);
	assert.equal(draft.stats.deltas.sportDurationMin, 105);
});

test('Cycle : la phase du brouillon est celle que la carte affiche, calculée aujourd’hui', async () => {
	const draft = await runLoadContext();
	const cardCycle = cycleState(lea.cycle);
	assert.equal(cardCycle.kind, 'tracked');
	assert.equal(draft.cycle.kind, 'tracked');
	assert.equal(draft.cycle.phaseLabel, cardCycle.label);
	assert.equal(draft.cycle.cycleDay, cardCycle.cycleDay);
});
