/**
 * Tests MISSION — Ajout rapide d'eau depuis l'Accueil.
 *
 * 1) Le bouton + est frère du lien « Mon hydratation » (aucune navigation
 *    déclenchée par le +) et ouvre la feuille sans changer de page ;
 * 2) La feuille réutilise l'API existante (POST /api/hydration) et les mêmes
 *    animations que la saisie du poids, avec les raccourcis +150/+250/+500 ;
 * 3) Après une prise, la carte est revalidée (total, %, anneau) ;
 * 4) Aucune nouvelle route ni logique serveur.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const home = read('../src/routes/espace/+page.svelte');
const sheet = read('../src/lib/components/HydrationQuickSheet.svelte');

test('Accueil : le bouton + est un frère du lien vers Mon hydratation', () => {
	const start = home.indexOf('gflux-home-hydration');
	const end = home.indexOf('</a>', home.indexOf('href="/espace/hydratation"'));
	const card = home.slice(start, end);
	assert.ok(card.includes('href="/espace/hydratation"'), 'le lien détaillé est conservé');
	const linkStart = card.indexOf('<a href="/espace/hydratation"');
	const buttonStart = card.indexOf('<button');
	assert.ok(buttonStart >= 0 && buttonStart < linkStart, 'le bouton est hors du lien');
	assert.match(card.slice(buttonStart, linkStart), /onclick=\{openHydrationSheet\}/);
	assert.match(card.slice(buttonStart, linkStart), /aria-label="Ajouter de l'eau"/);
});

test('Accueil : feuille d’ajout branchée, revalidation de la carte après prise', () => {
	assert.match(home, /import HydrationQuickSheet from '\$lib\/components\/HydrationQuickSheet\.svelte';/);
	assert.match(home, /<HydrationQuickSheet[\s\S]*?onSaved=\{onHydrationSaved\}/);
	assert.match(home, /async function onHydrationSaved\(\) \{\s*await invalidateAll\(\);/);
});

test('Feuille : raccourcis +150/+250/+500 enregistrés via POST /api/hydration', () => {
	assert.match(sheet, /const PRESETS = \[150, 250, 500\];/);
	assert.match(sheet, /fetch\('\/api\/hydration', \{[\s\S]*?method: 'POST'[\s\S]*?body: JSON\.stringify\(\{ date, ml \}\)/);
	assert.match(sheet, /if \(saving \|\| done !== null\) return;/, 'anti double-enregistrement');
});

test('Feuille : mêmes animations que la saisie du poids et fermeture Échap / safe area', () => {
	assert.match(sheet, /import \{ sheetFade, sheetFly \} from '\$lib\/sheetMotion';/);
	assert.match(sheet, /transition:fade=\{sheetFade\(\)\}/);
	assert.match(sheet, /transition:fly=\{sheetFly\(\)\}/);
	assert.match(sheet, /env\(safe-area-inset-bottom\)/);
	assert.match(sheet, /e\.key === 'Escape'/);
});

test('Feuille : bornes 1–5000 ml et saisie libre, sans nouvelle route serveur', () => {
	assert.match(sheet, /const ML_MAX = 5000;/);
	assert.match(sheet, /inputmode="numeric"/);
	assert.doesNotMatch(sheet, /from '\$lib\/server|convex\/_generated|api\.hydration\./, 'aucun import serveur ni appel Convex direct');
});
