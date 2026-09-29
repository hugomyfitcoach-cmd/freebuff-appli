/**
 * Mission : CRÉATION DE REPAS — import d'une RECETTE par photo IA.
 *
 * Parcours : Journal → Ajouter un aliment → Repas → Nouveau repas →
 * « ✨ Importer une recette avec l'IA » → photo (livre/fiche/capture) →
 * extraction IA (ingrédients + quantités ÉCRITES, conversions fiables
 * uniquement) → match fiches G-FLUX → ÉCRAN DE VALIDATION obligatoire →
 * remplissage du CONSTRUCTEUR DE REPAS EXISTANT.
 *
 * Garde-fous testés :
 *  - AUCUN enregistrement direct : aucune requête de sauvegarde dans le flow
 *    recette — le repas n'existe qu'après « Enregistrer le repas » ;
 *  - quantité illisible/non convertible → « Quantité à compléter » + blocage ;
 *  - photo inexploitable → message propre (jamais « no comment ») ;
 *  - zéro moteur parallèle : mêmes briques (compression, IA serveur, matching,
 *    fenêtre produit, feuille de portion, Estimation IA) ;
 *  - Convex : action additif + flag de matching additif, AUCUN changement de
 *    schema.ts, aucun appel prod.
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
const mealMatch = read('src/convex/mealMatch.ts');
const aiAnalysis = read('src/convex/aiAnalysis.ts');
const schema = read('src/convex/schema.ts');
const bffRecipe = read('src/routes/api/meals/analyze-recipe/+server.ts');
const bffMeals = read('src/routes/api/meals/+server.ts');
const bffMealId = read('src/routes/api/meals/[id]/+server.ts');
const journalPage = read('src/routes/espace/journal/+page.svelte');

/* ————— 1. Extraction IA (prompt + parseur) ————— */

test('Prompt recette : extraction liste d\u2019ingr\u00e9dients + quantit\u00e9s \u00e9crites (livre, fiche, capture)', () => {
	assert.ok(openai.includes('"recipe"'), 'type de photo \u00ab recipe \u00bb demand\u00e9 au mod\u00e8le');
	assert.ok(openai.includes('RECIPE_PROMPT'), 'prompt d\u00e9di\u00e9 recette');
	assert.ok(openai.includes('qtyRaw'), 'quantit\u00e9 telle qu\u2019\u00e9crite conserv\u00e9e (\u00ab 2 \u0153ufs \u00bb)');
	assert.ok(openai.includes('servings'), 'd\u00e9tection \u00ab pour X personnes \u00bb (informatif)');
});

test('Conversions fiables uniquement : pas de quantit\u00e9 invent\u00e9e silencieusement', () => {
	assert.ok(openai.includes('qtyUncertain'), 'flag quantit\u00e9 incertaine expos\u00e9 au parseur');
	assert.ok(/c\.à\.? ?c|cuill\u00e8re|cuillere/i.test(openai), 'rep\u00e8res cuill\u00e8re pr\u00e9sents dans le prompt');
	assert.ok(openai.includes('\u0153uf') || openai.includes('oeuf'), 'rep\u00e8re \u0153uf pr\u00e9sent (\u2248 50 g)');
});

test('parseRecipeExtraction : m\u00eames garde-fous que le Repas IA (placeholders, bornes)', () => {
	const parser = openai.slice(openai.indexOf('export function parseRecipeExtraction'));
	assert.ok(parser.includes('PLACEHOLDER_RE.test('), 'placeholder (\u00ab no comment \u00bb, \u00ab unknown \u00bb\u2026) \u2192 ingr\u00e9dient ignor\u00e9');
	assert.ok(parser.includes('s.length >= 2'), 'nom trop court \u2192 ignor\u00e9');
	assert.ok(parser.includes('qtyGrams'), 'conversion en grammes quand fiable');
});

test('analyzeRecipeImage : m\u00eame pipeline OpenAI que le Repas IA (callOpenAi, JSON strict)', () => {
	const fn = openai.slice(openai.indexOf('export async function analyzeRecipeImage'));
	assert.ok(fn.includes('callOpenAi'), 'r\u00e9utilise callOpenAi (timeout, JSON strict, prix)');
	assert.ok(fn.includes('RECIPE_PROMPT'), 'prompt recette utilis\u00e9');
	assert.ok(fn.includes('parseRecipeExtraction'), 'r\u00e9ponse pars\u00e9e par le parseur d\u00e9di\u00e9');
});

