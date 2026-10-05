/**
 * Mission : Repas IA MULTIMODAL — PHOTO + TEXTE (+ dictée native clavier).
 *
 * Avant : Repas IA = photo seule (prompt vision → composants → match).
 *
 * Après (MÊME pipeline, aucun moteur parallèle) :
 *  - le texte (saisie ou dictée du clavier) est extrait par un prompt dédié
 *    (analyzeMealText) avec qtyExplicit seulement si la quantité est écrite ;
 *  - la FUSION photo×texte est DÉTERMINISTE et pure (lib/mealFusion.ts) —
 *    jamais confiée au seul prompt : « 150 g de riz » écrit remplace
 *    TOUJOURS l'estimation visuelle, le texte sans quantité laisse la photo
 *    maîtresse, les apports du texte suivent ;
 *  - chaque quantité porte sa provenance (user / photo / estimated) affichée
 *    dans le récap — le chemin PHOTO SEULE ne pose PAS qtySource
 *    (comportement historique strictement préservé) ;
 *  - CTA désactivé sans photo ET sans texte (≥ 2 caractères).
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
const analyzeRoute = read('src/routes/api/meals/analyze/+server.ts');
const journalPage = read('src/routes/espace/journal/+page.svelte');

/** Module PUR de fusion (aucune dépendance Convex) — importé directement. */
const fusion = await import(new URL('../src/lib/mealFusion.ts', import.meta.url).href);

/* ── FUSION PHOTO × TEXTE (règle produit : quantités écrites prioritaires) ── */

test('Fusion : « 150 g de riz » écrit REMPLACE l\'estimation photo (220 g)', () => {
	const out = fusion.mergeTextOverPhoto(
		[{ name: 'riz', qtyGrams: 150, qtyExplicit: true }],
		[{ name: 'Riz basmati', qtyGrams: 220 }]
	);
	assert.equal(out.length, 1, 'un-à-un : pas de doublon riz');
	assert.equal(out[0].qtyGrams, 150, 'quantité de l\'utilisatrice');
	assert.equal(out[0].qtySource, 'user');
	assert.equal(out[0].qtyExplicit, true);
	assert.equal(out[0].name, 'Riz basmati', 'libellé le plus précis (photo ici)');
});

test('Fusion : texte SANS quantité → la photo reste maîtresse (composant inchangé)', () => {
	const out = fusion.mergeTextOverPhoto(
		[{ name: 'poulet', qtyGrams: 100, qtyExplicit: false }],
		[{ name: 'Poulet grillé', qtyGrams: 180 }]
	);
	assert.equal(out.length, 1);
	assert.equal(out[0].qtyGrams, 180, 'quantité photo fiable conservée');
	assert.equal(out[0].qtySource, 'photo');
	assert.notEqual(out[0].qtyExplicit, true);
	assert.equal(out[0].name, 'Poulet grillé');
});

test('Fusion : texte sans correspondance photo → ajouté (user si explicite, sinon estimated)', () => {
	const out = fusion.mergeTextOverPhoto(
		[
			{ name: "huile d'olive", qtyGrams: 10, qtyExplicit: true },
			{ name: 'courgettes', qtyGrams: 120, qtyExplicit: false },
		],
		[
			{ name: 'Riz basmati', qtyGrams: 220 },
			{ name: 'Poulet grillé', qtyGrams: 180 },
		]
	);
	assert.equal(out.length, 4, '2 photo + 2 apports texte, aucun écrasement');
	assert.equal(out[0].name, 'Riz basmati', 'ordre photo préservé');
	assert.equal(out[1].name, 'Poulet grillé');
	const huile = out.find((c) => c.name.includes('huile'));
	const courgettes = out.find((c) => c.name.includes('courgettes'));
	assert.equal(huile.qtySource, 'user');
	assert.equal(huile.qtyGrams, 10);
	assert.equal(courgettes.qtySource, 'estimated');
});

test('Fusion : texte flou (« une assiette de riz ») → quantité ESTIMÉE, jamais certaine', () => {
	const out = fusion.mergeTextOverPhoto(
		[{ name: 'une assiette de riz', qtyGrams: 200, qtyExplicit: false }],
		[]
	);
	assert.equal(out.length, 1);
	assert.equal(out[0].qtySource, 'estimated');
	assert.equal(out[0].qtyExplicit, false);
});

test('Fusion : seuil de rapprochement — aucun appariement hors score minimum', () => {
	const out = fusion.mergeTextOverPhoto(
		[{ name: 'chocolat', qtyGrams: 30, qtyExplicit: true }],
		[{ name: 'Saumon terre-mer', qtyGrams: 250 }]
	);
	assert.equal(out.length, 2, 'rien fusionné : texte ajouté, photo conservée');
	assert.equal(out[0].qtySource, 'photo');
	assert.equal(out[1].qtySource, 'user');
	assert.equal(out[0].qtyGrams, 250, 'photo intacte');
});

