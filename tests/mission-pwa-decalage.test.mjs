/**
 * Tests MISSION PWA-DECALAGE — appuis décalés après rotation dans la PWA iOS.
 *
 * Constat (iPhone, app installée, scanner ouvert, paysage → portrait) :
 * `window.scrollY = 62` et `visualViewport.offsetTop = 62` alors que le body
 * est verrouillé (`position: fixed; top: 0`). `getBoundingClientRect` de la
 * croix donnait y = -40 : `elementFromPoint` ne touchait plus rien. Hors PWA,
 * pas de bug.
 *
 * Cause : iOS applique son décalage (barre d'état) APRÈS `resize` /
 * `orientationchange`. Une correction unique à l'instant de l'événement ne
 * suffisait pas — le verrou doit maintenir le document à zéro pendant toute
 * sa durée, avec un second passage au tick suivant.
 *
 * Invariants : jamais de document défilé sous un verrou, quelle que soit
 * l'origine de l'événement (resize, visualViewport), et la fermeture rend
 * toujours la position d'origine. Un champ focalisé garde sa vue (clavier).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/** DOM minimal avec écouteurs : window + visualViewport simulés. */
function fakeDom({ scrollY = 0, w = 390, h = 812 } = {}) {
	const bodyStyle = { position: '', top: '', left: '', right: '', width: '', overflow: '', paddingRight: '' };
	const htmlStyle = { overflow: '' };
	const calls = [];
	const listeners = new Map();
	const vvListeners = new Map();

	const add = (map) => (type, fn) => {
		if (!map.has(type)) map.set(type, new Set());
		map.get(type).add(fn);
	};
	const remove = (map) => (type, fn) => {
		map.get(type)?.delete(fn);
	};
	const fire = (map, type) => {
		for (const fn of [...(map.get(type) ?? [])]) fn({ type });
	};

	globalThis.document = {
		activeElement: null,
		body: { style: bodyStyle },
		documentElement: { style: htmlStyle, scrollTop: scrollY, clientWidth: w },
	};
	globalThis.window = {
		scrollY,
		scrollX: 0,
		innerWidth: w,
		innerHeight: h,
		visualViewport: {
			height: h,
			offsetTop: 0,
			addEventListener: add(vvListeners),
			removeEventListener: remove(vvListeners),
		},
		scrollTo: (x, y) => {
			calls.push([x, y]);
			globalThis.window.scrollX = x;
			globalThis.window.scrollY = y;
			globalThis.document.documentElement.scrollTop = y;
		},
		requestAnimationFrame: (fn) => {
			fn();
			return 1;
		},
		addEventListener: add(listeners),
		removeEventListener: remove(listeners),
	};

	return {
		bodyStyle,
		calls,
		fireWindow: (type) => fire(listeners, type),
		fireVv: (type) => fire(vvListeners, type),
	};
}

const { lockScroll, unlockScroll, resetScrollLock, scrollLockCount } = await import('../src/lib/scrollLock.ts');

test('P1. décalage de 62 px appliqué APRÈS l’événement : le verrou ramène à zéro', () => {
	const { bodyStyle, calls, fireWindow, fireVv } = fakeDom({ scrollY: 0 });
	resetScrollLock();

	lockScroll();
	assert.equal(bodyStyle.position, 'fixed');
	assert.equal(scrollLockCount(), 1);
	calls.length = 0;

	/* Cœur du bug : iOS défile la fenêtre en différé, un tick après l'événement. */
	globalThis.window.scrollY = 62;
	globalThis.window.visualViewport.offsetTop = 62;
	fireWindow('resize');

	assert.deepEqual(calls.at(-1), [0, 0], 'window.scrollTo(0, 0) est appelé');
	assert.equal(globalThis.window.scrollY, 0, 'la fenêtre ne reste jamais défilée sous le verrou');

	/* Même décalage hérité, rapporté par le visualViewport. */
	calls.length = 0;
	globalThis.window.scrollY = 62;
	fireVv('scroll');
	assert.deepEqual(calls.at(-1), [0, 0]);
	assert.equal(globalThis.window.scrollY, 0);

	unlockScroll();
	resetScrollLock();
});

test('P2. fermeture : la position d’origine est restaurée, plus aucun maintien', () => {
	const dom = fakeDom({ scrollY: 640 });
	resetScrollLock();

	lockScroll();
	assert.equal(dom.bodyStyle.top, '-640px');

	/* Rotation : décalage hérité puis corrigé par le maintien. */
	globalThis.window.scrollY = 62;
	dom.fireWindow('orientationchange');
	assert.equal(globalThis.window.scrollY, 0);

	dom.calls.length = 0;
	unlockScroll();

	assert.deepEqual(dom.calls.at(-1), [0, 640], 'position d’avant l’ouverture rendue');
	assert.equal(globalThis.window.scrollY, 640);
	assert.equal(dom.bodyStyle.position, '', 'body rendu tel quel');
	assert.equal(scrollLockCount(), 0);

	/* Verrou libéré : un resize ne remet plus le document à zéro. */
	globalThis.window.scrollY = 62;
	const before = dom.calls.length;
	dom.fireWindow('resize');
	assert.equal(dom.calls.length, before, 'aucun écouteur ne survit au déverrouillage');

	resetScrollLock();
});

test('P3. un champ focalisé garde sa vue (clavier iOS légitime)', () => {
	class FakeInput {
		constructor(type = 'text') {
			this.type = type;
			this.disabled = false;
			this.readOnly = false;
		}
	}
	globalThis.HTMLInputElement = FakeInput;
	const dom = fakeDom({ scrollY: 0 });
	resetScrollLock();

	lockScroll();
	globalThis.document.activeElement = new FakeInput('text');
	dom.calls.length = 0;

	globalThis.window.scrollY = 62;
	dom.fireWindow('resize');
	dom.fireVv('resize');
	assert.equal(dom.calls.length, 0, 'aucune correction tant que la saisie est en cours');

	/* Champ retiré (clavier refermé) : le verrou reprend la main. */
	globalThis.document.activeElement = null;
	dom.fireWindow('resize');
	assert.deepEqual(dom.calls.at(-1), [0, 0]);

	unlockScroll();
	resetScrollLock();
	delete globalThis.HTMLInputElement;
});
