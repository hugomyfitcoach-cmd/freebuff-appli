/**
 * Tests MISSION R2 — brouillon de recette côté cliente.
 *
 * Problème : quitter « Nouvelle recette » en cours de saisie perdait tout.
 * Le brouillon vit dans localStorage, par cliente, sans jamais contenir de
 * photo, et expire après 7 jours.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { clearRecipeDraft, loadRecipeDraft, saveRecipeDraft } from '../src/lib/recipeDraft.ts';

const KEY_PREFIX = 'gflux:recipeDraft:';
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

const initialLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let store;

function setLocalStorage(value) {
	Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
}

function installFakeStorage() {
	store = new Map();
	setLocalStorage({
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => {
			store.set(key, String(value));
		},
		removeItem: (key) => {
			store.delete(key);
		},
		clear: () => store.clear(),
	});
}

const baseDraft = (name) => ({
	name,
	description: 'Description maison',
	ingredients: [
		{ foodId: 'food-1', name: 'Bœuf haché 5 %', kcal100: 137, carbs100: 0, protein100: 21, fat100: 5, qty: 150 },
	],
});

beforeEach(installFakeStorage);

afterEach(() => {
	if (initialLocalStorage) Object.defineProperty(globalThis, 'localStorage', initialLocalStorage);
	else delete globalThis.localStorage;
});

test('sauvegarde puis lecture : nom, description et ingrédients retrouvés', () => {
	saveRecipeDraft('cliente-1', baseDraft('Hachis parmentier'));

	const draft = loadRecipeDraft('cliente-1');
	assert.ok(draft, 'brouillon relu');
	assert.equal(draft.name, 'Hachis parmentier');
	assert.equal(draft.description, 'Description maison');
	assert.equal(draft.ingredients.length, 1);
	assert.deepEqual(draft.ingredients[0], {
		foodId: 'food-1',
		name: 'Bœuf haché 5 %',
		kcal100: 137,
		carbs100: 0,
		protein100: 21,
		fat100: 5,
		qty: 150,
	});
	assert.equal(typeof draft.savedAt, 'number');
	assert.ok(draft.savedAt <= Date.now(), 'date d’enregistrement présente');
});

test('brouillon de 8 jours ignoré et supprimé', () => {
	saveRecipeDraft('cliente-2', baseDraft('Recette oubliée'));
	const key = `${KEY_PREFIX}cliente-2`;
	const stored = JSON.parse(store.get(key));
	stored.savedAt = Date.now() - EIGHT_DAYS_MS;
	store.set(key, JSON.stringify(stored));

	assert.equal(loadRecipeDraft('cliente-2'), null);
	assert.equal(store.has(key), false, 'brouillon périmé supprimé du stockage');
});

test('une clé différente par cliente (aucun brouillon partagé)', () => {
	saveRecipeDraft('alice', baseDraft('Recette d’Alice'));
	saveRecipeDraft('bob', baseDraft('Recette de Bob'));

	assert.ok(store.has(`${KEY_PREFIX}alice`));
	assert.ok(store.has(`${KEY_PREFIX}bob`));
	assert.equal(loadRecipeDraft('bob').name, 'Recette de Bob');
	assert.equal(loadRecipeDraft('alice').name, 'Recette d’Alice');

	clearRecipeDraft('alice');
	assert.equal(loadRecipeDraft('alice'), null);
	assert.equal(loadRecipeDraft('bob').name, 'Recette de Bob', 'le brouillon de Bob est intact');
});

test('stockage qui lève une erreur : aucune exception', () => {
	const boom = () => {
		throw new Error('stockage indisponible');
	};
	setLocalStorage({ getItem: boom, setItem: boom, removeItem: boom });

	assert.doesNotThrow(() => saveRecipeDraft('cliente-3', baseDraft('Sans stockage')));
	assert.doesNotThrow(() => loadRecipeDraft('cliente-3'));
	assert.doesNotThrow(() => clearRecipeDraft('cliente-3'));
});

test('la photo n’est jamais enregistrée', () => {
	saveRecipeDraft('cliente-4', {
		...baseDraft('Recette du jour'),
		photo: 'data:image/jpeg;base64,AAAA',
		imageUrl: 'https://images.example/recette.jpg',
		ingredients: [
			{
				...baseDraft('x').ingredients[0],
				imageUrl: 'https://images.example/ingredient.jpg',
				thumbUrl: 'https://images.example/ingredient-100.jpg',
				photoUrl: 'https://images.example/photo-cliente.jpg',
				photo: 'data:image/png;base64,BBBB',
			},
		],
	});

	const raw = store.get(`${KEY_PREFIX}cliente-4`);
	assert.ok(raw, 'brouillon écrit');
	assert.ok(!/(imageUrl|thumbUrl|photoUrl|data:image|base64)/i.test(raw), 'aucune image / photo sérialisée');

	const draft = loadRecipeDraft('cliente-4');
	assert.deepEqual(Object.keys(draft.ingredients[0]).sort(), [
		'carbs100',
		'fat100',
		'foodId',
		'kcal100',
		'name',
		'protein100',
		'qty',
	]);
});
