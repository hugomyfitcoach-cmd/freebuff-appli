/**
 * Tests MISSION FIX-FIBRES-2 — fibres des recettes dans le bilan du jour.
 *
 * 1) Recette de cliente dont les ingrédients gardent leur référence : fibres,
 *    sucres, AGS et sel = somme des valeurs des ingrédients (même logique que
 *    `foodDetails`), rapportée à la quantité mangée. La recette apparaît sous
 *    son nom dans « D'où viennent tes fibres ».
 * 2) Somme des ingrédients qui publient la valeur ; si au moins un ingrédient
 *    ne publie pas ses fibres, la somme partielle reste affichée et la note
 *    du volet est déclenchée (règle FIX-FIBRES-3).
 * 3) Recette du coach (macros seules, aucun ingrédient rattaché) : fibres
 *    inconnues + note d'estimation du volet.
 * 4) Recette d'une autre cliente : jamais lue, jamais comptée.
 * 5) Note du volet élargie aux recettes ; aucun schéma modifié.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { hashToken } from '../src/convex/helpers.ts';
import { dayNutritionDetails } from '../src/convex/journal.ts';

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const SESSION_TOKEN = 'session-fix-fibres-2';
const USER = { _id: 'user-1', role: 'client', disabled: false, createdBy: 'coach-1' };
const OTHER_USER = 'user-2';
const DATE = '2026-10-27';

/** Contexte Convex minimal : session réelle (hashToken) + documents fournis. */
async function fakeCtx({ entries, docs = {}, read = [] }) {
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
			get: async (id) => {
				read.push(id);
				if (id === USER._id) return USER;
				return docs[id] ?? null;
			},
		},
	};
}

/** Ligne d'ingrédient de recette (référence Ciqual, sans snapshot résolu). */
const ingredient = (ciqualLabel, qtyGrams) => ({
	ciqualLabel,
	name: ciqualLabel,
	qtyGrams,
	kcal: 0,
	carbs: 0,
	protein: 0,
	fat: 0,
});

/* Références Ciqual : fibres / sucres / AGS / sel pour 100 g.
   Flocons d'avoine 40 g + pain complet 60 g + riz basmati cuit 100 g. */
const RECETTE_3_INGREDIENTS = {
	_id: 'meal-1',
	userId: USER._id,
	name: 'Porridge maison',
	totalWeight: 200,
	kcal: 300,
	carbs: 45,
	protein: 12,
	fat: 6,
	ingredients: [
		ingredient("Flocons d'avoine", 40),
		ingredient('Pain complet ou intégral (à la farine T150)', 60),
		ingredient('Riz basmati, cuit, sans sel ajouté', 100),
	],
	createdAt: 0,
};

test('recette cliente (3 ingrédients Ciqual) à 1 portion → fibres et macros correctes', async () => {
	const ctx = await fakeCtx({
		entries: [
			{
				_id: 'e1',
				date: DATE,
				meal: 'petit-dej',
				mealId: 'meal-1',
				name: 'Porridge maison',
				qtyGrams: 200,
				kcal: 300,
			},
		],
		docs: { 'meal-1': RECETTE_3_INGREDIENTS },
	});

	const bilan = await dayNutritionDetails._handler(ctx, { sessionToken: SESSION_TOKEN, date: DATE });

	// 11,2 × 0,4 + 7,3 × 0,6 + 0 × 1 = 8,86 → 8,9 g
	assert.equal(bilan.fibres, 8.9, 'fibres = somme des valeurs des ingrédients');
	assert.equal(bilan.sucres, 1.9, 'sucres = somme des valeurs des ingrédients');
	assert.equal(bilan.ags, 1, 'AGS = somme des valeurs des ingrédients');
	assert.equal(bilan.sel, 0.8, 'sel = somme des valeurs des ingrédients');
	assert.equal(bilan.fibresInconnues, 0, 'tous les ingrédients sont résolus → aucune note');
	assert.equal(bilan.couverture, 100, 'les kcal de la recette sont couvertes');
	assert.deepEqual(
		bilan.sourcesFibres,
		[{ name: 'Porridge maison', fibres: 8.9 }],
		'la recette apparaît sous son nom, une seule ligne'
	);
});