/* ————— 2. Backend Convex : action additif, m\u00eame moteur de matching ————— */

test('Action analyzeRecipe : garde b\u00eata, journalisation, recherche OFF pour les produits de marque', () => {
	assert.ok(aiAnalysis.includes('export const analyzeRecipe = action('), 'action additif analyzeRecipe');
	assert.ok(aiAnalysis.includes('meal_photo_ai_beta'), 'm\u00eame flag b\u00eata que le Repas IA (double garde)');
	assert.ok(aiAnalysis.includes('requireBetaInAction'), 'garde dans l\u2019action');
	assert.ok(aiAnalysis.includes('analyzeRecipeImage'), 'action branch\u00e9e sur le nouveau prompt');
	assert.ok(aiAnalysis.includes('searchOffProductsInternal'), 'recherche OFF r\u00e9utilis\u00e9e pour les produits de marque');
	assert.ok(aiAnalysis.includes('matchComponentsInternal'), 'm\u00eame moteur de matching que le Repas IA');
});

test('R\u00e8gle \u00ab servi cuit \u00bb neutralis\u00e9e pour une recette (poids CRU/SEC)', () => {
	assert.ok(mealMatch.includes('ignoreCookedRule'), 'flag additif ignoreCookedRule');
	const core = mealMatch.slice(mealMatch.indexOf('matchComponentsCore'));
	assert.ok(core.includes('c.ignoreCookedRule ? null : preferCookedForMeal'), 'bypass cuit appliqu\u00e9 au core');
});

test('Journalisation IA : kind \u00ab meal \u00bb existant r\u00e9utilis\u00e9 \u2014 Z\u00c9RO changement de schema', () => {
	assert.ok(aiAnalysis.includes('kind: "meal"'), 'usage IA logg\u00e9 sous le kind existant');
	// Le schema d'origine n'est pas modifi\u00e9 : ni aiUsageLog, ni meals, ni foods.
	const diffAnchors = ['analyzeRecipe', 'recipeImport', 'recipeAi', 'recipeExtraction'];
	for (const anchor of diffAnchors) {
		assert.ok(!schema.includes(anchor), `schema.ts reste vierge de toute notion recette (${anchor})`);
	}
});

test('Estimation IA : jamais un poids devin\u00e9 \u2014 d\u00e9faut 100 g affich\u00e9, quantit\u00e9 extraite seulement si fiable', () => {
	const action = aiAnalysis.slice(aiAnalysis.indexOf('export const analyzeRecipe = action('));
	assert.ok(action.includes('qtyGrams: it.qtyGrams ?? 100'), 'd\u00e9faut 100 g quand la conversion n\u2019est pas fiable');
	assert.ok(action.includes('uncertainQtyIdx'), 'liste des quantit\u00e9s \u00e0 compl\u00e9ter renvoy\u00e9e au client');
});

/* ————— 3. BFF ————— */

test('BFF analyze-recipe : session cliente + garde b\u00eata + d\u00e9l\u00e9gation \u00e0 l\u2019action Convex', () => {
	assert.ok(bffRecipe.includes("requireRole(event, 'client'"), 'session cliente requise');
	assert.ok(bffRecipe.includes('flags') && bffRecipe.includes('mealPhotoAi'), 'garde b\u00eata c\u00f4t\u00e9 serveur (403 si non autoris\u00e9)');
	assert.ok(bffRecipe.includes('analyzeRecipe'), 'd\u00e9l\u00e9gation \u00e0 l\u2019action Convex');
	assert.ok(bffRecipe.includes('imageDataUrl'), 'payload image compress\u00e9 transmis');
});

