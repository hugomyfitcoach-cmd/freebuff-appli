/**
 * MISSION PORTRAIT-ONLY — couche « Tourne ton téléphone » + démarrage caméra.
 *
 * Constat : en paysage sur téléphone, l'app restait utilisable (iOS ne bloque
 * pas la rotation d'une PWA) et la mise en page du Journal restait réduite au
 * retour en portrait. Décision produit : couche plein écran sur téléphone en
 * paysage, rien d'utilisable dessous, état conservé.
 *
 * Ces tests vérifient :
 *  1. téléphone tactile en paysage → couche affichée ET focus retiré ;
 *  2. clavier ouvert en portrait (fenêtre rétrécie, écran inchangé) → AUCUNE
 *     couche (détection sur l'APPAREIL, jamais la fenêtre) ;
 *  3. tablette / ordinateur en paysage → AUCUNE couche (CRM coach inclus) ;
 *  4. retour en portrait → remise à zéro (scrollTo(0,0) sous verrou) ;
 *  5. prefers-reduced-motion → icône fixe (aucune animation) ;
 *  6. vidéo caméra invisible tant que ses dimensions ne sont pas connues et
 *     stables, puis fondu court.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/* ── Environnement simulé (modules runes exécutés hors Vite) ── */

globalThis.$state = (v) => v;

globalThis.HTMLInputElement = class FakeInput {
	constructor() {
		this.tagName = 'INPUT';
		this.type = 'text';
		this.disabled = false;
		this.readOnly = false;
		this.isContentEditable = false;
		this.blurred = 0;
	}
	blur() {
		this.blurred += 1;
	}
};
globalThis.HTMLTextAreaElement = class FakeTextArea {};
globalThis.HTMLSelectElement = class FakeSelect {};
globalThis.HTMLElement = class FakeHtmlElement {
	constructor() {
		this.isContentEditable = false;
	}
};

const device = {
	/** Petit écran tactile (téléphone). */
	touch: true,
	coarse: true,
	screenW: 844,
	screenH: 390,
	angle: 90,
};

const view = { innerW: 844, innerH: 390, scrollY: 0, scrollX: 0 };
const calls = { scrollTo: [] };
const focus = { el: null };

const handlers = new Map();
const on = (type, fn) => {
	const set = handlers.get(type) ?? new Set();
	set.add(fn);
	handlers.set(type, set);
};
const off = (type, fn) => handlers.get(type)?.delete(fn);
const fire = (type) => {
	for (const fn of [...(handlers.get(type) ?? [])]) fn();
};

function fakeScreen() {
	return {
		get width() {
			return device.screenW;
		},
		get height() {
			return device.screenH;
		},
		orientation: {
			get angle() {
				return device.angle;
			},
			get type() {
				return device.angle === 90 || device.angle === 270 ? 'landscape-primary' : 'portrait-primary';
			},
			addEventListener: on,
			removeEventListener: off,
		},
	};
}

globalThis.screen = fakeScreen();
Object.defineProperty(globalThis, 'navigator', {
	configurable: true,
	get: () => ({ maxTouchPoints: device.touch ? 5 : 0 }),
});
globalThis.window = {
	get innerWidth() {
		return view.innerW;
	},
	get innerHeight() {
		return view.innerH;
	},
	get scrollY() {
		return view.scrollY;
	},
	set scrollY(v) {
		view.scrollY = v;
	},
	get scrollX() {
		return view.scrollX;
	},
	scrollTo(x, y) {
		calls.scrollTo.push([x, y]);
		view.scrollX = x;
		view.scrollY = y;
	},
	requestAnimationFrame(fn) {
		fn();
		return 1;
	},
	matchMedia: (query) => ({ matches: query === '(pointer: coarse)' ? device.coarse : false }),
	addEventListener: on,
	removeEventListener: off,
};
globalThis.document = {
	get activeElement() {
		return focus.el;
	},
	hidden: false,
	visibilityState: 'visible',
	body: { style: {} },
	documentElement: { style: {}, scrollTop: 0, clientWidth: 0 },
	addEventListener: on,
	removeEventListener: off,
};

