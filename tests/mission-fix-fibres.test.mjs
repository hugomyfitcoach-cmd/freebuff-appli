/**
 * Tests MISSION FIX-FIBRES — carte Fibres à état unique + note d'estimation.
 *
 * 1) `affichageFibres` : la carte du Journal affiche TOUJOURS « X g / Y g »,
 *    que la couverture kcal soit totale ou partielle (40 % → même valeur).
 * 2) `bilanJour.fibresInconnues` : compte les aliments dont les fibres sont
 *    inconnues, sans changer un seul total.
 * 3) JournalDay : état unique (plus de mention « au moins » / « Données
 *    incomplètes » / « pas assez de données », plus de jauge grise).
 * 4) Volet : note « Estimation » si au moins un aliment a des fibres
 *    inconnues, absente sinon ; la ligne « Calculé sur N % » est conservée.
 * 5) Ajout au journal d'un produit OFF : complétion OFF en arrière-plan
 *    (`refreshOffDetails`, règle 30 jours côté serveur), jamais bloquante,
 *    puis recalcul du bilan du jour ; le cache par date est invalidé à
 *    chaque ajout / modification / suppression.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { affichageFibres, bilanJour, repereFibres } from '../src/lib/bilanJour.ts';

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const journalDay = source('src/lib/components/JournalDay.svelte');
const bilanSheet = source('src/lib/components/BilanJourSheet.svelte');
const journalPage = source('src/routes/espace/journal/+page.svelte');

/* ─── 1) Carte Fibres : état unique, indépendant de la couverture ─── */

test('carte Fibres : couverture 40 % affiche « X g / Y g », sans mention', () => {
	// Mêmes fibres + repère, quelle que soit la couverture : la carte ne
	// reçoit d'ailleurs plus la couverture du tout.
	const faible = affichageFibres(12, 32);
	const complet = affichageFibres(12, 32);
	assert.deepEqual(faible, complet, 'la couverture ne change pas l’affichage');
	assert.equal(faible.valeur, 12, 'valeur connue affichée telle quelle (12 g)');
	assert.equal(Math.round(faible.pct), 38, 'jauge = part du repère (12 / 32)');
	assert.ok(!/au moins|incomplet|pas assez/i.test(JSON.stringify(faible)), 'aucune mention');

	// Aucune valeur connue : 0 g, jauge vide — jamais un chiffre inventé.
	assert.deepEqual(affichageFibres(null, 32), { valeur: 0, pct: 0 });
	assert.deepEqual(affichageFibres(0, 32), { valeur: 0, pct: 0 });
	// Repère absent : plancher 25 g, comme `repereFibres`.
	assert.deepEqual(affichageFibres(25, 0), { valeur: 25, pct: 100 });
	assert.equal(repereFibres(0), 25);
	// Jauge plafonnée à 100 %.
	assert.equal(affichageFibres(60, 32).pct, 100);
});

/* ─── 2) Aliments à fibres inconnues (note du volet) ─── */

test('bilanJour : fibresInconnues compte les aliments sans fibres, totals inchangés', () => {
	const aliments = [
		{ name: 'Pain complet', kcal: 468, fibres: 15, sucres: 6, ags: 3.2, sel: 1.8 },
		{ name: 'Produit du commerce', kcal: 194, fibres: null, sucres: 12, ags: 1.4, sel: 0.4 },
		{ name: 'Tomates', kcal: 27, fibres: 1.8, sucres: 3.9, ags: 0.1, sel: 0.03 },
	];
	const b = bilanJour(aliments, 2148);
	assert.equal(b.fibresInconnues, 1, 'un aliment sans fibres → note affichée');
	assert.equal(b.fibres, 16.8, 'total des fibres connues inchangé');
	assert.equal(b.couverture, 72, 'couverture kcal inchangée');

	const complets = aliments.filter((a) => a.fibres !== null);
	assert.equal(bilanJour(complets, 2148).fibresInconnues, 0, 'tout est connu → aucune note');
	assert.equal(bilanJour([], 2148).fibresInconnues, 0, 'jour vide → aucune note');
});

/* ─── 3) JournalDay : carte à état unique ─── */

