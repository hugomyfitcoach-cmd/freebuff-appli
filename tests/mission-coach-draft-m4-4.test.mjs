/**
 * MISSION M4-4 — MENSURATIONS HORS SEMAINE ET COMPLÉTUDE DU SUIVI.
 *
 * Aucun appel réseau, aucune donnée réelle, aucune écriture Convex :
 *  - la VRAIE query `coachDraft.loadContext` est exécutée contre une base
 *    Convex simulée, le même jour (clé Europe/Paris) ;
 *  - les mensurations ne partent vers l'assistant QUE si le dernier relevé
 *    est daté de J-7 à J (aujourd'hui inclus) : J-11 → rien du tout, J-3 →
 *    transmis ; « Oui » sans relevé sur la fenêtre → indicateur à true ;
 *  - calories, protéines et pas transmettent le nombre de jours
 *    exploitables/renseignés sur 7, avec un marqueur de complétude :
 *    1/7 → donnée marquée insuffisante (aucun jugement sur la moyenne),
 *    5/7 → « sur 5 jours » ;
 *  - les règles 11 et 12 du guide sont dans le .md source, dans la copie
 *    serveur et dans le prompt envoyé au modèle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadContext } from '../src/convex/coachDraft.ts';
import { client360 } from '../src/convex/coach.ts';
import { hashToken, addDaysISO } from '../src/convex/helpers.ts';
import {
	freshMensurationsVision,
	isMensurationFresh,
	parisTodayISO,
	trackingCompleteness,
} from '../src/lib/vision360.ts';
import { buildCoachDraftPrompt } from '../src/convex/coachDraftPrompt.ts';
import { COACH_DRAFT_STYLE_GUIDE } from '../src/lib/data/coachDraftStyleGuide.ts';
import { COACH_DRAFT_METHOD_REFERENCE } from '../src/convex/ai/methodeGflux.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

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

/* ═════════════════ 1) JEU DE DONNÉES — MÊME JOUR, VARIANTES ═════════════════ */

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
};
const session = {
	_id: 's1',
	_creationTime: 1,
	tokenHash: await hashToken('tok-m44'),
	userId: 'coach1',
	expiresAt: Date.now() + 86_400_000,
};

let entrySeq = 0;
const entry = (date, kcal, protein) => ({
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
});

/** Base complète, paramétrée : réponses du bilan, mensurations, jours alimentaires. */
function makeTables({ answers = {}, weightMetrics = [], mensurations = [], food = [], steps = [] } = {}) {
	return {
		users: [coach, lea],
		sessions: [session],
		checkins: [
			{
				_id: 'checkin1',
				_creationTime: 100,
				userId: 'client1',
				weekStart: '2026-10-05',
				weekLabel: 'S41 - 05 oct. 2026',
				status: 'nouveau',
				answers,
			},
		],
		diaryEntries: food,
		clientGoals: [
			{ _id: 'g1', _creationTime: 1, userId: 'client1', kcal: 1800, carbs: 200, protein: 120, fat: 60, stepGoal: 10000 },
		],
		clientGoalHistory: [],
		dailySteps: steps,
		bodyMetrics: [
			...weightMetrics.map((m, i) => ({
				_id: `w${i + 1}`,
				_creationTime: 10 + i,
				userId: 'client1',
				createdAt: 10 + i,
				...m,
			})),
			...mensurations.map((m, i) => ({
				_id: `m${i + 1}`,
				_creationTime: 20 + i,
				userId: 'client1',
				createdAt: 20 + i,
				...m,
			})),
		],
		sportActivities: [],
		appointments: [],
	};
}

const runLoadContext = (tables) =>
	loadContext._handler({ db: makeDb(tables) }, { sessionToken: 'tok-m44', checkinId: 'checkin1' });

const runClient360 = (tables) =>
	client360._handler({ db: makeDb(tables) }, { sessionToken: 'tok-m44', userId: 'client1' });

function buildPrompt(context) {
	return buildCoachDraftPrompt({
		context,
		styleGuide: COACH_DRAFT_STYLE_GUIDE,
		methodReference: COACH_DRAFT_METHOD_REFERENCE,
		examples: [],
		targetWords: 150,
	});
}

/* ═══════════════ 2) FENÊTRE DE FRAÎCHEUR — J-7 À J ═══════════════ */

test('Mensurations : fenêtre de fraîcheur J-7 → J (aujourd’hui inclus)', () => {
	assert.equal(isMensurationFresh(day(0), todayISO), true, 'relevé du jour : transmis');
	assert.equal(isMensurationFresh(day(-3), todayISO), true, 'relevé à J-3 : transmis');
	assert.equal(isMensurationFresh(day(-7), todayISO), true, 'borne basse J-7 : transmise');
	assert.equal(isMensurationFresh(day(-8), todayISO), false, 'J-8 : hors fenêtre');
	assert.equal(isMensurationFresh(day(-11), todayISO), false, 'J-11 : hors fenêtre');
});