const { isPhoneLandscape, portraitLock, refreshPortraitLock, startPortraitOnlyWatch } = await import(
	'../src/lib/portraitOnly.svelte.ts'
);
const { lockScroll, unlockScroll, scrollLockCount } = await import('../src/lib/scrollLock.ts');

const stopWatch = startPortraitOnlyWatch();

const phoneLandscape = () => {
	device.touch = true;
	device.coarse = true;
	device.screenW = 844;
	device.screenH = 390;
	device.angle = 90;
	view.innerW = 844;
	view.innerH = 390;
};
const phonePortrait = () => {
	device.touch = true;
	device.coarse = true;
	device.screenW = 390;
	device.screenH = 844;
	device.angle = 0;
	view.innerW = 390;
	view.innerH = 844;
};

test('téléphone en paysage → couche affichée et focus retiré', () => {
	/* Point de départ explicite : portrait, couche absente. */
	phonePortrait();
	refreshPortraitLock();
	phoneLandscape();
	focus.el = new globalThis.HTMLInputElement();
	assert.equal(refreshPortraitLock(), true);
	assert.equal(isPhoneLandscape(), true);
	assert.equal(portraitLock.active, true, 'la couche est affichée');
	assert.equal(focus.el.blurred, 1, 'le clavier est refermé (blur du champ actif)');
});

test('clavier ouvert en portrait (fenêtre rétrécie) → couche NON affichée', () => {
	phonePortrait();
	/* Clavier Android : la FENÊTRE rétrécit, l'écran et l'orientation ne changent pas. */
	view.innerW = 390;
	view.innerH = 380;
	assert.equal(refreshPortraitLock(), false);
	assert.equal(portraitLock.active, false, 'jamais déclenchée par la fenêtre');
	/* Téléphone couché mais fenêtre en portrait : la couche reste affichée. */
	phoneLandscape();
	view.innerW = 390;
	view.innerH = 844;
	assert.equal(refreshPortraitLock(), true, 'seul l’écran de l’appareil compte');
	phonePortrait();
	refreshPortraitLock();
});

test('tablette ou ordinateur en paysage → AUCUNE couche (CRM coach inclus)', () => {
	/* iPad couché : tactile, paysage, mais petit côté 768 px → hors cible. */
	device.touch = true;
	device.coarse = true;
	device.screenW = 1024;
	device.screenH = 768;
	device.angle = 90;
	assert.equal(isPhoneLandscape(), false);
	assert.equal(refreshPortraitLock(), false);
	assert.equal(portraitLock.active, false);

	/* Ordinateur (même tactile) en paysage : grand écran → hors cible. */
	device.screenW = 1440;
	device.screenH = 900;
	device.angle = 90;
	assert.equal(refreshPortraitLock(), false);

	/* Ordinateur non tactile, petit écran : hors cible aussi. */
	device.touch = false;
	device.coarse = false;
	device.screenW = 844;
	device.screenH = 390;
	assert.equal(refreshPortraitLock(), false);
	assert.equal(portraitLock.active, false);
});

test('retour en portrait → page remise à zéro sous verrou', () => {
	phoneLandscape();
	refreshPortraitLock();
	assert.equal(portraitLock.active, true);

	/* Feuille ouverte : le verrou de défilement est actif. */
	lockScroll();
	assert.equal(scrollLockCount(), 1);
	view.scrollY = 42; // décalage hérité de la rotation (iOS)
	calls.scrollTo.length = 0;

	phonePortrait();
	fire('orientationchange');
	assert.equal(portraitLock.active, false, 'couche retirée');
	assert.ok(
		calls.scrollTo.some(([x, y]) => x === 0 && y === 0),
		'scrollTo(0, 0) appliqué au retour en portrait'
	);
	unlockScroll();
});

