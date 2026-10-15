/**
 * Tests MISSION — Microanimation du pictogramme Calories (Accueil).
 *
 * 1) Seul le point central du pictogramme Calories porte la pulsation ;
 * 2) La pulsation est un halo ::after (transform/opacity), en boucle de 3 s,
 *    sans toucher au carré, au texte ni aux dimensions du point ;
 * 3) prefers-reduced-motion désactive le halo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const home = read('../src/routes/espace/+page.svelte');
const css = read('../src/routes/layout.css');

test('Calories : seul le point central porte la classe de pulsation', () => {
	const start = home.indexOf('<!-- CALORIES');
	const end = home.indexOf('Objectif {fmt(dash.tracking.kcalGoal)}', start);
	const block = home.slice(start, end);
	assert.match(block, /<span class="grid h-\[34px\] w-\[34px\] place-items-center rounded-xl bg-brand-light"><span aria-hidden="true" class="gflux-kcal-pulse h-1\.5 w-1\.5 rounded-full bg-brand"><\/span><\/span>/);
	// Demande : même halo sur les points Pas et Hydratation (point seul, jamais la carte ni l’icône).
	const dotCount = home.split('gflux-kcal-pulse').length - 1;
	assert.equal(dotCount, 3, 'trois points : Calories, Pas, Hydratation');
	for (const label of ['Pas', 'Hydratation']) {
		assert.match(home, new RegExp(`<span aria-hidden="true" class="gflux-kcal-pulse h-1\\.5 w-1\\.5 shrink-0 rounded-full bg-brand"><\\/span>\\s*<span class="text-\\[11px\\][^"]*">${label}<\\/span>`), `point animé sur ${label}`);
	}
});

test('Calories : halo ::after en boucle 3 s, transform/opacity uniquement', () => {
	assert.match(css, /\.gflux-kcal-pulse::after \{[\s\S]*?animation: kcal-halo 3s infinite;/);
	const kf = css.slice(css.indexOf('@keyframes kcal-halo'), css.indexOf('.gflux-kcal-pulse {'));
	assert.match(kf, /transform: scale\(3\.4\)/);
	assert.doesNotMatch(kf, /width|height|top|left|background|color/, 'aucune propriété de layout ou de couleur animée');
});

test('Calories : prefers-reduced-motion coupe le halo', () => {
	assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.gflux-kcal-pulse::after \{\s*animation: none;\s*display: none;/);
});