test('recette cliente mangée à une demi-portion → valeurs rapportées au mangé', async () => {
	const ctx = await fakeCtx({
		entries: [
			{
				_id: 'e1',
				date: DATE,
				meal: 'dejeuner',
				mealId: 'meal-1',
				name: 'Porridge maison',
				qtyGrams: 100,
				kcal: 150,
			},
		],
		docs: { 'meal-1': RECETTE_3_INGREDIENTS },
	});

	const bilan = await dayNutritionDetails._handler(ctx, { sessionToken: SESSION_TOKEN, date: DATE });
	assert.equal(bilan.fibres, 4.4, '8,86 g pour 200 g → 4,4 g pour 100 g mangés');
	assert.equal(bilan.sucres, 0.9);
	assert.equal(bilan.ags, 0.5, '1,024 g pour le plat → 0,5 g pour la portion');
	assert.equal(bilan.sel, 0.4, '0,7514 g pour le plat → 0,4 g pour la portion');
});

test('somme des ingrédients qui publient la valeur, note si les fibres sont partielles', async () => {
	// Aliment personnel : fibres et sel publiés, sucres et AGS non publiés.
	const ctx = await fakeCtx({
		entries: [
			{
				_id: 'e1',
				date: DATE,
				meal: 'diner',
				mealId: 'meal-mixte',
				name: 'Ma recette mixte',
				qtyGrams: 300,
				kcal: 400,
			},
		],
		docs: {
			'meal-mixte': {
				_id: 'meal-mixte',
				userId: USER._id,
				name: 'Ma recette mixte',
				totalWeight: 300,
				kcal: 400,
				carbs: 40,
				protein: 20,
				fat: 10,
				ingredients: [
					ingredient("Flocons d'avoine", 100),
					{ ...ingredient(undefined, 200), ciqualLabel: undefined, customFoodId: 'custom-1', name: 'Mon granola' },
				],
				createdAt: 0,
			},
			'custom-1': {
				_id: 'custom-1',
				userId: USER._id,
				name: 'Mon granola',
				kcal100: 400,
				carbs100: 60,
				protein100: 10,
				fat100: 12,
				fiber100: 8,
				salt100: 0.2,
				createdAt: 0,
			},
		},
	});

	const bilan = await dayNutritionDetails._handler(ctx, { sessionToken: SESSION_TOKEN, date: DATE });
	assert.equal(bilan.fibres, 27.2, 'fibres connues : 11,2 + 8 × 2 = 27,2 g');
	assert.equal(bilan.sel, 0.4, 'sel connu : 0,011 + 0,2 × 2 = 0,411 → 0,4 g');
	// FIX-FIBRES-3 : l’aliment perso ne publie ni sucres ni AGS — la somme
	// partielle des ingrédients connus est conservée (plus de `null` global).
	assert.equal(bilan.sucres, 1, 'sucres : seuls les flocons les publient (1,04 → 1 g)');
	assert.equal(bilan.ags, 1.4, 'AGS : seuls les flocons les publient (1,37 → 1,4 g)');
	assert.equal(bilan.fibresInconnues, 0, 'fibres de tous les ingrédients connues → aucune note');
});

