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

import { contextPreview, loadContext } from '../src/convex/coachDraft.ts';
import { client360 } from '../src/convex/coach.ts';
import { hashToken, addDaysISO } from '../src/convex/helpers.ts';
import {
	freshMensurationsVision,
	isMensurationFresh,
	parisTodayISO,
	trackingCompleteness,
} from '../src/lib/vision360.ts';
import {
	buildCoachDraftPrompt,
	NOT_TRANSMITTED_INSUFFICIENT,
	NOT_TRANSMITTED_STALE,
} from '../src/convex/coachDraftPrompt.ts';
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

/** Panneau « Voir les données envoyées à l'assistant » (query + vue de transmission). */
const runContextPreview = (tables) =>
	contextPreview._handler(
		{ runQuery: async (_ref, args) => loadContext._handler({ db: makeDb(tables) }, args) },
		{ sessionToken: 'tok-m44', checkinId: 'checkin1' }
	);

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

test('Mensurations, rythme de 15 jours : J-7 → J transmis, J-14 → J-8 silencieux, au-delà relance', async () => {
	// J-11 (dans les temps) : rien n'est transmis, aucune relance — même si
	// la cliente a répondu « Oui » (l'indicateur ne dépend plus de la réponse).
	const enTemps = await runLoadContext(
		makeTables({
			answers: { mensurations: 'oui' },
			mensurations: [{ date: day(-20), waistCm: 76 }, { date: day(-11), waistCm: 74 }],
		})
	);
	assert.equal(enTemps.stats.mensurations, null, 'aucune donnée transmise');
	assert.equal(enTemps.stats.mensurationsAttenduesNonSaisies, false, 'J-11 : pas d’indicateur');
	let prompt = buildPrompt(enTemps);
	assert.ok(!prompt.includes("l'inviter en UNE phrase courte à saisir ses mensurations"), 'aucune invitation');
	assert.ok(prompt.includes('aucune relance'), 'le contexte dit de ne pas relancer');
	assert.ok(!prompt.includes('74 cm'), 'aucune valeur ancienne transmise');

	// J-16 (dernier relevé antérieur à J-14) : indicateur à true + invitation.
	const enRetard = await runLoadContext(
		makeTables({ mensurations: [{ date: day(-30), waistCm: 78 }, { date: day(-16), waistCm: 76 }] })
	);
	assert.equal(enRetard.stats.mensurationsAttenduesNonSaisies, true, 'J-16 : indicateur à true');
	prompt = buildPrompt(enRetard);
	assert.ok(prompt.includes("l'inviter en UNE phrase courte à saisir ses mensurations"), 'invitation prévue');

	// Aucun relevé (même avec une réponse « non ») : indicateur à true.
	const aucun = await runLoadContext(makeTables({ answers: { mensurations: 'non' } }));
	assert.equal(aucun.stats.mensurationsAttenduesNonSaisies, true, 'aucun relevé : indicateur à true');

	// Relevé frais : indicateur à false.
	const frais = await runLoadContext(makeTables({ mensurations: [{ date: day(-3), waistCm: 72 }] }));
	assert.equal(frais.stats.mensurationsAttenduesNonSaisies, false);
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
		prompt.includes('moyenne NON transmise — suivi insuffisant (1 jour(s) exploitable(s) sur 7)'),
		'calories marquées insuffisantes, sans moyenne transmise'
	);
	assert.ok(
		prompt.includes('moyenne NON transmise — suivi insuffisant (1 jour(s) renseigné(s) sur 7)'),
		'pas marqués insuffisants, sans moyenne transmise'
	);
	assert.ok(!prompt.includes('sur 1 jours »'), 'aucune invitation à commenter la moyenne');
	assert.ok(!prompt.includes('moyenne 1 500 kcal'), 'aucune moyenne calorique dans le prompt');
	assert.ok(!prompt.includes('moyenne 8 000 pas'), 'aucune moyenne de pas dans le prompt');
});

