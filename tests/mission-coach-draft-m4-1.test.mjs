/**
 * MISSION M4-1 — RÈGLES DE STYLE DU COACH (retour de Hugo sur les brouillons).
 *
 * Aucun appel réseau réel, aucune donnée réelle, aucune écriture Convex.
 * Couverture demandée :
 *  - guide de style : section « Règles prioritaires » et exemple de référence
 *    du coach présents (source .md ET copie serveur envoyée au modèle) ;
 *  - contexte : écart entre la dernière pesée et la pesée précédente, et poids
 *    moyen du bilan précédent — y compris quand ces données sont absentes ;
 *  - arrondis avant envoi (kcal à la dizaine, protéines au gramme, poids à la
 *    centaine de grammes, pas à la centaine) ;
 *  - température basse transmise au fournisseur (régularité) ;
 *  - interface : indicateur « Préparation du brouillon… » et bouton désactivé
 *    pendant la génération.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildCoachDraftPrompt, roundToStep } from '../src/convex/coachDraftPrompt.ts';
import { loadContext, weightTrendFacts } from '../src/convex/coachDraft.ts';
import { COACH_DRAFT_MODEL_ENV, generateText } from '../src/convex/ai/provider.ts';
import { COACH_DRAFT_TEMPERATURE } from '../src/lib/server/openai.ts';
import { COACH_DRAFT_STYLE_GUIDE } from '../src/lib/data/coachDraftStyleGuide.ts';
import { COACH_DRAFT_METHOD_REFERENCE } from '../src/convex/ai/methodeGflux.ts';
import { hashToken } from '../src/convex/helpers.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const fixturesDir = join(root, 'tests/fixtures/coach-draft');
const fileExamples = JSON.parse(read('src/lib/data/coach-feedback-examples.json'));

const contextOf = (file) => JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));

function buildFor(context) {
	return buildCoachDraftPrompt({
		context,
		styleGuide: COACH_DRAFT_STYLE_GUIDE,
		methodReference: COACH_DRAFT_METHOD_REFERENCE,
		examples: [...fileExamples, ...context.examples],
		targetWords: 150,
	});
}

/* ═════════ 1) GUIDE DE STYLE — RÈGLES PRIORITAIRES ET EXEMPLE DU COACH ═════════ */

const REFERENCE_EXAMPLE =
	'Salut {{prenom}}, Bilan bien reçu. Très bonne semaine, avec une tendance de poids en -200 g par rapport à ta dernière pesée. La moyenne calorique est à 1 590, sur l\'objectif de 1 750, donc c\'est vraiment très bien. Ta moyenne de pas, aussi sur ce que tu as renseigné, est plutôt pas mal. L\'objectif de protéines est respecté aussi. Les dernières mensurations sont vraiment encourageantes. On ne touche à rien et on continue sur cette lancée. Passe un bon dimanche. :)';

test('Guide de style : la section « Règles prioritaires » est en tête, avec les règles du retour de Hugo', () => {
	const markdown = read('docs/guide-style-retours.md');
	const priorities = markdown.indexOf('## Règles prioritaires');
	assert.ok(priorities > 0, 'section « Règles prioritaires » présente');
	assert.ok(
		priorities < markdown.indexOf('## 1. Structure type'),
		'les règles prioritaires ouvrent le guide, avant la structure type'
	);
	assert.ok(markdown.includes('4 à 6 phrases'), 'longueur : 4 à 6 phrases');
	assert.ok(markdown.includes('2 courts paragraphes maximum'), 'au plus 2 courts paragraphes');
	assert.ok(markdown.includes('le verdict de la semaine'), 'verdict dès la première phrase');
	assert.ok(markdown.includes('kcal à la dizaine'), 'kcal arrondies à la dizaine');
	assert.ok(markdown.includes('à la centaine de grammes'), 'poids à la centaine de grammes');
	assert.ok(markdown.includes('pas à la centaine'), 'pas à la centaine');
	assert.ok(
		markdown.includes('QUE si la tendance stagne ou remonte'),
		'jours non renseignés : seulement si la tendance stagne ou remonte'
	);
	assert.ok(
		markdown.includes('Si la tendance baisse ou si les mensurations baissent : féliciter, ne rien pointer'),
		'tendance en baisse : féliciter, ne rien pointer'
	);
	assert.ok(
		markdown.includes('« On ne touche à rien et on continue sur cette lancée » ou l\'ajustement proposé'),
		'décision claire toujours présente'
	);
	assert.ok(markdown.includes('Pas de « focus » imposé quand tout va bien'), 'aucun focus imposé');
	assert.ok(markdown.includes('Passe un bon dimanche :)'), 'fin chaleureuse liée au moment');
	assert.ok(
		markdown.includes('Jamais « Si tu as une question, n\'hésite pas »'),
		'clôture bannie explicitement'
	);
});

