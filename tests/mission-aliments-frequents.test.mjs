/**
 * Mission : ALIMENTS FRÉQUENTS INTELLIGENTS (personnalisation « Ajouter un aliment »).
 *
 * Avant : « Tes aliments fréquents » = 12 derniers aliments utilisés
 * (journal.recentFoods) — aucune fréquence, aucune récence pondérée, aucun
 * contexte repas, notions « fréquents » et « récents » mélangées.
 *
 * Après (formule simple, explicable, SANS machine learning) :
 *  - score personnel = ln(1+consommations) + 0.5×exp(-jours/7) + bonus repas ;
 *  - panier 20 → « Voir plus » jusqu'à 50 (au lieu du cap dur 12) ;
 *  - IDENTITÉ EXACTE conservée : produit OFF importé (marque/barcode/image),
 *    fiche perso, référence CIQUAL — jamais remplacés par une fiche générique ;
 *  - recherche personnalisée = couche AU-DESSUS du moteur OFF (jamais dedans) ;
 *  - « Tes aliments fréquents » (habitudes apprises) ≠ « Récemment utilisés ».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const journal = read('src/convex/journal.ts');
const schema = read('src/convex/schema.ts');
const freqBff = read('src/routes/api/foods/frequent/+server.ts');
const searchBff = read('src/routes/api/foods/search/+server.ts');
const journalPage = read('src/routes/espace/journal/+page.svelte');

/** Module PUR de scoring (aucune dépendance Convex) — importé directement. */
const ff = await import(new URL('../src/lib/foodFrequency.ts', import.meta.url).href);

const NOW = Date.parse('2026-10-05T12:00:00Z');
const DAY = 86_400_000;

/* ── FORMULE DE SCORING (fréquence × récence × contexte repas) ── */

test('Produit consommé 10 fois → remonte TRÈS haut devant une consommation unique', () => {
	const veryFrequent = ff.frequencyScore('Maquereau', { count: 10, lastMs: NOW - 30 * DAY }, { nowMs: NOW });
	const once = ff.frequencyScore('Corn Flakes', { count: 1, lastMs: NOW - DAY }, { nowMs: NOW });
	assert.ok(veryFrequent > once, `ln(1+10)=2.40 + recence nulle (${veryFrequent.toFixed(2)}) > 1× hier (${once.toFixed(2)})`);
});

test('Une consommation unique récente ne domine PAS forcément un habituel', () => {
	const onceYesterday = ff.frequencyScore('Biscuit', { count: 1, lastMs: NOW - DAY }, { nowMs: NOW });
	const regular = ff.frequencyScore('Poulet', { count: 5, lastMs: NOW - 7 * DAY }, { nowMs: NOW });
	assert.ok(regular > onceYesterday, '5× la semaine passée > 1× hier (fréquence amortie mais dominante)');
});

test('Récence : bonus doux qui s\u2019efface (hier > il y a un mois, même fréquence)', () => {
	const recent = ff.frequencyScore('Skyr', { count: 3, lastMs: NOW - DAY }, { nowMs: NOW });
	const old = ff.frequencyScore('Skyr', { count: 3, lastMs: NOW - 30 * DAY }, { nowMs: NOW });
	assert.ok(recent > old);
	assert.ok(old > ff.frequencyScore('Skyr', { count: 3, lastMs: NOW - 365 * DAY }, { nowMs: NOW }), 'décroissance monotone');
});

test('Bonus repas : céréales au petit-déj, maquereau au dîner — JAMAIS inversé', () => {
	const base = { nowMs: NOW, currentMeal: undefined };
	const petitDej = { nowMs: NOW, currentMeal: 'petit-dej' };
	const diner = { nowMs: NOW, currentMeal: 'diner' };
	const stats = { count: 2, lastMs: NOW - DAY };
	const cereales = ff.frequencyScore('Corn Flakes', stats, petitDej) - ff.frequencyScore('Corn Flakes', stats, base);
	const maquereau = ff.frequencyScore('Maquereau grille', stats, diner) - ff.frequencyScore('Maquereau grille', stats, base);
	assert.ok(Math.abs(cereales - ff.FREQ_WEIGHTS.mealBonus) < 1e-9, 'affinité petit-déj');
	assert.ok(Math.abs(maquereau - ff.FREQ_WEIGHTS.mealBonus) < 1e-9, 'affinité dîner');
	assert.equal(ff.frequencyScore('Corn Flakes', stats, diner), ff.frequencyScore('Corn Flakes', stats, base), 'pas de bonus céréales au dîner');
	assert.equal(ff.frequencyScore('Maquereau grille', stats, petitDej), ff.frequencyScore('Maquereau grille', stats, base), 'pas de bonus maquereau au petit-déj');
});