test('Suivi insuffisant : ni moyenne ni écart pour calories, protéines et pas', async () => {
	// Semaine courante : 1 jour de calories et 1 jour de pas. Semaine de
	// comparaison : complète, donc seule la semaine courante bloque l'écart.
	const food = [entry(day(-4), 1500, 100), ...[day(-14), day(-13), day(-12), day(-11), day(-10), day(-9), day(-8)].map((d) => entry(d, 1400, 90))];
	const steps = [
		{ _id: 'st-cur', _creationTime: 1, userId: 'client1', date: day(-4), count: 8000 },
		...[-14, -13, -12, -11, -10, -9, -8].map((offset, i) => ({
			_id: `st-prev-${i}`,
			_creationTime: 10 + i,
			userId: 'client1',
			date: day(offset),
			count: 9000,
		})),
	];
	const context = await runLoadContext(makeTables({ food, steps }));
	assert.equal(context.stats.week.food.completeness, 'insufficient');
	assert.equal(context.stats.week.steps.completeness, 'insufficient');
	assert.equal(context.stats.previousWeek.food.completeness, 'complete');
	assert.notEqual(context.stats.deltas.kcalAvg, null, 'écart calculé par le code, mais pas transmis');

	const prompt = buildPrompt(context);
	// Ni moyenne ni écart pour les trois données au suivi insuffisant.
	assert.ok(!prompt.includes('moyenne 1 500 kcal'), 'aucune moyenne calorique');
	assert.ok(!prompt.includes('moyenne 100 g'), 'aucune moyenne de protéines');
	assert.ok(!prompt.includes('moyenne 8 000 pas'), 'aucune moyenne de pas');
	assert.ok(!/^- Calories : [+-]/m.test(prompt), 'aucun écart calorique');
	assert.ok(!/^- Protéines : [+-]/m.test(prompt), 'aucun écart de protéines');
	assert.ok(!/^- Pas : [+-]/m.test(prompt), 'aucun écart de pas');
	// Seuls le nombre de jours, le statut et l'explication restent transmis.
	assert.ok(prompt.includes('(1 jour(s) exploitable(s) sur 7)'), 'nombre de jours de calories');
	assert.ok(prompt.includes('(1 jour(s) renseigné(s) sur 7)'), 'nombre de jours de pas');
	assert.ok(
		prompt.includes('- Écart non transmis (calories/protéines et pas)'),
		'l’absence d’écart est expliquée, jamais un zéro inventé'
	);
});