test('Sauvegarde Estimation IA : snapshot accept\u00e9 par les deux chemins (cr\u00e9ation + \u00e9dition)', () => {
	// POST /api/meals : branche fromSelection existante (snapshot sans identit\u00e9).
	assert.ok(bffMeals.includes('fromSelection'), 'POST : chemin fromSelection existant r\u00e9utilis\u00e9');
	// PATCH /api/meals/[id] : additif r\u00e9trocompatible (snapshot transmis).
	assert.ok(bffMealId.includes('snapshot'), 'PATCH : snapshot transmis pour ingr\u00e9dient sans identit\u00e9');
	assert.ok(bffMealId.includes('deleteMeal'), 'PATCH : DELETE et POST historiques inchang\u00e9s');
});

/* ————— 4. UI ————— */

test('Bouton \u00ab Importer une recette avec l\u2019IA \u00bb SOUS \u00ab Ajouter un produit \u00bb, gate b\u00eata', () => {
	const addIdx = journalPage.indexOf('Ajouter un produit\n');
	assert.ok(addIdx > 0, 'bouton \u00ab Ajouter un produit \u00bb pr\u00e9sent');
	const after = journalPage.slice(addIdx);
	const recipeBtnIdx = after.indexOf('Importer une recette avec l\'IA');
	assert.ok(recipeBtnIdx > 0 && recipeBtnIdx < 900, 'bouton recette ins\u00e9r\u00e9 juste sous \u00ab Ajouter un produit \u00bb');
	const gateIdx = journalPage.lastIndexOf('{#if aiFlags.mealPhotoAi}', addIdx + recipeBtnIdx);
	assert.ok(gateIdx > addIdx, 'gate aiFlags.mealPhotoAi autour du bouton recette');
});

test('Deux chemins de capture (mobile prioritaire) : cam\u00e9ra + galerie', () => {
	assert.ok(journalPage.includes('recipePhotoInput'), 'input cam\u00e9ra recette');
	assert.ok(journalPage.includes('recipeGalleryInput'), 'input galerie recette');
	const cam = journalPage.indexOf('bind:this={recipePhotoInput}');
	const capture = journalPage.indexOf('capture="environment"', cam);
	assert.ok(capture > cam && capture - cam < 400, 'cam\u00e9ra mobile : capture="environment"');
	assert.ok(journalPage.includes("openRecipeImport"), "bouton ouvre l'\u00e9cran d'import");
});

test('\u00c9CRAN DE VALIDATION obligatoire : rien n\u2019est enregistr\u00e9 par le flow recette', () => {
	// La feuille de validation existe et n\u2019appelle JAMAIS de sauvegarde.
	const sheet = journalPage.slice(journalPage.indexOf('{#if recipeImportOpen}'), journalPage.indexOf('{#if mealPhotoOpen}'));
	assert.ok(sheet.includes('RECETTE D\u00c9TECT\u00c9E'), 'banni\u00e8re \u00ab RECETTE D\u00c9TECT\u00c9E \u00bb');
	assert.ok(sheet.includes('Utiliser cette recette'), 'action finale = remplissage du constructeur');
	assert.ok(!sheet.includes('/api/meals'), 'AUCUN appel de sauvegarde dans la feuille');
	assert.ok(!sheet.includes('saveMeal'), 'AUCUN appel saveMeal dans la feuille');
	// Le remplissage ne cr\u00e9e rien : il pousse dans le constructeur existant.
	const apply = journalPage.slice(journalPage.indexOf('function applyRecipeToMeal'), journalPage.indexOf('function applyRecipeToMeal') + 1800);
	assert.ok(apply.includes('mealItems = ['), 'remplit mealItems (constructeur existant)');
	assert.ok(!apply.includes('fetch('), 'applyRecipeToMeal : aucun appel r\u00e9seau');
});

test('Quantit\u00e9 non fiable : badge \u00ab Quantit\u00e9 \u00e0 compl\u00e9ter \u00bb + blocage avant remplissage', () => {
	assert.ok(journalPage.includes('Quantit\u00e9 \u00e0 compl\u00e9ter'), 'badge affich\u00e9');
	const apply = journalPage.slice(journalPage.indexOf('function applyRecipeToMeal'), journalPage.indexOf('function applyRecipeToMeal') + 1800);
	assert.ok(apply.includes('qtyUncertain'), 'contr\u00f4le des quantit\u00e9s incertaines avant import');
	assert.ok(apply.includes('some((c) => c.qtyUncertain) return') || apply.includes('some((c) => c.qtyUncertain)) return'), 'import refus\u00e9 tant qu\u2019une quantit\u00e9 manque');
});

