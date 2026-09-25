/**
 * Tests MISSION 5 — Aperçu compact des 3 macros dans la carte Calories de l'Accueil.
 *
 * 1. Helper pur (src/lib/macros.ts) : ordre/couleurs Journal, arrondis,
 *    objectifs absents, dépassement > 100 %, arc SVG toujours propre ;
 * 2. Intégration Accueil : MacroLine montée dans la carte Calories, données
 *    réutilisées depuis /api/journal/week (aucune nouvelle source de vérité),
 *    navigation de la carte inchangée, cohérence visuelle avec le Journal.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { MACRO_DEFS, macroRings, macroRingDashOffset, MACRO_RING_CIRCUMFERENCE, fmtMacro } from '../src/lib/macros.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const accueil = readFileSync(join(root, 'src/routes/espace/+page.svelte'), 'utf8');
const macroLine = readFileSync(join(root, 'src/lib/components/MacroLine.svelte'), 'utf8');
const journal = readFileSync(join(root, 'src/routes/espace/journal/+page.svelte'), 'utf8');

/* ─── 1) Ordre & couleurs : même lecture que le Journal ─── */

test('Macros : ordre et couleurs strictement identiques au Journal (G | P | L)', () => {
	assert.deepEqual(
		MACRO_DEFS.map((m) => [m.label, m.color]),
		[
			['Glucides', '#ec4899'],
			['Protéines', '#3b82f6'],
			['Lipides', '#f97316'],
		],
		'ordre Glucides | Protéines | Lipides + codes couleur G-FLUX'
	);
	// Les mêmes couleurs existent dans le Journal (source de la convention).
	for (const c of MACRO_DEFS.map((m) => m.color)) {
		assert.ok(journal.includes(c), `couleur ${c} déjà utilisée dans le Journal`);
	}
});

/* ─── 2) macroRings : cas nominaux, objectifs absents, dépassements ─── */

test('macroRings : valeurs consommées arrondies + pourcentage exact', () => {
	const rings = macroRings({ carbs: 102.4, protein: 47.6, fat: 28 }, { carbs: 200, protein: 120, fat: 70 });
	assert.deepEqual(
		rings.map((r) => [r.label, r.eaten, r.goal, Math.round(r.percent)]),
		[
			['Glucides', 102, 200, 51],
			['Protéines', 48, 120, 40],
			['Lipides', 28, 70, 40],
		]
	);
});

test('macroRings : objectif absent / non configuré → null, jamais de cible inventée', () => {
	for (const goals of [null, undefined, {}, { carbs: 0, protein: -5, fat: NaN }]) {
		const rings = macroRings({ carbs: 10, protein: 20, fat: 30 }, goals);
		for (const r of rings) {
			if (r.key === 'carbs' && goals === null) assert.equal(r.goal, null);
			if (typeof goals === 'object' && goals !== null) {
				// 0, négatif ou NaN = objectif non exploitable → null (pas de division par 0).
				assert.equal(r.goal, null, `${r.key} : objectif ${JSON.stringify(goals)} → null`);
				assert.equal(r.percent, 0);
			}
		}
	}
});

test('macroRings : dépassement > 100 % → pourcentage réel conservé (jamais plafonné)', () => {
	const rings = macroRings({ carbs: 250, protein: 48, fat: 28 }, { carbs: 200, protein: 120, fat: 70 });
	assert.equal(rings[0].percent > 100, true, 'glucides 250/200 → > 100 %');
	assert.equal(Math.round(rings[0].percent), 125);
});

test('macroRings : consommation négative impossible (bornée à 0)', () => {
	const rings = macroRings({ carbs: -3, protein: 0, fat: 0 }, { carbs: 200, protein: 120, fat: 70 });
	assert.equal(rings[0].eaten, 0);
});

/* ─── 3) Arc SVG : toujours propre, quel que soit le pourcentage ─── */

test('macroRingDashOffset : arc borné à 100 %, jamais de valeur SVG invalide', () => {
	assert.equal(macroRingDashOffset(0), MACRO_RING_CIRCUMFERENCE, '0 % → cercle vide');
	assert.equal(macroRingDashOffset(100), 0, '100 % → cercle plein');
	assert.equal(macroRingDashOffset(150), 0, '> 100 % → arc plafonné, aucune cassure');
	assert.equal(macroRingDashOffset(-20), MACRO_RING_CIRCUMFERENCE, 'négatif → vide, jamais de dashoffset aberrant');
	const half = macroRingDashOffset(50);
	assert.ok(Math.abs(half - MACRO_RING_CIRCUMFERENCE / 2) < 1e-9, '50 % → demi-cercle');
});

