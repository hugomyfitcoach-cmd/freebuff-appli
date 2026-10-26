/**
 * Tests MISSION T-ED — éditeur d'entraînement : dialogues G-FLUX, familles de
 * matériel, encodage des noms.
 *
 * 1. Aucune boîte native (prompt / confirm / alert) dans l'éditeur ni dans la
 *    page Entraînement ; renommage visible immédiatement, sans rechargement ;
 * 2. Familles de matériel : une seule fonction utilitaire, « sled » → Machine,
 *    inconnu → Autre, somme des familles = total des exercices ;
 * 3. Noms : « sled 45в° leg press » s'affiche « sled 45° leg press » (aucune
 *    écriture en base — correction à l'affichage).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { equipmentFacets, equipmentFamily, isEquipmentFamily } from '../src/lib/exerciseEquipment.ts';
import { displayExerciseName, fixExerciseEncoding } from '../src/lib/exerciseFr.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const editor = read('src/lib/components/TrainingEditor.svelte');
const page = read('src/routes/admin/entrainement/+page.svelte');
const browser = read('src/lib/components/ExerciseLibraryBrowser.svelte');

/* ─── 1) Dialogues G-FLUX + renommage immédiat ─── */

test('aucune boîte native (prompt / confirm / alert) dans l’éditeur ni la page', () => {
	for (const [name, src] of [['TrainingEditor', editor], ['page Entraînement', page]]) {
		assert.ok(!/\bprompt\s*\(/.test(src), `${name} : aucun prompt`);
		assert.ok(!/(?<![.\w])confirm\s*\(/.test(src), `${name} : aucun confirm natif`);
		assert.ok(!/(?<![.\w])alert\s*\(/.test(src), `${name} : aucun alert`);
	}
	// Les actions engageantes passent par le composant ConfirmDialog existant.
	assert.ok(editor.includes("import ConfirmDialog from '$lib/components/ConfirmDialog.svelte'"), 'éditeur : ConfirmDialog importé');
	assert.ok((editor.match(/<ConfirmDialog/g) || []).length >= 3, 'renommer / supprimer une séance / retirer un exercice');
	assert.ok(page.includes("import ConfirmDialog from '$lib/components/ConfirmDialog.svelte'"), 'page : ConfirmDialog importé');
	assert.ok(page.includes('<ConfirmDialog'), 'suppression de programme confirmée en G-FLUX');
	// Le renommage est un champ de saisie DANS la fenêtre G-FLUX.
	const renameDialog = editor.slice(editor.indexOf('title="Renommer la séance"'), editor.indexOf('title="Supprimer la séance ?"'));
	assert.ok(renameDialog.includes('bind:value={renameValue}'), 'champ de saisie dans la fenêtre');
	assert.ok(renameDialog.includes('onconfirm={confirmRenameSession}'), 'validation explicite');
});

test('renommer une séance est visible immédiatement (liste + titre), sans rechargement', () => {
	const fn = editor.slice(editor.indexOf('function confirmRenameSession'), editor.indexOf('async function duplicateSession'));
	assert.ok(fn.includes('sessionNames[target._id] = name'), 'mise à jour locale immédiate');
	assert.ok(fn.includes("send('PATCH', `/api/coach/training/sessions/${target._id}`"), 'persistance PATCH');
	assert.ok(!fn.includes('onReload'), 'aucun rechargement pendant le renommage');
	// La liste de gauche ET le titre de la colonne centrale lisent le nom local.
	assert.ok(editor.includes('{sessionName(s)}'), 'nom local dans la liste des séances');
	assert.ok(editor.includes('{selectedSession ? sessionName(selectedSession) : \'Exercices\'}'), 'nom local dans le titre');
	assert.ok(editor.includes('sessionNames[s._id] ?? s.name'), 'repli sur le nom serveur');
});

/* ─── 2) Familles de matériel ─── */

test('« sled » → Machine ; familles demandées par la mission', () => {
	assert.equal(equipmentFamily('sled'), 'Machine');
	assert.equal(equipmentFamily('leverage machine'), 'Machine');
	assert.equal(equipmentFamily('lever'), 'Machine');
	assert.equal(equipmentFamily('Traîneau'), 'Machine');
	assert.equal(equipmentFamily('sled machine'), 'Machine');
	assert.equal(equipmentFamily('smith machine'), 'Machine Smith');
	assert.equal(equipmentFamily('cable'), 'Poulies');
	assert.equal(equipmentFamily('band'), 'Élastiques');
	assert.equal(equipmentFamily('resistance band'), 'Élastiques');
	assert.equal(equipmentFamily('mini-bande'), 'Élastiques');
	assert.equal(equipmentFamily('body weight'), 'Poids du corps');
	assert.equal(equipmentFamily('dumbbell'), 'Haltères');
	assert.equal(equipmentFamily('barbell'), 'Barre');
	assert.equal(equipmentFamily('olympic barbell'), 'Barre');
	assert.equal(equipmentFamily('ez barbell'), 'Barre');
	assert.equal(equipmentFamily('kettlebell'), 'Kettlebell');
	assert.equal(equipmentFamily('weighted'), 'Lesté');
	assert.equal(equipmentFamily('stability ball'), 'Swiss ball');
	// Libellés français déjà normalisés par l'import.
	assert.equal(equipmentFamily('Poulies'), 'Poulies');
	assert.equal(equipmentFamily('Barre olympique'), 'Barre');
	assert.equal(equipmentFamily('Poids du corps'), 'Poids du corps');
});

test('matériel inconnu (ou vide) → Autre, jamais exclu des filtres', () => {
	assert.equal(equipmentFamily('bosu ball'), 'Autre');
	assert.equal(equipmentFamily('roue abdominale'), 'Autre');
	assert.equal(equipmentFamily(''), 'Autre');
	assert.equal(equipmentFamily(null), 'Autre');
	assert.equal(equipmentFamily(undefined), 'Autre');
	assert.equal(isEquipmentFamily('sled', 'Machine'), true);
	assert.equal(isEquipmentFamily('cable', 'Machine'), false);
});

test('la somme des familles = nombre total d’exercices', () => {
	const rows = [
		['sled', 3],
		['cable', 4],
		['Body Weight', 2],
		['mini-bande', 1],
		['bosu ball', 5],
		['smith machine', 2],
	];
	const facets = equipmentFacets(rows);
	assert.equal(facets.reduce((n, f) => n + f.count, 0), 17, 'aucun exercice perdu');
	assert.equal(new Set(facets.map((f) => f.family)).size, facets.length, 'une seule entrée par famille');
	assert.equal(facets.find((f) => f.family === 'Machine').count, 3);
	assert.equal(facets.find((f) => f.family === 'Autre').count, 5);
	assert.ok(!facets.some((f) => f.count === 0), 'familles vides omises');
	// Les filtres de la bibliothèque utilisent les familles (jamais le brut).
	assert.ok(browser.includes('equipmentFacets(stats.byEquipment)'), 'chips = familles');
	assert.ok(browser.includes("params.set('equipmentFamily'"), 'filtre envoyé par famille');
	assert.ok(browser.includes('{equipmentFamily(ex.equipment)}'), 'affichage sous chaque exercice');
});

/* ─── 3) Encodage des noms ─── */

test('« sled 45в° leg press » s’affiche « Sled 45° leg press »', () => {
	assert.equal(displayExerciseName('sled 45в° leg press'), 'Sled 45° leg press');
	assert.equal(fixExerciseEncoding('sled 45в° leg press'), 'sled 45° leg press');
	// Autres séquences évidentes (mojibake) — correction à l'affichage seulement.
	assert.equal(fixExerciseEncoding('développé Ã©paules'), 'développé épaules');
	assert.equal(fixExerciseEncoding('angle 90Â°'), 'angle 90°');
	assert.equal(fixExerciseEncoding('nom â€™apostrophe'), 'nom ’apostrophe');
	// Aucune écriture : le module ne fait que rendre une copie corrigée.
	assert.equal(displayExerciseName('Squat'), 'Squat');
});
