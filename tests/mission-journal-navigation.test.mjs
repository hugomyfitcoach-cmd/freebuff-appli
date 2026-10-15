import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const journal = readFileSync(join(root, 'src/routes/espace/journal/+page.svelte'), 'utf8');

function body(name) {
	const start = journal.indexOf(`function ${name}(`);
	assert.ok(start >= 0, `${name} introuvable`);
	const next = journal.indexOf('\n\t}\n', start);
	return journal.slice(start, next);
}

test('Nouveau repas / Modifier un repas quittent le mode code-barres avant d’ouvrir le formulaire', () => {
	assert.match(body('openMealEditor'), /leaveBarcodeForEditor\(\)/);
	assert.match(body('openMealEditorFor'), /leaveBarcodeForEditor\(\)/);
});

test('Nouvel aliment / Modifier un aliment quittent le mode code-barres avant d’ouvrir le formulaire', () => {
	assert.match(body('openCustomEditor'), /leaveBarcodeForEditor\(\)/);
	assert.match(body('openCustomEditorFor'), /leaveBarcodeForEditor\(\)/);
});

test('Le scanner ne s’ouvre que via une action explicite « Code-barres » (switchMode)', () => {
	assert.match(body('createFromScan'), /switchMode\('barcode'\)/);
	assert.match(journal, /onclick=\{\(\) => switchMode\('barcode'\)\}/);
});

test('Le retour arrière des formulaires reste câblé à la bonne destination', () => {
	assert.match(journal, /onclick=\{searchTab === 'repas' \? closeMealEditor : closeCustomEditor\}/);
});