test('fmtMacro : entier formaté fr-FR (2 ou 3 chiffres comme 4)', () => {
	assert.equal(fmtMacro(102.4), '102');
	assert.match(fmtMacro(1023.6), /^1\s?024$/, 'séparateur de milliers français, arrondi entier');
});

/* ─── 4) Intégration Accueil : montage + données réutilisées + non-régression ─── */

test('Accueil : MacroLine est montée DANS la carte Calories (après le texte de statut)', () => {
	assert.ok(accueil.includes('<MacroLine data={macroState} />'), 'composant monté dans la carte Calories');
	const statusIdx = accueil.indexOf('kcalStatusText}</span>');
	const macroIdx = accueil.indexOf('<MacroLine data={macroState}');
	assert.ok(statusIdx > 0 && macroIdx > statusIdx, 'la ligne macros vient APRÈS le texte kcal restant/objectif');
});

test('Accueil : données = semaine du Journal existante, aucune nouvelle source de vérité', () => {
	assert.ok(accueil.includes('/api/journal/week?start='), 'le fetch existant /api/journal/week est réutilisé');
	assert.ok(accueil.includes('macroRings('), 'les rings sont construits depuis les données du Journal');
	// Garde-fou frontend-only : la page n'importe jamais Convex directement.
	assert.ok(!accueil.includes('$lib/server/convex'), 'aucun import Convex côté page (BFF uniquement)');
	assert.ok(!accueil.includes('convex/_generated'), 'aucune dépendance aux fonctions Convex depuis la page');
});

test('Accueil : la carte Calories conserve sa navigation vers le Journal', () => {
	const cardIdx = accueil.indexOf('<!-- CALORIES -->');
	assert.ok(cardIdx > 0, 'carte Calories toujours présente');
	const cardChunk = accueil.slice(cardIdx, accueil.indexOf('<!-- POIDS -->'));
	assert.ok(cardChunk.includes('href="/espace/journal"'), 'la carte ouvre toujours /espace/journal');
});

test('MacroLine : mêmes libellés que le Journal, objectif absent géré, dépassement affiché', () => {
	for (const label of ['Glucides', 'Protéines', 'Lipides']) {
		assert.ok(macroLine.includes('{ring.label}'), `libellé dynamique (${label}) rendu depuis MACRO_DEFS`);
	}
	assert.ok(macroLine.includes("ring.goal !== null"), 'objectif absent → affichage sans cible (rien inventé)');
	assert.ok(macroLine.includes('ring.percent > 0'), 'arc absent à 0 % (journée vierge = anneau propre)');
	// La valeur réelle reste affichée même > 100 % (le ring, lui, est borné côté helper).
	assert.ok(macroLine.includes('{ring.eaten} g'), 'valeur consommée réelle affichée');
});

/* ─── 5) Ajustement v2 : équilibre Pas / Calories + hiérarchie « Mes pas » ─── */

const pas = readFileSync(join(root, 'src/routes/espace/pas/+page.svelte'), 'utf8');

test('Accueil : Calories (3/5) plus large que Pas (2/5), Poids/Cycle sur grille 2 colonnes', () => {
	assert.ok(accueil.includes('grid grid-cols-5 gap-3'), 'grille équilibrée en 5 colonnes');
	assert.ok(accueil.includes('col-span-2'), 'carte Pas compacte (2/5)');
	const calIdx = accueil.indexOf('<!-- CALORIES -->');
	const macroIdx = accueil.indexOf('<MacroLine data={macroState}');
	assert.ok(calIdx > 0 && macroIdx > calIdx && accueil.slice(calIdx, macroIdx).includes('col-span-3'), 'carte Calories élargie (3/5)');
	assert.ok(accueil.includes('mt-3 grid grid-cols-2 gap-3'), 'Poids / Cycle restent en 2 colonnes');
});