test('Guide de style : l\u2019exemple de référence est la version du coach, au mot près', () => {
	const markdown = read('docs/guide-style-retours.md');
	assert.ok(markdown.includes(REFERENCE_EXAMPLE), 'exemple de référence présent dans le .md');
	// Copie serveur : c'est elle qui part dans le prompt.
	assert.ok(COACH_DRAFT_STYLE_GUIDE.includes('## Règles prioritaires'), 'règles dans la copie serveur');
	assert.ok(COACH_DRAFT_STYLE_GUIDE.includes(REFERENCE_EXAMPLE), 'exemple dans la copie serveur');
	// L'exemple est aussi transmis au modèle dans chaque prompt.
	const prompt = buildFor(contextOf('progression.context.json'));
	assert.ok(prompt.includes(REFERENCE_EXAMPLE), 'exemple de référence dans le prompt');
	assert.ok(prompt.includes('Règles prioritaires'), 'règles prioritaires signalées dans les consignes');
});

/* ═══════════ 2) ÉCART DE PESÉE — DANS LE CONTEXTE, Y COMPRIS ABSENT ═══════════ */

test('Écart de pesée : les deux dernières pesées, toutes dates confondues + poids moyen du bilan précédent', () => {
	const rows = [
		{ date: '2026-09-23', weightKg: 61.62 },
		{ date: '2026-09-25', weightKg: 61.48 },
		{ date: '2026-10-10', weightKg: 61.22 },
	];
	const trend = weightTrendFacts(rows, { weekLabel: 'S39 - 21 sept. 2026', weekStart: '2026-09-21' });
	assert.deepEqual(trend.last, { date: '2026-10-10', weightKg: 61.22 });
	assert.deepEqual(trend.previous, { date: '2026-09-25', weightKg: 61.48 });
	assert.equal(trend.gapKg, -0.26, 'écart calculé par le code entre les deux dernières pesées');
	// Poids moyen de la SEMAINE du bilan précédent (21 → 27 sept.) : 61,62 et 61,48.
	assert.deepEqual(trend.prevCheckin, {
		weekLabel: 'S39 - 21 sept. 2026',
		avgKg: 61.6,
		count: 2,
	});
	// Désordre d'insertion : le tri se fait sur les dates, pas sur la saisie.
	const shuffled = weightTrendFacts([rows[2], rows[0], rows[1]], null);
	assert.deepEqual(shuffled.last, { date: '2026-10-10', weightKg: 61.22 });
	assert.equal(shuffled.gapKg, -0.26);
	assert.equal(shuffled.prevCheckin, null, 'aucun bilan précédent → absent explicite');
});

test('Écart de pesée absent : moins de deux pesées ou bilan précédent sans pesée — jamais un zéro inventé', () => {
	assert.deepEqual(weightTrendFacts([], null), {
		last: null,
		previous: null,
		gapKg: null,
		prevCheckin: null,
	});
	const one = weightTrendFacts([{ date: '2026-10-10', weightKg: 61.22 }], null);
	assert.deepEqual(one.last, { date: '2026-10-10', weightKg: 61.22 });
	assert.equal(one.previous, null);
	assert.equal(one.gapKg, null, 'une seule pesée → pas d\u2019écart');
	const noWeighing = weightTrendFacts([], {
		weekLabel: 'S39 - 21 sept. 2026',
		weekStart: '2026-09-21',
	});
	assert.deepEqual(noWeighing.prevCheckin, {
		weekLabel: 'S39 - 21 sept. 2026',
		avgKg: null,
		count: 0,
	});
});

/* ── Même fait, via la VRAIE query loadContext (base Convex simulée) ── */

/** `ctx.db` minimal dans la veine de mission-coach-draft-m2 (filtres réels). */
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

