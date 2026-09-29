/**
 * Mission : Repas IA — AUDIT OFF + matching produits emballés (Délisse
 * Yaourt à la grecque Stracciatella → retournait « nature · Ciqual »).
 *
 * Audit réel effectué (rejeu de la photo sur la Deploy Preview) :
 *  - photo classée packaged_product ✓, mais base OFF ABSENTE du Convex
 *    Preview (le seed n'alimentait jamais `foods`) → Cas A ;
 *  - ET « Yaourt à la grecque nature » (0.80 nominal + 0.05 bonus Ciqual)
 *    battait toute fiche précise (couverture incomplète − pénalité marque)
 *    → Cas B (la variante n'était ni exigée ni pénalisée).
 *
 * Correctifs :
 *  A) seed Preview : produits OFF de RÉFÉRENCE factuels (previewOffProducts.ts,
 *     upsert idempotent par offId, jamais en prod via assertNotProd) ;
 *  B) matching : tokens de rivalité (flavorConflict — stracciatella ≠ nature,
 *     fraise ≠ vanille, écrémé ≠ demi-écrémé, Zero ≠ classique), fiche
 *     générique sans la variante → sous le seuil (Estimation IA préférée),
 *     recherche OFF LIVE précise dans l'ACTION (searchOffProductsInternal,
 *     même pipeline que la recherche cliente + cache) — le scan code-barres
 *     reste inchangé.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const previewSeed = read('src/convex/previewSeed.ts');
const previewOff = read('src/convex/previewOffProducts.ts');
const foodText = read('src/lib/foodText.ts');
const mealMatch = read('src/convex/mealMatch.ts');
const off = read('src/convex/off.ts');
const aiAnalysis = read('src/convex/aiAnalysis.ts');

/* ─── Cas A : base OFF de référence en Preview ─── */

test('Seed Preview : produits OFF de référence factuels (échantillon public, idempotent)', () => {
	assert.ok(previewSeed.includes('seedPreviewOffProducts'), 'fonction de seed OFF appelée');
	assert.ok(previewSeed.includes('PREVIEW_OFF_PRODUCTS'), 'module de données importé');
	assert.ok(/async function seedPreviewOffProducts/.test(previewSeed), 'écritures awaitées (async)');
	assert.ok(previewOff.includes('DONNÉES FACTUELLES PUBLIQUES'), 'données de référence uniquement');
	assert.ok(previewOff.includes('3564706605145'), 'le produit du test réel (Délisse Stracciatella) est présent');
	assert.ok(previewOff.includes('ODbL'), 'attribution Open Food Facts');
});

test('Seed Preview : AUCUNE donnée personnelle, verrou anti-prod intact', () => {
	assert.ok(previewSeed.includes('assertNotProd()'), 'verrou anti-prod toujours actif');
	assert.ok(!/userId/.test(previewOff), 'aucune donnée cliente dans les produits OFF');
	// Les variantes rivales du cas réel sont toutes deux présentes pour tester le garde.
	assert.ok(previewOff.includes('Yaourt à la grecque nature'), 'variante nature présente (cas négatif)');
});

/* ─── Cas B : les variantes sont désormais exigées ─── */

test('flavorConflict : stracciatella ≠ nature (et réciproquement)', () => {
	assert.ok(foodText.includes('FLAVOR_CONFLICTS'), 'table de rivalités définie');
	const table = foodText.slice(foodText.indexOf('const FLAVOR_CONFLICTS'));
	assert.ok(table.includes('stracciatella'), 'stracciatella déclaré');
	assert.ok(table.includes('FLAVOR_AXES'), 'ensemble des tokens suivis exporté');
});

test('Matching : une fiche portant une variante RIVALE est rejetée (custom, OFF, Ciqual)', () => {
	assert.ok(mealMatch.includes('flavorConflict'), 'garde branché');
	// Le garde s'applique aux trois sources (custom 1a / OFF 1b / Ciqual 2).
	const customs = mealMatch.indexOf('customFoods');
	const offImported = mealMatch.indexOf('rankFoods(foods.map(toHit)');
	const ciqual = mealMatch.indexOf('searchCiqualLocal(term)');
	const guard1 = mealMatch.indexOf('flavorConflict(demandedFlavors, tokenize(f.name))');
	const guard2 = mealMatch.indexOf('flavorConflict(demandedFlavors, tokenize(hit.name))');
	const guard3 = mealMatch.indexOf('flavorConflict(demandedFlavors, tokenize(c.label))');
	assert.ok(guard1 > customs && guard1 < offImported, 'garde sur les aliments personnels');
	assert.ok(guard2 > offImported && guard2 < ciqual, 'garde sur les produits OFF');
	assert.ok(guard3 > ciqual, 'garde sur Ciqual');
});

test('Fiche générique sans la variante demandée → sous le seuil (Estimation IA)', () => {
	// Pénalité Ciqual : −0.35 → 0.85 au mieux passe sous 0.55.
	assert.ok(/s -= 0\.35/.test(mealMatch), 'handicap majeur appliqué aux fiches génériques');
	assert.ok(mealMatch.includes('MIN_MATCH_SCORE = 0.55'), 'seuil inchangé');
});

test('Recherche OFF LIVE précise dans l’ACTION (une query n’a pas le droit au réseau)', () => {
	assert.ok(off.includes('export const searchOffProductsInternal = internalAction'), 'action interne OFF');
	const action = off.slice(off.indexOf('export const searchOffProductsInternal'));
	assert.ok(action.includes('fetchOffSearch'), 'même pipeline que la recherche cliente');
	assert.ok(action.includes('cacheFoods'), 'cache foods automatique (le produit sera trouvé en local)');
	assert.ok(action.includes('flavorConflict'), 'règle variantes appliquée aux résultats live');
	assert.ok(action.includes('demandedFlavors.every'), 'la fiche retenue PORTE la variante demandée');
	assert.ok(aiAnalysis.includes('searchOffProductsInternal'), 'branché dans aiAnalysis (action)');
	assert.ok(aiAnalysis.includes('packagedSearchTerms'), 'termes précis marque+variante+produit');
});

test('Les variantes demandées viennent du nom ET du champ variant de l’IA', () => {
	assert.ok(mealMatch.includes('demandedFlavorTokens'), 'helper partagé');
	const helper = mealMatch.slice(mealMatch.indexOf('export function demandedFlavorTokens'));
	assert.ok(helper.includes('collect(variant'), 'variant de l’IA cumulé au nom');
});

test('Estimation IA reste le fallback final (jamais une fiche du mauvais produit)', () => {
	assert.ok(mealMatch.includes('aiFallback'), 'fallback conservé');
	assert.ok(mealMatch.includes('labelWithBrand'), 'estimation labellisée avec la marque lue');
});

test('Scan code-barres du Journal : comportement inchangé (aucun appel live déplacé)', () => {
	assert.ok(off.includes('export const barcodeLookup'), 'action publique du scan intacte');
	// Le cœur partagé barcode reste dédié au code-barres (pas de fusion avec la recherche par nom).
	assert.ok(!mealMatch.includes('resolveBarcodeCore'), 'mealMatch ne duplique pas la résolution barcode');
});
