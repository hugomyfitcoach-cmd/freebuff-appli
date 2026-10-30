/**
 * Tests MISSION RECHERCHE-INTRUS — plus de résultats hors sujet au milieu de
 * la liste « Ajouter un aliment ».
 *
 * Problème constaté en production : « Ragoût de veau » affichait d'abord des
 * résultats pertinents (paupiettes, blanquettes, quenelles de veau), puis des
 * intrus — « Velouté de légumes », « Bière blonde de haute fermentation »,
 * « Yaourt brassé sucré aux copeaux de chocolat » — dont le SEUL point commun
 * avec la requête est le mot « de », puis la liste redevenait pertinente.
 *
 * Cause : l'index plein texte (Convex `by_name`, API OFF) admet un candidat
 * dès qu'il porte AU MOINS UN des mots de la requête ; `rankFoods` ne faisait
 * que CLASSER ces candidats, il n'en écartait aucun.
 *
 * Correctif (src/convex/foodRanking.ts) : mots vides français ignorés dans la
 * requête (de, du, des, d', la, le, les, l', un, une, au, aux, à, et, en,
 * avec, sans, pour) et filtre d'éligibilité `filterByQueryWords` appliqué à
 * TOUTES les sources (base locale, aliments personnels, Open Food Facts) et à
 * TOUS les lots. Le classement R1 (`rankFoods`) est INCHANGÉ : les aliments
 * qui portent tous les mots restent devant.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
	filterByQueryWords,
	rankFoods,
	significantTokens,
	sharesSignificantWord,
} from '../src/convex/foodRanking.ts';

/** Source d'un fichier de l'app (vérifications de câblage). */
const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** minuscules, sans accents — contrôle INDÉPENDANT du code de ranking. */
function plain(s) {
	return s
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/œ/gi, 'oe')
		.toLowerCase();
}

/* ─── 1) Mots vides ignorés dans la requête ─── */

test('mots vides français retirés de la requête, le reste conservé', () => {
	assert.deepEqual(significantTokens('Ragoût de veau'), ['ragout', 'veau']);
	assert.deepEqual(significantTokens('Filet d’ poulet'), ['filet', 'poulet']);
	assert.deepEqual(significantTokens('Yaourt aux copeaux de chocolat'), ['yaourt', 'copeaux', 'chocolat']);
	assert.deepEqual(significantTokens('Pomme de terre'), ['pomme', 'terre']);
});

test('requête faite UNIQUEMENT de mots vides : conservée telle quelle', () => {
	assert.deepEqual(significantTokens('de'), ['de']);
	assert.deepEqual(significantTokens('de la'), ['de', 'la']);
	// Rien à filtrer : le nom reste éligible (on ne cherche jamais « rien »).
	assert.equal(sharesSignificantWord('Velouté de légumes', 'de'), true);
});

/* ─── 2) « ragoût de veau » : seuls les veaux ─── */

/** Échantillon FICTIF mêlant veau, velouté, bière et yaourt (aucune donnée réelle). */
const SAMPLE_RAGOUT = [
	{ name: 'Paupiettes de veau' },
	{ name: 'Velouté de légumes' },
	{ name: 'Blanquette de veau' },
	{ name: 'Bière blonde de haute fermentation' },
	{ name: 'Quenelles de veau' },
	{ name: 'Yaourt brassé sucré aux copeaux de chocolat' },
	{ name: 'Ragoût de veau' },
	{ name: 'Escalope de veau' },
];

test('« ragoût de veau » : aucun intrus, seuls les veaux restent', () => {
	for (const q of ['Ragoût de veau', 'ragout de veau', 'RAGOÛT DE VEAU']) {
		const kept = filterByQueryWords(SAMPLE_RAGOUT, q).map((f) => f.name);
		assert.ok(kept.length > 0, `des résultats pertinents restent (obtenu : ${kept.join(' | ')})`);
		assert.ok(
			kept.every((n) => plain(n).includes('veau')),
			`seuls les veaux (obtenu : ${kept.join(' | ')})`
		);
		for (const intrus of ['Velouté de légumes', 'Bière blonde de haute fermentation', 'Yaourt brassé sucré aux copeaux de chocolat']) {
			assert.ok(!kept.includes(intrus), `« ${intrus} » écarté (mot vide « de » seulement)`);
		}
	}
});

test('« ragoût de veau » : le classement R1 des rescapés est conservé', () => {
	const q = 'Ragoût de veau';
	const kept = filterByQueryWords(SAMPLE_RAGOUT, q);
	const names = rankFoods(kept, q).map((f) => f.name);
	assert.equal(names[0], 'Ragoût de veau', `le libellé qui porte tous les mots reste en tête (obtenu : ${names.join(' | ')})`);
	assert.equal(names.length, kept.length, 'aucun résultat perdu au classement');
});