const coach = { _id: 'coach1', _creationTime: 1, email: 'hugo@coaching.test', nom: 'Dupont', prenom: 'Hugo', role: 'coach', passwordHash: 'x' };
const client = {
	_id: 'client1',
	_creationTime: 2,
	email: 'lea@cliente.test',
	nom: 'Élise',
	prenom: 'Léa',
	role: 'client',
	passwordHash: 'x',
	createdBy: 'coach1',
};
const checkinCurrent = {
	_id: 'checkin1',
	_creationTime: 100,
	userId: 'client1',
	weekStart: '2026-10-05',
	weekLabel: 'S41 - 05 oct. 2026',
	status: 'nouveau',
	answers: {},
};
const checkinPrevious = {
	_id: 'checkin0',
	_creationTime: 90,
	userId: 'client1',
	weekStart: '2026-09-28',
	weekLabel: 'S40 - 28 sept. 2026',
	status: 'retour_envoye',
	feedback: 'Belle semaine, on continue.',
};

const metric = (id, date, weightKg) => ({
	_id: id,
	_creationTime: 1,
	userId: 'client1',
	date,
	weightKg,
	createdAt: 1,
});

async function contextTables(extra = {}) {
	const sessionRow = {
		_id: 's1',
		_creationTime: 1,
		tokenHash: await hashToken('tok-coach'),
		userId: 'coach1',
		expiresAt: Date.now() + 86_400_000,
	};
	return {
		users: [coach, client],
		sessions: [sessionRow],
		checkins: [checkinCurrent, checkinPrevious],
		diaryEntries: [],
		clientGoals: [{ _id: 'g1', _creationTime: 1, userId: 'client1', kcal: 1800, protein: 120, stepGoal: 10000 }],
		clientGoalHistory: [],
		dailySteps: [],
		bodyMetrics: [metric('m1', '2026-10-01', 61.9), metric('m2', '2026-10-02', 61.7), metric('m3', '2026-10-10', 61.22)],
		sportActivities: [],
		appointments: [],
		...extra,
	};
}

const runLoadContext = (tables) => loadContext._handler({ db: makeDb(tables) }, { sessionToken: 'tok-coach', checkinId: 'checkin1' });

test('loadContext expose l\u2019écart de pesée et le poids moyen du bilan précédent', async () => {
	const context = await runLoadContext(await contextTables());
	assert.deepEqual(context.stats.weightTrend.last, { date: '2026-10-10', weightKg: 61.22 });
	assert.deepEqual(context.stats.weightTrend.previous, { date: '2026-10-02', weightKg: 61.7 });
	assert.equal(context.stats.weightTrend.gapKg, -0.48);
	assert.deepEqual(context.stats.weightTrend.prevCheckin, {
		weekLabel: 'S40 - 28 sept. 2026',
		avgKg: 61.8,
		count: 2,
	});
});

test('loadContext : écart absent quand il n\u2019y a pas de pesée précédente ni de bilan précédent', async () => {
	const tables = await contextTables({
		bodyMetrics: [metric('m1', '2026-10-10', 61.22)],
		checkins: [checkinCurrent],
	});
	const context = await runLoadContext(tables);
	assert.deepEqual(context.stats.weightTrend.last, { date: '2026-10-10', weightKg: 61.22 });
	assert.equal(context.stats.weightTrend.previous, null);
	assert.equal(context.stats.weightTrend.gapKg, null);
	assert.equal(context.stats.weightTrend.prevCheckin, null);
});

test('Prompt : la tendance de poids (écart des deux dernières pesées) et le poids moyen du bilan précédent sont dans les faits envoyés', () => {
	const prompt = buildFor(contextOf('progression.context.json'));
	assert.ok(
		prompt.includes(
			'- Tendance de poids : dernière pesée 61,6 kg le 20/09/2026, précédente 61,9 kg le 16/09/2026, écart -300 g.'
		),
		'tendance = écart entre les deux dernières pesées, avec ses deux dates, arrondi à la centaine de grammes'
	);
	assert.ok(
		prompt.includes('- Poids moyen du bilan précédent (S37 - 07 septembre 2026) : 62,3 kg sur 2 pesée(s).'),
		'poids moyen du bilan précédent'
	);
});

