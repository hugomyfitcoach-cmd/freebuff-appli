/**
 * Tests MISSION — Saisie rapide du poids depuis l'Accueil.
 *
 * 1) Saisie : lecture décimale (virgule ou point), vide et invalide rejetés ;
 * 2) Bornes identiques au serveur (30 à 350 kg) ;
 * 3) Mise à jour locale : fusion par date, masse grasse recalculée, rien
 *    d'inventé quand aucun instantané n'existe encore ;
 * 4) Câblage : carte Poids ouvre la feuille (sans changer de page), anti
 *    double-enregistrement, lien « Voir mon historique » vers le détail Poids,
 *    et aucune nouvelle route ni logique serveur.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cacheGet, cacheSet } from '../src/lib/navMemory.ts';
import {
	applyWeightLocally,
	checkWeightKg,
	parseWeightKg,
	PROGRESSION_ROUTE,
	WEIGHT_MAX_KG,
	WEIGHT_MIN_KG,
} from '../src/lib/weightLog.ts';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const home = read('../src/routes/espace/+page.svelte');
const sheet = read('../src/lib/components/WeightQuickSheet.svelte');
const progression = read('../src/routes/espace/progression/+page.svelte');
const metricsRoute = read('../src/routes/api/metrics/+server.ts');

test('saisie : virgule et point acceptés, vide et invalide rejetés', () => {
	assert.equal(parseWeightKg('68,3'), 68.3);
	assert.equal(parseWeightKg('68.3'), 68.3);
	assert.equal(parseWeightKg(' 70 '), 70);
	assert.equal(parseWeightKg(''), undefined);
	assert.equal(parseWeightKg('   '), undefined);
	assert.equal(parseWeightKg('68.3.1'), undefined);
	assert.equal(parseWeightKg('abc'), undefined);
});

test('bornes identiques au serveur (api.metrics.upsert : 30 à 350 kg)', () => {
	assert.equal(WEIGHT_MIN_KG, 30);
	assert.equal(WEIGHT_MAX_KG, 350);
	assert.equal(checkWeightKg(undefined), 'Saisis ton poids en kg.');
	assert.notEqual(checkWeightKg(29.9), null);
	assert.notEqual(checkWeightKg(350.1), null);
	assert.equal(checkWeightKg(30), null);
	assert.equal(checkWeightKg(350), null);
	assert.equal(checkWeightKg(72.4), null);
});

test('mise à jour locale : aucun instantané en cache → rien d\'inventé', () => {
	cacheSet(PROGRESSION_ROUTE, undefined);
	assert.equal(applyWeightLocally(70, '2026-10-15'), null);
});

test('mise à jour locale : fusion par date, masse grasse recalculée, cache mis à jour', () => {
	cacheSet(PROGRESSION_ROUTE, {
		heightCm: 165,
		measurements: [
			{ _id: 'a', date: '2026-10-10', weightKg: 69, neckCm: 33, waistCm: 80, hipCm: 100 },
		],
		bodyFat: [],
	});
	const next = applyWeightLocally(68.3, '2026-10-15');
	assert.ok(next, 'un instantané existant est mis à jour');
	const today = next.measurements.find((m) => m.date === '2026-10-15');
	assert.equal(today?.weightKg, 68.3);
	// Ordre chronologique conservé
	assert.deepEqual(
		next.measurements.map((m) => m.date),
		['2026-10-10', '2026-10-15'],
	);
	// Même date : seule la pesée change, les autres mesures sont conservées
	const again = applyWeightLocally(68.1, '2026-10-10');
	const sameDay = again.measurements.find((m) => m.date === '2026-10-10');
	assert.equal(sameDay.weightKg, 68.1);
	assert.equal(sameDay.neckCm, 33);
	assert.equal(again.measurements.filter((m) => m.date === '2026-10-10').length, 1);
	// Le cache « Ma progression » reflète la nouvelle valeur
	assert.equal(cacheGet(PROGRESSION_ROUTE), again);
});

test('câblage : la carte Poids ouvre la feuille au lieu de naviguer', () => {
	const start = home.indexOf('POIDS : saisie rapide');
	const end = home.indexOf('<!-- CYCLE -->');
	assert.ok(start > 0 && end > start, 'carte Poids présente');
	const card = home.slice(start, end);
	assert.match(card, /<button\s[\s\S]*onclick=\{openWeightSheet\}/, 'carte = bouton ouvrant la feuille');
	assert.doesNotMatch(card, /href="\/espace\/progression"/, 'plus de navigation directe');
	assert.match(home, /import WeightQuickSheet from '\$lib\/components\/WeightQuickSheet\.svelte'/);
	assert.match(home, /<WeightQuickSheet[\s\S]*onSaved=\{onWeightSaved\}/);
});

test('câblage : après enregistrement, carte Poids et Ma progression sont mises à jour', () => {
	assert.match(home, /async function onWeightSaved\(kg: number, date: string\)/);
	assert.match(home, /applyWeightLocally\(kg, date\)/, 'Ma progression (cache + partagé) mise à jour');
	assert.match(home, /await invalidateAll\(\);/, 'revalidation serveur de l\'Accueil');
	assert.match(home, /weightOverride\s*\?\s*weightOverride\.kg/, 'carte Poids affiche la pesée immédiatement');
});

test('feuille : clavier décimal, dialogue accessible, marges de sécurité iPhone', () => {
	assert.match(sheet, /inputmode="decimal"/);
	assert.match(sheet, /role="dialog"/);
	assert.match(sheet, /aria-modal="true"/);
	assert.match(sheet, /env\(safe-area-inset-bottom\)/);
	assert.match(sheet, /aria-label="Fermer"/);
	assert.match(sheet, /Escape/);
});

test('feuille : anti double-enregistrement et enregistrement via le flux existant', () => {
	assert.match(sheet, /if \(saving \|\| done\) return;/, 'garde contre les envois multiples');
	assert.match(sheet, /disabled=\{saving \|\| done\}/, 'bouton désactivé pendant l\'envoi');
	assert.match(sheet, /await saveWeightKg\(date, kg\)/);
	assert.match(read('../src/lib/weightLog.ts'), /fetch\('\/api\/metrics'/, 'même endpoint que Ma progression');
});

test('feuille : pesée du jour existante proposée en modification', () => {
	assert.match(sheet, /isToday \? 'Modifier ma pesée' : 'Enregistrer ma pesée'/);
	assert.match(sheet, /Une pesée existe déjà aujourd'hui/);
});

test('lien « Voir mon historique » ouvre le détail Poids dans Ma progression', () => {
	assert.match(sheet, /href="\/espace\/progression\?detail=weightKg"/);
	assert.match(progression, /params\.get\('detail'\) === 'weightKg'\) openDetail\('weightKg'\)/);
});

test('aucune nouvelle route ni logique serveur : endpoint existant inchangé', () => {
	assert.match(metricsRoute, /api\.metrics\.upsert/);
});
