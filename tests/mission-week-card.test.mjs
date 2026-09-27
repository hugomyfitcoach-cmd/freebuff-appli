/**
 * Tests MISSION — CARTE « Tes 7 derniers jours terminés » (Accueil cliente).
 *
 * Garde-fous :
 *  1. UNE SEULE SOURCE DE VÉRITÉ : dashboard.ts réutilise visionWindow +
 *     parisTodayISO + foodAverages + stepsAverages (module lib/vision360.ts) —
 *     aucune fenêtre ni moyenne recalculée localement ;
 *  2. FENÊTRE : 7 journées calendaires complètes J-7 → J-1 (Europe/Paris),
 *     aujourd'hui TOUJOURS exclu, recalculée à chaque consultation — plus
 *     jamais la semaine calendaire lundi → dimanche, ni la visibilité sam/dim ;
 *  3. CALORIES : mêmes journées EXPLOITABLES que la Vision 360 (seuil
 *     max(800, 60 % objectif)) — absence ≠ 0 ≠ partiel ;
 *  4. PAS : exactement la même fenêtre/moyenne que la page Pas ;
 *  5. PAGE PAS : parisTodayISO() — même fuseau de référence que l'Accueil,
 *     impossible d'avoir deux moyennes différentes au même moment ;
 *  6. UI : titre « Tes 7 derniers jours terminés », plage dynamique,
 *     libellés exploitables/partielles cohérents Vision 360.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { visionWindow, foodAverages, stepsAverages } from '../src/lib/vision360.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dashboard = readFileSync(join(root, 'src/convex/dashboard.ts'), 'utf8');
const homePage = readFileSync(join(root, 'src/routes/espace/+page.svelte'), 'utf8');
const pasPage = readFileSync(join(root, 'src/routes/espace/pas/+page.svelte'), 'utf8');

/* ── 1. Source unique ── */

test('SOURCE UNIQUE : la carte réutilise les helpers Vision 360 (aucun calcul local)', () => {
	assert.ok(dashboard.includes('from "../lib/vision360"'), 'dashboard importe le module partagé');
	assert.ok(dashboard.includes('visionWindow(parisTodayISO(ts))'), 'fenêtre J-7 → J-1 sur Paris, recalculée à chaque appel');
	assert.ok(dashboard.includes('foodAverages('), 'calories : helper Vision 360');
	assert.ok(dashboard.includes('stepsAverages('), 'pas : helper Vision 360');
});

/* ── 2. Fenêtre J-7 → J-1, tous les jours, jamais la semaine calendaire ── */

test('FENÊTRE : plus jamais la semaine calendaire ni la visibilité sam/dim', () => {
	assert.ok(!/dow === 6 \|\| dow === 0/.test(dashboard), 'la carte n\'est plus limitée au week-end');
	const block = dashboard.slice(dashboard.indexOf('/* ── Récap hebdo'), dashboard.indexOf('const recap = {') + 600);
	assert.ok(block.includes('windowStart') && block.includes('windowEnd'), 'nouvelle plage J-7 → J-1 exposée');
	assert.ok(!block.includes('recapWeekStart'), 'ancienne variable semaine calendaire supprimée');
});

test('FENÊTRE : exemple métier — dimanche 27 → 20→26, lundi 28 → 21→27', () => {
	const w = visionWindow('2026-09-27');
	assert.equal(w.start, '2026-09-20');
	assert.equal(w.end, '2026-09-26');
	assert.ok(!w.days.includes('2026-09-27'), 'aujourd\'hui toujours exclu');
	const w2 = visionWindow('2026-09-28');
	assert.equal(w2.start, '2026-09-21');
	assert.equal(w2.end, '2026-09-27');
});

/* ── 3. Calories : garde-fou Vision 360 ── */