test('Prompt : écart de pesée absent — aucune ligne de tendance, jamais un zéro', () => {
	const context = contextOf('progression.context.json');
	context.stats.weightTrend = {
		last: null,
		previous: null,
		gapKg: null,
		prevCheckin: { weekLabel: 'S37 - 07 septembre 2026', avgKg: null, count: 0 },
	};
	const prompt = buildFor(context);
	assert.ok(
		!prompt.includes('- Tendance de poids :'),
		'aucune ligne de tendance quand l’écart est absent'
	);
	assert.ok(
		prompt.includes(
			'- Poids moyen du bilan précédent (S37 - 07 septembre 2026) : indisponible (aucune pesée sur sa semaine).'
		),
		'bilan précédent sans pesée annoncé'
	);
	assert.ok(!prompt.includes('écart 0 g'), 'aucun écart zéro inventé');

	// Sans aucun bilan précédent : la ligne le dit, sans inventer de valeur.
	context.stats.weightTrend = { last: null, previous: null, gapKg: null, prevCheckin: null };
	const second = buildFor(context);
	assert.ok(second.includes('- Poids moyen du bilan précédent : indisponible (aucun bilan précédent).'));
});

/* ═══════════════════ 3) ARRONDIS AVANT ENVOI ═══════════════════ */

test('Arrondis : kcal à la dizaine, protéines au gramme, poids à la centaine de grammes, pas à la centaine', () => {
	assert.equal(roundToStep(1592, 10), 1590, 'kcal à la dizaine (1 590, jamais 1 600)');
	assert.equal(roundToStep(1748, 10), 1750);
	assert.equal(roundToStep(107.6, 1), 108, 'protéines au gramme');
	assert.equal(roundToStep(-223, 100), -200, 'poids à la centaine de grammes');
	assert.equal(roundToStep(10432, 100), 10400, 'pas à la centaine');

	const context = contextOf('progression.context.json');
	context.stats.week.food.kcalAvg = 1592;
	context.stats.week.food.proteinAvg = 107.6;
	context.stats.week.food.goalKcal = 1748;
	context.stats.week.steps.avg = 10432;
	context.stats.deltas.kcalAvg = 132;
	context.stats.deltas.proteinAvg = 7.6;
	context.stats.deltas.weightAvg = -0.223;
	context.stats.deltas.stepsAvg = 1234;
	context.stats.weightTrend = {
		last: { date: '2026-09-20', weightKg: 61.22 },
		previous: { date: '2026-09-13', weightKg: 61.44 },
		gapKg: -0.22,
		prevCheckin: null,
	};
	const prompt = buildFor(context);
	assert.ok(prompt.includes('moyenne 1 590 kcal'), 'moyenne calorique à la dizaine');
	assert.ok(prompt.includes('moyenne 108 g'), 'protéines au gramme');
	assert.ok(prompt.includes('objectif 1 750 kcal'), 'objectif calorique à la dizaine');
	assert.ok(prompt.includes('moyenne 10 400 pas'), 'pas à la centaine');
	assert.ok(prompt.includes('- Calories : +130 kcal'), 'écart calorique arrondi');
	assert.ok(prompt.includes('- Protéines : +8 g'), 'écart de protéines au gramme');
	assert.ok(prompt.includes('- Poids moyen : -200 g'), 'écart de poids à la centaine de grammes');
	assert.ok(prompt.includes('- Pas : +1 200 pas'), 'écart de pas à la centaine');
	assert.ok(prompt.includes('écart -200 g.'), 'écart de pesée à la centaine de grammes');
	assert.ok(!prompt.includes('1 592'), 'aucune valeur brute non arrondie');
	assert.ok(!prompt.includes('107,6'), 'aucune protéine à la décimale');
});

/* ═════════════════ 4) TEMPÉRATURE BASSE TRANSMISE ═════════════════ */

function mockFetch(response) {
	const calls = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), init });
		if (typeof response === 'function') return response(String(url), init, calls.length);
		return response;
	};
	return {
		calls,
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

const jsonResponse = (body, status = 200) => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => body,
});

function withFakeKey(run) {
	const saved = process.env.OPENAI_API_KEY;
	process.env.OPENAI_API_KEY = 'cle-de-test-simulee';
	return Promise.resolve()
		.then(run)
		.finally(() => {
			if (saved === undefined) delete process.env.OPENAI_API_KEY;
			else process.env.OPENAI_API_KEY = saved;
		});
}