/* ─── 3) « pomme de terre » : que des pommes de terre ─── */

const SAMPLE_PDT = [
	{ name: 'Pomme de terre, sans peau, crue' },
	{ name: 'Flocons de pomme de terre' },
	{ name: 'Velouté de légumes' },
	{ name: 'Bière blonde de haute fermentation' },
	{ name: 'Pommes de terre sautées' },
	{ name: 'Yaourt brassé sucré aux copeaux de chocolat' },
];

test('« pomme de terre » : uniquement des pommes de terre (le « de » n’admet personne)', () => {
	for (const q of ['pomme de terre', 'Pommes de terre']) {
		const kept = filterByQueryWords(SAMPLE_PDT, q).map((f) => f.name);
		assert.ok(
			kept.every((n) => plain(n).includes('pomme') && plain(n).includes('terre')),
			`pommes de terre uniquement (obtenu : ${kept.join(' | ')})`
		);
		assert.ok(
			kept.every((n) => !/veloute|biere|yaourt/i.test(plain(n))),
			`aucun intrus (obtenu : ${kept.join(' | ')})`
		);
		assert.equal(kept.length, 3, 'les trois fiches de pomme de terre sont conservées');
	}
});

/* ─── 4) Recherches de référence R1 : rien ne change ─── */

test('R1 intact : deux mots partagés avant un seul, et un nom partiel reste admis', () => {
	const items = [
		{ name: 'Steak haché 5% MG' },
		{ name: 'Steak de bœuf' }, // un seul mot significatif : reste candidat (R1)
		{ name: 'Haché parmentier' },
		{ name: 'Steaks hachés pur bœuf' },
	];
	const out = rankFoods(filterByQueryWords(items, 'steak haché'), 'steak haché').map((f) => f.name);
	assert.ok(
		out.indexOf('Steak haché 5% MG') < out.indexOf('Steak de bœuf'),
		`produit complet avant produit partiel (obtenu : ${out.join(' | ')})`
	);
	assert.ok(
		out.indexOf('Steaks hachés pur bœuf') < out.indexOf('Haché parmentier'),
		`deux mots avant un seul (obtenu : ${out.join(' | ')})`
	);
});

test('R1 intact : rankFoods garde son contrat (il classe, il n’exclut pas)', () => {
	const items = [{ name: 'Riz basmati' }, { name: 'Velouté de légumes' }];
	assert.equal(rankFoods(items, 'riz').length, 2, 'rankFoods classe la liste reçue, sans la filtrer');
	assert.equal(filterByQueryWords(items, 'riz').length, 1, 'filterByQueryWords écarte l’intrus');
});

/* ─── 5) Câblage : le filtre s'applique à TOUTES les sources et à TOUS les lots ─── */

test('toutes les sources passent par le même filtre d’éligibilité', () => {
	const journal = source('src/convex/journal.ts');
	const coach = journal.slice(journal.indexOf('export const searchForCoach'));
	const coachBody = coach.slice(0, coach.indexOf('export const addEntryForCoach'));
	assert.ok(/filterByQueryWords\(foods\.map\(toHit\), term\)/.test(coachBody), 'recherche coach : filtre appliqué');
	const local = journal.slice(journal.indexOf('export const searchLocal'));
	const localBody = local.slice(0, local.indexOf('foodByBarcode'));
	assert.ok(/filterByQueryWords\(foods\.map\(toHit\), term\)/.test(localBody), 'base locale : filtre appliqué');
	assert.ok(/filterByQueryWords\(await Promise\.all\(customs/.test(localBody), 'aliments personnels : filtre appliqué');
	assert.ok(
		/journal\.ts[\s\S]*?rankFoods\(\s*filterByQueryWords/.test(journal) ||
			/filterByQueryWords\([^)]*\)\s*,?\s*\)?/.test(localBody),
		'le classement R1 suit le filtre (jamais l’inverse)'
	);

	const off = source('src/convex/off.ts');
	assert.ok(/filterByQueryWords\(foods, q\)\.map/.test(off), 'recherche Open Food Facts : filtre appliqué');
});

test('le lot suivant complète la liste (jamais de réinjection au milieu)', () => {
	const engine = source('src/lib/foodSearch.svelte.ts');
	assert.ok(
		/state\.products = \[\.\.\.state\.products, \.\.\.items\.filter/.test(engine),
		'CRM : la page suivante est ajoutée en fin de liste'
	);
	const journal = source('src/routes/espace/journal/+page.svelte');
	assert.ok(
		/results = \[\.\.\.results, \.\.\.items\.filter/.test(journal),
		'PWA : la page suivante est ajoutée en fin de liste'
	);
});
