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
 *   3. mots CONSÉCUTIFS à pertinence égale (« pain complet » : les mots qui
 *      se suivent passent avant ceux qui sont séparés — Mission R1-bis) ;
 *   4. regroupement par VARIÉTÉ (nom sans la mention de cuisson), la cuisson
 *      s'ordonnant à l'intérieur de chaque variété : cru → cuit à l'eau →
 *      vapeur → four → poêlé/sauté → frit (une cuisson tapée reste
 *      prioritaire — Mission R1-bis) ;
 *   5. à égalité, le nom le plus court passe en premier.
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

import { readFileSync } from 'node:fs';

import { searchCiqualLocal, rankCiqual } from '../src/convex/ciqual.ts';
import { rankFoods } from '../src/convex/foodRanking.ts';
import { cookingBadgeOf } from '../src/lib/cookedState.ts';

/** Source d'un fichier de l'app (tests d'affichage, sans DOM). */
const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

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

test('riz : un riz cru d\'abord, puis la cuisson de SA variété (R1-bis : plus de cuisson globale)', () => {
	const top = labels('riz');
	assert.equal(top.length, 3, 'trois fiches par défaut');
	assert.ok(top.every((l) => /^riz\b/.test(plain(l)), `uniquement la famille « riz » (obtenu : ${top.join(' | ')})`));
	assert.equal(stateRank(top[0]), 0, `1er = riz cru (obtenu : ${top[0]})`);
	// Regroupement par variété : le cru et le cuit du MÊME riz se suivent
	// (l'ancienne règle imposait « top 3 = crus » toutes variétés mêlées).
	assert.equal(top[0], 'Riz blanc, cru');
	assert.equal(top[1], 'Riz blanc, cuit, sans sel ajouté', `cru puis cuit de la variété « riz blanc » (obtenu : ${top.join(' | ')})`);
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

test('haricots : variétés regroupées, cuisson cru → cuit à l\'eau DANS chaque variété', () => {
	const top = labels('haricots');
	assert.equal(stateRank(top[0]), 0, `1er = haricot cru (obtenu : ${top[0]})`);
	assert.ok(top.every((l) => /^haricot/.test(plain(l))), `famille haricot (obtenu : ${top.join(' | ')})`);
	// R1-bis : l'ordre de cuisson s'applique à l'intérieur d'une variété, plus
	// globalement à toute la famille (« haricot plat » puis « haricot vert »).
	const verts = rankCiqual('haricots')
		.map((h) => h.label)
		.filter((l) => /^haricot vert\b/i.test(l));
	const firstEau = verts.findIndex((l) => stateRank(l) === 2);
	const lastCru = verts.reduce((acc, l, i) => (stateRank(l) === 0 ? i : acc), -1);
	assert.ok(firstEau !== -1, `un « haricot vert » cuit à l'eau est présent (obtenu : ${verts.join(' | ')})`);
	assert.ok(lastCru !== -1 && lastCru < firstEau, 'dans la variété « haricot vert » : tous les crus avant le cuit à l’eau');
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

/* ─── 15) R1-bis : mots consécutifs ─── */

test('pain complet : les mots CONSÉCUTIFS passent avant les mots séparés', () => {
	const full = rankCiqual('pain complet').map((h) => h.label);
	const phrase = full.indexOf('Pain complet ou intégral (à la farine T150)');
	const separated = full.indexOf('Pain grillé au blé complet, tranches, préemballé');
	assert.ok(phrase !== -1 && separated !== -1, `les deux fiches sont présentes (obtenu : ${full.slice(0, 6).join(' | ')})`);
	assert.ok(phrase < separated, `« Pain complet ou intégral » (rang ${phrase}) avant « Pain grillé au blé complet » (rang ${separated})`);
	// Même règle côté Open Food Facts, à pertinence égale.
	const off = rankFoods(
		[{ name: 'Pain grillé au blé complet' }, { name: 'Pain complet ou intégral' }],
		'pain complet'
	).map((f) => f.name);
	assert.equal(off[0], 'Pain complet ou intégral');
});

/* ─── 16) R1-bis : regroupement par variété puis cuisson ─── */

test('pâtes : une variété à la fois — crue puis cuite de la MÊME variété dans le top 2', () => {
	const top = labels('pâtes');
	assert.equal(top[0], 'Pâtes sèches, standard, crues');
	assert.equal(top[1], 'Pâtes sèches, standard, cuites, sans sel ajouté', `crues puis cuites (obtenu : ${top.join(' | ')})`);
	assert.match(top[2], /^Pâtes sèches, aux oeufs, crues$/, 'la variété suivante commence ensuite');
});

test('pomme de terre : crue, cuite à l\'eau, au four (même variété)', () => {
	const top = labels('pomme de terre');
	assert.deepEqual(top, [
		'Pomme de terre, sans peau, crue',
		'Pomme de terre, bouillie/cuite à l\'eau',
		'Pomme de terre, rôtie/cuite au four',
	]);
});

/* ─── 17) Badges de cuisson (source unique cookedState.ts) ─── */

test('badges de cuisson : cru, cuit, dernier mot gagnant, aucun badge sans mention', () => {
	assert.equal(cookingBadgeOf('Pomme de terre, sans peau, crue'), 'Cru');
	assert.equal(cookingBadgeOf('Pâtes sèches, standard, cuites'), 'Cuit');
	assert.equal(cookingBadgeOf("Pomme de terre, bouillie/cuite à l'eau"), "Cuit à l'eau");
	assert.equal(cookingBadgeOf('Pomme de terre, appertisée, égouttée'), 'En conserve');
	// Deux mentions de cuisson : la DERNIÈRE du nom gagne (rôtie → au four).
	assert.equal(cookingBadgeOf('Pomme de terre, rôtie/cuite au four'), 'Au four');
	assert.equal(cookingBadgeOf('Beurre à 80% MG, doux'), null);
});

/* ─── 18) Panne Open Food Facts : Ciqual jamais masqué ─── */

test('panne Open Food Facts : Ciqual reste affiché, message discret sur les Produits', () => {
	const engine = source('src/lib/foodSearch.svelte.ts');
	const runBody = engine.slice(engine.indexOf('async function run(q'), engine.indexOf('function setQuery'));
	assert.ok(/state\.productsUnavailable = true/.test(runBody), 'la panne OFF est signalée à la vue');
	assert.ok(!/state\.ciqual\s*=\s*\[\]/.test(runBody), 'la panne OFF ne vide plus les fiches Ciqual');

	const journal = source('src/routes/espace/journal/+page.svelte');
	assert.ok(/searchError = 'Produits indisponibles pour le moment\.'/.test(journal), 'message discret côté PWA');
	const searchBody = journal.slice(
		journal.indexOf('async function runSearch'),
		journal.indexOf('/**', journal.indexOf('async function runSearch'))
	);
	const errBody = searchBody.slice(searchBody.indexOf('if (err) {'), searchBody.indexOf('searching = false;'));
	assert.ok(!/ciqualResults\s*=/.test(errBody), 'le bloc Ciqual survit à la panne');
	const ciqualAt = journal.indexOf('Aliments de référence');
	assert.ok(ciqualAt !== -1 && journal.indexOf('{searchError}', ciqualAt) > ciqualAt, 'le message est rendu APRÈS le bloc Ciqual');
});

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

/* ─── 19) R1-ter : apostrophes + AUCUN résultat de remplissage ─── */

test('avoine : uniquement des noms qui contiennent « avoine », flocons inclus', () => {
	const all = rankCiqual('avoine').map((h) => h.label);
	assert.ok(all.length > 0, 'au moins une fiche pertinente');
	assert.ok(
		all.every((l) => plain(l).split(' ').some((w) => w.startsWith('avoine'))),
		`chaque fiche porte le mot « avoine » en début de mot (obtenu : ${all.slice(0, 6).join(' | ')})`
	);
	const shown = labels('avoine', 13);
	assert.ok(
		shown.some((l) => /flocons d'avoine/i.test(l)),
		`« Flocons d'avoine » présent (apostrophe = séparateur de mots) — obtenu : ${shown.join(' | ')}`
	);
	// La mésaventure Preview : « avoine » remplissait la liste avec des fiches
	// sans rapport (mots outils « a », « au », « d » pris pour des préfixes).
	for (const bad of ['sole', 'homard', 'navet']) {
		assert.ok(!all.some((l) => plain(l).startsWith(bad)), `aucun « ${bad} » pour « avoine »`);
	}
});

test('olive : « Huile d\'olive » est trouvée (apostrophe droite et typographique)', () => {
	const shown = labels('olive', 13);
	assert.ok(
		shown.some((l) => /^huile d'olive/i.test(l)),
		`« Huile d'olive vierge extra » présente — obtenu : ${shown.join(' | ')}`
	);
	assert.ok(
		shown.every((l) => plain(l).split(' ').some((w) => w.startsWith('olive'))),
		`aucune fiche sans le mot « olive » (obtenu : ${shown.join(' | ')})`
	);
	// Les deux apostrophes séparent « d » et « avoine » de la même façon.
	for (const q of ["d'avoine", 'd’avoine']) {
		const out = labels(q, 13);
		assert.ok(
			out.some((l) => /flocons d'avoine/i.test(l)),
			`« ${q} » : flocons trouvés (obtenu : ${out.join(' | ')})`
		);
	}
});
