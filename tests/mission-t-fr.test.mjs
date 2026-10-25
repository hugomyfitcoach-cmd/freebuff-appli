/**
 * Mission T-FR — descriptions d'exercices en français (noms inchangés).
 *
 * Ces tests couvrent le COMPORTEMENT (pas seulement la présence de code) :
 *  - affichage : version française si elle existe, repli sur l'originale ;
 *  - noms : jamais modifiés en base, première lettre en majuscule à l'écran ;
 *  - traduction : lots de 20, 200 max par exécution, replanification,
 *    dryRun sans écriture, arrêt propre sur erreur fournisseur, journal
 *    aiUsageLog sans aucun texte d'exercice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { displayExerciseName, exerciseInstructions } from '../src/lib/exerciseFr.ts';
import { MAX_PER_RUN, TRANSLATION_BATCH_SIZE, runExerciseTranslation } from '../src/lib/exerciseTranslationCore.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ─── Affichage ─── */

test('instructions : la version française est affichée quand elle existe', () => {
	const ex = {
		instructions: ['Set up the bench.', 'Press the bar.'],
		instructionsFr: ['Installe le banc.', 'Pousse la barre.'],
	};
	assert.deepEqual(exerciseInstructions(ex), ['Installe le banc.', 'Pousse la barre.']);
});

test('instructions : repli sur la version originale en l’absence de traduction', () => {
	const original = ['Set up the bench.', 'Press the bar.'];
	assert.deepEqual(exerciseInstructions({ instructions: original }), original);
	assert.deepEqual(exerciseInstructions({ instructions: original, instructionsFr: [] }), original);
	assert.deepEqual(exerciseInstructions({ instructions: original, instructionsFr: ['   '] }), original);
	assert.deepEqual(exerciseInstructions(null), []);
});

test('nom : première lettre en majuscule à l’affichage, sans toucher à la valeur d’origine', () => {
	const brut = 'bench press (haltères)';
	const affiche = displayExerciseName(brut);
	assert.equal(affiche, 'Bench press (haltères)');
	assert.equal(brut, 'bench press (haltères)', 'la valeur reçue n’est jamais mutée');
	assert.equal(displayExerciseName('Bench Press'), 'Bench Press', 'majuscule déjà présente : reste inchangé');
	assert.equal(displayExerciseName('  dumbbell fly '), 'Dumbbell fly');
	assert.equal(displayExerciseName(''), '');
	assert.equal(displayExerciseName(undefined), '');
});

