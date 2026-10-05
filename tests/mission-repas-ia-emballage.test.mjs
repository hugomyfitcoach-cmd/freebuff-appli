/**
 * Mission : Repas IA — élargir la reconnaissance aux PRODUITS EMBALLÉS.
 *
 * Avant : le prompt ne voyait que des « repas servis » (aucune notion de
 * marque / emballage / code-barres), le matching n'avait que 3 sources
 * (custom → OFF importé → CIQUAL) et un « no comment » du modèle pouvait
 * remonter tel quel comme composant affiché.
 *
 * Après (MÊMES briques, aucun moteur parallèle) :
 *  - le prompt classe la photo (meal / packaged_product / barcode /
 *    nutrition_label / unclear) et extrait marque + variante + code-barres ;
 *  - un code-barres lisible est résolu par le MÊME moteur que le scan du
 *    Journal (base locale → aliments personnels → API OFF + cache) ;
 *  - un produit emballé sans code est recherché « marque + variante +
 *    produit » (jamais de match de marque forcée : sinon Estimation IA) ;
 *  - aucun placeholder (« no comment », « unknown »…) ne devient un composant ;
 *  - l'UI affiche un message propre sur photo inexploitable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const openai = read('src/lib/server/openai.ts');
const off = read('src/convex/off.ts');
const mealMatch = read('src/convex/mealMatch.ts');
const aiAnalysis = read('src/convex/aiAnalysis.ts');
const journalPage = read('src/routes/espace/journal/+page.svelte');

test('Prompt Repas IA : classification de la photo (emballage, code-barres, étiquette, unclear)', () => {
	assert.ok(openai.includes('"packaged_product"'), 'type packaged_product demandé au modèle');
	assert.ok(openai.includes('"barcode"') && openai.includes('"nutrition_label"'), 'code-barres et étiquette reconnus comme types');
	assert.ok(openai.includes('"unclear"'), 'photo trop incertaine = type dédié');
	assert.ok(openai.includes('packaged') && openai.includes('variant') && openai.includes('barcode'), 'schéma composant : marque, variante, code');
});

test('Prompt Repas IA : marque et variante séparées du nom (Haribo ≠ Dragibus)', () => {
	assert.ok(openai.includes('« Haribo »'), 'exemples de marques imprimées');
	assert.ok(openai.includes('la marque vit dans brand, pas dans name'), 'nom = produit, marque = brand');
});

test('Interdiction stricte des placeholders (« no comment ») dans la réponse IA', () => {
	assert.ok(openai.includes('no comment'), 'le prompt interdit explicitement « no comment »');
	assert.ok(openai.includes('PLACEHOLDER_RE'), 'parseur : garde anti-placeholder');
	assert.ok(openai.includes('inconnu') && openai.includes('unknown'), 'placeholders FR et EN couverts');
});

test('parseMealComponents : un placeholder ne devient JAMAIS un composant', () => {
	const parser = openai.slice(openai.indexOf('export function parseMealComponents'));
	assert.ok(parser.includes('PLACEHOLDER_RE.test('), 'nom vide ou placeholder → composant ignoré');
	assert.ok(parser.includes('if (name.length < 2'), 'nom trop court → ignoré');
});

test('Code-barres : le Repas IA réutilise le MÊME moteur que le scan du Journal', () => {
	assert.ok(off.includes('resolveBarcodeCore'), 'cœur de résolution extrait dans off.ts');
	assert.ok(off.includes('export const resolveBarcodeInternal = internalAction'), 'action interne pour aiAnalysis');
	assert.ok(off.includes('export const barcodeLookup'), 'le scan public du Journal existe toujours');
	// Ordre de résolution identique au scan (base locale → personnels → OFF).
	const core = off.slice(off.indexOf('async function resolveBarcodeCore'));
	assert.ok(core.includes('foodByBarcode'), '1) base locale foods');
	assert.ok(core.includes('api.customFoods.byBarcode'), '2) aliments personnels de la cliente');
	assert.ok(core.includes('world.openfoodfacts.org/api/v2/product'), '3) API OFF + cache');
});

test('Repas IA : résolution barcode AVANT le matching nominal (priorité règle produit)', () => {
	const meal = aiAnalysis.slice(aiAnalysis.indexOf('export const analyzeMeal'));
	assert.ok(meal.includes('resolveBarcodeInternal'), 'aiAnalysis résout les codes-barres');
	assert.ok(meal.includes('preResolved') && mealMatch.includes('preResolved'), 'match pré-résolu transmis au matcher');
});

test('Matching emballé : marque+variante+produit cherché AVANT le produit seul', () => {
	assert.ok(mealMatch.includes('export function packagedSearchTerms'), 'fonction de termes emballés');
	const fn = mealMatch.slice(mealMatch.indexOf('export function packagedSearchTerms'));
	const specific = fn.indexOf('${b} ${v} ${n}');
	const generic = fn.indexOf('push(n)');
	assert.ok(specific !== -1 && generic !== -1 && specific < generic, 'du plus spécifique au plus générique');
	assert.ok(mealMatch.includes("wantCooked: false"), 'pas de réécriture « cuit » pour un emballé');
});

test('Aucun match fiable → Estimation IA conservée (jamais une fiche de marque forcée)', () => {
	assert.ok(mealMatch.includes('MIN_MATCH_SCORE = 0.55'), 'seuil de confiance inchangé');
	assert.ok(mealMatch.includes('aiFallback'), 'fallback Estimation IA intact');
	assert.ok(mealMatch.includes('labelWithBrand'), 'estimation labellisée avec la marque lue');
});

test('Composants mixtes : chaque composant garde SA source (ciqual / off / ai)', () => {
	assert.ok(mealMatch.includes('matchSource: p.source === "custom" ? "custom" : "off_imported"'), 'barcode pré-résolu : source exacte');
	assert.ok(mealMatch.includes('matchSource: m.source'), 'matching nominal : source du meilleur match');
});

test('UI : jamais de « no comment » affiché — message propre sur photo inexploitable', () => {
	// Message orienté solution — depuis la mission multimodal, photo ET description
	// texte sont proposées en repli (photo seule → « reprendre une photo » inchangé
	// dans l'esprit, élargi à la description) :
	assert.ok(
		journalPage.includes("Essaie une autre photo, ou décris-le plus précisément") ||
			journalPage.includes("reprendre une photo du produit, du code-barres ou de l'étiquette"),
		'message orienté solution'
	);
	assert.ok(journalPage.includes("matchSource: 'custom' | 'off_imported' | 'ciqual' | 'ai'"), 'type client inchangé (aucune régression)');
	assert.ok(journalPage.includes('packaged?: boolean'), 'champ emballé accepté côté client');
});

test('Produits OFF en base : le matching emballé cherche DANS les 780k produits importés', () => {
	assert.ok(mealMatch.includes('FOOD_SEARCH_CANDIDATES'), 'même fenêtre de candidats que la recherche cliente');
	assert.ok(mealMatch.includes('rankFoods'), 'même ranking foodRanking (aucun moteur parallèle)');
});
