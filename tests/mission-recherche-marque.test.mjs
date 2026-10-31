/**
 * Tests MISSION RECHERCHE-MARQUE — trouver un produit par sa marque.
 *
 * Constat (production) : un produit Open Food Facts scanné, « Bar Protéinée
 * Caramel Cookie », marque « BODYMASS », était bien en cache mais introuvable
 * en cherchant « Bodymass » : l'index plein texte (`by_name`) et le filtre
 * d'éligibilité `filterByQueryWords` ne portaient que sur le NOM.
 *
 * Correctif :
 *  - `filterByQueryWords` admet un candidat dont le nom OU la marque porte un
 *    mot significatif ; `rankFoods` place le NOM devant la marque seule à
 *    pertinence égale (l'ordre R1 des recherches par nom est inchangé) ;
 *  - `foods.searchText` (nom + marque normalisés) + index de recherche dédié
 *    `by_searchText`, rempli à la mise en cache et au rafraîchissement OFF ;
 *    la recherche locale interroge cet index avec repli `by_name` ;
 *  - rattrapage interne idempotent par lots de 200, planifié toutes les 2 min.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
	filterByQueryWords,
	needsSearchTextUpdate,
	rankFoods,
	searchTextOf,
	sharesBrandWord,
} from '../src/convex/foodRanking.ts';
import { formatDetailValue } from '../src/lib/foodDetailsFormat.ts';

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** Le produit réel du constat : la marque n'est PAS dans le nom. */
const BAR = { name: 'Bar Protéinée Caramel Cookie', brand: 'BODYMASS' };

/* ─── 1) Un produit se trouve par sa marque ─── */

test('« bodymass » retient un produit dont seule la MARQUE contient le mot', () => {
	for (const q of ['Bodymass', 'bodymass', 'BODYMASS']) {
		const kept = filterByQueryWords([BAR], q);
		assert.equal(kept.length, 1, `« ${q} » doit trouver la barre BODYMASS`);
		assert.equal(kept[0].name, BAR.name);
	}
	assert.equal(sharesBrandWord('BODYMASS', 'bodymass'), true);
	assert.equal(sharesBrandWord('null', 'bodymass'), false, 'la marque « null » n’est pas une marque');
	assert.equal(sharesBrandWord(undefined, 'bodymass'), false);
});

test('une marque hors sujet ne rend pas un produit éligible', () => {
	const items = [
		BAR,
		{ name: 'Velouté de légumes', brand: 'Knorr' },
		{ name: 'Bière blonde', brand: 'Bodymass' }, // marque homonyme : reste éligible
	];
	const kept = filterByQueryWords(items, 'bodymass').map((f) => f.name);
	assert.ok(kept.includes(BAR.name));
	assert.ok(!kept.includes('Velouté de légumes'), 'ni nom ni marque → écarté');
	assert.ok(kept.includes('Bière blonde'), 'la marque homonyme est bien une correspondance');
});

/* ─── 2) Nom avant marque à pertinence égale ─── */

test('à pertinence égale, le NOM passe avant la seule marque', () => {
	const items = [
		BAR, // marque seule
		{ name: 'Bodymass Whey Protein', brand: 'BODYMASS' }, // nom
	];
	const out = rankFoods(filterByQueryWords(items, 'bodymass'), 'bodymass').map((f) => f.name);
	assert.equal(out[0], 'Bodymass Whey Protein', `ordre obtenu : ${out.join(' | ')}`);
	assert.equal(out[1], BAR.name);
});

/* ─── 3) R1 et RECHERCHE-INTRUS inchangés pour les recherches par nom ─── */

const RAGOUT = [
	{ name: 'Paupiette de veau' },
	{ name: 'Blanquette de veau' },
	{ name: 'Velouté de légumes' },
	{ name: 'Bière blonde de haute fermentation' },
	{ name: 'Quenelle de veau' },
];

test('« ragoût de veau » : mêmes rescapés, aucun intrus (R1 conservé)', () => {
	for (const q of ['Ragoût de veau', 'ragout de veau']) {
		const kept = filterByQueryWords(RAGOUT, q);
		assert.deepEqual(kept.map((f) => f.name), ['Paupiette de veau', 'Blanquette de veau', 'Quenelle de veau']);
	}
});