test('Régularité : la température basse (0,3) part avec chaque appel de brouillon', async () => {
	const fetchMock = mockFetch(
		jsonResponse({
			output_text: 'Salut {{prenom}}, bilan bien reçu.',
			usage: { input_tokens: 10, output_tokens: 5 },
		})
	);
	try {
		await withFakeKey(async () => {
			await generateText({
				feature: 'coach_draft',
				env: { [COACH_DRAFT_MODEL_ENV]: 'modele-simule-m4' },
				system: 'système',
				prompt: 'prompt',
				maxTokens: 400,
			});
		});
		assert.equal(fetchMock.calls.length, 1);
		const body = JSON.parse(fetchMock.calls[0].init.body);
		assert.equal(COACH_DRAFT_TEMPERATURE, 0.3, 'constante de régularité');
		assert.equal(body.temperature, 0.3, 'température transmise au fournisseur');
	} finally {
		fetchMock.restore();
	}
});

test('Régularité : modèle qui refuse le réglage → réessai sans température (valeur la plus proche acceptée)', async () => {
	const fetchMock = mockFetch((url, init, callIndex) => {
		const body = JSON.parse(init.body);
		if (callIndex === 1 && body.temperature !== undefined) {
			return jsonResponse({ error: { message: 'Unsupported parameter: temperature' } }, 400);
		}
		return jsonResponse({
			output_text: 'Salut {{prenom}}, bilan bien reçu.',
			usage: { input_tokens: 10, output_tokens: 5 },
		});
	});
	try {
		await withFakeKey(async () => {
			const result = await generateText({
				feature: 'coach_draft',
				env: { [COACH_DRAFT_MODEL_ENV]: 'modele-simule-m4' },
				system: 'système',
				prompt: 'prompt',
				maxTokens: 400,
			});
			assert.equal(result.text, 'Salut {{prenom}}, bilan bien reçu.');
		});
		assert.equal(fetchMock.calls.length, 2, 'un seul réessai');
		assert.equal(JSON.parse(fetchMock.calls[0].init.body).temperature, 0.3, 'd\u2019abord 0,3');
		assert.equal(JSON.parse(fetchMock.calls[1].init.body).temperature, undefined, 'puis réglage retiré');
	} finally {
		fetchMock.restore();
	}
});

/* ═════════ 5) INTERFACE — INDICATEUR ET BOUTON DÉSACTIVÉ ═════════ */

test('BilanCard : « Préparation du brouillon… » affiché et bouton désactivé pendant la génération', () => {
	const card = read('src/lib/components/BilanCard.svelte');
	assert.ok(card.includes("'Préparation du brouillon…'"), 'indicateur visible pendant la génération');
	assert.ok(card.includes('disabled={draftLoading}'), 'bouton désactivé pendant la génération');
	assert.ok(card.includes('aria-busy={draftLoading}'), 'état d\u2019activité annoncé');
	// L'indicateur couvre tout l'appel : draftLoading monte avant le fetch et
	// redescend au `finally`, succès ou erreur.
	const fn = card.slice(card.indexOf('async function generateDraft'), card.indexOf('/* ── Vérification du contexte'));
	assert.ok(fn.includes('draftLoading = true'), 'chargement débuté');
	assert.ok(fn.includes('draftLoading = false'), 'chargement terminé dans le finally');
	assert.ok(
		fn.indexOf('draftLoading = true') < fn.indexOf("fetch('/api/coach/draft'"),
		'le chargement couvre l\u2019appel réseau'
	);
	assert.ok(fn.indexOf('draftLoading = false') > fn.indexOf("fetch('/api/coach/draft'"), 'reset après l\u2019appel');
	// L'indicateur est bien celui du bouton (désactivé dans le même balisage).
	const buttonStart = card.indexOf('onclick={requestDraft}');
	const buttonEnd = card.indexOf("'Préparer un brouillon'}") + 40;
	assert.ok(buttonStart > 0 && buttonEnd > buttonStart, 'bouton de génération présent');
	const buttonBlock = card.slice(buttonStart, buttonEnd);
	assert.ok(buttonBlock.includes('disabled={draftLoading}'), 'bouton désactivé dans son balisage');
	assert.ok(buttonBlock.includes('Préparation du brouillon…'), 'indicateur sur le bouton désactivé');
});
