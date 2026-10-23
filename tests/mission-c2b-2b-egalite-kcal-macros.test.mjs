/**
 * Mission C2b-2b — COHÉRENCE « APPLIQUER À LA FICHE » : objectif = 4G + 4P + 9L.
 *
 * Vérifié :
 *  1. ÉGALITÉ objectif = 4G + 4P + 9L après CHAQUE type de modification
 *     (glucides, protéines, lipides, objectif kcal) — grammes entiers ;
 *     objectif kcal inchangé quand on modifie protéines/lipides (réaligné de
 *     ±2 kcal max uniquement si le reste n'est pas divisible par 4) ;
 *  2. GLUCIDES NÉGATIFS bloqués avec un message clair ; glucides < 100 g →
 *     avertissement EXISTANT du calibrage (message unique partagé) ;
 *  3. BADGES « modifié » et « Reprendre les valeurs calculées » inchangés.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const goalMacros = await import(new URL('../src/lib/goalMacros.ts', import.meta.url).href);
const calibrageLib = await import(new URL('../src/lib/calibrage.ts', import.meta.url).href);
const { kcalDepuisMacros, messageBlocageGlucides, recalculerObjectif } = goalMacros;
const adminPage = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');

/** Invariant : l'objectif affiché = 4G + 4P + 9L, exactement, en entiers. */
function assertEgalite(r, label) {
	const { kcal, glucidesG, proteinesG, lipidesG } = r.valeurs;
	for (const [nom, v] of Object.entries(r.valeurs)) {
		assert.ok(Number.isInteger(v), `${label} : ${nom} entier (reçu ${v})`);
	}
	assert.equal(
		kcal,
		4 * glucidesG + 4 * proteinesG + 9 * lipidesG,
		`${label} : objectif = 4G + 4P + 9L`
	);
	assert.equal(kcal, kcalDepuisMacros(r.valeurs), `${label} : kcalDepuisMacros cohérent`);
}

/* ── Base de test de l'exemple de la mission : G 245, P 148, L 75 = 2 247 ── */
const BASE = { kcal: 2247, glucidesG: 245, proteinesG: 148, lipidesG: 75 };
assert.equal(4 * 245 + 4 * 148 + 9 * 75, 2247, 'base cohérente');

/* ═══ 1 · Égalité objectif = 4G + 4P + 9L après chaque type de modification ═══ */

test('Glucides modifiés → objectif kcal recalculé (4G + 4P + 9L exact)', () => {
	/* L'exemple de la mission : G 247, P 148, L 75 = 2 255 kcal — l'objectif
	   affiché doit devenir 2 255, plus jamais 2 247. */
	const r = recalculerObjectif({ ...BASE, glucidesG: 247 }, 'glucides');
	assertEgalite(r, 'glucides');
	assert.equal(r.valeurs.glucidesG, 247, 'glucides = saisie');
	assert.equal(r.valeurs.kcal, 2255, 'objectif = 4·247 + 4·148 + 9·75 = 2 255');
	assert.equal(r.messageBlocage, null, 'pas de blocage');
});

test('Protéines modifiées → glucides recalculés, objectif kcal INCHANGÉ', () => {
	const r = recalculerObjectif({ ...BASE, proteinesG: 150 }, 'proteines');
	assertEgalite(r, 'protéines');
	assert.equal(r.valeurs.proteinesG, 150);
	assert.equal(r.valeurs.glucidesG, 243, 'glucides = (2 247 − 600 − 675)/4');
	assert.equal(r.valeurs.kcal, 2247, 'objectif inchangé (reste divisible par 4)');
});

test('Lipides modifiés → glucides recalculés, objectif inchangé ou réaligné de ±2 kcal max', () => {
	/* Reste non divisible par 4 → l'égalité EXACTE en grammes entiers impose
	   un réalignement de l'objectif de ±2 kcal max (jamais plus). */
	const r = recalculerObjectif({ ...BASE, lipidesG: 74 }, 'lipides');
	assertEgalite(r, 'lipides');
	assert.equal(r.valeurs.lipidesG, 74);
	assert.equal(r.valeurs.glucidesG, 247, 'glucides = round((2 247 − 592 − 666)/4)');
	assert.ok(Math.abs(r.valeurs.kcal - 2247) <= 2, 'réalignement ≤ 2 kcal');
});

