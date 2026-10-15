import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const journal = readFileSync(join(root, 'src/routes/espace/journal/+page.svelte'), 'utf8');

test('ouvrir la recherche ne focalise pas automatiquement le champ principal ni celui des ingrédients', () => {
	const mainSearch = journal.match(/placeholder="Rechercher un produit…"[\s\S]{0,180}?\/>/)?.[0] ?? '';
	assert.ok(mainSearch, 'champ principal de recherche présent');
	assert.doesNotMatch(mainSearch, /autofocus|onMount|focus\(/);
	assert.doesNotMatch(journal, /getElementById\('meal-picker-input'\)[\s\S]{0,100}?\.focus\(/);
	assert.match(journal, /L'ouverture de la recherche d'ingrédients garde le clavier fermé/);
});

test('la capsule inférieure est masquée uniquement dans le constructeur de repas', () => {
	assert.match(journal, /\{#if !customEditor && !\(searchTab === 'repas' && mealEditor\) && !keyboardOpen\}[\s\S]{0,150}pointer-events-none absolute inset-x-0 bottom/);
	assert.match(journal, /onclick=\{\(\) => \(mealSearchOpen = true\)\}[\s\S]{0,180}Ajouter un produit/);
	assert.match(journal, /id="meal-picker-input"/);
	assert.match(journal, /switchMealSearchMode\('barcode'\)/);
});

test('Ciqual : recherche produit et ingrédients déplient les références avec Voir plus/moins', () => {
	assert.equal((journal.match(/limit=13/g) ?? []).length, 3, 'les recherches produit, ingrédients et composants chargent jusqu’à 13 références');
	assert.match(journal, /ciqualResults\.slice\(0, 3\)/, 'recherche principale limitée à trois références visibles par défaut');
	assert.match(journal, /mealCiqualResults\.slice\(0, 3\)/, "recherche d'ingrédients limitée à trois références visibles par défaut");
	assert.equal((journal.match(/'Voir moins' : 'Voir plus'/g) ?? []).length, 2, 'un bouton Voir plus/moins par recherche');
});

test('les modes utilisent un slide court avec respect de prefers-reduced-motion', () => {
	assert.match(journal, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
	assert.match(journal, /modeSlideX = reduced \? 0 : direction \* 18/);
	assert.match(journal, /modeSlideDuration = reduced \? 0 : 180/);
	for (const id of ['logListEl', 'bcListEl', 'mealSearchListEl', 'mealBcListEl']) {
		assert.match(journal, new RegExp(`bind:this=\\{${id}\\}[^\\n]*in:fly=\\{\\{ x: modeSlideX, duration: modeSlideDuration \\}\\}`), `${id} animé`);
	}
	assert.match(journal, /max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5[\s\S]{0,180}in:fly=\{\{ x: modeSlideX, duration: modeSlideDuration \}\}/);
});