test('CLASSEMENT : 10× > 1× récent > rare ancien ; tie-break déterministe', () => {
	const names = new Map([
		['f:maq', 'Maquereau'],
		['f:corn', 'Corn Flakes'],
		['f:poulet', 'Poulet'],
	]);
	const ranked = ff.rankFrequentFoods(
		[
			{ key: 'f:corn', meal: 'petit-dej', createdAtMs: NOW - DAY }, // 1× hier
			...Array.from({ length: 10 }, (_, i) => ({ key: 'f:maq', meal: 'diner', createdAtMs: NOW - (10 + i) * DAY })), // 10×
			{ key: 'f:poulet', meal: 'dejeuner', createdAtMs: NOW - 60 * DAY }, // 1× ancien
		],
		names,
		{ nowMs: NOW }
	);
	assert.deepEqual(ranked.map((r) => r.key), ['f:maq', 'f:corn', 'f:poulet']);
	// Statistiques apprises fiables :
	assert.equal(ranked[0].stats.count, 10);
	assert.equal(ranked[0].stats.lastMs, NOW - 10 * DAY, 'dernière consommation (pas la première)');
});

test('IDENTITÉ EXACTE : sources séparées (OFF / perso / CIQUAL), jamais fusionnées', () => {
	assert.equal(ff.foodFrequencyKey('food', 'abc123'), 'f:abc123');
	assert.equal(ff.foodFrequencyKey('custom', 'abc123'), 'c:abc123');
	assert.equal(ff.foodFrequencyKey('ciqual', 'Maquereau cuit au four'), 'q:Maquereau cuit au four');
	const ranked = ff.rankFrequentFoods(
		[
			{ key: 'f:xyz', createdAtMs: NOW }, // produit OFF précis
			{ key: 'q:Maquereau', createdAtMs: NOW }, // référence générique CIQUAL
		],
		new Map([['f:xyz', 'Maquereau'], ['q:Maquereau', 'Maquereau']]),
		{ nowMs: NOW }
	);
	assert.equal(ranked.length, 2, 'le produit emballé précis n\u2019est JAMAIS remplacé par la fiche générique');
});

test('Module PUR : sans Convex, sans réseau, formule en un seul endroit', () => {
	const src = read('src/lib/foodFrequency.ts');
	assert.ok(!src.includes('convex') && !src.includes('fetch('), 'aucune dépendance runtime');
	assert.ok(src.includes('Math.log(1 +'), 'formule fréquence explicable');
	assert.ok(src.includes('Math.exp(-days'), 'demi-vie récence explicable');
});

/* ── QUERY CONVEX ADDITIVE (zéro schema, zéro migration) ── */

test('journal.freqFoods : query additive — même table, MÊME index existant by_user', () => {
	assert.ok(journal.includes('export const freqFoods = query({'), 'nouvelle query additive');
	assert.ok(journal.includes('from "../lib/foodFrequency"'), 'scoring via le module pur');
	const fn = journal.slice(journal.indexOf('export const freqFoods'));
	assert.ok(fn.includes('.withIndex("by_user"'), 'index EXISTANT (aucun nouveau)');
	assert.ok(fn.includes('foodFrequencyKey("food"') && fn.includes('foodFrequencyKey("custom"') && fn.includes('foodFrequencyKey("ciqual"'), '3 identités stables');
});

