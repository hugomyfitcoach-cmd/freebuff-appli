/**
 * Tests MISSION — Indicateurs nutritionnels : pastilles colorées (style du
 * « Récap de la semaine ») à la place des pictogrammes Calories / Glucides /
 * Protéines / Lipides. Couleurs : kcal vert, glucides rose, protéines bleu,
 * lipides orange. Valeurs et calculs inchangés (non couverts ici).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const journal = read('../src/routes/espace/journal/+page.svelte');
const performance = read('../src/routes/espace/performance/+page.svelte');
const perfCard = read('../src/lib/components/PerformanceWeekCard.svelte');
const home = read('../src/routes/espace/+page.svelte');

const NUTRI_ICONS = /name="(flame|wheat|drumstick|droplet)"|name=\{(ring|macroMeta)\.icon\}/;

test('Nouveau repas / Modifier le repas : totaux en pastilles, plus de pictogrammes', () => {
	const start = journal.indexOf('<!-- Totaux live -->');
	const end = journal.indexOf('Plat entier', start);
	assert.ok(start > 0 && end > start, 'bloc des totaux présent');
	const block = journal.slice(start, end);
	assert.doesNotMatch(block, /<Icon /, 'aucun pictogramme dans les totaux');
	assert.match(block, /h-1\.5 w-1\.5 rounded-full bg-brand/, 'kcal : pastille verte');
	assert.match(block, /background:#ec4899/, 'glucides : rose');
	assert.match(block, /background:#3b82f6/, 'protéines : bleu');
	assert.match(block, /background:#f97316/, 'lipides : orange');
});

test('Détail macro (vide) : pastille à la couleur de la macro', () => {
	assert.doesNotMatch(journal, /<Icon name=\{macroMeta\.icon\} size=\{22\}/);
	assert.match(journal, /h-1\.5 w-1\.5 rounded-full" style:background=\{macroMeta\.color\}/);
});

test('Performance : anneaux macro et en-têtes Calories en pastilles', () => {
	assert.doesNotMatch(performance, NUTRI_ICONS, 'aucun pictogramme macro/kcal');
	assert.match(performance, /style="background:\{ring\.color\}"/, 'anneaux : couleur de la macro');
	assert.match(performance, /h-1\.5 w-1\.5 shrink-0 rounded-full bg-brand"><\/span> Calories/);
	assert.match(performance, /h-1\.5 w-1\.5 shrink-0 rounded-full bg-brand"><\/span> kcal moy\./);
});

test('Carte semaine (objectif kcal) et Accueil : pastille verte', () => {
	assert.doesNotMatch(perfCard, /name="flame"/);
	assert.match(perfCard, /h-1\.5 w-1\.5 shrink-0 rounded-full bg-brand"><\/span> Objectif/);
	assert.doesNotMatch(home, /<Icon name="flame" size=\{19\}/);
	assert.match(home, /h-1\.5 w-1\.5 rounded-full bg-brand/);
});
