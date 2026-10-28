/**
 * Tests MISSION R5a — données nutritionnelles détaillées (sans interface).
 *
 * 1) Conversion des cellules Ciqual du XLSX officiel : « - »/vide → null,
 *    « traces » → 0, « < x » → 0 (y compris l'encodage XML « &lt; x »),
 *    virgule décimale gérée.
 * 2) Fiche Ciqual exacte : valeurs vérifiées contre le XLSX officiel
 *    (Table Ciqual 2025, DOI 10.57745/RDMHWY — colonnes S/AA/AF/AX/AY/BB/BD/
 *    BG/BN/BU), sel lu dans la colonne « Sel » (jamais recalculé).
 * 3) Fiche OFF sans détails : valeurs inconnues servies en null (jamais 0
 *    inventé), aucune micro-nutrition hors Ciqual.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { ciqualDetailNumber } from '../src/lib/ciqualValues.ts';
import { hashToken } from '../src/convex/helpers.ts';
import {
	ciqualFoodDetails,
	foodDetails,
	foodDetailsFromCustomFood,
	foodDetailsFromOffFood,
	foodDetailsFromReferenceFood,
} from '../src/convex/foodDetails.ts';

/* ─── 1) Conversion Ciqual ─── */

test('conversion Ciqual : « - » et vide → null, « traces » et « < x » → 0, virgule gérée', () => {
	assert.equal(ciqualDetailNumber('-'), null, '« - » = inconnu');
	assert.equal(ciqualDetailNumber(''), null, 'cellule vide = inconnu');
	assert.equal(ciqualDetailNumber(undefined), null, 'cellule absente = inconnu');
	assert.equal(ciqualDetailNumber('   '), null, 'espaces seuls = inconnu');
	assert.equal(ciqualDetailNumber('traces'), 0, '« traces » = 0');
	assert.equal(ciqualDetailNumber('Traces'), 0, 'casse indifférente');
	assert.equal(ciqualDetailNumber('< 0,5'), 0, '« < 0,5 » = 0');
	assert.equal(ciqualDetailNumber('&lt; 0,25'), 0, 'entité XML « &lt; » gérée');
	assert.equal(ciqualDetailNumber('1,2'), 1.2, 'virgule décimale');
	assert.equal(ciqualDetailNumber('0,045'), 0.045, 'petites valeurs conservées');
	assert.equal(ciqualDetailNumber('148'), 148, 'entier');
	assert.equal(ciqualDetailNumber('0'), 0, 'zéro réel conservé');
});

/* ─── 2) Fiche Ciqual connue — valeurs du XLSX officiel ─── */

test('Ciqual « Riz basmati, cuit, sans sel ajouté » : valeurs /100 g du XLSX', () => {
	// Ligne alim_code 9125 du XLSX officiel :
	// K=148 kcal · O=3,03 P · Q=32,9 G · R=0,4 L · S=traces · AA=< 0,5 ·
	// AF=0,14 AGS · AX=0,045 sel · AY=7 Ca · BB=< 0,25 Fe · BD=5,26 Mg ·
	// BG=14 K · BU=< 2 vit. C · BN=< 0,25 vit. D.
	const riz = ciqualFoodDetails('Riz basmati, cuit, sans sel ajouté');
	assert.ok(riz, 'fiche trouvée');
	assert.equal(riz.source, 'ciqual');
	assert.equal(riz.kcal, 148, 'kcal (colonne K)');
	assert.equal(riz.protein, 3.03, 'protéines (colonne O)');
	assert.equal(riz.carbs, 32.9, 'glucides (colonne Q)');
	assert.equal(riz.fat, 0.4, 'lipides (colonne R)');
	assert.equal(riz.sugars, 0, 'sucres « traces » → 0 (colonne S)');
	assert.equal(riz.fiber, 0, 'fibres « < 0,5 » → 0 (colonne AA)');
	assert.equal(riz.saturatedFat, 0.14, 'AGS (colonne AF)');
	assert.equal(riz.salt, 0.045, 'sel = colonne « Sel » AX (pas un recalcul sodium)');
	assert.ok(riz.micros, 'micros Ciqual présents');
	assert.equal(riz.micros.calcium, 7, 'calcium (colonne AY)');
	assert.equal(riz.micros.iron, 0, 'fer « < 0,25 » → 0 (colonne BB)');
	assert.equal(riz.micros.magnesium, 5.26, 'magnésium (colonne BD)');
	assert.equal(riz.micros.potassium, 14, 'potassium (colonne BG)');
	assert.equal(riz.micros.vitaminC, 0, 'vitamine C « < 2 » → 0 (colonne BU)');
	assert.equal(riz.micros.vitaminD, 0, 'vitamine D « < 0,25 » → 0 (colonne BN)');
});