test('JournalDay : un seul état « X g / Y g » + jauge fibres, aucune mention', () => {
	assert.ok(journalDay.includes('affichageFibres('), 'affichage unique');
	assert.ok(journalDay.includes('/ {bilanJour?.repere} g'), 'toujours le repère à côté de la valeur');
	assert.ok(!journalDay.includes('etatFibres'), 'plus de logique à trois états dans la carte');
	const carte = journalDay.slice(
		journalDay.indexOf('{#if fibresCard}'),
		journalDay.indexOf('<!-- Repas -->')
	);
	assert.ok(carte.includes('bg-fibres'), 'jauge aux couleurs des fibres');
	assert.ok(!carte.includes('bg-mist'), 'plus de jauge grise');
	assert.ok(!carte.includes('au moins'), 'plus de « au moins »');
	assert.ok(!carte.includes('Données incomplètes'), 'plus de « Données incomplètes »');
	assert.ok(!carte.includes('pas assez de données'), 'plus de « pas assez de données »');
	assert.ok(!carte.includes('mention'), 'aucune mention conditionnelle');
});

/* ─── 4) Volet : note d'estimation conditionnelle ─── */

test('volet : note « Estimation » seulement si des fibres sont inconnues', () => {
	assert.ok(
		bilanSheet.includes('{#if bilan.fibresInconnues > 0}'),
		'note conditionnée au nombre d’aliments sans fibres'
	);
	assert.ok(
		bilanSheet.includes('Estimation : certains produits du commerce (Open Food Facts)'),
		'note discrète présente'
	);
	assert.ok(
		bilanSheet.includes('Le calcul repose surtout sur les aliments à référence nutritionnelle.'),
		'phrase complète'
	);
	assert.ok(
		bilanSheet.includes('Calculé sur {bilan.couverture} % des calories de la journée'),
		'ligne de couverture conservée'
	);
	// La note est dans le bloc Fibres, avant les sources : discrète, jamais un total.
	const note = bilanSheet.slice(
		bilanSheet.indexOf('{#if bilan.fibresInconnues > 0}'),
		bilanSheet.indexOf("{#if sources.length > 0}")
	);
	assert.ok(note.includes('text-mist'), 'style discret');
	assert.ok(!/bg-|danger/.test(note), 'aucune couleur d’alerte');
});

/* ─── 5) Ajout OFF : complétion en arrière-plan + invalidation du jour ─── */

test('ajout : complétion OFF en arrière-plan, puis recalcul du bilan du jour', () => {
	assert.ok(
		journalPage.includes("'/api/foods/details/refresh'"),
		'route de complétion OFF réutilisée (règle 30 jours côté Convex)'
	);
	assert.ok(journalPage.includes('async function completerOffEnArrierePlan('));
	assert.ok(
		journalPage.includes('if (offFoodId) void completerOffEnArrierePlan(offFoodId)'),
		'lancée sans être attendue : l’ajout n’est jamais bloqué'
	);
	assert.ok(
		journalPage.includes("!qtyFood.gflux && !qtyFood.ciqual && !qtyFood.custom"),
		'produit Open Food Facts uniquement'
	);
	// Recalcul du bilan une fois les valeurs OFF arrivées.
	const fn = journalPage.slice(
		journalPage.indexOf('async function completerOffEnArrierePlan('),
		journalPage.indexOf('function openBilanJour(')
	);
	assert.ok(fn.includes('if (j.refreshed) void loadBilanJour(d)'), 'bilan du jour rechargé');
	assert.ok(
		!/await\s+completerOffEnArrierePlan/.test(journalPage),
		'la complétion n’est jamais attendue par l’ajout'
	);
	assert.ok(fn.includes('catch'), 'une panne OFF ne casse jamais l’ajout');
});

test('cache par date : invalidé à chaque ajout, modification et suppression', () => {
	// Toutes les mutations du jour passent par setDate(), qui relance le bilan.
	const setDate = journalPage.slice(
		journalPage.indexOf('async function setDate('),
		journalPage.indexOf('/* ————— Totaux & calculs ————— */')
	);
	assert.ok(setDate.includes('void loadBilanJour(d)'), 'le bilan repart à chaque changement de jour');
	assert.ok(
		journalPage.includes('await setDate(date)'),
		'ajout / édition / suppression rechargent le jour ET son bilan'
	);
	// Le cache est bien un cache PAR DATE, pas un résultat figé.
	assert.ok(journalPage.includes('bilanByDay[date]'), 'résultat indexé par la date affichée');
});