test('Semaine de comparaison insuffisante : pas d’écart, moyenne de la semaine en cours conservée', async () => {
	// Semaine courante : 5 jours exploitables (suffisant). Semaine de
	// comparaison : 2 jours seulement → aucun écart calorique ni protéique.
	const food = [
		...[day(-7), day(-6), day(-5), day(-4), day(-3)].map((d) => entry(d, 1500, 100)),
		entry(day(-11), 1400, 90),
		entry(day(-10), 1400, 90),
	];
	const stepRows = [...[-14, -13, -12, -11, -10, -9, -8], ...[-7, -6, -5, -4, -3, -2, -1]].map((offset, i) => ({
		_id: `st-${i}`,
		_creationTime: 10 + i,
		userId: 'client1',
		date: day(offset),
		// Deux semaines complètes mais différentes : l'écart de pas existe.
		count: offset <= -8 ? 8000 : 10000,
	}));
	const context = await runLoadContext(makeTables({ food, steps: stepRows }));
	assert.equal(context.stats.week.food.completeness, 'partial', 'semaine courante suffisante');
	assert.equal(context.stats.previousWeek.food.completeness, 'insufficient', 'comparaison trop courte');
	assert.notEqual(context.stats.deltas.kcalAvg, null, 'écart calculé mais non transmis');

	const prompt = buildPrompt(context);
	assert.ok(prompt.includes('moyenne 1 500 kcal'), 'moyenne de la semaine en cours conservée');
	assert.ok(prompt.includes('« sur 5 jours »'), 'moyenne commentée sur 5 jours');
	assert.ok(!/^- Calories : [+-]/m.test(prompt), 'aucun écart calorique');
	assert.ok(!/^- Protéines : [+-]/m.test(prompt), 'aucun écart de protéines');
	assert.ok(
		prompt.includes('- Écart non transmis (calories/protéines)'),
		'écart alimentaire retiré, pas de zéro inventé'
	);
	// Les pas, suffisants des deux côtés, gardent leur écart.
	assert.ok(/^- Pas : [+-]/m.test(prompt), 'écart de pas transmis quand les deux semaines sont suffisantes');
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

test('Ouverture : données partielles → consigne d’ouverture factuelle dans le prompt', async () => {
	// 5/7 jours de calories, aucun pas : une donnée commentée est partielle.
	const food = [day(-7), day(-6), day(-5), day(-4), day(-3)].map((d) => entry(d, 1500, 100));
	const partiel = await runLoadContext(makeTables({ food }));
	assert.equal(partiel.stats.ouvertureFactuelle, true, 'données partielles');
	let prompt = buildPrompt(partiel);
	assert.ok(
		prompt.includes('Ouverture : FACTUELLE obligatoire'),
		'consigne d’ouverture factuelle transmise au modèle'
	);
	assert.ok(
		prompt.includes('aucune appréciation globale'),
		'aucune appréciation globale tant qu’une donnée est partielle'
	);
	assert.ok(
		prompt.includes('« bonne semaine côté activité »'),
		'formulations globales explicitement interdites'
	);

	// 7/7 jours de calories ET de pas : toutes les données commentées sont complètes.
	const semaine = [day(-7), day(-6), day(-5), day(-4), day(-3), day(-2), day(-1)];
	const complet = await runLoadContext(
		makeTables({
			food: semaine.map((d) => entry(d, 1500, 100)),
			steps: semaine.map((d, i) => ({ _id: `stc-${i}`, _creationTime: 10 + i, userId: 'client1', date: d, count: 9000 })),
		})
	);
	assert.equal(complet.stats.ouvertureFactuelle, false, 'données complètes');
	prompt = buildPrompt(complet);
	assert.ok(prompt.includes('une appréciation globale est possible'), 'verdict global autorisé');
	assert.ok(!prompt.includes('Ouverture : FACTUELLE obligatoire'));
});

/* ═══════════════ 5) ÉCART DE PESÉE — FENÊTRE J-7 → J ═══════════════ */

test('Pesée à J-10 : aucun écart transmis, indicateur peseeRecenteAbsente et invitation à se peser', async () => {
	const tables = makeTables({
		weightMetrics: [
			{ date: day(-17), weightKg: 62.4 },
			{ date: day(-10), weightKg: 61.9 },
		],
	});
	const context = await runLoadContext(tables);
	assert.equal(context.stats.peseeRecenteAbsente, true, 'dernière pesée hors fenêtre');
	// La moyenne J-7 → J-1 et la dernière pesée restent des faits calculés ;
	// c'est l'ÉCART qui n'est pas transmis.
	assert.equal(context.stats.week.weight.avg, null, 'aucune pesée dans J-7 → J-1');
	assert.deepEqual(context.stats.weightTrend.last, { date: day(-10), weightKg: 61.9 }, 'dernière pesée connue conservée');

	const prompt = buildPrompt(context);
	assert.ok(!prompt.includes('- Tendance de poids :'), 'aucune ligne de tendance');
	assert.ok(!/écart [-+]?\d/.test(prompt), 'aucun écart de pesée dans le prompt');
	assert.ok(prompt.includes("l'inviter en UNE phrase courte à se peser"), 'invitation à se peser');

	// Le panneau montre la valeur retirée, pas l'écart calculé.
	const preview = await runContextPreview(tables);
	assert.equal(preview.stats.weightTrend.gapKg, NOT_TRANSMITTED_STALE);
	assert.equal(preview.stats.week.weight.delta, NOT_TRANSMITTED_STALE);
});

test('Pesée du jour : l’écart dernière pesée vs précédente est transmis', async () => {
	const tables = makeTables({
		weightMetrics: [
			{ date: day(-5), weightKg: 62 },
			{ date: day(0), weightKg: 61.5 },
		],
	});
	const context = await runLoadContext(tables);
	assert.equal(context.stats.peseeRecenteAbsente, false);
	assert.equal(context.stats.weightTrend.gapKg, -0.5, 'écart calculé par le code');
	assert.equal(context.stats.week.weight.avg, 62, 'moyenne J-7 → J-1 inchangée');

	const prompt = buildPrompt(context);
	assert.ok(
		prompt.includes('- Tendance de poids : dernière pesée 61,5 kg le ' + day(0).split('-').reverse().join('/')),
		'écart transmis avec ses deux dates'
	);
	assert.ok(!prompt.includes("l'inviter en UNE phrase courte à se peser"), 'aucune invitation inutile');
});

/* ═══════════ 6) PANNEAU CRM — CE QUI EST RETIRÉ EST AFFICHÉ COMME TEL ═══════════ */

test('Panneau : suivi insuffisant et relevé trop ancien affichent « non transmis »', async () => {
	const tables = makeTables({
		food: [entry(day(-4), 1500, 100)],
		steps: [{ _id: 'st1', _creationTime: 1, userId: 'client1', date: day(-4), count: 8000 }],
		mensurations: [{ date: day(-20), waistCm: 76 }, { date: day(-11), waistCm: 74 }],
		weightMetrics: [{ date: day(-10), weightKg: 61.9 }],
	});
	const preview = await runContextPreview(tables);
	const week = preview.stats.week;

	// Suivi insuffisant : nombre de jours conservé, valeur remplacée.
	assert.equal(week.food.exploitableDays, 1, 'nombre de jours toujours visible');
	assert.equal(week.food.kcalAvg, NOT_TRANSMITTED_INSUFFICIENT);
	assert.equal(week.food.proteinAvg, NOT_TRANSMITTED_INSUFFICIENT);
	assert.equal(week.steps.avg, NOT_TRANSMITTED_INSUFFICIENT);
	assert.equal(week.steps.trackedDays, 1);
	assert.equal(preview.stats.deltas.kcalAvg, NOT_TRANSMITTED_INSUFFICIENT);
	assert.equal(preview.stats.deltas.stepsAvg, NOT_TRANSMITTED_INSUFFICIENT);

	// Relevés trop anciens : mensurations et écart de pesée.
	assert.equal(preview.stats.mensurations, NOT_TRANSMITTED_STALE);
	assert.equal(preview.stats.weightTrend.gapKg, NOT_TRANSMITTED_STALE);
	assert.equal(week.weight.delta, NOT_TRANSMITTED_STALE);

	// Les données transmises restent des valeurs, jamais des sentinelles.
	assert.equal(typeof week.sport.activities, 'number');
	assert.equal(typeof week.steps.goal, 'number');
});

test('Panneau : données suffisantes et relevés frais → valeurs conservées', async () => {
	const food = [day(-7), day(-6), day(-5), day(-4), day(-3)].map((d) => entry(d, 1500, 100));
	const tables = makeTables({
		food,
		weightMetrics: [{ date: day(-5), weightKg: 62 }, { date: day(0), weightKg: 61.5 }],
		mensurations: [{ date: day(-20), waistCm: 76 }, { date: day(-3), waistCm: 72 }],
	});
	const preview = await runContextPreview(tables);
	assert.equal(preview.stats.week.food.kcalAvg, 1500, 'moyenne conservée');
	assert.equal(typeof preview.stats.week.food.kcalAvg, 'number', 'aucune sentinelle');
	assert.equal(preview.stats.weightTrend.gapKg, -0.5, 'écart conservé');
	assert.equal(preview.stats.mensurations.waistCm, 72, 'mensurations conservées');
});

/* ═══════════════ 7) GUIDE DE STYLE — RÈGLES 11, 12 ET 13 ═══════════════ */

const RULE_MENSURATIONS =
	"11. **Mensurations, rythme de 15 jours** : ne parle des mensurations que si le dernier relevé est daté de J-7 à J (aujourd'hui inclus)";
const RULE_COMPLETENESS = "12. **Complétude du suivi** : moins de 4 jours exploitables sur 7";
const RULE_FRESHNESS =
	"13. **Fraîcheur des relevés** : l'écart entre la dernière pesée et la précédente ne se commente que si la dernière pesée est datée de J-7 à J (aujourd'hui inclus).";

test('Guide : les règles 11 (mensurations) et 12 (complétude) sont dans les Règles prioritaires', () => {
	const markdown = read('docs/guide-style-retours.md');
	const priorities = markdown.slice(
		markdown.indexOf('## Règles prioritaires'),
		markdown.indexOf('## 1. Structure type')
	);
	assert.ok(priorities.includes(RULE_MENSURATIONS), 'règle 11 dans le .md source');
	assert.ok(priorities.includes(RULE_COMPLETENESS), 'règle 12 dans le .md source');
	assert.ok(priorities.includes(RULE_FRESHNESS), 'règle 13 (fraîcheur des relevés) dans le .md source');
	assert.ok(priorities.includes('seules celles de J-7 à J sont mentionnées'), 'photos : même fenêtre');
	assert.ok(
		priorities.includes("L'appréciation d'ouverture (« très bonne semaine », « bonne semaine côté activité »…)"),
		'appréciation globale nommée explicitement'
	);
	assert.ok(
		priorities.includes('est interdite dès qu’une donnée commentée est partielle ou insuffisante') ||
			priorities.includes("est interdite dès qu'une donnée commentée est partielle ou insuffisante"),
		'aucune appréciation globale sur une donnée partielle (< 7 jours)'
	);
	assert.ok(
		priorities.includes("ouvre directement sur un fait, par exemple la tendance de poids"),
		'ouverture factuelle imposée'
	);
});

test('Copie serveur : les règles 11 et 12 voyagent dans COACH_DRAFT_STYLE_GUIDE et dans le prompt', async () => {
	assert.ok(COACH_DRAFT_STYLE_GUIDE.includes(RULE_MENSURATIONS), 'règle 11 dans la copie serveur');
	assert.ok(COACH_DRAFT_STYLE_GUIDE.includes(RULE_COMPLETENESS), 'règle 12 dans la copie serveur');
	assert.ok(COACH_DRAFT_STYLE_GUIDE.includes(RULE_FRESHNESS), 'règle 13 dans la copie serveur');
	const context = await runLoadContext(makeTables({ food: [entry(day(-4), 1500, 100)] }));
	const prompt = buildPrompt(context);
	assert.ok(prompt.includes(RULE_MENSURATIONS), 'règle 11 transmise au modèle');
	assert.ok(prompt.includes(RULE_COMPLETENESS), 'règle 12 transmise au modèle');
	assert.ok(prompt.includes(RULE_FRESHNESS), 'règle 13 transmise au modèle');
	assert.ok(
		prompt.includes("L'appréciation d'ouverture (« très bonne semaine ») ne s'appuie jamais"),
		'consigne d’ouverture transmise au modèle'
	);
});
