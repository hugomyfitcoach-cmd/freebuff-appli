/**
 * Tests MISSION R5b — fiche nutritionnelle détaillée (interface).
 *
 * 1) Formatage français des valeurs (virgule, une décimale sous 10 g, entier
 *    au-delà, sel à deux décimales sous 1 g, « — » si inconnu) et recalcul
 *    pour la quantité choisie (ex. 150 g).
 * 2) Bloc « Vitamines et minéraux » : Ciqual uniquement, masqué si les 6
 *    valeurs sont inconnues (OFF et Référence G-Flux n'en publient jamais).
 * 3) Câblage : lien replié par défaut, UNE requête au dépliage seulement,
 *    rafraîchissement OFF en parallèle, fibres OFF conservées (correctif R5a).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
	detailRows,
	detailSourceLabel,
	formatDetailForQty,
	formatDetailValue,
	hasUnknownValue,
	microRows,
	showMicros,
} from '../src/lib/foodDetailsFormat.ts';

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/* ─── 1) Formatage ─── */

test('formatage : virgule, décimale sous 10 g, entier au-delà, sel à 2 décimales', () => {
	assert.equal(formatDetailValue(0.045, 'salt'), '0,05', 'sel : deux décimales sous 1 g');
	assert.equal(formatDetailValue(0.02, 'salt'), '0,02');
	assert.equal(formatDetailValue(8.6, 'g'), '8,6', 'glucides : une décimale sous 10 g');
	assert.equal(formatDetailValue(0.5, 'g'), '0,5');
	assert.equal(formatDetailValue(48, 'kcal'), '48', 'énergie : entier');
	assert.equal(formatDetailValue(12.4, 'g'), '12', 'au-delà de 10 g : entier');
	assert.equal(formatDetailValue(2.19, 'salt'), '2,2', 'sel entre 1 et 10 g : une décimale');
	assert.equal(formatDetailValue(1.24, 'mg'), '1,2', 'micros : une décimale sous 10');
	assert.equal(formatDetailValue(0.1, 'ug'), '0,1', 'vitamine D en µg');
	assert.equal(formatDetailValue(245, 'mg'), '245');
	assert.equal(formatDetailValue(null, 'g'), '—', 'valeur inconnue → « — »');
	assert.equal(formatDetailValue(undefined, 'kcal'), '—');
});

test('recalcul pour la quantité choisie (150 g) — jamais la valeur /100 g', () => {
	// Tomate cerise crue : 31,8 kcal · 5,7 g de glucides /100 g.
	assert.equal(formatDetailForQty(31.8, 150, 'kcal'), '48', 'énergie pour 150 g');
	assert.equal(formatDetailForQty(5.7, 150, 'g'), '8,6', 'glucides pour 150 g (8,55 → 8,6)');
	assert.equal(formatDetailForQty(0.3, 150, 'salt'), '0,45', 'sel : deux décimales sous 1 g');
	assert.equal(formatDetailForQty(0.03, 150, 'salt'), '0,05', 'sel 0,045 g → 0,05');
	assert.equal(formatDetailForQty(1.4, 100, 'g'), '1,4', 'quantité 100 g = valeurs /100 g');
	assert.equal(formatDetailForQty(null, 150, 'g'), '—', 'valeur inconnue → « — »');
	assert.equal(formatDetailForQty(5.7, null, 'g'), '—', 'quantité invalide → « — »');
	assert.equal(formatDetailForQty(5.7, 0, 'g'), '—');
});

const CIQUAL = {
	kcal: 148,
	protein: 3.03,
	carbs: 32.9,
	fat: 0.4,
	sugars: 0,
	fiber: null,
	saturatedFat: 0.14,
	salt: 0.045,
	source: 'ciqual',
	micros: { calcium: 7, iron: 0, magnesium: 5.26, potassium: 14, vitaminC: 0, vitaminD: 0.1 },
};

const OFF = {
	kcal: 52,
	protein: 0.3,
	carbs: 12.5,
	fat: 0.2,
	sugars: 0,
	fiber: 0.4,
	saturatedFat: null,
	salt: null,
	source: 'food',
};

test('lignes de la fiche : ordre, libellés et « dont … »', () => {
	const rows = detailRows(CIQUAL, 100);
	assert.deepEqual(
		rows.map((r) => r.key),
		['kcal', 'carbs', 'sugars', 'fiber', 'protein', 'fat', 'saturatedFat', 'salt'],
		'ordre Énergie → Sel'
	);
	assert.equal(rows[0].label, 'Énergie');
	assert.equal(rows[0].value, '148');
	assert.equal(rows[0].unit, 'kcal');
	assert.equal(rows[1].tone, 'carbs', 'glucides : couleur Journal');
	assert.equal(rows[2].label, 'dont sucres');
	assert.equal(rows[2].indent, true, 'sous-ligne « dont » indentée');
	assert.equal(rows[3].value, '—', 'fibres inconnues → « — »');
	assert.equal(rows[6].label, 'dont acides gras saturés');
	assert.equal(rows[7].value, '0,05', 'sel du XLSX, 2 décimales');

	const for150 = detailRows(CIQUAL, 150);
	assert.equal(for150[0].value, '222', 'énergie recalculée pour 150 g');
	assert.equal(for150[7].value, '0,07', 'sel recalculé pour 150 g');
	assert.equal(detailRows(null, 150)[0].value, '—', 'aucune fiche → « — » partout');
});

/* ─── 2) Vitamines et minéraux ─── */

