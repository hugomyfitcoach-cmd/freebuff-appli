/**
 * MISSION M0 — CONTEXTE ET PROMPT DU BROUILLON DE RETOUR.
 *
 * Tests dorés : 3 bilans fictifs (semaine en progrès, stagnation, signal
 * d'alerte fatigue) → prompt complet figé dans
 * `tests/fixtures/coach-draft/*.prompt.txt`.
 *
 * Aucune donnée réelle, aucun appel IA, aucune écriture Convex : les contextes
 * sont des JSON fictifs et le prompt est une fonction pure.
 *
 * Régénérer les goldens après une évolution VOLONTAIRE du prompt :
 *   UPDATE_GOLDEN=1 node --test --experimental-strip-types \
 *     --import ./tests/ts-resolve.mjs tests/mission-coach-draft.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	buildCoachDraftPrompt,
	normalizeCoachDraftTargetWords,
	DEFAULT_COACH_DRAFT_TARGET_WORDS,
} from '../src/convex/coachDraftPrompt.ts';
import { COACH_DRAFT_STYLE_GUIDE } from '../src/lib/data/coachDraftStyleGuide.ts';
import { COACH_DRAFT_METHOD_REFERENCE } from '../src/lib/data/methodeGflux.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = join(root, 'tests/fixtures/coach-draft');
const fileExamples = JSON.parse(
	readFileSync(join(root, 'src/lib/data/coach-feedback-examples.json'), 'utf8')
);
const updateGolden = process.env.UPDATE_GOLDEN === '1';

const CASES = [
	{ name: 'progression', file: 'progression.context.json', label: 'semaine en progrès' },
	{ name: 'stagnation', file: 'stagnation.context.json', label: 'stagnation' },
	{ name: 'alerte-fatigue', file: 'alerte-fatigue.context.json', label: "signal d'alerte fatigue" },
];

function loadContext(file) {
	return JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
}

function buildFor(context) {
	return buildCoachDraftPrompt({
		context,
		styleGuide: COACH_DRAFT_STYLE_GUIDE,
		methodReference: COACH_DRAFT_METHOD_REFERENCE,
		// Les trois sources : fichier sélectionné + historique de la même cliente.
		examples: [...fileExamples, ...context.examples],
		targetWords: DEFAULT_COACH_DRAFT_TARGET_WORDS,
	});
}

/* ═══════════════ 1) GOLDENS — 3 bilans fictifs ═══════════════ */

for (const testCase of CASES) {
	test(`Prompt doré — ${testCase.label} (${testCase.name})`, () => {
		const context = loadContext(testCase.file);
		const prompt = buildFor(context);
		const expectedPath = join(fixturesDir, `${testCase.name}.prompt.txt`);
		if (updateGolden) writeFileSync(expectedPath, prompt, 'utf8');
		const expected = readFileSync(expectedPath, 'utf8');
		assert.equal(prompt, expected, `le prompt de ${testCase.name} ne correspond plus au golden`);
	});

	test(`Contexte fictif — ${testCase.name} : aucune identité interdite`, () => {
		const context = loadContext(testCase.file);
		for (const forbidden of ['userId', 'checkinId', 'email', 'nom', 'birthDate', 'stripeCustomerId']) {
			assert.equal(Object.hasOwn(context, forbidden), false, `champ interdit : ${forbidden}`);
		}
		assert.equal(typeof context.prenom, 'string');
		assert.ok(context.prenom.length > 0, 'prénom seul présent');
		assert.equal(context.examples.length, 2, 'exactement 2 retours de la même cliente');
	});
}

/* ═══════════════ 2) CONTENU DU PROMPT ═══════════════ */

test('Le prompt contient les TROIS sources, dans l’ordre', () => {
	const prompt = buildFor(loadContext('progression.context.json'));
	const guide = prompt.indexOf('--- 1. GUIDE DE STYLE ---');
	const methode = prompt.indexOf('--- 2. RÉFÉRENTIEL DE MÉTHODE ---');
	const exemples = prompt.indexOf('--- 3. EXEMPLES DE RETOURS');
	assert.ok(guide >= 0 && methode > guide && exemples > methode, 'guide → méthode → exemples');
	assert.ok(prompt.includes('GUIDE DE STYLE'));
	assert.ok(prompt.includes(COACH_DRAFT_METHOD_REFERENCE.slice(0, 40)));
});