test('Zéro schema : la mission n\u2019ajoute NI table NI index Convex', () => {
	assert.ok(!schema.includes('freq'), 'aucune trace schema');
	assert.ok((schema.match(/\.index\(/g) || []).length >= 1, 'schema lisible');
	// Le nouveau code n'introduit aucun defineTable/index ailleurs :
	assert.ok(!journal.slice(journal.indexOf('ALIMENTS FRÉQUENTS INTELLIGENTS')).includes('defineTable'));
});

test('Panier borné : 20 par défaut, 50 MAX (fenêtre d\u2019historique plafonnée)', () => {
	const fn = journal.slice(journal.indexOf('const FREQ_WINDOW'));
	assert.ok(fn.includes('FREQ_WINDOW = 300'), 'fenêtre de scan plafonnée (performance)');
	assert.ok(fn.includes('FREQ_MAX_LIMIT = 50'), 'plafond 50');
	assert.ok(fn.includes('Math.min(FREQ_MAX_LIMIT'), 'clamp effectif');
});

test('CIQUAL : identité = libellé officiel exact (les entrées ne persistent pas d\u2019id ciqual)', () => {
	const fn = journal.slice(journal.indexOf('const freqKeyOf'));
	assert.ok(fn.includes('e.name'), 'clé CIQUAL dérivée du nom journalisé (snapshot officiel)');
	assert.ok(fn.includes('!e.mealId'), 'repas planifiés exclus du périmètre fréquents');
	const resolve = journal.slice(journal.indexOf('ciqualFoodSource(label)') - 400, journal.indexOf('ciqualFoodSource(label)') + 200);
	assert.ok(resolve.includes('ciqualFoodSource(label)'), 'résolution libellé par libellé (fonction synchrone)');
});

/* ── BFF : /api/foods/frequent (limite clampée, repas whitelisté) ── */

test('BFF frequent : clamp 1..50, meal whitelisté, query journal.freqFoods', () => {
	assert.ok(freqBff.includes('api.journal.freqFoods'), 'nouvelle query branchée');
	assert.ok(freqBff.includes('Math.min(50'), 'limite clampée au plafond serveur');
	assert.ok(freqBff.includes("new Set(['petit-dej', 'dejeuner', 'diner', 'collation'] as const)"), 'repas whitelisté (littéraux typés)');
	assert.ok(freqBff.includes('requireRole'), 'garde session inchangée');
});

test('Moteur de recherche OFF INTOUCHE : la personnalisation est une couche CLIENT', () => {
	assert.ok(searchBff.includes('api.off.searchFoods'), 'même action de recherche');
	assert.ok(!searchBff.includes('freqFoods') && !searchBff.includes('recentFoods'), 'aucun mélange historique/recherche côté action');
	assert.ok(journalPage.includes('personalOverlay('), 'couche personnelle au-dessus des résultats');
	assert.ok(journalPage.includes('if (!favOnly) applyPersonalOverlay()'), 'branchée sur la recherche principale');
	assert.ok(journalPage.includes('personalOverlay(prods, mealAddQuery)'), 'et sur la feuille « Ajouter un ingrédient »');
});

test('Overlay : correspondance PERTINENTE uniquement (tokens significatifs communs)', () => {
	const fn = journalPage.slice(journalPage.indexOf('function personalOverlay'));
	assert.ok(fn.includes('length >= 4'), 'tokens significatifs (pas « de », « la »)');
	assert.ok(fn.includes('if (personal.length === 0) return list'), 'aucune correspondance → ordre du moteur INTACT');
	assert.ok(fn.includes('freqFoods.filter((f) => personalIds.has(f._id)'), 'les habituels d\u2019abord, ordre du score serveur');
});

/* ── UX : deux sections distinctes, « Voir plus », quantité habituelle ── */

test('UI : « Tes aliments fréquents » (habitudes) ≠ « Récemment utilisés » — jamais mélangés', () => {
	assert.ok(journalPage.includes('Tes aliments fréquents'), 'section habitudes apprises');
	assert.ok(journalPage.includes('tes habitudes'), 'légende distincte');
	assert.ok(journalPage.includes('Récemment utilisés'), 'section historique récent séparée');
	assert.ok(journalPage.includes('derniers ajouts'), 'légende distincte');
});

test('UI : panier 20 → « Voir plus » progressif jusqu\u2019à 50', () => {
	assert.ok(journalPage.includes('Voir plus'), 'bouton de chargement progressif');
	assert.ok(journalPage.includes('const FREQ_PAGE = 20'), '20 premiers');
	assert.ok(journalPage.includes('freqLimit = Math.min(50, freqLimit + 10)'), '+10 par clic, plafond 50');
	assert.ok(journalPage.includes('loadMoreFreq'), 'handler dédié');
});

test('UI : contexte repas transmis à l\u2019ouverture (bonus d\u2019affinité serveur)', () => {
	const open = journalPage.slice(journalPage.indexOf('async function openLog'), journalPage.indexOf('async function openLog') + 900);
	assert.ok(open.includes('loadFreq(qtyMeal)'), 'repas en cours → bonus affinité');
	assert.ok(journalPage.includes('function loadFreq(meal?: string)'), 'chargement fréquents paramétré');
});

test('Quantité habituelle : RÉUTILISÉE (portion mémorisée existante, jamais inventée)', () => {
	assert.ok(journalPage.includes('/api/foods/portion'), 'endpoint portion existant réutilisé');
	const fn = journalPage.slice(journalPage.indexOf('function uiPortionList'));
	assert.ok(fn.includes('freqFoods.length > 0 ? freqFoods : recentFoods'), 'les fréquents participent à la mémorisation de portion');
	assert.ok(!journalPage.includes('portionInventee'), 'aucune quantité inventée');
});

test('Fallback propre : peu d\u2019historique → récents seuls, jamais d\u2019écran vide', () => {
	const block = journalPage.slice(journalPage.indexOf('{#if freqFoods.length > 0}'), journalPage.indexOf('{#if freqFoods.length > 0}') + 1600);
	assert.ok(block.includes('recentFoods.length > 0'), 'récents affichés même sans habitudes');
	assert.ok(block.includes('recentLoaded && freqFoods.length === 0'), 'écran d\u2019accueil recherche intact');
});
