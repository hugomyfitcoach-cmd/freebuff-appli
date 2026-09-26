/**
 * Tests MISSION — Journal plus compact + repères G-FLUX + valeurs recalculées.
 *
 * 1. Journal compact (JournalDay.svelte, mode client uniquement) : vignettes
 *    44 px, lignes py-1, rond de sélection 24 px avec zone tactile conservée,
 *    rendu coach inchangé ;
 * 2. Repères G-FLUX : ordre des œufs Ciqual (cru → dur → au plat), corn
 *    flakes à la cuillère, whey 1 scoop = 30 g, non-régression ;
 * 3. Édulcorants : pas de « valeur recalculée » sur les fiches stévia /
 *    Pure Via / sucralose, les aliments classiques restent couverts.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { reperesForFood } from '../src/lib/data/gfluxReperes.ts';
import { kcalNeedsRecalc, guardedKcal100 } from '../src/lib/nutritionGuard.ts';
import { searchCiqualLocal } from '../src/convex/ciqual.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const journalDay = readFileSync(join(root, 'src/lib/components/JournalDay.svelte'), 'utf8');

/* ─── 1) Journal compact (mode client) ─── */

test('Journal : vignettes compactes 44 px côté cliente (52 px → 44 px)', () => {
	const sizes = [...journalDay.matchAll(/h-\[44px\] w-\[44px\]/g)].length;
	assert.ok(sizes >= 4, `au moins 4 gabarits 44 px (entrée, placeholder, planifié, groupe) — trouvés : ${sizes}`);
	assert.ok(!journalDay.includes('h-[52px]'), 'plus aucune vignette 52 px côté client');
	// Rendu coach : conservé (36 px).
	assert.ok(journalDay.includes("'h-9 w-9'"), 'gabarit coach 36 px inchangé');
});

test('Journal : lignes aliments resserrées (py-1 cliente) mais lisibilité intacte', () => {
	// Ligne consommée + ligne planifiée : la branche cliente passe à py-1.
	assert.ok(/plannedRow\(p: Planned\)[\s\S]{0,200}'gap-2 px-2 py-1'/.test(journalDay), 'ligne planifiée compacte (py-1)');
	// Typographie : nom 14 px et kcal/quantité 11 px inchangés (lisibilité).
	assert.ok(journalDay.includes("compact ? 'text-[14px]' : 'text-sm'"), 'nom du produit inchangé (14 px)');
	assert.ok(journalDay.includes("compact ? 'text-[11px]' : 'text-[11px]'"), 'kcal/quantité inchangés (11 px)');
});

test('Journal : rond de sélection réduit à 24 px, zone tactile ~44 px conservée', () => {
	assert.ok(journalDay.includes("compact ? 'h-6 w-6' : 'h-7 w-7'"), 'rond 24 px en mode client (28 px en coach)');
	assert.ok(journalDay.includes("compact ? 'after:-inset-2.5' : 'after:-inset-2'"), 'zone tactile élargie conservée (after:-inset-2.5)');
	assert.ok(journalDay.includes("size={compact ? 11 : 13}"), 'coche réduite proportionnellement');
	// Les deux ronds (entrée consommée + planifiée) utilisent le même gabarit.
	const rounds = [...journalDay.matchAll(/compact \? 'h-6 w-6' : 'h-7 w-7'/g)].length;
	assert.equal(rounds, 2, 'rond compact appliqué aux lignes consommées ET planifiées');
});

test('Journal : placeholder G-FLUX propre sans image (gabarit identique à la vignette)', () => {
	assert.ok(
		/place-items-center rounded-xl bg-brand-light \{compact \? 'h-\[44px\] w-\[44px\]' : 'h-9 w-9'\}/.test(journalDay),
		'placeholder 44 px avec icône utensils sur fond brand-light'
	);
});

/* ─── 2) Repères G-FLUX ─── */

test('Œufs : l\'ordre Ciqual générique est cru → dur → au plat (œuf et œuf accentué)', () => {
	for (const q of ['oeuf', 'œuf']) {
		const labels = searchCiqualLocal(q).map((h) => h.label);
		assert.ok(labels.length >= 3, `« ${q} » : 3 fiches Ciqual affichées`);
		assert.match(labels[0], /^Oeuf cru$/, `1er repère = œuf cru (obtenu : ${labels[0]})`);
		assert.match(labels[1], /^Oeuf dur$/, `2e = œuf dur (obtenu : ${labels[1]})`);
		assert.match(labels[2], /^Oeuf au plat/, `3e = œuf au plat (obtenu : ${labels[2]})`);
	}
});

test('Œufs : aucune fiche exotique (d\'oie/caille/cane/dinde) ni abats dans la liste générique', () => {
	const labels = searchCiqualLocal('oeuf').map((h) => h.label);
	for (const l of labels) {
		assert.ok(!/oie|caille|cane|dinde|cabillaud|lompe|saumon|truite|lait,/.test(l), `fiche hors mission absente : ${l}`);
	}
});

test('Œufs : requête spécifique (« œuf dur », « œuf au plat ») → pertinence pure inchangée', () => {
	assert.deepEqual(searchCiqualLocal('oeuf dur').map((h) => h.label), ['Oeuf dur']);
	assert.deepEqual(searchCiqualLocal('oeuf au plat').map((h) => h.label), ['Oeuf au plat, sans matière grasse']);
});