test('R1 intact : deux mots partagés avant un seul, produit complet d’abord', () => {
	const items = [
		{ name: 'Steak de bœuf' },
		{ name: 'Steak haché 5% MG' },
		{ name: 'Haché parmentier' },
		{ name: 'Steaks hachés pur bœuf' },
	];
	const out = rankFoods(filterByQueryWords(items, 'steak haché'), 'steak haché').map((f) => f.name);
	assert.ok(out.indexOf('Steak haché 5% MG') < out.indexOf('Steak de bœuf'), `obtenu : ${out.join(' | ')}`);
	assert.ok(out.indexOf('Steaks hachés pur bœuf') < out.indexOf('Haché parmentier'), `obtenu : ${out.join(' | ')}`);
	// Un produit de marque n'est jamais éligible s'il ne partage rien.
	assert.equal(filterByQueryWords([{ name: 'Riz basmati', brand: 'Taureau Ailé' }, { name: 'Velouté' }], 'riz').length, 1);
});

/* ─── 4) `searchText` : nom + marque normalisés, idempotence ─── */

test('searchTextOf : nom + marque normalisés, sans accent ni casse', () => {
	assert.equal(searchTextOf(BAR.name, BAR.brand), 'bar proteinee caramel cookie bodymass');
	assert.equal(searchTextOf('Tomate', undefined), 'tomate', 'sans marque → le nom seul');
	assert.equal(searchTextOf('Tomate', 'null'), 'tomate', 'la marque littérale « null » est ignorée');
	assert.equal(searchTextOf('Bodymass Whey', 'BODYMASS'), 'bodymass whey', 'marque déjà dans le nom : pas de doublon');
});

test('idempotence : une fiche déjà à jour n’est jamais réécrite', () => {
	const text = searchTextOf(BAR.name, BAR.brand);
	assert.equal(needsSearchTextUpdate({ searchText: text }, text), false);
	assert.equal(needsSearchTextUpdate({}, text), true);
});

/* ─── 5) Schéma : champ optionnel + index de recherche dédié ─── */

test('schéma : searchText optionnel, index `by_searchText` (aucune migration)', () => {
	const schema = source('src/convex/schema.ts');
	const foods = schema.slice(schema.indexOf('foods: defineTable('), schema.indexOf('customFoods: defineTable('));
	assert.ok(foods.includes('searchText: v.optional(v.string())'), 'champ OPTIONNEL (fiches existantes valides)');
	assert.ok(
		/\.searchIndex\("by_searchText", \{ searchField: "searchText" \}\)/.test(foods),
		'index de recherche dédié nom + marque'
	);
	assert.ok(foods.includes('.searchIndex("by_name", { searchField: "name" })'), 'index par nom conservé');
});

/* ─── 6) Câblage : cache, rafraîchissement, recherche locale, rattrapage ─── */

test('la recherche locale interroge le nouvel index, avec repli sur by_name', () => {
	const journal = source('src/convex/journal.ts');
	for (const code of [
		journal.slice(journal.indexOf('export const searchForCoach'), journal.indexOf('export const addEntryForCoach')),
		journal.slice(journal.indexOf('export const searchLocal'), journal.indexOf('foodByBarcode')),
	]) {
		assert.ok(code.includes('withSearchIndex("by_searchText"'), 'index nom + marque interrogé');
		assert.ok(code.includes('withSearchIndex("by_name"'), 'repli par nom conservé');
		assert.ok(/byName\.filter\(\(f\) => !f\.searchText && !seenIds\.has\(f\._id\)\)/.test(code), 'repli limité aux fiches sans searchText');
		assert.ok(/filterByQueryWords\(foods\.map\(toHit\), term\)/.test(code), 'même filtre d’éligibilité');
	}
});

