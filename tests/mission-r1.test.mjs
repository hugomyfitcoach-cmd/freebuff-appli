/**
 * Tests MISSION R1 — classement de la recherche d'aliments (Ciqual + OFF).
 *
 * Problème : dans « Ajouter un aliment », les résultats Ciqual étaient mal
 * ordonnés — « beurre » affichait Haricot beurre / Pâte brisée / Sandwich avant
 * le beurre, « riz cuit » n'affichait que du riz cru, « jambon » plaçait
 * « Porc, escalope de jambon » avant le jambon cru.
 *
 * Classement attendu (src/convex/ciqual.ts), par ordre de priorité :
 *   1. tous les mots de la recherche présents (en début de mot) ;
 *   2. noms commençant par le premier mot recherché d'abord (format Ciqual :
 *      aliment, puis précisions) ;
 *   3. état de cuisson : tapé → prioritaire ; sinon cru → poêlé/sauté →
 *      cuit à l'eau ;
 *   4. à égalité, le nom le plus court passe en premier.
 * Bonus : les aliments déjà ajoutés par la cliente remontent en tête.
 *
 * Ces tests sont des tests de RÉFÉRENCE : leurs assertions sont écrites avec
 * leur propre normalisation (aucune réutilisation du code de ranking), sur la
 * vraie table Ciqual embarquée. OFF est testé sur un petit échantillon
 * fictif (même normalisation + règle « tous les mots présents »).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { searchCiqualLocal, rankCiqual } from '../src/convex/ciqual.ts';
import { rankFoods } from '../src/convex/foodRanking.ts';

/* ── Helpers de test (normalisation INDÉPENDANTE du code de ranking) ── */