test('Validation compl\u00e8te : modifier / Remplacer / Supprimer / ajouter / totaux recalcul\u00e9s', () => {
	assert.ok(journalPage.includes('openRecipeQty') && journalPage.includes('applyRecipeQty'), '\u00e9dition de quantit\u00e9');
	assert.ok(journalPage.includes('replaceRecipeComp') && journalPage.includes('removeRecipeComp'), 'remplacement et suppression');
	assert.ok(journalPage.includes('addRecipeComp'), 'ajout d\u2019ingr\u00e9dient dans la validation');
	assert.ok(journalPage.includes('recipeTotals'), 'totaux d\u00e9riv\u00e9s (recalcul instantan\u00e9)');
	assert.ok(journalPage.includes('recipeServings'), 'mention \u00ab pour X personnes \u00bb (informatif)');
});

test('Remplacer/Ajouter r\u00e9utilisent la fen\u00eatre produit EXISTANTE (aucun 2e moteur)', () => {
	const replace = journalPage.slice(journalPage.indexOf('function replaceRecipeComp'), journalPage.indexOf('function replaceRecipeComp') + 400);
	assert.ok(replace.includes('mealSearchOpen = true'), 'ouvre la fen\u00eatre produit de l\u2019\u00e9diteur');
	assert.ok(journalPage.includes('function saveIngredientQtyForRecipe'), 'routage s\u00e9curis\u00e9 de la s\u00e9lection vers la validation');
});

test('Routage de la s\u00e9lection : saveIngredientQty2 sert la validation en priorit\u00e9', () => {
	const fn = journalPage.slice(journalPage.indexOf('function saveIngredientQty2'), journalPage.indexOf('function saveIngredientQty2') + 900);
	const recipeFirst = fn.indexOf('recipeImportOpen');
	const mealPicked = fn.indexOf('if (mealPickedFood)');
	assert.ok(recipeFirst > -1 && recipeFirst < mealPicked, 'le flux recette est trait\u00e9 AVANT l\u2019ajout direct \u00e0 l\u2019\u00e9diteur');
});

test('T\u00eate de la liste : quantit\u00e9 \u00e9crite conserv\u00e9e (\u00ab tel qu\u2019\u00e9crit \u00bb) et sources G-FLUX affich\u00e9es', () => {
	const sheet = journalPage.slice(journalPage.indexOf('{#if recipeImportOpen}'), journalPage.indexOf('{#if mealPhotoOpen}'));
	assert.ok(sheet.includes("tel qu'\u00e9crit"), 'quantit\u00e9 d\u2019origine affich\u00e9e');
	assert.ok(sheet.includes('R\u00e9f. Ciqual'), 'source Ciqual');
	assert.ok(sheet.includes('Estimation IA'), 'source Estimation IA');
	assert.ok(sheet.includes('Mes aliments'), 'source aliments personnels');
});

test('Photo inexploitable : message propre, jamais \u00ab no comment \u00bb', () => {
	assert.ok(journalPage.includes("Je n'arrive pas \u00e0 lire suffisamment cette recette"), 'message orient\u00e9 solution');
	assert.ok(journalPage.includes("L'analyse IA est momentan\u00e9ment indisponible"), 'message indisponibilit\u00e9 IA propre');
});

test('Import \u2192 constructeur : pr\u00e9-remplissage du nom + Estimation IA marqu\u00e9e pour la sauvegarde', () => {
	const apply = journalPage.slice(journalPage.indexOf('function applyRecipeToMeal'), journalPage.indexOf('function applyRecipeToMeal') + 1800);
	assert.ok(apply.includes('mealName'), 'nom du repas pr\u00e9-rempli si vide (modifiable)');
	assert.ok(apply.includes('aiEstimate: c.matchSource'), 'Estimation IA trac\u00e9e jusqu\u2019\u00e0 la sauvegarde');
});

