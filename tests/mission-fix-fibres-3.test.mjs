/**
 * Tests MISSION FIX-FIBRES-3 — recettes : somme des ingrédients connus.
 *
 * 1) Recette lentilles (Ciqual, fibres connues) + crème (OFF, fibres
 *    inconnues) : fibres = celles des lentilles proratisées à la portion
 *    mangée, et la recette compte dans `fibresInconnues` (note du volet).
 * 2) Recette 100 % connue : valeurs inchangées (aucune note).
 * 3) Recette dont AUCUN ingrédient ne publie les fibres : `null`, comme avant.
 * 4) Recettes du coach (ingrédients vides) : inchangées, fibres inconnues.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { hashToken } from '../src/convex/helpers.ts';
import { dayNutritionDetails } from '../src/convex/journal.ts';
import { bilanJour } from '../src/lib/bilanJour.ts';

const SESSION_TOKEN = 'session-fix-fibres-3';
const USER = { _id: 'user-1', role: 'client', disabled: false, createdBy: 'coach-1' };
const DATE = '2026-10-27';

/** Contexte Convex minimal : session réelle (hashToken) + documents fournis. */
async function fakeCtx({ entries, docs = {} }) {
	const session = {
		userId: USER._id,
		tokenHash: await hashToken(SESSION_TOKEN),
		expiresAt: Date.now() + 60_000,
	};
	const chain = (rows) => ({
		withIndex: () => chain(rows),
		filter: () => chain(rows),
		order: () => chain(rows),
		collect: async () => rows,
		first: async () => rows[0] ?? null,
		unique: async () => rows[0] ?? null,
	});
	return {
		db: {
			query: (table) => {
				if (table === 'sessions') return chain([session]);
				if (table === 'diaryEntries') return chain(entries);
				if (table === 'clientGoals')
					return chain([{ kcal: 2148, carbs: 217, protein: 158, fat: 72 }]);
				if (table === 'clientGoalHistory') return chain([]);
				if (table === 'referenceFoods') return chain([]);
				if (table === 'users') return chain([USER]);
				return chain([]);
			},
			get: async (id) => (id === USER._id ? USER : (docs[id] ?? null)),
		},
	};
}

/** Ligne d'ingrédient de recette (référence Ciqual ou OFF). */
const ingredient = (ref, qtyGrams) => ({
	...ref,
	qtyGrams,
	kcal: 0,
	carbs: 0,
	protein: 0,
	fat: 0,
});

/** Recette de 200 g (150 g de lentilles Ciqual + 50 g de crème OFF). */
const RECETTE_LENTILLES = {
	_id: 'meal-lentilles',
	userId: USER._id,
	name: 'Lentilles à la crème',
	totalWeight: 200,
	kcal: 400,
	carbs: 30,
	protein: 20,
	fat: 18,
	ingredients: [
		ingredient({ ciqualLabel: "Lentille verte, bouillie/cuite à l'eau", name: 'Lentilles' }, 150),
		ingredient({ foodId: 'food-creme', name: 'Crème fraîche' }, 50),
	],
	createdAt: 0,
};

/** Crème OFF : aucune valeur de fibres publiée. */
const CREME = {
	_id: 'food-creme',
	kcal100: 300,
	carbs100: 3,
	protein100: 2,
	fat100: 30,
	sugars100: 3,
	saturatedFat100: 19,
	salt100: 0.1,
};

test('lentilles Ciqual + crème OFF → fibres des lentilles proratisées + note', async () => {
	const ctx = await fakeCtx({
		entries: [
			{
				_id: 'e1',
				date: DATE,
				meal: 'dejeuner',
				mealId: 'meal-lentilles',
				name: 'Lentilles à la crème',
				qtyGrams: 200,
				kcal: 400,
			},
		],
		docs: { 'meal-lentilles': RECETTE_LENTILLES, 'food-creme': CREME },
	});

	const bilan = await dayNutritionDetails._handler(ctx, { sessionToken: SESSION_TOKEN, date: DATE });

	// Lentilles : 8,45 g de fibres /100 g × 150 g = 12,675 → 12,7 g.
	// La crème ne publie pas ses fibres : somme partielle conservée.
	assert.equal(bilan.fibres, 12.7, 'fibres = celles des lentilles, proratisées');
	assert.equal(bilan.fibresInconnues, 1, 'la recette déclenche la note du volet');
	assert.deepEqual(
		bilan.sourcesFibres,
		[{ name: 'Lentilles à la crème', fibres: 12.7 }],
		'la recette apparaît sous son nom'
	);
	// Les autres nutriments somment aussi les seuls ingrédients qui les publient.
	assert.equal(bilan.sucres, 1.8, 'lentilles 0,3 + crème 1,5');
	assert.equal(bilan.ags, 9.6, 'lentilles 0,1395 + crème 9,5');
	assert.equal(bilan.sel, 0.1, 'lentilles 0,0225 + crème 0,05 → 0,07 arrondi à 0,1');
});