test('Objectif kcal modifié → glucides recalculés, égalité exacte', () => {
	const r = recalculerObjectif({ ...BASE, kcal: 2250 }, 'kcal');
	assertEgalite(r, 'kcal');
	assert.equal(r.valeurs.glucidesG, 246, 'glucides = round((2 250 − 592 − 675)/4)');
	assert.ok(Math.abs(r.valeurs.kcal - 2250) <= 2, 'réalignement ≤ 2 kcal');
});

test('Égalité objectif = 4G + 4P + 9L sur une grille de saisies × 4 champs', () => {
	const grilles = [
		BASE,
		{ kcal: 1800, glucidesG: 200, proteinesG: 120, lipidesG: 60 },
		{ kcal: 1399, glucidesG: 142, proteinesG: 102, lipidesG: 47 },
		{ kcal: 2500, glucidesG: 300, proteinesG: 160, lipidesG: 80 },
		{ kcal: 1141, glucidesG: 100, proteinesG: 102, lipidesG: 37 }
	];
	for (const g of grilles) {
		for (const champ of ['kcal', 'glucides', 'proteines', 'lipides']) {
			/* Vraie modification du champ (+3 g, +30 kcal) — pas une ressaisie. */
			const cle = champ === 'kcal' ? 'kcal' : champ + 'G';
			const saisie = g[cle] + (champ === 'kcal' ? 30 : 3);
			const r = recalculerObjectif({ ...g, [cle]: saisie }, champ);
			assertEgalite(r, `${champ} @ ${g.kcal}`);
			if (champ === 'glucides') {
				assert.equal(r.valeurs.glucidesG, saisie, 'glucides = saisie');
				assert.equal(r.valeurs.kcal, 4 * saisie + 4 * g.proteinesG + 9 * g.lipidesG);
			} else if (champ === 'kcal') {
				assert.ok(Math.abs(r.valeurs.kcal - saisie) <= 2, 'réalignement ≤ 2 kcal de la saisie');
			} else {
				/* P/L : l'objectif kcal est inchangé (réaligné de ±2 kcal max). */
				assert.ok(Math.abs(r.valeurs.kcal - g.kcal) <= 2, `kcal inchangées, ±2 max (${champ})`);
			}
		}
	}
});

/* ═══ 2 · Glucides négatifs bloqués · sous 100 g : avertissement existant ═══ */

test('Glucides calculés négatifs → application bloquée, message clair', () => {
	/* Protéines + lipides (1 475 kcal) > objectif 800 kcal → glucides négatifs. */
	const r = recalculerObjectif({ kcal: 800, glucidesG: 0, proteinesG: 200, lipidesG: 75 }, 'proteines');
	assertEgalite(r, 'négatif (P)');
	assert.equal(r.glucidesNegatifs, true, 'glucides négatifs détectés');
	assert.ok(r.messageBlocage, 'message de blocage présent');
	assert.match(r.messageBlocage, /bloquée/, 'message clair : application bloquée');
	assert.match(r.messageBlocage, /négatifs/, 'message clair : cause citée');
	assert.match(r.messageBlocage, /-?\d+ g/, 'message clair : valeur citée');
});

test('Glucides saisis négatifs → application bloquée, égalité conservée', () => {
	const r = recalculerObjectif({ ...BASE, glucidesG: -50 }, 'glucides');
	assertEgalite(r, 'négatif (G)');
	assert.equal(r.glucidesNegatifs, true);
	assert.ok(r.messageBlocage);
});

test('messageBlocageGlucides : null dès que les glucides sont ≥ 0', () => {
	assert.equal(messageBlocageGlucides(0), null);
	assert.equal(messageBlocageGlucides(99), null);
	assert.ok(messageBlocageGlucides(-1));
});