test('Inputs photo/galerie recette montés à la RACINE (hors de tout bloc conditionnel)', () => {
	// Régression Preview : inputs déclarés DANS {#if mealPhotoOpen} → refs
	// undefined quand la modale recette s'ouvre seule → .click() no-op
	// silencieux, boutons « Prendre une photo » / « Choisir dans la galerie »
	// totalement inactifs (iPhone comme desktop).
	const cam = journalPage.indexOf('bind:this={recipePhotoInput}');
	const gal = journalPage.indexOf('bind:this={recipeGalleryInput}');
	assert.ok(cam > -1 && gal > -1, 'les deux inputs recette existent');
	// Racine = directement après la fermeture du bloc mealPhoto ({/if}),
	// balise <input> non indentée (les inputs imbriqués seraient tabulés).
	assert.ok(journalPage.includes('{/if}\n<!-- Recette IA'), 'bloc inputs recette placé APRÈS la fermeture du bloc mealPhoto');
	assert.ok(journalPage.includes('\n<input\n\tbind:this={recipePhotoInput}'), 'input caméra au niveau racine (non indenté)');
	assert.ok(journalPage.split('bind:this={recipePhotoInput}').length === 2, 'un seul input caméra recette');
	assert.ok(journalPage.split('bind:this={recipeGalleryInput}').length === 2, 'un seul input galerie recette');
	assert.ok(journalPage.includes('recipePhotoInput?.click()'), 'bouton caméra déclenche l\'input');
	assert.ok(journalPage.includes('recipeGalleryInput?.click()'), 'bouton galerie déclenche l\'input');
	assert.ok(journalPage.includes('accept="image/*"'), 'accept image/* sur les inputs recette');
});

test('Sérialisation Convex du retour : qtyRaw JAMAIS undefined dans un array', () => {
	// Régression Preview (capture Marmiton lisible → échec affiché) : l'action
	// retournait qtyRaw: items.map(it => it.qtyRaw) — array À TROUS (undefined
	// aux ingrédients sans quantité écrite) → « undefined is not a valid Convex
	// value » au retour → message à tort « photo illisible » alors que
	// l'extraction ET le matching avaient réussi.
	assert.ok(aiAnalysis.includes('it.qtyRaw ?? null'), 'positions vides → null (valeur Convex valide)');
	assert.ok(aiAnalysis.includes('recipe.items.some((it) => it.qtyRaw)'), 'array omis entièrement si aucune quantité écrite');
	assert.ok(!aiAnalysis.includes('qtyRaw: recipe.items.map((it) => it.qtyRaw),'), 'ancien map à trous supprimé');
});

test('Message d\'erreur : « photo illisible » réservé aux vraies images inexploitables', () => {
	// Une erreur serveur (Convex/OpenAI) ne doit PAS accuser la photo.
	const ui = journalPage.slice(journalPage.indexOf('async function analyzeRecipeFile'), journalPage.indexOf('async function analyzeRecipeFile') + 2200);
	assert.ok(/convex\|server error\|indisponible/i.test(ui), 'crash serveur → bucket « indisponible »');
	assert.ok(ui.includes("'ai-unavailable', 'unreachable', 'timeout'"), 'pannes connues → bucket « indisponible »');
});

test('saveMeal : chemin snapshot pour les ingr\u00e9dients SANS fiche \u2014 chemins existants inchang\u00e9s', () => {
	const save = journalPage.slice(journalPage.indexOf('async function saveMeal()'), journalPage.indexOf('async function saveMeal()') + 3200);
	assert.ok(save.includes('fromSelection: true'), 'cr\u00e9ation avec Estimation IA \u2192 createMealFromSelection (snapshot)');
	assert.ok(save.includes('kcal: Math.round((it.food.kcal100 * it.qty) / 100)'), 'snapshot : kcal de la ligne exacte');
	assert.ok(save.includes("it.aiEstimate ? ''") || save.includes('it.aiEstimate\n'), 'ingr\u00e9dient sans identit\u00e9 : aucun foodId invent\u00e9');
	// R\u00e9ouverture d'un repas import\u00e9 : l'Estimation IA reste r\u00e9-enregistrable.
	assert.ok(journalPage.includes('aiEstimate: !ing.foodId && !ing.customFoodId && !ing.ciqualLabel'), 'r\u00e9ouverture : Estimation IA re-marqu\u00e9e depuis le snapshot du repas');
});