test('cacheFoods et refreshOffDetails remplissent searchText (jamais un autre champ)', () => {
	const journal = source('src/convex/journal.ts');
	const cache = journal.slice(journal.indexOf('export const cacheFoods'), journal.indexOf('export const FOOD_SEARCH_TEXT_BATCH'));
	assert.ok(cache.includes('searchTextOf(p.name, p.brand)'), 'texte calculé à l’insertion');
	assert.ok(cache.includes('await ctx.db.patch(id, { searchText });'), 'searchText seul écrit');
	assert.ok(cache.includes('const id = existing ? existing._id : await ctx.db.insert("foods", p);'), 'upsert par offId conservé');

	const off = source('src/convex/off.ts');
	const apply = off.slice(off.indexOf('export const applyOffDetails'));
	assert.ok(apply.includes('searchTextOf(food.name, food.brand)'), 'rafraîchissement OFF : texte recalculé');
	assert.ok(apply.includes('patch.searchText = searchText;'), 'écrit seulement si nécessaire');
});

test('rattrapage : lot borné de 200, idempotent, sans réseau, planifié toutes les 2 min', () => {
	const journal = source('src/convex/journal.ts');
	assert.ok(journal.includes('export const FOOD_SEARCH_TEXT_BATCH = 200;'), 'taille de lot bornée');
	const backfill = journal.slice(
		journal.indexOf('export const backfillFoodSearchText'),
		journal.indexOf('export const FOOD_SEARCH_TEXT_BATCH') > journal.indexOf('export const backfillFoodSearchText')
			? journal.length
			: journal.indexOf('export const backfillFoodSearchText') + 1200
	);
	assert.ok(backfill.includes('internalMutation'), 'mutation interne (jamais exposée au client)');
	assert.ok(
		backfill.includes('.filter((q) => q.eq(q.field("searchText"), undefined))'),
		'ne cible QUE les fiches sans searchText'
	);
	assert.ok(backfill.includes('.take(limit)'), 'lecture bornée (aucune boucle infinie)');
	assert.ok(backfill.includes('await ctx.db.patch(f._id, { searchText });'), 'n’écrit que searchText');
	assert.ok(backfill.includes('console.log('), 'journalise le nombre traité');
	assert.ok(!/fetch\(|ctx\.runAction/.test(backfill), 'aucun appel réseau');

	const crons = source('src/convex/crons.ts');
	const job = crons.slice(crons.indexOf('foods-search-text-rattrapage'));
	assert.ok(job.includes('internal.journal.backfillFoodSearchText'), 'tâche planifiée branchée');
	assert.ok(/\{ minutes: 2 \}/.test(job.slice(0, 200)), 'toutes les 2 minutes');
});

/* ─── 7) Affichage : une macro à zéro s'écrit « 0 g » ─── */

test('0 → « 0 », 0,7 → « 0,7 », 5,5 → « 5,5 » (règle partagée)', () => {
	assert.equal(formatDetailValue(0, 'g'), '0', 'zéro exact : jamais « 0,0 »');
	assert.equal(formatDetailValue(0.7, 'g'), '0,7', 'une décimale pour les valeurs non nulles sous 10 g');
	assert.equal(formatDetailValue(5.5, 'g'), '5,5');
	assert.equal(formatDetailValue(0, 'salt'), '0');
	assert.equal(formatDetailValue(0.045, 'salt'), '0,05', 'une pincée reste lisible');
	assert.equal(formatDetailValue(0, 'kcal'), '0');
	assert.equal(formatDetailValue(12.4, 'g'), '12', 'au-delà de 10 g : entier');
	assert.equal(formatDetailValue(null, 'g'), '—', 'valeur inconnue → « — »');
});

test('la ligne de macros du journal coach suit cette règle', () => {
	const day = source('src/lib/components/JournalDay.svelte');
	assert.ok(/P \{formatDetailValue\(e\.protein, 'g'\)\} g/.test(day), 'protéines');
	assert.ok(/G \{formatDetailValue\(e\.carbs, 'g'\)\} g/.test(day), 'glucides');
	assert.ok(/L \{formatDetailValue\(e\.fat, 'g'\)\} g/.test(day), 'lipides');
});