test('nom : jamais réécrit en base (la vue exercice recopie le nom tel quel)', () => {
	const source = readFileSync(join(root, 'src/convex/exercises.ts'), 'utf8');
	assert.match(source, /name: e\.name,/, 'toView recopie le nom sans transformation');
	assert.ok(!/name:\s*(e|ex)\.name\.(toLowerCase|toUpperCase|trim)\(/.test(source), 'aucune réécriture du nom');
	const translation = readFileSync(join(root, 'src/convex/exerciseTranslation.ts'), 'utf8');
	assert.match(translation, /name: ex\.name/, 'le nom part comme contexte, sans transformation');
	assert.ok(!/patch\([^)]*name/.test(translation), 'la traduction ne patche jamais le nom');
});

/* ─── Orchestration : fakes injectés ─── */

function exercise(i, overrides = {}) {
	return {
		id: `ex_${i}`,
		name: `exercise ${i}`,
		instructions: [`Step one of exercise ${i}.`, `Step two of exercise ${i}.`],
		...overrides,
	};
}

function makeHarness(pool, opts = {}) {
	const calls = { list: [], translate: [], save: [], schedule: [], log: [] };
	const poolItems = [...pool];
	const deps = {
		model: 'gpt-4o-mini',
		async listUntranslated(limit) {
			calls.list.push(limit);
			return poolItems.filter((item) => !(item.instructionsFr && item.instructionsFr.length > 0)).slice(0, limit);
		},
		async translate(items) {
			calls.translate.push(items.map((item) => item.id));
			if (opts.failOnCall != null && calls.translate.length === opts.failOnCall) {
				throw new Error('Service de traduction indisponible (HTTP 500).');
			}
			return {
				results: items.map((item) => ({
					id: item.id,
					instructionsFr: item.instructions.map((line) => `FR ${line}`),
				})),
				inputTokens: 100,
				outputTokens: 120,
				estimatedCostUsd: 0.001,
			};
		},
		async save(results) {
			calls.save.push(results.map((item) => item.id));
			return results.length;
		},
		async schedule(nextLimit) {
			calls.schedule.push(nextLimit);
		},
		async log(entry) {
			calls.log.push(entry);
		},
		now: (() => {
			let t = 0;
			return () => (t += 5);
		})(),
	};
	return { deps, calls };
}

test('lots de 20 exercices, plafond de 200 par exécution', async () => {
	assert.equal(TRANSLATION_BATCH_SIZE, 20);
	assert.equal(MAX_PER_RUN, 200);
	const pool = Array.from({ length: 260 }, (_, i) => exercise(i));
	const { deps, calls } = makeHarness(pool);
	const out = await runExerciseTranslation(deps, { limit: 0 });
	assert.equal(out.ok, true);
	assert.equal(out.processed, 200, 'une exécution ne dépasse jamais 200 exercices');
	assert.ok(calls.translate.every((batch) => batch.length <= 20), 'aucun lot au-delà de 20');
	assert.equal(calls.translate.length, 10);
	assert.equal(calls.save.length, 10, 'écriture lot par lot (progression conservée)');
	assert.equal(calls.save.flat().length, 200);
	assert.deepEqual(calls.schedule, [0], 'replanification pour le reste (limit 0 = tout)');
	assert.equal(out.scheduled, true);
});

test('replanification avec le budget restant quand limit > 200', async () => {
	const pool = Array.from({ length: 400 }, (_, i) => exercise(i));
	const { deps, calls } = makeHarness(pool);
	const out = await runExerciseTranslation(deps, { limit: 350 });
	assert.equal(out.processed, 200);
	assert.deepEqual(calls.schedule, [150], 'le reste du budget est replanifié');
});

test('limit atteint : aucune replanification inutile', async () => {
	const pool = Array.from({ length: 30 }, (_, i) => exercise(i));
	const { deps, calls } = makeHarness(pool);
	const out = await runExerciseTranslation(deps, { limit: 30 });
	assert.equal(out.processed, 30);
	assert.equal(out.scheduled, false);
	assert.deepEqual(calls.schedule, []);
});

test('un exercice déjà traduit n’est jamais renvoyé au fournisseur', async () => {
	const pool = [
		exercise(1, { instructionsFr: ['Déjà traduit.'] }),
		exercise(2),
		exercise(3, { instructionsFr: ['Déjà traduit aussi.'] }),
		exercise(4),
	];
	const { deps, calls } = makeHarness(pool);
	const out = await runExerciseTranslation(deps, { limit: 10 });
	const envoyes = calls.translate.flat();
	assert.deepEqual(envoyes, ['ex_2', 'ex_4']);
	assert.equal(out.processed, 2);
	assert.equal(out.nextLimit, 0, 'plus rien à traduire : pas de relance');
});

test('dryRun : renvoie les traductions sans rien écrire et sans se replanifier', async () => {
	const pool = Array.from({ length: 30 }, (_, i) => exercise(i));
	const { deps, calls } = makeHarness(pool);
	const out = await runExerciseTranslation(deps, { limit: 3, dryRun: true });
	assert.equal(out.ok, true);
	assert.equal(out.dryRun, true);
	assert.equal(out.processed, 3);
	assert.equal(out.translations.length, 3, 'les traductions sont renvoyées telles quelles');
	assert.equal(out.saved, 0);
	assert.deepEqual(calls.save, [], 'dryRun n’écrit aucune fiche');
	assert.deepEqual(calls.schedule, [], 'dryRun ne se replanifie pas');
	assert.deepEqual(calls.log, [], 'dryRun ne journalise rien');
});

test('erreur fournisseur : arrêt propre, aucune replanification, cause journalisée', async () => {
	const pool = Array.from({ length: 60 }, (_, i) => exercise(i));
	const { deps, calls } = makeHarness(pool, { failOnCall: 2 });
	const out = await runExerciseTranslation(deps, { limit: 0 });
	assert.equal(out.ok, false);
	assert.equal(out.scheduled, false);
	assert.deepEqual(calls.schedule, [], 'aucune relance sur erreur');
	assert.equal(calls.save.length, 1, 'le premier lot déjà traduit reste écrit');
	assert.equal(calls.save[0].length, 20);
	assert.equal(calls.log.at(-1).status, 'error');
	assert.match(calls.log.at(-1).failReason, /HTTP 500/);
});

test('journal aiUsageLog : aucun texte d’exercice, seulement des métadonnées', async () => {
	const pool = Array.from({ length: 25 }, (_, i) => exercise(i));
	const { deps, calls } = makeHarness(pool);
	await runExerciseTranslation(deps, { limit: 25 });
	assert.equal(calls.log.length, 2, 'un enregistrement par lot');
	const serialise = JSON.stringify(calls.log);
	for (const item of pool) {
		assert.ok(!serialise.includes(item.name), 'aucun nom d’exercice journalisé');
		for (const line of item.instructions) {
			assert.ok(!serialise.includes(line), 'aucune consigne journalisée');
		}
	}
	const cles = new Set(Object.keys(calls.log[0]));
	for (const cle of ['kind', 'model', 'inputTokens', 'outputTokens', 'durationMs', 'status', 'estimatedCostUsd']) {
		assert.ok(cles.has(cle), `champ ${cle} journalisé`);
	}
	assert.equal(calls.log[0].kind, 'exercise_translation');
	assert.ok(!cles.has('text'));
	assert.ok(!cles.has('prompt'));
});

/* ─── Câblage Convex (action interne + schéma) ─── */

test('action interne exposée : translateExerciseDescriptions({ limit, dryRun })', () => {
	const source = readFileSync(join(root, 'src/convex/exerciseTranslation.ts'), 'utf8');
	assert.match(source, /export const translateExerciseDescriptions = internalAction\(/);
	assert.match(source, /OPENAI_TRANSLATION_MODEL/);
	assert.match(source, /gpt-4o-mini/);
	assert.match(source, /internal\.exerciseTranslation\.translateExerciseDescriptions/, 'replanification automatique');
	assert.match(source, /internal\.aiLog\.record/, 'journalisation');
	assert.match(source, /exercise_translation/);
});

test('schéma : champs additifs seulement (instructionsFr, kind exercise_translation)', () => {
	const schema = readFileSync(join(root, 'src/convex/schema.ts'), 'utf8');
	assert.match(schema, /instructionsFr: v\.optional\(v\.array\(v\.string\(\)\)\)/, 'traduction facultative, même découpage');
	assert.match(schema, /v\.literal\("exercise_translation"\)/, 'kind de journal déclaré');
	const log = readFileSync(join(root, 'src/convex/aiLog.ts'), 'utf8');
	assert.match(log, /v\.literal\("exercise_translation"\)/);
});