test('Mensurations : relevé à J-11 non transmis, relevé à J-3 transmis (même comparaison que la carte)', () => {
	const rows = [
		{ date: day(-20), waistCm: 76 },
		{ date: day(-11), waistCm: 74, hipCm: 98 },
	];
	assert.equal(freshMensurationsVision(rows, todayISO), null, 'relevé trop ancien → rien ne part');

	const fresh = [
		{ date: day(-20), waistCm: 76 },
		{ date: day(-3), waistCm: 72, hipCm: 96 },
	];
	const vision = freshMensurationsVision(fresh, todayISO);
	assert.ok(vision, 'relevé frais transmit');
	assert.equal(vision.date, day(-3));
	assert.equal(vision.prevDate, day(-20), 'comparaison avec le relevé précédent, comme la carte');
	assert.equal(vision.waistCm, 72);
	assert.equal(vision.deltas.waistCm, -4);
	assert.equal(freshMensurationsVision([], todayISO), null, 'aucun relevé → null');
	assert.equal(freshMensurationsVision([{ date: day(-3), weightKg: 61 }], todayISO), null, 'poids seul ≠ mensurations');
});

/* ═══════════════ 3) CONTEXTE ENVOYÉ — MENSURATIONS ═══════════════ */

test('Contexte : relevé à J-11 → mensurations ABSENTES du payload et du prompt', async () => {
	const tables = makeTables({ mensurations: [{ date: day(-20), waistCm: 76 }, { date: day(-11), waistCm: 74 }] });
	const context = await runLoadContext(tables);
	assert.equal(context.stats.mensurations, null, 'aucune donnée de mensurations transmise');
	assert.equal(context.stats.mensurationsAttenduesNonSaisies, false, 'pas de réponse « oui »');
	const prompt = buildPrompt(context);
	assert.ok(!prompt.includes('- Mensurations : dernier relevé le'), 'aucune ligne de relevé dans le prompt');
	assert.ok(!prompt.includes('74 cm'), 'aucune valeur ancienne transmise');
	assert.ok(prompt.includes('aucun relevé disponible sur les 7 derniers jours'), 'absence explicite');
});

test('Contexte : relevé à J-3 → mensurations transmises avec leur écart', async () => {
	const tables = makeTables({ mensurations: [{ date: day(-20), waistCm: 76 }, { date: day(-3), waistCm: 72, hipCm: 96 }] });
	const context = await runLoadContext(tables);
	assert.ok(context.stats.mensurations, 'relevé frais transmis');
	assert.equal(context.stats.mensurations.date, day(-3));
	assert.equal(context.stats.mensurations.waistCm, 72);
	assert.equal(context.stats.mensurations.deltas.waistCm, -4);
	const prompt = buildPrompt(context);
	assert.ok(prompt.includes('tour de taille 72 cm'), 'valeur transmise au modèle');
	assert.ok(prompt.includes(`- Mensurations : dernier relevé le ${day(-3).split('-').reverse().join('/')}`), 'date du relevé frais');
});

test('Contexte : « Oui » sans relevé dans la fenêtre → mensurationsAttenduesNonSaisies à true', async () => {
	const tables = makeTables({
		answers: { mensurations: 'oui' },
		mensurations: [{ date: day(-20), waistCm: 76 }, { date: day(-11), waistCm: 74 }],
	});
	const context = await runLoadContext(tables);
	assert.equal(context.stats.mensurations, null);
	assert.equal(context.stats.mensurationsAttenduesNonSaisies, true, 'indicateur simple pour une relance courte');
	const prompt = buildPrompt(context);
	assert.ok(prompt.includes("l'inviter en UNE phrase courte à saisir ses mensurations"), 'invitation prévue');
	assert.ok(!prompt.includes('74 cm'), 'aucune valeur ancienne transmise');

	// Relevé frais + « Oui » → indicateur à false (rien à relancer).
	const fresh = await runLoadContext(
		makeTables({ answers: { mensurations: 'oui' }, mensurations: [{ date: day(-20), waistCm: 76 }, { date: day(-3), waistCm: 72 }] })
	);
	assert.equal(fresh.stats.mensurationsAttenduesNonSaisies, false);
});

/* ═══════════════ 4) CONTEXTE ENVOYÉ — COMPLÉTUDE DU SUIVI ═══════════════ */

test('Complétude : seuils 4 et 7 jours', () => {
	assert.equal(trackingCompleteness(0), 'insufficient');
	assert.equal(trackingCompleteness(1), 'insufficient');
	assert.equal(trackingCompleteness(3), 'insufficient');
	assert.equal(trackingCompleteness(4), 'partial');
	assert.equal(trackingCompleteness(6), 'partial');
	assert.equal(trackingCompleteness(7), 'complete');
});

