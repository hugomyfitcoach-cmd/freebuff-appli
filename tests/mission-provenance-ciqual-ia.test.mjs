/**
 * Mission : PROVENANCE CIQUAL / REPAS IA / ICONOGRAPHIE.
 *
 * Avant :
 *  - le badge « Référence Ciqual – ANSES » disparaissait à la réouverture
 *    d'une fiche depuis le Journal (la feuille d'édition ne recevait jamais
 *    la provenance : entrée snapshot sans identifiant + prop source absente) ;
 *  - les repas Repas IA n'étaient identifiables nulle part dans le Journal ;
 *  - « Ajouter un nouveau repas » et « Créer un aliment » partageaient le
 *    même pictogramme « + ».
 *
 * Après (ZÉRO schema, ZÉRO migration, ZÉRO backfill) :
 *  - provenance CIQUAL recalculée À LA LECTURE (getDay + getDayForCoach) :
 *    entrée sans identité + libellé officiel exact → champ calculé
 *    `ciqualLabel` → badge conservé (cliente, coach, historique) ;
 *  - provenance Repas IA = mealGroup « analyse:… » DÉJÀ persisté par le
 *    commit (photo seule / texte seul / dictée / photo+texte) — indicateur
 *    dans la miniature : encadré vert pâle « IA » (sans photo) ou macaron
 *    « IA » sur la photo ; composant partagé → cliente ET coach ;
 *  - icônes distinctes : bol fumant (repas) vs fiche + crayon (aliment).
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
const meals = read('src/convex/meals.ts');
const schema = read('src/convex/schema.ts');
const journalPage = read('src/routes/espace/journal/+page.svelte');
const journalDay = read('src/lib/components/JournalDay.svelte');
const quantitySheet = read('src/lib/components/QuantitySheet.svelte');
const adminPage = read('src/routes/admin/+page.svelte');

/* ── 1-3. PROVENANCE CIQUAL CONSERVÉE ── */

test('Badge CIQUAL visible dans la recherche (existant, inchangé)', () => {
	assert.ok(journalPage.includes('Référence Ciqual – ANSES'), 'badge existant conservé');
	assert.ok(journalPage.includes("source={qtyFood.ciqual ? 'ciqual' : undefined}"), 'fiche d\u2019ajout passe déjà la provenance');
});

test('POURQUOI disparu : la feuille d\u2019édition ne passait JAMAIS la provenance — corrigé', () => {
	assert.ok(journalPage.includes('ciqual: !!editEntry.ciqualLabel'), 'editFood reconstruit le flag ciqual');
	assert.ok(journalPage.includes("source={editFood.ciqual ? 'ciqual' : undefined}"), 'feuille d\u2019édition : prop source branchée');
});

test('Provenance CIQUAL recalculée À LA LECTURE (zéro schema, zéro backfill)', () => {
	assert.ok(journal.includes('function withCiqualProvenance'), 'enrichissement calculé');
	const fn = journal.slice(journal.indexOf('function withCiqualProvenance'));
	assert.ok(fn.includes('e.foodId || e.customFoodId || e.mealId'), 'exclut tout ajout avec identité (OFF/perso/repas)');
	assert.ok(fn.includes('resolveCiqualLabel(e.name)'), 'résolution EXACTE du libellé officiel (table embarquée)');
	assert.ok(journal.includes('entries.map(withCiqualProvenance)'), 'getDayForCoach (coach) enrichi');
	assert.ok(journal.includes('return withCiqualProvenance({'), 'getDay (cliente) enrichi');
	assert.ok(journal.includes('from "./ciqual"'), 'même table CIQUAL embarquée (aucune donnée nouvelle)');
});

test('Historique CIQUAL identifiable sans backfill : détection à chaque lecture', () => {
	assert.ok(!schema.includes('iaProvenance') && !schema.includes('sourceIa'), 'aucun champ schema ajouté');
	const fn = journal.slice(journal.indexOf('function withCiqualProvenance'), journal.indexOf('function withCiqualProvenance') + 300);
	assert.ok(fn.includes('e.name'), 'le libellé officiel EST la clé de provenance (snapshot existant)');
});

/* ── 4-10. PROVENANCE REPAS IA (déjà persistée : mealGroup « analyse: ») ── */

test('Repas IA : provenance DÉJÀ persistée par le commit — mealGroup « analyse: »', () => {
	assert.ok(meals.includes('const mealGroup = `analyse:${rid ?? Date.now()}`'), 'même commit pour TOUS les modes IA (photo/texte/dictée/fusion)');
	assert.ok(meals.includes('mealGroup,'), 'écrit sur chaque entrée du repas IA');
});

test('JournalDay : miniature « IA » (encadré vert pâle) quand pas de photo', () => {
	const body = journalDay.slice(journalDay.indexOf('{#snippet entryBody'));
	assert.ok(body.includes('{:else if e.mealGroup}'), 'branche IA sans photo');
	assert.ok(body.includes('font-bold tracking-widest text-brand">IA'), 'texte « IA » au centre (Lato bold)');
	assert.ok(body.includes('name="sparkles"'), 'étincelle discrète');
	assert.ok(body.includes('bg-brand-light'), 'vert G-FLUX pâle, même gabarit 44 px');
});