test('ingrédient sans référence → somme partielle conservée, note affichée', async () => {
	const ctx = await fakeCtx({
		entries: [
			{
				_id: 'e1',
				date: DATE,
				meal: 'diner',
				mealId: 'meal-libre',
				name: 'Recette libre',
				qtyGrams: 250,
				kcal: 500,
			},
		],
		docs: {
			'meal-libre': {
				_id: 'meal-libre',
				userId: USER._id,
				name: 'Recette libre',
				totalWeight: 250,
				kcal: 500,
				carbs: 50,
				protein: 25,
				fat: 15,
				ingredients: [
					ingredient("Flocons d'avoine", 50),
					{ name: 'Ingrédient saisi à la main', qtyGrams: 200, kcal: 0, carbs: 0, protein: 0, fat: 0 },
				],
				createdAt: 0,
			},
		},
	});

	const bilan = await dayNutritionDetails._handler(ctx, { sessionToken: SESSION_TOKEN, date: DATE });
	// FIX-FIBRES-3 : l’ingrédient non référencé n’annule plus les flocons —
	// 11,2 × 0,5 = 5,6 g, somme partielle conservée et signalée.
	assert.equal(bilan.fibres, 5.6, 'somme des ingrédients dont les fibres sont connues');
	assert.equal(bilan.sucres, 0.5, 'sucres des flocons seuls (1,04 × 0,5)');
	assert.equal(bilan.ags, 0.7, 'AGS des flocons seuls (1,37 × 0,5)');
	assert.equal(bilan.sel, 0, 'sel des flocons seuls (0,011 × 0,5)');
	assert.equal(bilan.fibresInconnues, 1, 'la recette reste comptée comme fibres inconnues');
});

test('recette du coach (macros seules) → fibres inconnues + note du volet', async () => {
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
	assert.equal(bilan.fibres, null, 'recette du coach : macros seulement, fibres jamais inventées');
	assert.equal(bilan.fibresInconnues, 1, 'la note du volet est déclenchée');
	assert.deepEqual(bilan.sourcesFibres, [], 'aucune source de fibres affichée');

	// Volet : note élargie aux recettes (visible dès qu’un aliment a des fibres inconnues).
	const sheet = source('src/lib/components/BilanJourSheet.svelte');
	assert.ok(sheet.includes('{#if bilan.fibresInconnues > 0}'), 'note conditionnée aux fibres inconnues');
	assert.ok(
		sheet.includes("certains produits du commerce et certaines recettes n'indiquent pas"),
		'note élargie aux recettes'
	);
	assert.ok(
		sheet.includes('Le calcul repose surtout sur les aliments à référence nutritionnelle.'),
		'phrase conservée'
	);
});

test('recette d’une autre cliente : jamais lue, jamais comptée', async () => {
	const read = [];
	const ctx = await fakeCtx({
		entries: [
			{
				_id: 'e1',
				date: DATE,
				meal: 'dejeuner',
				mealId: 'meal-autre',
				name: 'Recette privée',
				qtyGrams: 200,
				kcal: 400,
			},
		],
		docs: {
			'meal-autre': {
				...RECETTE_3_INGREDIENTS,
				_id: 'meal-autre',
				userId: OTHER_USER,
			},
		},
		read,
	});

	const bilan = await dayNutritionDetails._handler(ctx, { sessionToken: SESSION_TOKEN, date: DATE });
	assert.equal(bilan.fibres, null, 'le repas d’une autre cliente n’est jamais résolu');
	assert.equal(bilan.fibresInconnues, 1);
	// Session, coach des références, repas : aucune fiche ingrédient n’est lue.
	assert.deepEqual(read, [USER._id, 'coach-1', 'meal-autre'], 'aucun ingrédient d’un repas étranger lu');
});

test('aucun schéma modifié : la recette se résout depuis les ingrédients existants', () => {
	const journal = source('src/convex/journal.ts');
	const schema = source('src/convex/schema.ts');
	assert.ok(journal.includes('recetteDetails'), 'résolution des recettes dans le bilan');
	assert.ok(journal.includes('ciqualFoodDetails'), 'même logique que foodDetails (Ciqual)');
	assert.ok(journal.includes('foodDetailsFromOffFood'), 'même logique que foodDetails (OFF)');
	assert.ok(journal.includes('foodDetailsFromCustomFood'), 'même logique que foodDetails (perso)');
	assert.ok(
		journal.includes('rec.userId !== ownerId'),
		'mêmes contrôles d’accès que les recettes existantes'
	);
	// Le schéma des repas n’a pas bougé : mêmes champs d’ingrédient.
	assert.ok(schema.includes('totalWeight: v.number()'), 'poids total du plat');
	assert.ok(schema.includes('qtyGrams: v.number(),'), 'quantité de l’ingrédient');
	assert.ok(schema.includes('ciqualLabel: v.optional(v.string())'), 'référence Ciqual de l’ingrédient');
});