test('bloc micros : Ciqual uniquement, masqué si les 6 valeurs sont inconnues', () => {
	assert.equal(showMicros(OFF), false, 'Open Food Facts : jamais de bloc micros');
	assert.equal(microRows(OFF).length, 0);
	assert.equal(showMicros({ ...CIQUAL, source: 'reference' }), false, 'Référence G-Flux : jamais non plus');

	const allNull = { ...CIQUAL, micros: { calcium: null, iron: null, magnesium: null, potassium: null, vitaminC: null, vitaminD: null } };
	assert.equal(showMicros(allNull), false, '6 valeurs inconnues → bloc masqué');
	assert.equal(microRows(allNull).length, 0);
	assert.equal(showMicros({ ...CIQUAL, micros: undefined }), false, 'aucune micro → masqué');

	const rows = microRows(CIQUAL);
	assert.deepEqual(
		rows.map((r) => r.label),
		['Vitamine C', 'Potassium', 'Fer', 'Calcium', 'Vitamine D', 'Magnésium'],
		'ordre et libellés de la maquette'
	);
	assert.equal(rows[0].unit, 'mg');
	assert.equal(rows[4].unit, 'µg', 'vitamine D en µg');
	assert.equal(rows[4].value, '0,1');
	assert.equal(rows[1].value, '14');

	const partial = microRows({ ...CIQUAL, micros: { ...CIQUAL.micros, magnesium: null } });
	assert.equal(partial[5].value, '—', 'valeur absente → « — »');
	assert.equal(partial[5].unit, '', 'unité omise quand la valeur est inconnue');
});

test('mention de source et légende « — »', () => {
	assert.equal(detailSourceLabel('ciqual'), 'Valeurs Ciqual – ANSES');
	assert.equal(detailSourceLabel('food'), 'Valeurs Open Food Facts');
	assert.equal(detailSourceLabel('reference'), 'Valeurs Référence G-Flux');
	assert.equal(hasUnknownValue(CIQUAL), true, 'fibres inconnues → légende affichée');
	assert.equal(
		hasUnknownValue({ ...CIQUAL, fiber: 0, micros: { calcium: 1, iron: 2, magnesium: 3, potassium: 4, vitaminC: 5, vitaminD: 6 } }),
		false,
		'toutes les valeurs connues → pas de légende'
	);
	assert.equal(hasUnknownValue(OFF), true, 'AGS et sel OFF inconnus → légende');
});

/* ─── 3) Câblage de la fiche ─── */

const sheet = source('src/lib/components/QuantitySheet.svelte');

test('fiche : lien replié par défaut, une seule requête au dépliage', () => {
	assert.match(sheet, /let detailsOpen = \$state\(false\)/, 'section fermée par défaut');
	assert.ok(sheet.includes('Voir la fiche nutritionnelle'), 'lien de dépliage');
	assert.ok(sheet.includes('Masquer la fiche nutritionnelle'), 'lien de repli');
	assert.equal((sheet.match(/fetch\(/g) ?? []).length, 2, 'deux appels : fiche + rafraîchissement OFF');
	assert.match(sheet, /function toggleDetails\(\)[\s\S]{0,400}if \(!detailsData && !detailsLoading\) void loadDetails\(\)/, 'requête au premier dépliage seulement');
	assert.ok(sheet.includes('/api/foods/details?source='), 'une seule requête `foodDetails`');
	assert.ok(!/onMount\([^)]*loadDetails/.test(sheet), 'aucune requête à l’ouverture de la fiche');
	// Valeurs recalculées pour la quantité : le markup lit les lignes dérivées.
	assert.match(sheet, /const detailQty = \$derived\(valid \? effGrams : null\)/);
	assert.match(sheet, /const detailRowList = \$derived\(detailRows\(detailsData, detailQty\)\)/);
	assert.ok(sheet.includes('Fiche nutritionnelle'), 'titre de la section');
	assert.ok(sheet.includes('pour {fmtQty(detailQty ?? 0)} g'), 'titre « pour X g »');
});

test('OFF : rafraîchissement au dépliage, jamais attendu pour l’affichage', () => {
	assert.match(sheet, /if \(ref\.source === 'food' && !offRefreshAsked\)/, 'rafraîchissement OFF seulement');
	assert.match(sheet, /void refreshOffDetails\(ref\.id\)/, 'lancé en parallèle (non bloquant)');
	assert.ok(sheet.includes("'/api/foods/details/refresh'"), 'route de complétion OFF');
	assert.match(sheet, /if \(j\.refreshed && detailsOpen && detailRef\?\.id === foodId\) void loadDetails\(true\)/, 'relecture silencieuse');

	const route = source('src/routes/api/foods/details/+server.ts');
	assert.match(route, /requireRole\(event, \['client', 'coach'\]\)/, 'fiche partagée cliente/coach, session obligatoire');
	assert.ok(route.includes('api.foodDetails.foodDetails'), 'même requête que le moteur existant');
	const refresh = source('src/routes/api/foods/details/refresh/+server.ts');
	assert.ok(refresh.includes('api.off.refreshOffDetails'), 'règle des 30 jours côté serveur');
	assert.match(refresh, /if \(user\.role !== 'client'\) return json\(\{ refreshed: false \}\)/, 'complétion réservée aux clientes');
});

test('correctif R5a : fibres OFF conservées à l’insertion et dans le rafraîchissement', () => {
	const off = source('src/convex/off.ts');
	assert.ok(
		off.includes('fiber100: detail1(p.nutriments?.["fiber_100g"])'),
		'0 g de fibres est une valeur réelle (detail1, pas round1)'
	);
	assert.match(off, /if \(parsed\.fiber100 !== undefined\) details\.fiber100 = parsed\.fiber100/, 'rafraîchissement OFF conserve les fibres');
	const journal = source('src/convex/journal.ts');
	assert.ok(journal.includes('fiber100: v.optional(v.number())'), 'cacheFoods accepte les fibres');
});