test('Complétude : 1/7 jour de calories → donnée marquée insuffisante, aucun jugement sur la moyenne', async () => {
	const tables = makeTables({ food: [entry(day(-4), 1500, 100)], steps: [{ _id: 'st1', _creationTime: 1, userId: 'client1', date: day(-4), count: 8000 }] });
	const context = await runLoadContext(tables);
	assert.equal(context.stats.week.food.exploitableDays, 1);
	assert.equal(context.stats.week.food.completeness, 'insufficient');
	assert.equal(context.stats.week.steps.completeness, 'insufficient', '1/7 jour de pas aussi');

	const prompt = buildPrompt(context);
	assert.ok(
		prompt.includes('suivi insuffisant (1 jour(s) exploitable(s) sur 7) : ne commente PAS la moyenne'),
		'calories marquées insuffisantes, sans jugement sur la moyenne'
	);
	assert.ok(prompt.includes('suivi insuffisant (1 jour(s) renseigné(s) sur 7)'), 'pas marqués insuffisants');
	assert.ok(!prompt.includes('sur 1 jours »'), 'aucune invitation à commenter la moyenne');
});

test('Complétude : 5/7 jours exploitables → nombre de jours transmis (« sur 5 jours »)', async () => {
	const food = [day(-7), day(-6), day(-5), day(-4), day(-3)].map((d) => entry(d, 1500, 100));
	const tables = makeTables({ food });
	const context = await runLoadContext(tables);
	assert.equal(context.stats.week.food.exploitableDays, 5);
	assert.equal(context.stats.week.food.completeness, 'partial');
	assert.ok(context.stats.week.steps.trackedDays === 0, 'aucun pas renseigné');

	const prompt = buildPrompt(context);
	assert.ok(prompt.includes('sur 5 jour(s) exploitable(s)'), 'nombre de jours transmis');
	assert.ok(prompt.includes('moyenne à commenter en précisant « sur 5 jours »'), 'consigne adaptée');
	assert.ok(!prompt.includes('suivi insuffisant (5'), 'pas marqué insuffisant');

	// Les mêmes compteurs que la carte du bilan.
	const card = await runClient360(tables);
	assert.equal(context.stats.week.food.exploitableDays, card.cockpit.calories.trackedDays);
});

/* ═══════════════ 5) GUIDE DE STYLE — RÈGLES 11 ET 12 ═══════════════ */

const RULE_MENSURATIONS =
	"11. **Mensurations hors semaine** : ne parle des mensurations que si le dernier relevé est daté de J-7 à J (aujourd'hui inclus).";
const RULE_COMPLETENESS = "12. **Complétude du suivi** : moins de 4 jours exploitables sur 7";

test('Guide : les règles 11 (mensurations) et 12 (complétude) sont dans les Règles prioritaires', () => {
	const markdown = read('docs/guide-style-retours.md');
	const priorities = markdown.slice(
		markdown.indexOf('## Règles prioritaires'),
		markdown.indexOf('## 1. Structure type')
	);
	assert.ok(priorities.includes(RULE_MENSURATIONS), 'règle 11 dans le .md source');
	assert.ok(priorities.includes(RULE_COMPLETENESS), 'règle 12 dans le .md source');
	assert.ok(
		priorities.includes('L’appréciation d’ouverture (« très bonne semaine ») ne s’appuie jamais sur une donnée dont le suivi est inférieur à 4 jours.') ||
			priorities.includes("L'appréciation d'ouverture (« très bonne semaine ») ne s'appuie jamais sur une donnée dont le suivi est inférieur à 4 jours."),
		'ouverture jamais appuyée sur moins de 4 jours'
	);
});

test('Copie serveur : les règles 11 et 12 voyagent dans COACH_DRAFT_STYLE_GUIDE et dans le prompt', async () => {
	assert.ok(COACH_DRAFT_STYLE_GUIDE.includes(RULE_MENSURATIONS), 'règle 11 dans la copie serveur');
	assert.ok(COACH_DRAFT_STYLE_GUIDE.includes(RULE_COMPLETENESS), 'règle 12 dans la copie serveur');
	const context = await runLoadContext(makeTables({ food: [entry(day(-4), 1500, 100)] }));
	const prompt = buildPrompt(context);
	assert.ok(prompt.includes(RULE_MENSURATIONS), 'règle 11 transmise au modèle');
	assert.ok(prompt.includes(RULE_COMPLETENESS), 'règle 12 transmise au modèle');
	assert.ok(
		prompt.includes("L'appréciation d'ouverture (« très bonne semaine ») ne s'appuie jamais"),
		'consigne d’ouverture transmise au modèle'
	);
});