test('Ciqual « Poulet, poitrine, viande et peau rôties/cuites au four » : sel et vit. D du XLSX', () => {
	// Ligne alim_code 36032 : K=189 · S=0 · AF=2,19 · AX=0,18 · BN=0,1 · BG=245.
	const poulet = ciqualFoodDetails('Poulet, poitrine, viande et peau rôties/cuites au four');
	assert.ok(poulet, 'fiche trouvée');
	assert.equal(poulet.kcal, 189, 'kcal');
	assert.equal(poulet.protein, 29.8, 'protéines');
	assert.equal(poulet.sugars, 0, 'sucres 0 (zéro réel, pas null)');
	assert.equal(poulet.saturatedFat, 2.19, 'AGS');
	assert.equal(poulet.salt, 0.18, 'sel officiel');
	assert.equal(poulet.micros.vitaminD, 0.1, 'vitamine D');
	assert.equal(poulet.micros.potassium, 245, 'potassium');
});

test('Ciqual : libellé inconnu → null (aucune fiche inventée)', () => {
	assert.equal(ciqualFoodDetails('Plat inventé qui n’existe pas'), null);
	assert.equal(ciqualFoodDetails(''), null);
});

/* ─── 3) OFF / perso / référence — valeurs null si inconnues ─── */

test('aliment OFF sans détails : sucres, fibres, AGS, sel → null', () => {
	const details = foodDetailsFromOffFood({
		kcal100: 52,
		carbs100: 12.5,
		protein100: 0.3,
		fat100: 0.2,
	});
	assert.deepEqual(
		details,
		{
			kcal: 52,
			protein: 0.3,
			carbs: 12.5,
			fat: 0.2,
			sugars: null,
			fiber: null,
			saturatedFat: null,
			salt: null,
			source: 'food',
		},
		'aucune valeur inventée, aucune micro hors Ciqual'
	);
	assert.equal(details.micros, undefined, 'les micros sont réservés à Ciqual');
});

test('aliment OFF avec détails : 0 g de sucres reste 0 (pas null)', () => {
	const details = foodDetailsFromOffFood({
		kcal100: 0.5,
		carbs100: 0,
		protein100: 0,
		fat100: 0,
		sugars100: 0,
		fiber100: 0.4,
		saturatedFat100: 0.1,
		salt100: 1.2,
	});
	assert.equal(details.sugars, 0, 'zéro réel conservé');
	assert.equal(details.fiber, 0.4);
	assert.equal(details.saturatedFat, 0.1);
	assert.equal(details.salt, 1.2);
});

test('aliment perso et fiche G-Flux : champs facultatifs absents → null', () => {
	const perso = foodDetailsFromCustomFood({
		_id: 'custom-1',
		userId: 'user-1',
		name: 'Porridge maison',
		kcal100: 120,
		carbs100: 18,
		protein100: 4,
		fat100: 3,
		createdAt: 0,
	});
	assert.equal(perso.source, 'custom');
	assert.equal(perso.sugars, null, 'les sucres ne sont pas saisis sur une fiche perso');
	assert.equal(perso.fiber, null);
	assert.equal(perso.saturatedFat, null);
	assert.equal(perso.salt, null);

	const ref = foodDetailsFromReferenceFood({
		_id: 'ref-1',
		coachId: 'coach-1',
		name: 'Poulet fermier G-Flux',
		kcal: 165,
		proteinG: 31,
		carbsG: 0,
		fatG: 4,
		sugarsG: 0,
		fiberG: 1.5,
		saturatedFatG: 1.1,
		saltG: 0.2,
		createdAt: 0,
		updatedAt: 0,
	});
	assert.equal(ref.source, 'reference');
	assert.equal(ref.sugars, 0);
	assert.equal(ref.fiber, 1.5);
	assert.equal(ref.saturatedFat, 1.1);
	assert.equal(ref.salt, 0.2);
});

/* ─── 4) Câblage : module Ciqual séparé, schéma optionnel, 30 jours ─── */

test('le module Ciqual détaillé est SÉPARÉ : aucune recherche ne l’importe', () => {
	const files = readdirSync(new URL('../src', import.meta.url), { recursive: true })
		.map(String)
		.filter((f) => /\.(ts|svelte)$/.test(f));
	const importers = files.filter((f) =>
		/from\s+['"][^'"]*ciqualDetails(?:\.js)?['"]/.test(source(`src/${f}`))
	);
	// Seul le module de détail l’importe (plus la liste générée de l’API, type-only).
	assert.deepEqual(
		importers.sort(),
		['convex/_generated/api.d.ts', 'convex/foodDetails.ts'],
		'ciqualNutrients.ts et la recherche ne chargent jamais le module de détail'
	);
	for (const file of ['src/convex/ciqual.ts', 'src/convex/foodRanking.ts', 'src/convex/journal.ts']) {
		assert.ok(
			!/from\s+['"][^'"]*ciqualDetails(?:\.js)?['"]/.test(source(file)),
			`${file} : module de détail non importé`
		);
	}
});