test('Glucides sous 100 g → avertissement EXISTANT du calibrage (message partagé)', () => {
	const r = recalculerObjectif({ kcal: 1100, glucidesG: 90, proteinesG: 102, lipidesG: 37 }, 'kcal');
	assertEgalite(r, 'sous seuil');
	assert.equal(r.valeurs.glucidesG, 90, '(1 100 − 408 − 333)/4 = 90');
	assert.ok(r.alerteGlucides, 'avertissement affiché');
	assert.equal(r.alerteGlucides, calibrageLib.alerteGlucidesPour(90), 'message identique à celui du calibrage');
	assert.match(r.alerteGlucides, /100/, 'seuil cité');
});

test('Glucides à 100 g pile → aucun avertissement', () => {
	const r = recalculerObjectif({ kcal: 1141, glucidesG: 100, proteinesG: 102, lipidesG: 37 }, 'kcal');
	assert.equal(r.valeurs.glucidesG, 100);
	assert.equal(r.alerteGlucides, null);
});

/* ═══ 3 · Badges « modifié » et « Reprendre les valeurs calculées » inchangés ═══ */

test('Badges « modifié » inchangés : chaque champ compare sa référence', () => {
	for (const badge of [
		'{#if applyKcal !== refKcal}',
		'{#if applyMaintenance !== refMaintenance}',
		'{#if applyCarbs !== refCarbs}',
		'{#if applyProtein !== refProtein}',
		'{#if applyFat !== refFat}'
	]) {
		assert.ok(adminPage.includes(badge), `badge présent : ${badge}`);
	}
});

test('« Reprendre les valeurs calculées » SUPPRIMÉ : la dernière action gagne (C2c-3)', () => {
	/* Le bouton et sa fonction disparaissent avec le bandeau « Les résultats ont
	   changé » : les champs sont recalculés automatiquement à chaque entrée. */
	assert.ok(!adminPage.includes('onclick={reprendreValeursCalculees}'), 'bouton supprimé');
	assert.ok(!adminPage.includes('function reprendreValeursCalculees'), 'fonction supprimée');
	assert.ok(!adminPage.includes('applyResultatsChanges'), 'état du bandeau supprimé');
	const suivi = adminPage.slice(adminPage.indexOf('$effect(() => {'), adminPage.indexOf('function recalculerApresSaisie'));
	for (const ligne of [
		'applyKcal = r.objectifJournalierKcal;',
		'applyCarbs = r.macros.glucidesG;',
		'applyProtein = r.macros.proteinesG;',
		'applyFat = r.macros.lipidesG;',
		'refKcal = applyKcal;',
		'refCarbs = applyCarbs;',
		'refProtein = applyProtein;',
		'refFat = applyFat;'
	]) {
		assert.ok(suivi.includes(ligne), `recalcul inconditionnel : ${ligne}`);
	}
});

test('Recalcul branché sur les 4 champs de saisie + gardes de blocage', () => {
	for (const champ of ['kcal', 'glucides', 'proteines', 'lipides']) {
		assert.ok(
			adminPage.includes(`onchange={() => recalculerApresSaisie('${champ}')}`),
			`recalcul branché : ${champ}`
		);
	}
	assert.ok(adminPage.includes('{#if applyAlerteGlucides}'), 'avertissement < 100 g affiché');
	assert.ok(adminPage.includes('{#if applyBlocageGlucides}'), 'blocage négatif affiché');
	assert.ok(adminPage.includes('alerteGlucidesPour(applyCarbs)'), 'message existant réutilisé');
	const demarrage = adminPage.slice(adminPage.indexOf('function demarrerApplication'));
	assert.ok(
		demarrage.includes('if (applyBlocageGlucides)') && demarrage.includes('calConfirmOpen = true;'),
		'la confirmation ne s’ouvre jamais avec des glucides négatifs'
	);
	const appli = adminPage.slice(
		adminPage.indexOf('async function appliquerCalibrage'),
		adminPage.indexOf('/* Onglet Plan de repas')
	);
	assert.ok(appli.includes('if (applyBlocageGlucides)'), 'filet de sécurité dans appliquerCalibrage');
});