test('CALORIES : totaux par journée (absence = null) + compteur EXPLOITABLES', () => {
	const block = dashboard.slice(dashboard.indexOf('Totaux caloriques par journée'), dashboard.indexOf('const recap = {') + 600);
	assert.ok(block.includes('kcalByDay360'), 'totaux par journée de la fenêtre');
	assert.ok(dashboard.includes('trackedDays: food360Home.breakdown.exploitableDays'), 'compteur = jours EXPLOITABLES (seuil 60 %)');
	assert.ok(dashboard.includes('partialDays: food360Home.breakdown.partialDays'), 'journées partielles exposées');
});

test('CALCUL : moyenne calories = uniquement jours exploitables (journée 700 kcal sous seuil 1050 exclue)', () => {
	const days = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'];
	const totals = new Map();
	for (const d of days) totals.set(d, { kcal: 1500, protein: null });
	totals.set('2026-09-25', { kcal: 700, protein: null }); // partielle (objectif 1750 → seuil 1050)
	const avg = foodAverages(totals, days, 1750);
	assert.equal(avg.breakdown.exploitableDays, 6);
	assert.equal(avg.breakdown.partialDays, 1);
	assert.equal(avg.kcalAvg, 1500);
});

test('CALCUL : absence de donnée ≠ 0 ≠ partiel (3 catégories distinctes)', () => {
	const days = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'];
	const totals = new Map();
	for (const d of days) totals.set(d, { kcal: null, protein: null });
	totals.set('2026-09-21', { kcal: 1600, protein: null }); // exploitable
	totals.set('2026-09-22', { kcal: 700, protein: null }); // partiel
	const b = foodAverages(totals, days, 1750).breakdown;
	assert.deepEqual({ e: b.exploitableDays, p: b.partialDays, a: b.absentDays }, { e: 1, p: 1, a: 5 });
});

/* ── 4. Pas : même fenêtre/moyenne que la page Pas ── */

test('PAS : moyenne calculée sur la fenêtre partagée (visionDays), jours renseignés', () => {
	const block = dashboard.slice(dashboard.indexOf('const steps360Home'), dashboard.indexOf('const recap = {') + 600);
	assert.ok(block.includes('visionDays'), 'moyenne pas sur la fenêtre J-7 → J-1');
});

test('CALCUL : pas — 6/7 renseignés, jour absent distinct (même helper que la page Pas)', () => {
	const days = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'];
	const rows = days.slice(0, 6).map((d) => ({ date: d, count: 12000 }));
	const s = stepsAverages(rows, days);
	assert.equal(s.trackedDays, 6);
	assert.equal(s.avg, 12000);
	assert.equal(s.series[6].count, null);
});

/* ── 5. Page Pas : même fuseau de référence ── */

test('PAGE PAS : parisTodayISO() — jamais deux moyennes différentes au même moment', () => {
	assert.ok(pasPage.includes('parisTodayISO()'), 'page Pas : aujourd\'hui Europe/Paris');
	assert.ok(!pasPage.includes('const d = new Date();'), 'ancien Date() local supprimé');
	assert.ok(pasPage.includes("from '$lib/vision360'"), 'helper partagé importé');
});

/* ── 6. UI de la carte ── */

test('UI CARTE : titre « Tes 7 derniers jours terminés » + plage dynamique', () => {
	assert.ok(homePage.includes('Tes 7 derniers jours terminés'), 'nouveau titre');
	assert.ok(!homePage.includes("Ta semaine en un coup d'œil"), 'ancien titre supprimé');
	assert.ok(homePage.includes('recap.windowStart') && homePage.includes('recap.windowEnd'), 'plage J-7 → J-1 affichée');
});

test('UI CARTE : libellés « jours exploitables » + partielles (cohérence Vision 360)', () => {
	const card = homePage.slice(homePage.indexOf('Tes 7 derniers jours terminés'));
	assert.ok(card.includes('jours exploitables'), 'calories : exploitables');
	assert.ok(card.includes('partiellement renseignée'), 'mention des partielles exclues');
});