test('câblage : schéma optionnel, insertion OFF, rafraîchissement au plus tous les 30 jours', () => {
	const schema = source('src/convex/schema.ts');
	for (const field of [
		'sugars100',
		'saturatedFat100',
		'salt100',
		'detailsRefreshedAt',
		'sugarsG',
		'fiberG',
		'saturatedFatG',
		'saltG',
	]) {
		assert.match(
			schema,
			new RegExp(`${field}: v\\.optional\\(v\\.number\\(\\)\\)`),
			`${field} : champ optionnel (aucune migration)`
		);
	}

	const journal = source('src/convex/journal.ts');
	for (const field of ['sugars100', 'saturatedFat100', 'salt100']) {
		assert.ok(
			journal.includes(`${field}: v.optional(v.number())`),
			`cacheFoods conserve ${field} à l’insertion`
		);
	}

	const off = source('src/convex/off.ts');
	assert.match(off, /export const DETAILS_REFRESH_MS = 30 \* 24 \* 60 \* 60 \* 1000/, 'délai 30 jours');
	assert.match(off, /export const refreshOffDetails = action/, 'action de complétion à la demande');
	assert.match(off, /now - food\.detailsRefreshedAt < DETAILS_REFRESH_MS/, 'garde d’horodatage');
	assert.match(off, /sugars100: detail1\(p\.nutriments\?\.\["sugars_100g"\]\)/, 'sucres OFF');
	assert.match(
		off,
		/saturatedFat100: detail1\(p\.nutriments\?\.\["saturated-fat_100g"\]\)/,
		'AGS OFF (clé « saturated-fat_100g »)'
	);
	assert.match(off, /salt100: detail1\(p\.nutriments\?\.\["salt_100g"\]\)/, 'sel OFF');

	const details = source('src/convex/foodDetails.ts');
	assert.match(details, /source === "ciqual"/, 'source Ciqual servie par la requête unique');
	assert.match(details, /food\.userId !== user\._id/, 'isolation des fiches perso');
});

/* ─── 5) La requête foodDetails elle-même (même chemin que le client) ─── */

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const SESSION_TOKEN = 'session-r5a';
const USER = { _id: 'user-1', role: 'client', disabled: false };

/** Contexte Convex minimal : session réelle (hashToken) + documents fournis.
 *  Les queries ne tournent pas hors Convex — son handler est appelé avec ce
 *  contexte de lecture, ce qui exerce bien le chemin d'accès de la requête. */
async function fakeCtx(docs = {}) {
	const session = {
		userId: USER._id,
		tokenHash: await hashToken(SESSION_TOKEN),
		expiresAt: Date.now() + 60_000,
	};
	return {
		db: {
			query: () => ({ withIndex: () => ({ unique: async () => session }) }),
			get: async (id) => (id === USER._id ? USER : docs[id] ?? null),
			normalizeId: async (_table, id) => (docs[id] ? id : null),
		},
	};
}

test('foodDetails : Ciqual + OFF servis, fiche perso d’une autre cliente refusée', async () => {
	const ctx = await fakeCtx({
		'food-1': { _id: 'food-1', offId: '1234567890123', kcal100: 52, carbs100: 12.5, protein100: 0.3, fat100: 0.2 },
		'custom-1': {
			_id: 'custom-1',
			userId: 'user-2',
			name: 'Recette d’une autre cliente',
			kcal100: 100,
			carbs100: 10,
			protein100: 5,
			fat100: 2,
			createdAt: 0,
		},
		'custom-2': {
			_id: 'custom-2',
			userId: USER._id,
			name: 'Mon aliment',
			kcal100: 100,
			carbs100: 10,
			protein100: 5,
			fat100: 2,
			salt100: 0.5,
			createdAt: 0,
		},
	});

	const ciqual = await foodDetails._handler(ctx, {
		sessionToken: SESSION_TOKEN,
		source: 'ciqual',
		id: 'Riz basmati, cuit, sans sel ajouté',
	});
	assert.equal(ciqual.kcal, 148, 'kcal Ciqual');
	assert.equal(ciqual.salt, 0.045, 'sel Ciqual (colonne Sel)');
	assert.equal(ciqual.micros.calcium, 7, 'calcium Ciqual');

	const off = await foodDetails._handler(ctx, {
		sessionToken: SESSION_TOKEN,
		source: 'food',
		id: 'food-1',
	});
	assert.equal(off.source, 'food');
	assert.equal(off.sugars, null, 'aliment OFF sans détails → null');
	assert.equal(off.salt, null, 'sel inconnu → null');
	assert.equal(off.micros, undefined, 'aucune micro hors Ciqual');

	const foreign = await foodDetails._handler(ctx, {
		sessionToken: SESSION_TOKEN,
		source: 'custom',
		id: 'custom-1',
	});
	assert.equal(foreign, null, 'isolation : fiche perso d’une autre cliente invisible');

	const own = await foodDetails._handler(ctx, {
		sessionToken: SESSION_TOKEN,
		source: 'custom',
		id: 'custom-2',
	});
	assert.equal(own.source, 'custom');
	assert.equal(own.salt, 0.5);

	await assert.rejects(() =>
		foodDetails._handler(ctx, { sessionToken: undefined, source: 'ciqual', id: 'Riz basmati, cuit, sans sel ajouté' })
	);
});
