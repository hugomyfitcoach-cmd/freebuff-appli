import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const home = readFileSync(join(root, 'src/routes/espace/+page.svelte'), 'utf8');
const weekCard = readFileSync(join(root, 'src/lib/components/PerformanceWeekCard.svelte'), 'utf8');

test('Home lot 1 : raccourcis suivent l’ordre Recettes, Drive, Bilans, Entraînement de la maquette', () => {
	const start = home.indexOf('const chips = $derived([');
	const end = home.indexOf(']);', start);
	const shortcuts = home.slice(start, end);
	assert.ok(start >= 0 && end > start, 'liste de raccourcis conservée');
	assert.ok(shortcuts.indexOf("label: 'Recettes'") < shortcuts.indexOf("label: 'Drive'"));
	assert.ok(shortcuts.indexOf("label: 'Drive'") < shortcuts.indexOf("label: 'Bilans'"));
	assert.ok(shortcuts.indexOf("label: 'Bilans'") < shortcuts.indexOf("label: 'Entraînement'"));
	assert.match(home, /gflux-home-shortcuts[\s\S]{0,220}aria-label="Raccourcis"/);
});

test('Home lot 1 : calories forment la carte principale et gardent macro/données/actions existantes', () => {
	const today = home.slice(home.indexOf('<section aria-label="Aujourd\'hui"'), home.indexOf('<!-- ═══════════ Ma progression'));
	assert.ok(today.indexOf('gflux-home-calories') < today.indexOf('gflux-home-steps'), 'calories avant l’histogramme des pas');
	const caloriesStart = today.indexOf('gflux-home-calories');
	const anchorStart = today.lastIndexOf('<a', caloriesStart);
	const calories = today.slice(anchorStart, today.indexOf('gflux-home-steps', caloriesStart));
	assert.ok(calories.includes('href="/espace/journal"'), 'raccourci Calories mène au Journal');
	assert.match(calories, /<MacroLine data=\{macroState\} featured \/>/);
	assert.match(calories, /kcalStatusText/);
	assert.match(calories, /kcalBarClass/);
	assert.match(today, /stepsLast7 as d/);
	assert.match(today, /role="img" aria-label=\{stepsChartLabel\}/);
	assert.match(today, /href="\/espace\/pas"/);
	assert.match(today, /grid grid-cols-2 gap-3/);
	assert.match(today, /onCycleCardClick/);
});

test('Home lot 1 : Performance présente les 7 jours et les trois indicateurs attendus', () => {
	const start = home.indexOf('gflux-home-performance');
	const end = home.indexOf('<!-- ═══════════ Dépense sportive', start);
	const performance = home.slice(start, end);
	assert.ok(start >= 0 && end > start, 'carte Performance présente');
	assert.match(performance, /MOYENNE|Moyenne/);
	assert.match(performance, /OBJECTIF|Objectif/);
	assert.match(performance, /DÉFICIT|Déficit/);
	assert.match(performance, /<PerformanceWeekCard[^>]+featured/);
	assert.ok(home.indexOf('Ma progression') < start, 'la carte Ma progression précède Performance comme dans la maquette');
	assert.match(weekCard, /featured \? 'h-\[116px\]'/);
	assert.match(weekCard, /class:perf-featured=\{featured\}/);
});

test('Home lot 1 conserve les états vides futurs et respecte prefers-reduced-motion', () => {
	assert.match(weekCard, /isFuture\(d\.date\)/);
	assert.match(weekCard, /d\.tracked && !future/);
	assert.match(weekCard, /prefers-reduced-motion/);
	assert.match(home, /Aucune journée renseignée cette semaine/);
});
