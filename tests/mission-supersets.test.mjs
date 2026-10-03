/**
 * Mission SUPERSETS — liaison d'exercices (superset / triset / circuit).
 *
 * Architecture : champ ADDITIF `trainingSessionExercises.supersetGroup`
 * (string optionnelle "sup:<hex>") — aucune migration, aucun backfill :
 * les séances existantes (champ absent) restent des exercices isolés.
 * Lier = patch de N lignes via setSupersetGroup ; l'ordre d'affichage
 * reste porté par `order` (lecture par contiguïté).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const schema = read('src/convex/schema.ts');
const training = read('src/convex/training.ts');
const trainingClient = read('src/convex/trainingClient.ts');
const bffId = read('src/routes/api/coach/training/session-exercises/[id]/+server.ts');
const lib = read('src/lib/training.ts');
const editor = read('src/lib/components/TrainingEditor.svelte');
const runner = read('src/lib/components/SessionRunner.svelte');

test('SCHEMA : champ additif optionnel — aucune migration, rétrocompatible', () => {
	assert.ok(schema.includes('supersetGroup: v.optional(v.string())'), 'champ optionnel');
	assert.ok(!schema.includes('supersetGroup: v.string()'), 'jamais obligatoire');
});

test('CONVEX : setSupersetGroup — garde-fous 2–6 exercices, même séance, délier = undefined', () => {
	assert.ok(training.includes('export const setSupersetGroup = mutation({'), 'mutation présente');
	assert.ok(/orderedIds\.length < 2 \|\| orderedIds\.length > 6/.test(training), 'garde 2 à 6');
	assert.ok(training.includes('doivent appartenir à la même séance'), 'garde même séance');
	assert.ok(training.includes('supersetGroup: undefined'), 'délier → isolé');
	assert.ok(training.includes('supersetGroup: group'), 'lier → même id');
});

test('CONVEX : copies (duplication programme/séance) PROPAGENT le groupe', () => {
	const copy = training.slice(training.indexOf('export async function copyProgramInto'), training.indexOf('export const duplicateProgram'));
	assert.ok(copy.includes('supersetGroup'), 'copyProgramInto copie le groupe');
	const dupSession = training.slice(training.indexOf('export const duplicateSession'), training.indexOf('export const deleteSession = mutation'));
	assert.ok(dupSession.includes('supersetGroup'), 'duplicateSession copie le groupe');
});

test('CONVEX : duplication d\'UN exercice → copie TOUJOURS isolée (jamais 2 refs au groupe)', () => {
	const dupEx = training.slice(training.indexOf('export const duplicateSessionExercise'), training.indexOf('export const removeSessionExercise'));
	assert.ok(dupEx.includes('La copie EST l\'exercice d\'origine'), 'commentaire d\'intention');
	assert.ok(!/insert\("trainingSessionExercises",\s*\{[^}]*supersetGroup/.test(dupEx), 'aucune écriture du groupe à la copie simple');
});

test('VUE CLIENTE : scheduledSession expose supersetGroup (null = isolé)', () => {
	assert.ok(trainingClient.includes('supersetGroup: se.supersetGroup ?? null'), 'champ exposé');
});

test('BFF : PATCH { superset: { orderedIds, group } } → setSupersetGroup (contrat séparé)', () => {
	assert.ok(bffId.includes('setSupersetGroup'), 'mutation appelée');
	assert.ok(bffId.includes("body.superset !== undefined"), 'branche dédiée');
});

test('LIB : supersetBlocks (contiguïté) + newSupersetId ("sup:hex") + libellés', () => {
	assert.ok(lib.includes('export function supersetBlocks'), 'blocage par contiguïté');
	assert.ok(/sup:\$\{hex\}|`sup:/.test(lib), 'format sup:<hex>');
	assert.ok(lib.includes("'Triset'"), 'trisets prévus naturellement');
});

test('ÉDITEUR : sélection par carte + bannière « Créer un superset » + délier', () => {
	assert.ok(editor.includes('Créer un superset'), 'action de liaison');
	assert.ok(editor.includes('unlinkGroup'), 'délier');
	assert.ok(editor.includes('reorderSuperset'), 'réordonner le groupe');
	assert.ok(editor.includes('clearSel(); // jamais d\'ids d\'une autre séance'), 'sélection vidée au changement de séance');
	assert.ok(editor.includes('supersetBlocks('), 'rendu par blocs');
});

test('RUNNER CLIENTE : rendu du groupe (label) sans changer l\'écriture des séries', () => {
	assert.ok(runner.includes('supersetLabel('), 'libellé affiché');
	assert.ok(runner.includes("supersetGroup: string | null"), 'type client aligné');
	assert.ok(runner.includes('logSet') || runner.includes('/api/training/log'), 'écriture inchangée');
});
