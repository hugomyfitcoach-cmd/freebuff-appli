/**
 * Tests MISSION T6 — mise en page premium (AFFICHAGE uniquement).
 *
 * 1. Un SEUL bandeau d'astuce (plus de bandeau vert répété par exercice) ;
 * 2. Colonne kg absente du tableau des séries quand le kg est masqué (T5) ;
 * 3. « Terminer la séance » : un seul bouton, dans une barre fixe ;
 * 4. Jour sans séance → carte « Repos » + cartes semaine/jour/repos ;
 * 5. Aucune nouvelle couleur hexadécimale dans les fichiers d'affichage.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runner = readFileSync(join(root, 'src/lib/components/SessionRunner.svelte'), 'utf8');
const page = readFileSync(join(root, 'src/routes/espace/entrainement/+page.svelte'), 'utf8');

const count = (haystack, needle) => haystack.split(needle).length - 1;
const libre = runner.slice(runner.indexOf('<!-- ═══════════ MODE LIBRE'), runner.indexOf('<!-- ═══════════ MODE GUIDÉ'));

/* ─── 1) Une seule astuce ─── */

test('1 · un seul bandeau d’astuce, plus de bandeau vert par exercice', () => {
	assert.equal(count(runner, 'Coche chaque série terminée'), 1, 'une seule astuce dans la séance');
	assert.ok(!libre.includes("Indique la charge utilisée aujourd'hui"), 'bandeau répété supprimé du mode libre');
	assert.ok(!libre.includes('ex.isFirstTime'), 'plus de bandeau conditionné par exercice');
	assert.ok(/<Icon name="info"/.test(runner), 'icône info verte (couleur de l’app)');
});

/* ─── 2) Colonne kg conditionnelle ─── */

test('2 · colonne kg absente du tableau quand le kg est masqué', () => {
	assert.ok(/\{#if showWeight\(ex\)\}<span>Kg<\/span>\{\/if\}/.test(runner), 'en-tête Kg conditionnel');
	assert.ok(/grid-cols-\[2rem_minmax\(0,1fr\)_2\.75rem\]/.test(runner), 'grille sans colonne kg');
	assert.ok(/grid-cols-\[2rem_minmax\(0,1fr\)_minmax\(0,1fr\)_2\.75rem\]/.test(runner), 'grille avec colonne kg');
	assert.ok(/\{#if showWeight\(ex\)\}\s*\n\s*<input[\s\S]*?Charge série/.test(runner), 'champ kg conditionnel');
});

/* ─── 3) Terminer : un seul bouton, barre fixe ─── */

test('3 · « Terminer la séance » unique dans une barre fixe, lien guidé en dessous', () => {
	assert.equal(count(libre, 'Terminer la séance'), 1, 'un seul bouton Terminer en mode libre');
	assert.ok(/fixed inset-x-0 bottom-0/.test(libre), 'barre d’action fixe en bas');
	assert.ok(libre.includes('Passer en mode guidé'), 'lien texte vers le mode guidé');
	assert.ok(!libre.includes('Commencer en mode guidé'), 'plus de bouton guidé concurrent');
	assert.ok(/pb-40/.test(runner), 'marge basse : le contenu n’est jamais masqué');
	assert.ok(/min-h-\[54px\]/.test(libre), 'bouton principal ≥ 44 px');
});

/* ─── 4) Cartes semaine / jour / repos ─── */

test('4 · jour sans séance → carte Repos ; semaine, jour et séances réalisées structurés', () => {
	assert.ok(page.includes('>Repos</p>'), 'carte Repos');
	assert.ok(page.includes('Aucune séance prévue ce jour-là.'), 'sous-titre Repos');
	assert.ok(page.includes('{weekDoneCount} / {days.length} faites'), 'compteur de la semaine');
	assert.ok(page.includes('>Faite</span>') && page.includes('>Prévue</span>'), 'légende Faite / Prévue');
	assert.ok(/rounded-3xl border-2 border-brand/.test(page), 'carte du jour bordée de vert');
	assert.ok(page.includes('autres exercices'), '2 premiers exercices + « + N autres »');
	assert.ok(page.includes("Tu peux la faire aujourd'hui : elle sera comptée à sa date réelle."), 'note date réelle hors aujourd’hui');
	assert.ok(page.includes('weekCompleted'), 'séances réalisées de la semaine');
	assert.ok(page.includes('effort {h.difficulty}/5'), 'effort dans la carte réalisée');
});

/* ─── 5) Aucune couleur hexadécimale ─── */

test('5 · aucune nouvelle couleur hexadécimale dans les fichiers d’affichage', () => {
	const hex = /#[0-9a-fA-F]{3,8}\b/;
	assert.ok(!hex.test(runner), 'SessionRunner : uniquement les classes/variables de l’app');
	assert.ok(!hex.test(page), 'Entraînement : uniquement les classes/variables de l’app');
	assert.ok(runner.includes('bg-brand') && page.includes('bg-brand'), 'vert G-FLUX réutilisé');
	assert.ok(runner.includes('font-display') || runner.includes('font-black'), 'graisses de l’app');
});