test('TEXTE SEUL : explicit → user, vague → estimated', () => {
	const out = fusion.applyTextQtySource([
		{ name: 'riz', qtyGrams: 200, qtyExplicit: true },
		{ name: 'légumes verts', qtyGrams: 150, qtyExplicit: false },
	]);
	assert.equal(out[0].qtySource, 'user');
	assert.equal(out[0].qtyGrams, 200);
	assert.equal(out[1].qtySource, 'estimated');
});

test('Fusion : module PUR sans dépendance Convex ni réseau', () => {
	const src = read('src/lib/mealFusion.ts');
	assert.ok(!src.includes('convex'), 'aucun import Convex');
	assert.ok(!src.includes('fetch('), 'aucun appel réseau');
	assert.ok(src.includes("from './foodText'"), 'réutilise nameMatchScore (même moteur que le matching)');
});

/* ── PROMPT TEXTE : qtyExplicit réservé aux quantités ÉCRITES ── */

test('Prompt texte : qtyExplicit = true seulement pour une quantité écrite fiable', () => {
	assert.ok(openai.includes('qtyExplicit = true'), 'règle explicite dans le prompt');
	assert.ok(openai.includes('grammes/kilos') && openai.includes('millilitres/centilitres'), 'unités fiables listées');
	assert.ok(openai.includes('cuillères'), 'conversions cuillères (×1000/×10/×1000) documentées');
});

test('Prompt texte : qtyExplicit = false par défaut — le modèle ne déduit JAMAIS une quantité', () => {
	assert.ok(openai.includes('qtyExplicit = false dans TOUS les autres cas'), 'portions vagues (bol, part, poignée) → estimation');
	const parser = openai.slice(openai.indexOf('export function parseMealTextComponents'));
	assert.ok(parser.includes('qtyExplicit: r.qtyExplicit === true'), 'parseur : défaut strictement false');
});

test('parseMealTextComponents : même garde anti-placeholder que la photo, ≤ 8 composants', () => {
	const parser = openai.slice(openai.indexOf('export function parseMealTextComponents'));
	assert.ok(parser.includes('PLACEHOLDER_RE.test('), '« no comment » jamais composant');
	assert.ok(parser.includes('items.length >= 8'), 'borne haute identique à la photo');
});

test('analyzeMealText : texte borné (800), refus < 2 caractères, tokens plafonnés', () => {
	const fn = openai.slice(openai.indexOf('export async function analyzeMealText'));
	assert.ok(fn.includes('slice(0, 800)'));
	assert.ok(fn.includes('length < 2'));
	assert.ok(fn.includes('1_100') || fn.includes('1100'), 'budget tokens dédié');
	assert.ok(fn.includes('callOpenAiText'), 'passe par le même client OpenAI (aucun moteur parallèle)');
});

test('openai.ts : un seul cœur d\'appel — callOpenAi (photo) et callOpenAiText sont des wrappers', () => {
	assert.ok(openai.includes('function callOpenAiCore'), 'cœur extrait');
	const core = openai.slice(openai.indexOf('function callOpenAiCore'));
	assert.ok(core.includes('input:'), 'cœur prend un tableau input (texte OU image)');
	assert.ok(openai.includes('async function callOpenAiText('), 'wrapper texte');
	assert.ok(openai.includes('async function callOpenAi('), 'wrapper image (signature historique conservée)');
});

/* ── ACTION CONVEX : args additifs, 3 modes, photo seule inchangée ── */

test('analyzeMeal : imageDataUrl ET text optionnels — au moins l\'un des deux requis', () => {
	assert.ok(aiAnalysis.includes('imageDataUrl: v.optional(v.string())'), 'photo optionnelle');
	assert.ok(aiAnalysis.includes('text: v.optional(v.string())'), 'texte optionnel');
	assert.ok(aiAnalysis.includes('Ajoute une photo ou décris ton repas.'), 'erreur métier ni photo ni texte');
});

test('analyzeMeal : fusion déterministe importée du module pur (jamais déléguée au prompt)', () => {
	assert.ok(aiAnalysis.includes('from "../lib/mealFusion"'), 'import mealFusion');
	assert.ok(aiAnalysis.includes('mergeTextOverPhoto(textItems, photoItems)'), 'photo+texte → fusion');
	assert.ok(aiAnalysis.includes('applyTextQtySource(textItems)'), 'texte seul → sources user/estimated');
	assert.ok(aiAnalysis.includes('items = photoItems'), 'photo seule → composants tels quels');
});

test('Photo seule : qtySource NON posé (comportement historique strictement préservé)', () => {
	const start = aiAnalysis.indexOf('// PHOTO SEULE');
	assert.ok(start > 0, 'branche photo seule identifiable');
	const branch = aiAnalysis.slice(start, aiAnalysis.indexOf('hint = hint ?? textHint'));
	assert.ok(branch.includes('qtySource NON posé'), 'commentaire d\'intention présent');
	assert.ok(!branch.includes("qtySource: '"), 'aucune source imposée sur le chemin photo seule');
});