test('recette 100 % connue : valeurs et absence de note inchangées', async () => {
	const ctx = await fakeCtx({
		entries: [
			{
				_id: 'e1',
				date: DATE,
				meal: 'petit-dej',
				mealId: 'meal-connue',
				name: 'Porridge maison',
				qtyGrams: 200,
				kcal: 300,
			},
		],
		docs: {
			'meal-connue': {
				_id: 'meal-connue',
				userId: USER._id,
				name: 'Porridge maison',
				totalWeight: 200,
				kcal: 300,
				carbs: 45,
				protein: 12,
				fat: 6,
				ingredients: [
					ingredient({ ciqualLabel: "Flocons d'avoine", name: 'Flocons' }, 40),
					ingredient(
						{ ciqualLabel: 'Pain complet ou intégral (à la farine T150)', name: 'Pain complet' },
						60
					),
					ingredient(
						{ ciqualLabel: 'Riz basmati, cuit, sans sel ajouté', name: 'Riz basmati' },
						100
					),
				],
				createdAt: 0,
			},
		},
	});

	const bilan = await dayNutritionDetails._handler(ctx, { sessionToken: SESSION_TOKEN, date: DATE });
	assert.equal(bilan.fibres, 8.9, 'mêmes valeurs que FIX-FIBRES-2');
	assert.equal(bilan.sucres, 1.9);
	assert.equal(bilan.ags, 1);
	assert.equal(bilan.sel, 0.8);
	assert.equal(bilan.fibresInconnues, 0, 'toutes les fibres sont connues → aucune note');
});

test('recette sans aucune valeur de fibres → null, comme avant', async () => {
	const ctx = await fakeCtx({
		entries: [
			{
				_id: 'e1',
				date: DATE,
				meal: 'diner',
				mealId: 'meal-sans-fibres',
				name: 'Recette sans références',
				qtyGrams: 200,
				kcal: 400,
			},
		],
		docs: {
			'meal-sans-fibres': {
				_id: 'meal-sans-fibres',
				userId: USER._id,
				name: 'Recette sans références',
				totalWeight: 200,
				kcal: 400,
				carbs: 40,
				protein: 20,
				fat: 10,
				ingredients: [
					ingredient({ customFoodId: 'custom-1', name: 'Mon aliment 1' }, 100),
					ingredient({ customFoodId: 'custom-1', name: 'Mon aliment 1' }, 100),
				],
				createdAt: 0,
			},
			'custom-1': {
				_id: 'custom-1',
				userId: USER._id,
				name: 'Mon aliment 1',
				kcal100: 200,
				carbs100: 20,
				protein100: 10,
				fat100: 10,
				createdAt: 0,
			},
		},
	});

	const bilan = await dayNutritionDetails._handler(ctx, { sessionToken: SESSION_TOKEN, date: DATE });
	assert.equal(bilan.fibres, null, 'aucun ingrédient ne publie ses fibres → aucune valeur');
	assert.equal(bilan.sucres, null);
	assert.equal(bilan.ags, null);
	assert.equal(bilan.sel, null);
	assert.equal(bilan.fibresInconnues, 1, 'la recette compte comme fibres inconnues');
});

test('recette du coach (ingrédients vides) : inchangée, fibres inconnues', async () => {
	const ctx = await fakeCtx({
		entries: [
			{
				_id: 'e1',
				date: DATE,
				meal: 'dejeuner',
				mealId: 'meal-coach',
				name: 'Poulet quinoa brocolis',
				qtyGrams: 200,
				kcal: 600,
			},
		],
		docs: {
			'meal-coach': {
				_id: 'meal-coach',
				userId: USER._id,
				name: 'Poulet quinoa brocolis',
				totalWeight: 100,
				kcal: 300,
				carbs: 20,
				protein: 30,
				fat: 10,
				ingredients: [],
				sourceType: 'gflux_recipe',
				sourceRecipeId: 'DJ-04',
				createdAt: 0,
			},
		},
	});

	const bilan = await dayNutritionDetails._handler(ctx, { sessionToken: SESSION_TOKEN, date: DATE });
	assert.equal(bilan.fibres, null, 'recette du coach : macros seulement');
	assert.equal(bilan.fibresInconnues, 1, 'note du volet affichée');
});

test('bilanJour : une somme partielle de fibres déclenche la note sans changer le total', () => {
	const b = bilanJour(
		[
			{ name: 'Lentilles à la crème', kcal: 400, fibres: 12.7, sucres: 1.8, ags: 9.6, sel: 0.1, fibresPartielles: true },
			{ name: 'Yaourt nature', kcal: 100, fibres: 1.5, sucres: 4, ags: 0.3, sel: 0.1 },
		],
		2148
	);
	assert.equal(b.fibres, 14.2, 'le total garde la somme partielle');
	assert.equal(b.fibresInconnues, 1, 'la recette partielle déclenche la note');
	assert.equal(
		bilanJour([{ name: 'Yaourt nature', kcal: 100, fibres: 1.5, sucres: 4, ags: 0.3, sel: 0.1 }], 2148)
			.fibresInconnues,
		0,
		'aucune recette partielle → aucune note'
	);
});