test('Œufs : le repère de saisie « 1 œuf = 50 g » reste intact (y compris au plat)', () => {
	for (const name of ['Oeuf', 'Oeuf cru', 'Oeuf dur', 'Oeuf au plat']) {
		const r = reperesForFood(name);
		assert.ok(r.length > 0 && r[0].label === 'œuf' && r[0].grams === 50, `« ${name} » → 1 œuf = 50 g`);
	}
});

test('Corn flakes : repère cuillère ~9 g ajouté (sans doublon, jamais pop-corn ni barre)', () => {
	for (const name of ['Corn flakes', 'Corn flakes kelloggs', 'Kelloggs Corn Flakes']) {
		const r = reperesForFood(name);
		assert.ok(r.length === 1, `« ${name} » : exactement 1 repère (pas de doublon)`);
		assert.equal(r[0].label, 'c. à soupe');
		assert.equal(r[0].grams, 9);
	}
	assert.equal(reperesForFood('Pop-corn').length, 0, 'pop-corn : aucun repère cuillère corn flakes');
	assert.equal(reperesForFood('Barre céréales corn flakes').length, 0, 'barre corn flakes : pas de cuillère');
});

test('Whey : 1 scoop = 30 g (poudre pure uniquement)', () => {
	for (const name of ['Whey', 'Whey vanille Native', 'Whey isolate Myprotein', 'Whey Native delicious vanilla']) {
		const r = reperesForFood(name);
		assert.ok(r.length >= 1, `« ${name} » : au moins un repère`);
		const scoop = r.find((x) => x.label === 'scoop');
		assert.ok(scoop && scoop.grams === 30 && scoop.unit === 'g', `« ${name} » → 1 scoop = 30 g`);
	}
	// Non-régression : produits transformés à la whey jamais au scoop.
	assert.equal(reperesForFood('Barre whey protéinée').length, 0, 'barre protéinée : pas de scoop');
	assert.equal(reperesForFood('Pancake whey').find((x) => x.label === 'scoop'), undefined, 'pancake : pas de scoop');
	const bois = reperesForFood('Boisson whey');
	assert.equal(bois.find((x) => x.label === 'scoop'), undefined, 'boisson : pas de scoop');
});

test('Repères : non-régression générale (œuf de caille, pop-corn, Pure Via, sucre)', () => {
	assert.equal(reperesForFood('Oeuf de caille').length, 0, 'œuf de caille : toujours aucun repère');
	assert.equal(reperesForFood('Pure Via').length, 1, 'Pure Via : repère morceau conservé');
	assert.equal(reperesForFood('Sucre').length, 1, 'sucre : repère morceau conservé');
	// Flocons d'avoine : poids cuillère d'origine inchangé (8 g ≠ 9 g corn flakes).
	const flo = reperesForFood('Flocons d avoine');
	assert.equal(flo[0]?.grams, 8, 'flocons d’avoine : c. à soupe 8 g inchangée');
});

/* ─── 3) Édulcorants : jamais de « valeur recalculée » ─── */

const SWEETENER_CASES = [
	{ name: 'Pure Via édulcorant de table', kcal100: 0, carbs100: 0, protein100: 0, fat100: 0 },
	{ name: 'Stevia en poudre', kcal100: 2.3, carbs100: 0, protein100: 0, fat100: 0 },
	{ name: 'Édulcorant de table stévia', kcal100: 2, carbs100: 96, protein100: 0, fat100: 0 },
	{ name: 'Sucralose liquide', kcal100: 0, carbs100: 0, protein100: 0, fat100: 0 },
	{ name: 'Aspartame comprimés', kcal100: 42, carbs100: 42.4, protein100: 0, fat100: 0 },
	{ name: 'Canderel sticks', kcal100: 5, carbs100: 0.4, protein100: 0, fat100: 0 },
];

test('Édulcorants : aucune valeur recalculée (kcal affichées = kcal de la fiche)', () => {
	for (const n of SWEETENER_CASES) {
		assert.equal(kcalNeedsRecalc(n), false, `« ${n.name} » : pas de recalcul`);
		assert.equal(guardedKcal100(n), n.kcal100, `« ${n.name} » : kcal affichées intactes`);
	}
});

test('Édulcorants : un aliment classique citant l\'édulcorant reste couvert par le garde-fou', () => {
	const n = { name: 'Yaourt au sucralose', kcal100: 55, carbs100: 40, protein100: 4, fat100: 2 };
	assert.equal(kcalNeedsRecalc(n), true, 'yaourt incohérent au sucralose : recalcul conservé');
});

test('Édulcorants : les exclusions existantes (alcool, huile) et les corrections légitimes restent', () => {
	assert.equal(kcalNeedsRecalc({ name: 'Bière blonde', kcal100: 43, carbs100: 3.6, protein100: 0.5, fat100: 0 }), false, 'bière : exclusion conservée');
	assert.equal(kcalNeedsRecalc({ name: "Huile d'olive", kcal100: 900, carbs100: 0, protein100: 0, fat100: 100 }), false, 'huile : exclusion conservée');
	assert.equal(kcalNeedsRecalc({ name: 'Tomate', kcal100: 195, carbs100: 3, protein100: 1, fat100: 0.2 }), true, 'tomate aberrante : correction conservée');
});
