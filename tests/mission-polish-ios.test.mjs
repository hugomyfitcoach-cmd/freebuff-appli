/**
 * Tests MISSION POLISH-IOS — fermeture des volets sans clignotement.
 *
 * Constat (iPhone 14, 60 Hz) : à la fermeture d'un volet de l'Accueil, le
 * contenu saute vers le bas par-dessus la barre de navigation et le fond
 * assombri réapparaît une fraction de seconde.
 *
 * Ce que ces tests verrouillent :
 * 1) Un SEUL fondu de sortie : le fond et le panneau ont la même durée
 *    (l'entrée du fond reste à 160 ms, inchangée).
 * 2) La libération (verrou de défilement, géométrie) attend la FIN de la
 *    sortie — `transitionend` avec délai de secours — jamais pendant.
 * 3) La géométrie du volet est figée en pixels avant la sortie : plus aucune
 *    marge `env(safe-area-inset-*)` ni hauteur recalculée pendant le fondu.
 * 4) Le rebond élastique de la page est supprimé sur `html` et `body`.
 * 5) Câblage : volets de l'Accueil ET du Journal passent par ce mécanisme.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const motion = await import('../src/lib/sheetMotion.ts');

test('un seul fondu de sortie : fond et panneau sur la même durée', () => {
	assert.equal(motion.SHEET_FADE_MS, 160, 'entrée du fond inchangée (iPhone récent identique)');
	assert.equal(motion.SHEET_PANEL_MS, 240);
	assert.equal(motion.SHEET_EXIT_MS, motion.SHEET_PANEL_MS);
	assert.equal(motion.sheetFade().duration, 160, 'ouverture : fondu de 160 ms');
	assert.equal(motion.sheetFadeOut().duration, motion.SHEET_EXIT_MS, 'sortie : fond aligné sur le panneau');
	assert.equal(motion.sheetFlyOut().y, 48, 'même trajectoire de sortie');
	assert.equal(motion.sheetFlyOut().duration, motion.SHEET_EXIT_MS);
});

test('libération après la fin de la sortie, jamais avant', async () => {
	let appels = 0;
	const annuler = motion.onSheetExitEnd(null, () => {
		appels += 1;
	});
	assert.equal(appels, 0, 'aucun appel synchrone : la sortie n’a pas commencé');
	await new Promise((r) => setTimeout(r, motion.sheetExitMs() + motion.SHEET_EXIT_FALLBACK_MS + 40));
	assert.equal(appels, 1, 'appelée une seule fois, après la durée de sortie');
	annuler();
});

test('annulation (réouverture pendant la sortie) : aucun appel', async () => {
	let appels = 0;
	const annuler = motion.onSheetExitEnd(null, () => {
		appels += 1;
	});
	annuler();
	await new Promise((r) => setTimeout(r, motion.sheetExitMs() + motion.SHEET_EXIT_FALLBACK_MS + 40));
	assert.equal(appels, 0);
});

test('fin de transition (transitionend du panneau) : plus tôt que le délai de secours', async () => {
	globalThis.window = { matchMedia: () => ({ matches: false }) };
	const ecouteurs = new Map();
	const panneau = {
		addEventListener: (type, fn) => ecouteurs.set(type, fn),
		removeEventListener: (type) => ecouteurs.delete(type),
	};
	let fini = 0;
	motion.onSheetExitEnd(panneau, () => {
		fini += 1;
	});
	ecouteurs.get('transitionend')({ target: panneau, propertyName: 'opacity' });
	assert.equal(fini, 1, 'la fin du fondu déclenche la libération');
	// Une transition d'un enfant (autre propriété) ne doit pas la déclencher.
	let fini2 = 0;
	motion.onSheetExitEnd(panneau, () => {
		fini2 += 1;
	});
	ecouteurs.get('transitionend')({ target: {}, propertyName: 'opacity' });
	assert.equal(fini2, 0);
	delete globalThis.window;
});

test('géométrie figée en pixels avant la sortie, styles rendus ensuite', () => {
	const panneau = { offsetHeight: 322, style: { height: '', paddingBottom: '' }, parentElement: null };
	const calque = { offsetHeight: 780, style: { height: '' }, addEventListener() {}, removeEventListener() {} };
	panneau.parentElement = calque;
	globalThis.window = { getComputedStyle: () => ({ paddingBottom: '34px' }) };

	const rendre = motion.freezeSheetForExit(panneau);
	assert.equal(panneau.style.height, '322px', 'hauteur figée (aucun recalcul pendant le fondu)');
	assert.equal(panneau.style.paddingBottom, '34px', 'marge safe-area résolue en pixels');
	assert.equal(calque.style.height, '780px', 'calque figé (barre d’URL iOS ne déplace plus le volet)');

	rendre();
	assert.equal(panneau.style.height, '', 'styles d’origine rendus');
	assert.equal(panneau.style.paddingBottom, '');
	assert.equal(calque.style.height, '');
	delete globalThis.window;
});

test('câblage Accueil : verrou posé à l’ouverture, libéré après la sortie', () => {
	for (const chemin of ['src/lib/components/WeightQuickSheet.svelte', 'src/lib/components/HydrationQuickSheet.svelte']) {
		const feuille = read(chemin);
		assert.ok(feuille.includes("from '$lib/scrollLock'"), `${chemin} : verrou partagé`);
		assert.match(feuille, /onSheetExitEnd\(panel,/, `${chemin} : libération sur la fin de sortie`);
		assert.match(feuille, /freezeSheetForExit\(panel\)/, `${chemin} : géométrie figée à la fermeture`);
		assert.match(feuille, /verrouille = true;\s*lockScroll\(\);/s, `${chemin} : verrou à l’ouverture`);
		assert.match(feuille, /out:fade=\{sheetFadeOut\(\)\}/, `${chemin} : fond aligné sur la sortie`);
		// Chaque unlockScroll() de la feuille est derrière onSheetExitEnd ou
		// onDestroy : jamais déclenché par la seule bascule `open = false`.
		const libérations = feuille.split('unlockScroll()').length - 1;
		assert.equal(
			libérations,
			3,
			`${chemin} : libération à la fin du fondu (requestClose + filet) et au démontage`,
		);
	}
});

test('câblage Journal : le verrou reste posé pendant le fondu de sortie', () => {
	const journal = read('src/routes/espace/journal/+page.svelte');
	assert.ok(journal.includes("import { onSheetExitEnd } from '$lib/sheetMotion';"));
	assert.match(journal, /fondFigé = false;[\s\S]*?onSheetExitEnd\(null,[\s\S]*?if \(!fondFigé\) unlockScroll\(\);/);
	assert.doesNotMatch(journal, /fondFigé = locked;\s*if \(locked\) lockScroll\(\);\s*else unlockScroll\(\);/, 'plus de libération immédiate');
	assert.ok(journal.includes('onDestroy('), 'déverrouillage garanti au démontage');
});

test('rebond de page supprimé sur html et body, zones internes inchangées', () => {
	const css = read('src/routes/layout.css');
	const regle = /html,\s*body\s*\{[^}]*overscroll-behavior-y:\s*none;[^}]*\}/;
	assert.match(css, regle, 'overscroll-behavior-y: none sur html et body');
	assert.match(css, /\.gflux-app-client-home \{[^}]*overscroll-behavior-y:\s*none;/, 'règle existante conservée');
});