test('Le prompt interdit explicitement de calculer et d’inventer', () => {
	const prompt = buildFor(loadContext('stagnation.context.json'));
	assert.ok(prompt.includes('INTERDICTION DE CALCULER'));
	assert.ok(prompt.includes("INTERDICTION D'INVENTER"));
	assert.ok(prompt.includes('ne fais aucune addition'), 'aucune opération autorisée');
	assert.ok(prompt.includes("n'ajoute aucun chiffre"));
	assert.ok(prompt.includes('déjà formatés'), 'les chiffres arrivent formatés par le code');
});

test('Le prompt ne contient aucun identifiant technique ni e-mail', () => {
	for (const testCase of CASES) {
		const prompt = buildFor(loadContext(testCase.file));
		assert.ok(!/userId|checkinId|@|_id/i.test(prompt), `fuite d’identité dans ${testCase.name}`);
	}
});

test('L’historique de la même cliente est bien présent (2 exemples), jamais un corpus global', () => {
	const context = loadContext('alerte-fatigue.context.json');
	const prompt = buildFor(context);
	for (const example of context.examples) {
		assert.ok(prompt.includes(example.weekLabel), `semaine absente : ${example.weekLabel}`);
		assert.ok(prompt.includes(example.text.slice(0, 40)), 'texte du retour de la même cliente absent');
	}
});

test('Les données indisponibles ne sont jamais présentées comme zéro', () => {
	const context = loadContext('stagnation.context.json');
	context.stats.mensurations = null;
	context.stats.deltas.proteinAvg = null;
	context.stats.week.food.kcalAvg = null;
	const prompt = buildFor(context);
	assert.ok(prompt.includes('aucun relevé disponible'), 'mensurations absentes');
	assert.ok(prompt.includes('moyenne indisponible (aucune journée exploitable)'));
	assert.ok(!prompt.includes('Protéines : +0,0 g'), 'aucun écart inventé');
});

test('Le paramètre de longueur est utilisé et borné', () => {
	assert.equal(normalizeCoachDraftTargetWords(undefined), DEFAULT_COACH_DRAFT_TARGET_WORDS);
	assert.equal(normalizeCoachDraftTargetWords(180), 180);
	assert.equal(normalizeCoachDraftTargetWords(10), 60);
	assert.equal(normalizeCoachDraftTargetWords(999), 400);
	const prompt = buildCoachDraftPrompt({
		context: loadContext('progression.context.json'),
		styleGuide: COACH_DRAFT_STYLE_GUIDE,
		methodReference: COACH_DRAFT_METHOD_REFERENCE,
		examples: [],
		targetWords: 180,
	});
	assert.ok(prompt.includes('environ 180 mots'), 'la longueur cible vient du paramètre');
});

/* ═══════════════ 3) CÂBLAGE DU CONTEXTE (static analysis) ═══════════════ */

const contextSource = readFileSync(join(root, 'src/convex/coachDraft.ts'), 'utf8');

test('coachDraft.loadContext est une query INTERNE, réservée au coach, en lecture seule', () => {
	assert.ok(contextSource.includes('internalQuery({'), 'query interne');
	assert.ok(contextSource.includes('user.role !== "coach"'), 'garde coach');
	assert.ok(contextSource.includes('Accès réservé au coach'));
	assert.ok(!contextSource.includes('.insert('), 'aucune écriture');
	assert.ok(!contextSource.includes('.patch('), 'aucune écriture');
	assert.ok(!contextSource.includes('.delete('), 'aucune écriture');
	assert.ok(!contextSource.includes('generateText'), 'aucun appel IA');
});

test('coachDraft.loadContext réutilise les fonctions pures de vision360', () => {
	for (const fn of ['foodAverages', 'weightVision', 'stepsAverages', 'sportVision', 'mensurationsVision', 'last7CompletedDays']) {
		assert.ok(contextSource.includes(fn), `fonction pure manquante : ${fn}`);
	}
	assert.ok(contextSource.includes('last7CompletedDays(addDaysISO(checkin.weekStart, 7))'), '7 jours du bilan');
	assert.ok(contextSource.includes('last7CompletedDays(checkin.weekStart)'), '7 jours précédents');
	assert.ok(contextSource.includes('row.status === "retour_envoye"'), 'retours publiés uniquement');
	assert.ok(contextSource.includes('.slice(0, 2)'), '2 derniers retours');
});

test('coachDraft.loadContext ne renvoie ni nom, ni e-mail, ni identifiant', () => {
	assert.ok(contextSource.includes('prenom: target.prenom'), 'prénom seul');
	assert.ok(!/email:\s*target\.email/.test(contextSource), 'e-mail jamais renvoyé');
	assert.ok(!/nom:\s*target\.nom/.test(contextSource), 'nom jamais renvoyé');
	assert.ok(!/userId:\s*target\._id/.test(contextSource), 'userId jamais renvoyé');
});
