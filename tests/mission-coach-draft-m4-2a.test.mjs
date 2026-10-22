/**
 * MISSION M4-2a — TENDANCE DE POIDS ET PHRASES COURTES.
 *
 * Aucun appel réseau réel, aucune donnée réelle, aucune écriture Convex.
 * Couverture demandée :
 *  - le prompt présente comme TENDANCE l'écart entre les deux dernières pesées
 *    (toutes dates confondues), avec ses deux dates — dès 2 pesées ;
 *  - avec une seule pesée : aucune ligne de tendance, jamais un zéro inventé ;
 *  - le poids moyen reste la moyenne des pesées de la semaine du bilan ;
 *  - les deux nouvelles règles prioritaires du guide (poids sans tendance,
 *    phrases courtes) sont dans le .md source ET dans la copie serveur envoyée
 *    au modèle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildCoachDraftPrompt } from '../src/convex/coachDraftPrompt.ts';
import { weightTrendFacts } from '../src/convex/coachDraft.ts';
import { COACH_DRAFT_STYLE_GUIDE } from '../src/lib/data/coachDraftStyleGuide.ts';
import { COACH_DRAFT_METHOD_REFERENCE } from '../src/convex/ai/methodeGflux.ts';

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

const RULE_NO_WEIGHT =
	"Si aucune tendance de poids n'est disponible, ne parle pas du poids ; ne jamais expliquer qu'une donnée manque.";
const RULE_SHORT_SENTENCES = 'Phrases courtes : une idée par phrase, 20 mots maximum.';

/* ═════════ 1) TENDANCE DE POIDS = ÉCART DES DEUX DERNIÈRES PESÉES ═════════ */

test('Prompt : dès 2 pesées, la tendance donne l’écart ET ses deux dates, toutes dates confondues', () => {
	const context = contextOf('progression.context.json');
	// Deux pesées hors semaine du bilan : la tendance ignore les fenêtres.
	context.stats.weightTrend = weightTrendFacts(
		[
			{ date: '2026-10-13', weightKg: 60.8 },
			{ date: '2026-10-16', weightKg: 60.6 },
		],
		{ weekLabel: 'S41 - 05 oct. 2026', weekStart: '2026-10-05' }
	);
	assert.equal(context.stats.weightTrend.gapKg, -0.2, 'écart calculé par le code (M4-1)');
	const prompt = buildFor(context);
	assert.ok(
		prompt.includes(
			'- Tendance de poids : dernière pesée 60,6 kg le 16/10/2026, précédente 60,8 kg le 13/10/2026, écart -200 g.'
		),
		'tendance = écart entre les deux dernières pesées, avec ses deux dates'
	);
	// Le poids moyen reste la moyenne des pesées de la semaine du bilan.
	assert.ok(
		prompt.includes('- Poids : moyenne 61,8 kg sur 3 pesée(s)'),
		'poids moyen = moyenne des pesées de la semaine du bilan, inchangé'
	);
});

test('Prompt : trois pesées ou plus — la tendance compare les deux dernières seulement', () => {
	const context = contextOf('progression.context.json');
	context.stats.weightTrend = weightTrendFacts(
		[
			{ date: '2026-09-30', weightKg: 61.2 },
			{ date: '2026-10-13', weightKg: 60.8 },
			{ date: '2026-10-16', weightKg: 60.6 },
		],
		null
	);
	const prompt = buildFor(context);
	assert.ok(
		prompt.includes(
			'- Tendance de poids : dernière pesée 60,6 kg le 16/10/2026, précédente 60,8 kg le 13/10/2026, écart -200 g.'
		),
		'uniquement les deux dernières pesées, toutes dates confondues'
	);
});

test('Prompt : une seule pesée → aucune ligne de tendance, jamais un zéro inventé', () => {
	const context = contextOf('progression.context.json');
	context.stats.weightTrend = weightTrendFacts([{ date: '2026-10-16', weightKg: 60.6 }], null);
	assert.equal(context.stats.weightTrend.gapKg, null, 'une seule pesée → pas d’écart');
	const prompt = buildFor(context);
	assert.ok(!prompt.includes('- Tendance de poids :'), 'aucune ligne de tendance');
	assert.ok(!prompt.includes('- Écart de pesée'), 'plus aucune ligne d’écart de pesée');
	assert.ok(!prompt.includes('écart 0 g'), 'jamais un écart zéro inventé');
});

/* ═════════ 2) RÈGLES PRIORITAIRES — .md SOURCE ET COPIE SERVEUR ═════════ */

test('Guide de style : « pas de poids sans tendance » et « phrases courtes » dans les Règles prioritaires', () => {
	const markdown = read('docs/guide-style-retours.md');
	const priorities = markdown.slice(
		markdown.indexOf('## Règles prioritaires'),
		markdown.indexOf('## 1. Structure type')
	);
	assert.ok(priorities.includes(RULE_NO_WEIGHT), 'règle « pas de poids sans tendance » dans le .md');
	assert.ok(priorities.includes(RULE_SHORT_SENTENCES), 'règle « phrases courtes » dans le .md');
});

test('Copie serveur : les deux règles voyagent dans COACH_DRAFT_STYLE_GUIDE et dans le prompt', () => {
	assert.ok(COACH_DRAFT_STYLE_GUIDE.includes(RULE_NO_WEIGHT), 'règle dans la copie serveur');
	assert.ok(COACH_DRAFT_STYLE_GUIDE.includes(RULE_SHORT_SENTENCES), 'règle dans la copie serveur');
	const prompt = buildFor(contextOf('progression.context.json'));
	assert.ok(prompt.includes(RULE_NO_WEIGHT), 'règle transmise au modèle');
	assert.ok(prompt.includes(RULE_SHORT_SENTENCES), 'règle transmise au modèle');
});