test('JournalDay : photo conservée + mini macaron « IA » quand photo présente', () => {
	const body = journalDay.slice(journalDay.indexOf('{#snippet entryBody'));
	assert.ok(body.includes('<span class="relative shrink-0">'), 'FoodImg enveloppé');
	assert.ok(body.includes('eager={eagerEntryIds.has(e._id)}'), 'FoodImg inchangé (photo conservée)');
	assert.ok(body.includes('{#if e.mealGroup}<span class="absolute -right-1 -top-1 rounded-full bg-brand'), 'macaron IA dans le coin');
	assert.ok(body.includes('text-[8px] font-bold tracking-wide text-white'), 'macaron compact premium');
});

test('Aliment ajouté normalement : AUCUNE indication IA (condition stricte)', () => {
	const body = journalDay.slice(journalDay.indexOf('{#snippet entryBody'));
	assert.ok(body.includes('{#if e.mealGroup}'), 'indicateur conditionné UNIQUEMENT à mealGroup');
	const utensils = body.slice(body.indexOf('{:else}') + 8);
	assert.ok(utensils.includes('name="utensils"'), 'placeholder générique inchangé hors IA');
});

test('Consultation COACH : même indication IA (composant partagé + même enrichissement)', () => {
	assert.ok(adminPage.includes('<JournalDay') && adminPage.includes('mode="coach"'), 'le coach utilise le MÊME composant');
	assert.ok(journal.includes('entries.map(withCiqualProvenance)'), 'getDayForCoach enrichi (badge CIQUAL coach)');
	assert.ok(journalPage.includes("source={editFood.ciqual ? 'ciqual' : undefined}"), 'fiche côté cliente : provenance transmise');
});

/* ── 11-12. ICONOGRAPHIE DISTINCTE ── */

test('« Ajouter un nouveau repas » : icône REPAS (bol fumant) ≠ « Créer un aliment »', () => {
	const repasBtn = journalPage.slice(journalPage.indexOf('onclick={openMealEditor}'), journalPage.indexOf('onclick={openMealEditor}') + 400);
	assert.ok(repasBtn.includes('name="soup"'), 'bol/casserole = repas complet');
	const createBtn = journalPage.slice(journalPage.indexOf('onclick={openCreateSheet}'), journalPage.indexOf('onclick={openCreateSheet}') + 400);
	assert.ok(createBtn.includes('name="clipboardPen"'), 'fiche + crayon = création d\u2019aliment');
	assert.ok(!createBtn.includes('name="soup"') && !repasBtn.includes('name="clipboardPen"'), 'icônes réellement distinctes');
});

test('Système d\u2019icônes Lucide existant (pas d\u2019emoji ajouté, pas de nouvelle dépendance)', () => {
	const iconMap = read('src/lib/components/Icon.svelte');
	assert.ok(iconMap.includes('soup: Soup') && iconMap.includes('clipboardPen: ClipboardPen'), 'noms déjà mappés');
	const repasBtn = journalPage.slice(journalPage.indexOf('onclick={openMealEditor}'), journalPage.indexOf('onclick={openMealEditor}') + 400);
	const createBtn = journalPage.slice(journalPage.indexOf('onclick={openCreateSheet}'), journalPage.indexOf('onclick={openCreateSheet}') + 400);
	assert.ok(!repasBtn.includes('🍽') && !createBtn.includes('🍽'), 'aucun emoji dans les boutons');
});

/* ── Garde-fous mission ── */

test('Zéro impact nutritionnel : aucun calcul kcal/macro modifié', () => {
	const fn = journal.slice(journal.indexOf('function withCiqualProvenance'), journal.indexOf('export const getDayForCoach'));
	assert.ok(!fn.includes('kcal') && !fn.includes('qtyGrams') && !fn.includes('carbs'), 'purement indicatif (lecture seule)');
	// JournalDay : la branche IA ajoutée n'introduit aucun calcul (affichage seul) :
	const iaBranch = journalDay.slice(journalDay.indexOf('{:else if e.mealGroup}'), journalDay.indexOf('{:else}', journalDay.indexOf('{:else if e.mealGroup}')));
	assert.ok(!iaBranch.includes('fmt('), 'branche IA = rendu seul, aucun calcul');
});

test('Lignes du Journal inchangées : aucune ligne texte/badge CIQUAL ajouté aux rows', () => {
	// Le badge CIQUAL reste dans la FICHE (QuantitySheet) — jamais dans les rows.
	assert.ok(quantitySheet.includes('Référence Ciqual – ANSES'), 'badge dans la fiche détaillée');
	const body = journalDay.slice(journalDay.indexOf('{#snippet entryBody'));
	assert.ok(!body.includes('Ciqual'), 'aucun badge CIQUAL sur les lignes du Journal');
});