test('matchComponents : qtySource transmis tel quel, aucun effet sur le matching', () => {
	assert.ok(mealMatch.includes('qtySource?: MealQtySource'), 'type MatchedComponent étendu');
	assert.ok((mealMatch.match(/qtySource: c\.qtySource/g) || []).length >= 3, 'passthrough signature + 2 sites out.push');
	assert.ok(
		(mealMatch.match(/qtySource: v\.optional\(v\.union\(v\.literal\("user"\), v\.literal\("photo"\), v\.literal\("estimated"\)\)\)/g) || []).length === 2,
		'args optionnels : query publique + interne'
	);
	assert.ok(aiAnalysis.includes('qtySource: it.qtySource'), 'aiAnalysis transmet qtySource au matcher');
});

/* ── BFF : photo et/ou texte ── */

test('BFF /api/meals/analyze : accepte photo et/ou texte, 400 si ni l\'un ni l\'autre', () => {
	assert.ok(analyzeRoute.includes('imageDataUrl?: unknown; text?: unknown'), 'body multimodal');
	assert.ok(analyzeRoute.includes("reason: 'Ajoute une photo ou décris ton repas.'"), '400 métier');
	assert.ok(analyzeRoute.includes('...(imageDataUrl ? { imageDataUrl } : {})'), 'spread conditionnel photo');
	assert.ok(analyzeRoute.includes('...(text && text.length >= 2 ? { text } : {})'), 'spread conditionnel texte');
	assert.ok(analyzeRoute.includes('slice(0, 800)'), 'texte borné côté BFF');
});

/* ── UI Journal : saisie texte, aperçu photo, CTA, badges de provenance ── */

test('UI : CTA désactivé sans photo ET sans texte (< 2 caractères)', () => {
	assert.ok(
		journalPage.includes('disabled={mealAnalyzing || (!mealPendingFile && mealTextNote.trim().length < 2)}'),
		'CTA « Analyser mon repas » conditionné aux deux entrées'
	);
	assert.ok(journalPage.includes('Analyser mon repas'));
});

test('UI : champ texte natif (dictée clavier = zéro moteur vocal custom)', () => {
	assert.ok(journalPage.includes('id="meal-text-note"'), 'textarea dédiée');
	assert.ok(journalPage.includes('maxlength="800"'), 'borne identique au serveur');
	assert.ok(journalPage.includes('enterkeyhint="enter"'), 'touche entrée native');
	assert.ok(!journalPage.includes('SpeechRecognition') && !journalPage.includes('webkitSpeechRecognition'), 'aucune API vocale custom');
});

test('UI : sélection photo SANS analyse auto (aperçu puis CTA unique)', () => {
	assert.ok(journalPage.includes('function onMealPhotoPicked'), 'handler de sélection');
	assert.ok(journalPage.includes('function removeMealPhoto'), 'retrait de la photo en attente');
	assert.ok((journalPage.match(/onMealPhotoPicked\(f/g) || []).length >= 2, 'caméra ET photothèque passent par le même handler');
	assert.ok(!journalPage.includes('analyzeMealPhoto'), 'ancienne analyse-auto supprimée');
	assert.ok(journalPage.includes('Changer de photo'), 'reprise photo sans rouvrir le sélecteur');
});

test('UI : récap distingue quantité saisie / détectée / estimée', () => {
	assert.ok(journalPage.includes('✓ Ta quantité'), 'badge user (emerald)');
	assert.ok(journalPage.includes('bg-emerald-50'), 'badge user = emerald (token)');
	assert.ok(journalPage.includes('✓ Quantité détectée'), 'badge photo (brand)');
	assert.ok(journalPage.includes('⚠ Quantité estimée — vérifie si besoin'), 'badge estimated (warn)');
	assert.ok(journalPage.includes("qtySource?: 'user' | 'photo' | 'estimated'"), 'type côté PWA');
});

test('UI : le sheet réinitialise photo à chaque ouverture ; le TEXTE repart du BROUILLON', () => {
	const open = journalPage.slice(journalPage.indexOf('function openMealPhoto'), journalPage.indexOf('function openMealPhoto') + 700);
	assert.ok(open.includes('mealPendingFile = null'), 'photo réinitialisée');
	assert.ok(open.includes('DRAFT_MEAL_KEY'), 'texte repris depuis le brouillon (protection anti-perte, mission UX)');
	assert.ok(open.includes('sessionStorage'), 'reprise via sessionStorage (jamais de reprise périmée après succès)');
});

test('Pipeline : aucune route ni action parallèle — l\'existant réutilisé tel quel', () => {
	assert.ok(aiAnalysis.includes('matchComponentsInternal'), 'même matcher interne');
	assert.ok(aiAnalysis.includes('resolveBarcodeInternal'), 'même résolution code-barres');
	assert.ok(!aiAnalysis.includes('analyzeMealMultimodal') && !aiAnalysis.includes('analyzeMealV2'), 'pas de second moteur');
});
