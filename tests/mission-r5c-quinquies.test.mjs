/**
 * Tests MISSION R5c-quinquies — verrou de défilement partagé des volets.
 *
 * Sur iPhone, `body { overflow: hidden }` ne bloque pas le document (le
 * Journal défile encore derrière le volet). Le helper fige donc le body en
 * `position: fixed` à sa position courante et restaure tout à la fermeture.
 *
 * 1) Verrou : body figé à -scrollY, html non défilable, position mémorisée.
 * 2) Verrous superposés : le premier verrouille, le dernier libère.
 * 3) Déverrouillage : styles d'origine rendus tels quels + position restaurée.
 * 4) Câblage : le Journal passe par ce mécanisme pour tous ses volets.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** DOM minimal : seuls les styles inline et le scroll sont exercés. */
function fakeDocument(scrollY = 0) {
	const bodyStyle = { position: '', top: '', left: '', right: '', width: '', overflow: '', paddingRight: '' };
	const htmlStyle = { overflow: '' };
	const calls = [];
	globalThis.document = {
		body: { style: bodyStyle },
		documentElement: { style: htmlStyle, scrollTop: scrollY, clientWidth: 1000 },
	};
	globalThis.window = {
		scrollY,
		innerWidth: 1000,
		scrollTo: (x, y) => {
			calls.push([x, y]);
			globalThis.window.scrollY = y;
		},
		requestAnimationFrame: (fn) => fn(),
	};
	return { bodyStyle, htmlStyle, calls };
}

const {
	lockScroll,
	unlockScroll,
	resetScrollLock,
	currentScrollY,
	scrollLockCount,
} = await import('../src/lib/scrollLock.ts');

test('verrou : body figé à sa position, html non défilable, position mémorisée', () => {
	const { bodyStyle, htmlStyle } = fakeDocument(640);
	resetScrollLock();

	lockScroll();
	assert.equal(bodyStyle.position, 'fixed');
	assert.equal(bodyStyle.top, '-640px', 'position courante conservée à l’écran');
	assert.equal(bodyStyle.width, '100%');
	assert.equal(bodyStyle.overflow, 'hidden');
	assert.equal(htmlStyle.overflow, 'hidden', 'html non défilable non plus');
	assert.equal(scrollLockCount(), 1);
	assert.equal(currentScrollY(), 640, 'la position visible reste celle d’avant le volet');

	unlockScroll();
	resetScrollLock();
});

test('verrous superposés : le premier verrouille, le dernier libère', () => {
	const { bodyStyle, calls } = fakeDocument(320);
	resetScrollLock();

	lockScroll();
	const topFigé = bodyStyle.top;
	lockScroll();
	assert.equal(scrollLockCount(), 2);
	assert.equal(bodyStyle.top, topFigé, 'le second verrou ne refige pas');

	unlockScroll();
	assert.equal(bodyStyle.position, 'fixed', 'toujours verrouillé : un volet reste ouvert');
	assert.equal(scrollLockCount(), 1);

	unlockScroll();
	assert.equal(bodyStyle.position, '');
	assert.equal(scrollLockCount(), 0);
	assert.deepEqual(calls.at(-1), [0, 320], 'position restaurée à la fermeture');

	// Un appel sans verrou actif ne fait rien (jamais de déverrouillage sauvage).
	unlockScroll();
	assert.equal(scrollLockCount(), 0);
	resetScrollLock();
});

test('déverrouillage : styles d’origine rendus tels quels', () => {
	const { bodyStyle } = fakeDocument(200);
	resetScrollLock();
	bodyStyle.position = 'static';
	bodyStyle.overflow = 'visible';

	lockScroll();
	unlockScroll();
	assert.equal(bodyStyle.position, 'static', 'style d’origine restauré');
	assert.equal(bodyStyle.overflow, 'visible');
	assert.equal(bodyStyle.top, '');

	resetScrollLock();
});

test('câblage : le Journal utilise le verrou partagé pour tous ses volets', () => {
	const journal = source('src/routes/espace/journal/+page.svelte');
	assert.ok(journal.includes("from '$lib/scrollLock'"), 'helper partagé importé');
	assert.ok(journal.includes('lockScroll()') && journal.includes('unlockScroll()'));
	assert.ok(!journal.includes('document.body.style.overflow'), 'plus de verrou body seul');
	assert.ok(
		journal.includes('mealPhotoOpen || bilanOpen'),
		'le volet bilan rejoint la liste des volets verrouillés'
	);
	assert.ok(journal.includes('onDestroy('), 'déverrouillage garanti au démontage / retour');
});