test('Mes pas : hiérarchie simplifiée — champ direct + CTA « Enregistrer »', () => {
	// Signaux ambigus supprimés (plusieurs éléments non cliquables ressemblant à des boutons).
	assert.ok(!pas.includes('>Modifiable</span>'), 'badge « Modifiable » supprimé');
	assert.ok(!pas.includes('Compléter ou modifier mes pas</span>'), 'pseudo-lien « Compléter ou modifier » supprimé');
	assert.ok(!/aria-label="Modifier les 7 derniers jours"/.test(pas), 'icône crayon d\'en-tête supprimée');
	assert.ok(!pas.includes("Modifier mes pas d'aujourd'hui"), 'plus de bouton d\'ouverture intermédiaire');
	// CTA du haut = « Enregistrer » (expression Svelte, pas d'ouverture en deux temps).
	assert.ok(/\{stepsSaving \? '…' : 'Enregistrer'\}/.test(pas), 'CTA du jour = Enregistrer');
	assert.ok(pas.includes('Mettre à jour mes pas de la semaine'), 'action semaine conservée sous le graphique');
	assert.ok(pas.includes('startEditing(true)'), "l'action semaine ouvre le panneau existant (+ scroll)");
	// Logique métier inchangée : mêmes endpoints, même garde « vide ≠ 0 ».
	assert.ok(pas.includes("fetch('/api/steps'"), 'sauvegarde via /api/steps inchangée');
	assert.ok(pas.includes("if (raw === '') continue;"), 'champ vide = aucun changement (jamais 0)');
	assert.ok(pas.includes('invalidateAll();'), 'revalidation après enregistrement');
});

test('Accueil : mini-rings animés + labels macros entiers + tendance pas discrète', () => {
	// Libellés entiers : whitespace-nowrap (jamais de GL… / PR… / LI…).
	assert.ok(macroLine.includes('whitespace-nowrap'), 'libellés et valeurs jamais tronqués');
	// Format demandé : valeur consommée + objectif en entier.
	assert.ok(macroLine.includes('{ring.eaten} g'), 'valeur consommée en entier');
	assert.ok(macroLine.includes('/ {ring.goal} g'), 'objectif en entier');
	// Animation premium de l'arc, neutralisée sous prefers-reduced-motion.
	assert.ok(macroLine.includes('macro-ring-in'), 'animation de progression de l\'arc présente');
	assert.ok(macroLine.includes('prefers-reduced-motion'), 'prefers-reduced-motion respecté');
	// Tendance pas sur la carte Pas : composant Sparkline existant, données dashboard.
	assert.ok(accueil.includes('<Sparkline points={stepsWeekPts}'), 'sparkline réutilisant les données du dashboard');
	// Le tableau de points reste alimenté par les données existantes.
	assert.ok(accueil.includes('dash?.steps.week'), 'aucune nouvelle source de données');
});

test('Carte Pas : valeur explicitement « du jour » + tendance 7 j étiquetée', () => {
	// Anti-ambiguïté : la valeur affichée est celle du JOUR (pas une stat hebdo).
	assert.ok(accueil.includes("Aujourd'hui · "), "libellé « Aujourd'hui » sur la carte Pas");
	assert.ok(
		accueil.includes('{/key} <span class="text-sm font-semibold text-mist">pas</span>'),
		'la valeur du jour porte son unité (pas)'
	);
	assert.ok(accueil.includes('Objectif du jour atteint'), 'objectif formulé « du jour »');
	// Tendance hebdo clairement distinguée de la valeur du jour.
	assert.ok(accueil.includes('>7 j</span>'), 'étiquette « 7 j » sur la sparkline');
});

test('Mes pas : feedback post-enregistrement expliquant la moyenne 7 jours', () => {
	assert.ok(pas.includes("C'est noté !"), 'confirmation claire après enregistrement');
	assert.ok(pas.includes('apparaîtront'), 'explication : jour intégré demain dans la moyenne');
	assert.ok(pas.includes('noteSaved();'), 'feedback déclenché après un enregistrement réussi');
	assert.ok(pas.includes('role="status"'), 'message non intrusif (role=status)');
	assert.ok(pas.includes('onDestroy(() => clearTimeout(savedTimer));'), 'timer nettoyé au démontage');
	// Le message disparaît dès une nouvelle saisie (pas de confirmation périmée).
	assert.ok(pas.includes('savedMsg = false;'), 'feedback réinitialisé à la saisie');
});