/** minuscules, sans accents (œ/æ inclus), sans ponctuation. */
function plain(s) {
	return s
		.replace(/œ/gi, 'oe')
		.replace(/æ/gi, 'ae')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/** Famille de cuisson d'un libellé (même vocabulaire que la règle 3). */
function stateRank(label) {
	const t = ` ${plain(label)} `;
	if (/\b(cru|crue|crus|crues)\b/.test(t)) return 0;
	if (/\b(poele|poelee|saute|sautee|grille|grillee|roti|rotie|frit|frite|pane|panee|rissole|rissolee)\b/.test(t)) return 1;
	if (/\b(cuit|cuite|cuits|cuites|bouilli|bouillie|vapeur)\b/.test(t)) return 2;
	return 3; // neutre (sec, fumé, recettes…)
}

const labels = (q, limit, opts) => searchCiqualLocal(q, limit, opts).map((h) => h.label);

/* ─── 1) riz → riz cru d'abord ─── */

test('riz : un riz cru d\'abord (ordre par défaut cru → poêlé/sauté → cuit à l\'eau)', () => {
	const top = labels('riz');
	assert.equal(top.length, 3, 'trois fiches par défaut');
	assert.ok(top.every((l) => /^riz\b/.test(plain(l)), `uniquement la famille « riz » (obtenu : ${top.join(' | ')})`));
	assert.equal(stateRank(top[0]), 0, `1er = riz cru (obtenu : ${top[0]})`);
	assert.ok(top.every((l) => stateRank(l) === 0), `top 3 = crus avant cuits (obtenu : ${top.join(' | ')})`);
});

/* ─── 2) riz cuit → uniquement des riz cuits ─── */

test('riz cuit : uniquement des riz cuits (tous les mots présents — plus aucun cru)', () => {
	const top = labels('riz cuit');
	assert.ok(top.every((l) => /^riz\b/.test(plain(l))), `top 3 = famille riz (obtenu : ${top.join(' | ')})`);
	assert.ok(top.every((l) => stateRank(l) === 2), `top 3 = riz cuits (obtenu : ${top.join(' | ')})`);
	// Déplié (13) : encore uniquement des fiche cuites — AUCUN riz cru.
	const out = labels('riz cuit', 13);
	assert.ok(out.every((l) => stateRank(l) === 2), `aucun cru dans la liste (obtenu : ${out.join(' | ')})`);
	assert.ok(out.every((l) => /\bcuit/.test(plain(l))), `chaque fiche porte « cuit » (obtenu : ${out.join(' | ')})`);
});

/* ─── 3) haricots → crus, puis poêlés, puis cuits à l'eau ─── */

test('haricots : d\'abord les crus, puis les poêlés/sautés, puis les cuits à l\'eau', () => {
	const top = labels('haricots');
	assert.equal(stateRank(top[0]), 0, `1er = haricot cru (obtenu : ${top[0]})`);
	assert.ok(top.every((l) => /^haricot/.test(plain(l))), `famille haricot (obtenu : ${top.join(' | ')})`);
	// Ordre des groupes dans la FAMILLE haricot (les préparations mêlées type
	// « Printanière … haricots verts » restent derrière — règle 2 avant règle 3) :
	// aucun cru après un poêlé, aucun poêlé après un cuit à l'eau.
	const all = rankCiqual('haricots')
		.map((h) => h.label)
		.filter((l) => /^haricot\b/.test(plain(l)))
		.map(stateRank);
	const maxOf = (r) => all.lastIndexOf(r);
	const minOf = (r) => all.indexOf(r);
	if (minOf(1) !== -1) assert.ok(maxOf(0) < minOf(1), 'tous les crus avant les poêlés/sautés');
	if (minOf(2) !== -1) {
		assert.ok(maxOf(0) < minOf(2), 'tous les crus avant les cuits à l\'eau');
		if (minOf(1) !== -1) assert.ok(maxOf(1) < minOf(2), 'tous les poêlés/sautés avant les cuits à l\'eau');
	}
});

/* ─── 4) beurre → beurres (80 % MG) avant haricot beurre ─── */

test('beurre : les beurres 80 % MG d\'abord, « Haricot beurre » derrière', () => {
	const top = labels('beurre');
	assert.ok(
		top.every((l) => /^beurre\b/.test(plain(l)) && l.includes('80% MG')),
		`top 3 = beurres 80 % MG (obtenu : ${top.join(' | ')})`
	);
	const all = labels('beurre', 13);
	const firstHaricot = all.findIndex((l) => /^haricot beurre/i.test(l));
	assert.ok(firstHaricot === -1 || firstHaricot > 2, 'aucun « Haricot beurre » dans le top 3');
	// Sur le classement complet : tout « Beurre… » avant tout « Haricot beurre… ».
	const full = rankCiqual('beurre').map((h) => h.label);
	const lastBeurre = full.reduce((acc, l, i) => (/^beurre\b/i.test(l) ? i : acc), -1);
	const firstHaricotFull = full.findIndex((l) => /^haricot beurre/i.test(l));
	assert.ok(firstHaricotFull === -1 || lastBeurre < firstHaricotFull, 'les beurres passent avant haricot beurre');
});

/* ─── 5) jambon → jambon cuit / cru / sec avant « Porc, escalope de jambon » ─── */

test('jambon : la famille jambon (cuit / cru / sec) avant « Porc, escalope de jambon »', () => {
	const top = labels('jambon');
	assert.ok(
		top.every((l) => /^jambon/.test(plain(l))),
		`top 3 = famille jambon, jamais « Porc, escalope de jambon » (obtenu : ${top.join(' | ')})`
	);
	const full = rankCiqual('jambon').map((h) => h.label);
	const firstPorc = full.findIndex((l) => /^porc, escalope de jambon/i.test(l));
	assert.ok(firstPorc !== -1, '« Porc, escalope de jambon » reste présent dans la recherche');
	for (const probe of [/^jambon cuit/i, /^jambon cru$/i, /^jambon sec$/i]) {
		const idx = full.findIndex((l) => probe.test(l));
		assert.ok(idx !== -1, `fiche présente : ${probe}`);
		assert.ok(idx < firstPorc, `${probe} (rang ${idx}) avant « Porc, escalope de jambon » (rang ${firstPorc})`);
	}
});

/* ─── 6) poulet → morceaux de poulet avant plats préparés ─── */

test('poulet : les morceaux de poulet avant les plats préparés', () => {
	const top = labels('poulet');
	const dish = /basquaise|curry|coco|manchon|marin|emball/i;
	assert.ok(top.every((l) => /^poulet\b/.test(plain(l))), `famille poulet (obtenu : ${top.join(' | ')})`);
	assert.ok(
		top.every((l) => !dish.test(l)),
		`top 3 = morceaux/viande, pas de plat préparé (obtenu : ${top.join(' | ')})`
	);
	const full = rankCiqual('poulet').map((h) => h.label);
	for (const name of ['Poulet basquaise, préemballé', 'Poulet au curry et au lait de coco, préemballé']) {
		const idx = full.indexOf(name);
		assert.ok(idx !== -1, `${name} reste présent dans la recherche`);
		assert.ok(idx > 2, `${name} (rang ${idx}) après les morceaux (top 3)`);
	}
});

/* ─── 7) pâtes cuites → pâtes cuites ─── */

test('pâtes cuites : des pâtes cuites en tête (jamais une pâte à gâteau cuite)', () => {
	const top = labels('pâtes cuites');
	assert.ok(
		top.every((l) => /^pates\b/.test(plain(l)) && /\bcuit/.test(plain(l))),
		`top 3 = pâtes cuites (obtenu : ${top.join(' | ')})`
	);
	assert.ok(top.every((l) => !/^pate\b/.test(plain(l))), `jamais « Pâte … » (pâte à pizza/sablée) devant (obtenu : ${top.join(' | ')})`);
	assert.equal(stateRank(top[0]), 2, `1er = pâtes cuites (obtenu : ${top[0]})`);
});

/* ─── 8) oeuf → œuf entier avant les plats aux œufs ─── */

test('oeuf : l\'œuf entier (cru → dur → au plat) avant les plats aux œufs', () => {
	for (const q of ['oeuf', 'œuf']) {
		const top = labels(q);
		assert.equal(top[0], 'Oeuf cru', `« ${q} » : 1er = Oeuf cru (obtenu : ${top[0]})`);
		assert.equal(top[1], 'Oeuf dur', `« ${q} » : 2e = Oeuf dur (obtenu : ${top[1]})`);
		assert.match(top[2], /^Oeuf au plat/, `« ${q} » : 3e = œuf au plat (obtenu : ${top[2]})`);
	}
	const full = rankCiqual('oeuf').map((h) => h.label);
	for (const dish of ['Oeufs au lait, rayon frais']) {
		const idx = full.indexOf(dish);
		assert.ok(idx !== -1, `${dish} reste présent dans la recherche`);
		assert.ok(idx > 2, `${dish} (rang ${idx}) après l'œuf entier (top 3)`);
	}
});

/* ─── 9) pomme → pomme (fruit) avant pomme de terre ─── */

test('pomme : la pomme (fruit) avant la pomme de terre', () => {
	const top = labels('pomme');
	assert.match(top[0], /^Pomme[, ]/, `1er = pomme fruit (obtenu : ${top[0]})`);
	assert.ok(!/^Pomme de terre/i.test(top[0]), `jamais une pomme de terre en tête (obtenu : ${top[0]})`);
	const full = rankCiqual('pomme').map((h) => h.label);
	const firstFruit = full.findIndex((l) => /^Pomme[, ]/.test(l));
	const firstPotato = full.findIndex((l) => /^Pomme de terre/i.test(l));
	assert.ok(firstPotato !== -1, 'la pomme de terre reste présente dans la recherche');
	assert.ok(firstFruit < firstPotato, `fruit (rang ${firstFruit}) avant pomme de terre (rang ${firstPotato})`);
});

/* ─── 10) pomme de terre → pommes de terre avant chips ─── */

test('pomme de terre : les pommes de terre avant les chips', () => {
	const top = labels('pomme de terre');
	assert.ok(
		top.every((l) => /^pomme de terre/i.test(l)),
		`top 3 = pommes de terre (obtenu : ${top.join(' | ')})`
	);
	const full = rankCiqual('pomme de terre').map((h) => h.label);
	const firstChips = full.findIndex((l) => /^chips/i.test(l));
	assert.ok(firstChips !== -1, 'les chips de pommes de terre restent présentes');
	assert.ok(firstChips > 2, `chips (rang ${firstChips}) après les pommes de terre (top 3)`);
});

/* ─── 11) yaourt → yaourt nature avant desserts ─── */

test('yaourt : les yaourts nature avant les desserts (gâteau, glace, sauce…)', () => {
	const top = labels('yaourt');
	assert.ok(top.every((l) => /^yaourt\b/.test(plain(l))), `top 3 = famille yaourt (obtenu : ${top.join(' | ')})`);
	assert.ok(top.every((l) => /\bnature\b/.test(plain(l))), `top 3 = yaourts nature (obtenu : ${top.join(' | ')})`);
	const full = rankCiqual('yaourt').map((h) => h.label);
	const firstDessert = full.findIndex((l) => !/^yaourt\b/i.test(l));
	assert.ok(firstDessert !== -1, 'les desserts au yaourt restent présents');
	assert.ok(firstDessert > 2, `premier dessert (rang ${firstDessert}) après les yaourts nature (top 3)`);
});

/* ─── 12) steak hache → steaks hachés ─── */

test('steak hache : des steaks hachés (les deux mots présents)', () => {
	const top = labels('steak hache');
	assert.ok(top.length === 3, 'trois fiches');
	assert.ok(
		top.every((l) => /steak hach/i.test(l)),
		`top 3 = steaks hachés (obtenu : ${top.join(' | ')})`
	);
	assert.ok(top.every((l) => !/bifteck/i.test(l)), 'aucun « steak ou bifteck » (mot « haché » absent)');
	for (const q of ['steak haché', 'steaks hachés']) {
		assert.ok(labels(q).every((l) => /steak hach/i.test(l)), `« ${q} » : même résultat (normalisation pluriel/accents)`);
	}
});

/* ─── 13) Bonus : un aliment déjà utilisé remonte en tête ─── */

test('Un aliment déjà ajouté par la cliente remonte en tête de la section Ciqual', () => {
	const used = 'Yaourt à la grecque aromatisé, sucré';
	const before = labels('yaourt', 3);
	assert.ok(!before.includes(used), 'prérequis : pas déjà dans le top 3');
	const after = labels('yaourt', 3, { usedLabels: [used] });
	assert.equal(after[0], used, `l'aliment déjà utilisé passe en tête (obtenu : ${after.join(' | ')})`);
	// Le bonus reste strictement limité aux candidats pertinents :
	// un aliment déjà utilisé mais hors recherche ne s'invite jamais.
	const unrelated = labels('riz', 3, { usedLabels: [used] });
	assert.ok(unrelated.every((l) => /^riz\b/.test(plain(l))), `hors recherche → jamais boosté (obtenu : ${unrelated.join(' | ')})`);
	// La règle « tous les mots présents » reste prioritaire sur le bonus.
	const missWord = labels('riz cuit', 3, { usedLabels: ['Riz blanc, cru'] });
	assert.ok(
		missWord.every((l) => stateRank(l) === 2),
		`un riz cru déjà utilisé ne passe pas devant des riz cuits (obtenu : ${missWord.join(' | ')})`
	);
});

/* ─── 14) Open Food Facts : même normalisation + règle « tous les mots présents » ─── */

test('OFF : même normalisation (accents, casse, pluriels, œuf)', () => {
	const items = [{ name: 'Œuf entier, cru' }, { name: 'Pain de mie complet' }, { name: 'Yaourt nature' }];
	for (const q of ['oeuf', 'œuf', 'OEUF', 'oeufs', 'ŒUF']) {
		const out = rankFoods(items, q).map((f) => f.name);
		assert.equal(out[0], 'Œuf entier, cru', `« ${q} » → œuf d'abord (obtenu : ${out.join(' | ')})`);
	}
	assert.equal(rankFoods(items, 'YAOURT')[0].name, 'Yaourt nature', 'casse ignorée');
	assert.equal(rankFoods(items, 'pâtes')[0] !== undefined, true, 'requete sans résultat = liste vide sans erreur');
});

test('OFF : règle « tous les mots présents » — les produits complets passent d\'abord', () => {
	// Petit échantillon fictif (aucune donnée réelle).
	const items = [
		{ name: 'Steak haché 5% MG' }, // tous les mots
		{ name: 'Steak de bœuf' }, // manque « haché »
		{ name: 'Haché parmentier' }, // manque « steak »
		{ name: 'Steaks hachés pur bœuf' }, // tous les mots (pluriel)
	];
	for (const q of ['steak hache', 'steaks hachés']) {
		const out = rankFoods(items, q).map((f) => f.name);
		assert.ok(
			out.indexOf('Steak haché 5% MG') < out.indexOf('Steak de bœuf'),
			`« ${q} » : produit complet avant produit incomplet (obtenu : ${out.join(' | ')})`
		);
		assert.ok(
			out.indexOf('Steaks hachés pur bœuf') < out.indexOf('Haché parmentier'),
			`« ${q} » : les deux mots avant un seul mot (obtenu : ${out.join(' | ')})`
		);
	}
	// La normalisation OFF est bien partagée : « hachés » ≈ « haché ».
	assert.ok(
		rankFoods(items, 'steak haché').map((f) => f.name).includes('Steak haché 5% MG'),
		'pluriel/accents équivalents'
	);
});