test('prefers-reduced-motion → icône fixe, aucune animation', () => {
	const overlay = source('src/lib/components/PortraitOnlyOverlay.svelte');
	assert.match(overlay, /@media \(prefers-reduced-motion: reduce\)[^}]*\{[\s\S]*?\.gflux-portrait-icon\s*\{[^}]*animation:\s*none/, 'animation coupée');
	assert.match(overlay, /\.gflux-portrait-icon\s*\{[^}]*animation:\s*gflux-portrait-turn/, 'animation de rotation en boucle');
	assert.match(overlay, /3\.4s/, 'cycle ~2 s + pause');
	assert.match(overlay, /-webkit-backdrop-filter:\s*blur/, 'flou avec préfixe iOS');
	assert.match(overlay, /backdrop-filter:\s*blur/, 'flou standard');
	assert.match(overlay, /role="alertdialog"/, 'couche annoncée');
	assert.match(overlay, /Tourne ton téléphone/, 'titre demandé');
	assert.match(overlay, /G-Flux s'utilise en mode portrait\./, 'sous-titre demandé');
	assert.match(overlay, /touch-action:\s*none/, 'rien n’est cliquable/scrollable dessous');
	assert.match(overlay, /z-\[9999\]/, 'couvre toute l’app');
});

test('vidéo caméra : invisible jusqu’à des dimensions connues et stables', () => {
	const scanner = source('src/lib/barcodeScanner.ts');
	assert.match(scanner, /opacity:\s*'0'/, 'vidéo masquée au démarrage');
	assert.match(scanner, /transition:\s*`opacity \$\{VIDEO_REVEAL_MS\}ms ease`/, 'fondu court');
	assert.match(scanner, /const VIDEO_REVEAL_MS = 150;/, 'fondu ≈ 150 ms');
	assert.match(scanner, /!video\.videoWidth \|\| !video\.videoHeight/, 'dimensions non nulles exigées');
	assert.match(scanner, /dims !== stableDims/, 'dimensions stables exigées');
	assert.match(scanner, /videoVisible = true;\s*video\.style\.opacity = '1';/, 'affichage seulement après validation');
	assert.match(scanner, /addEventListener\('playing', markVideoPlayable\)/, 'lecture réelle prise en compte');
	assert.match(scanner, /requestVideoFrameCallback/, 'première image prise en compte');
	assert.match(scanner, /removeEventListener\('playing', markVideoPlayable\)/, 'écoute retirée à l’arrêt');
	assert.match(scanner, /if \(stableTimer\) clearTimeout\(stableTimer\)/, 'minuterie nettoyée à l’arrêt');
});

test('paysage téléphone : le scanner met la caméra en pause (reconstruction au retour)', () => {
	const journal = source('src/routes/espace/journal/+page.svelte');
	const run = journal.slice(journal.indexOf('async function runScanner(session: ScannerSession)'), journal.indexOf('scanner = handle;', journal.indexOf('async function runScanner(session: ScannerSession)')));
	assert.match(run, /hasAttribute\?\.\('data-portrait-lock'\)\) return;/, 'aucune caméra ouverte en paysage (pause)');
	/* La pause est posée par le module partagé, seule source de détection. */
	const module = source('src/lib/portraitOnly.svelte.ts');
	assert.match(module, /setAttribute\?\.\('data-portrait-lock'/, 'drapeau de pause posé');
	assert.match(module, /removeAttribute\?\.\('data-portrait-lock'\)/, 'drapeau retiré au retour portrait');
	/* Le layout racine monte la couche au-dessus de TOUTE l’app (CRM inclus). */
	const layout = source('src/routes/+layout.svelte');
	assert.match(layout, /<PortraitOnlyOverlay \/>/, 'couche montée dans le layout racine');
});

test.after(() => stopWatch());
