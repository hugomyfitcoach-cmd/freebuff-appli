/**
 * Tests MISSION ROTATION — volet « Ajouter un aliment » cassé après rotation.
 *
 * Constat (production, iPhone, PWA) : volet de recherche ouvert depuis le
 * Journal, téléphone en paysage puis de retour en portrait → volet tassé avec
 * le Journal visible derrière, en-tête décalé vers le bas, capsule
 * Recherche / Code-barres / Repas IA hors de place. Accueil et Progression
 * tournaient sans problème : le défaut est propre au Journal.
 *
 * Cause (PR #31, NAV-FIX/REV31-FIX) : la détection « clavier ouvert » comparait
 * `innerHeight` et `visualViewport.height` avec 140 px de tolérance. Pendant une
 * rotation, iOS change ces deux métriques DANS LE DÉSORDRE : l'écart mesuré
 * (portrait 844 vs paysage 390) dépasse le seuil et la rotation est prise pour
 * un clavier. Le volet restait figé en état « clavier » (capsule masquée,
 * hauteur/décalage héritées de l'autre orientation) et la référence de hauteur
 * n'était jamais réinitialisée.
 *
 * Ces tests vérifient : rotation simulée (inversion largeur/hauteur) avec le
 * volet du Journal ouvert, champ focalisé OU NON → jamais d'état clavier, et
 * géométrie remesurée (aucune dimension figée).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/* ── DOM / runes simulés (les modules de l'app tournent sous Vite) ── */

class FakeInput {
	constructor(type = 'text') {
		this.type = type;
		this.disabled = false;
		this.readOnly = false;
	}
}

/**
 * Géométrie mutable : `w`/`h` = window, `vvH` = visualViewport.height.
 * La rotation est simulée en inversant largeur/hauteur ; la valeur `vvH`
 * héritée de l'autre orientation reproduit la métrique figée d'iOS.
 */
const state = { w: 390, h: 844, vvH: 844, active: null, sheetOpen: false };

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

function fakeEnv() {
	globalThis.window = {
		get innerWidth() {
			return state.w;
		},
		get innerHeight() {
			return state.h;
		},
		scrollX: 0,
		scrollY: 0,
		visualViewport: {
			get width() {
				return state.w;
			},
			get height() {
				return state.vvH;
			},
			get offsetTop() {
				return 0;
			},
			addEventListener: on,
			removeEventListener: off,
		},
		scrollTo() {},
		requestAnimationFrame: (fn) => {
			fn();
			return 1;
		},
		addEventListener: on,
		removeEventListener: off,
	};
	globalThis.document = {
		get activeElement() {
			return state.active;
		},
		visibilityState: 'visible',
		body: { style: {} },
		documentElement: { style: {}, scrollTop: 0, clientWidth: 1000 },
		addEventListener: on,
		removeEventListener: off,
	};
}

globalThis.$state = (v) => v;
globalThis.HTMLInputElement = FakeInput;
globalThis.HTMLTextAreaElement = class FakeTextArea {};
globalThis.HTMLSelectElement = class FakeSelect {};
globalThis.HTMLElement = class FakeHTMLElement {
	constructor() {
		this.isContentEditable = false;
	}
};

fakeEnv();

const { keyboard, syncKeyboardOpen, settleNavVisibility, registerSheetOwner, startKeyboardWatch } = await import(
	'../src/lib/keyboardViewport.svelte.ts'
);
const { resetScrollLock } = await import('../src/lib/scrollLock.ts');

/* Volet de recherche du Journal RÉELLEMENT ouvert pendant toute la rotation. */
const stopWatch = startKeyboardWatch();
const unregisterSheet = registerSheetOwner(() => state.sheetOpen);

function portrait(vvH = 844) {
	state.w = 390;
	state.h = 844;
	state.vvH = vvH;
}
function landscape(vvH = 844) {
	/* Rotation vers le paysage : la hauteur de fenêtre change, la métrique du
	   visualViewport peut rester en portrait (comportement iOS d'origine). */
	state.w = 844;
	state.h = 390;
	state.vvH = vvH;
}
function clean() {
	portrait(844);
	state.active = null;
	state.sheetOpen = false;
	resetScrollLock();
	syncKeyboardOpen();
}

/* ── 1. La rotation n'est jamais un clavier (volet ouvert, sans focus) ── */

test('rotation paysage → portrait, volet de recherche ouvert : aucun état clavier', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	clean();
	state.sheetOpen = true;
	assert.equal(keyboard.open, false, 'portrait de départ : pas de clavier');

	/* Paysage : la hauteur de fenêtre tombe à 390 px alors que le
	   visualViewport annonce encore 844 px (métrique en retard d'iOS). */
	landscape(844);
	settleNavVisibility('visible');
	assert.equal(keyboard.open, false, 'le paysage n’est pas un clavier');

	/* Retour en portrait, métrique encore amputée (390 px) : l'ancien calcul
	   voyait 844 − 390 = 454 px d’écart = clavier fantôme. */
	portrait(390);
	settleNavVisibility('visible');
	assert.equal(keyboard.open, false, 'le retour en portrait n’est pas un clavier');

	/* La mesure se stabilise : toujours pas de clavier. */
	state.vvH = 844;
	syncKeyboardOpen();
	assert.equal(keyboard.open, false, 'métrique stabilisée : pas de clavier');

	t.mock.timers.tick(1500);
	assert.equal(keyboard.open, false, 'aucun garde-fou ne rouvre un clavier fantôme');

	/* Un VRAI clavier reste détecté après la rotation (comportement #31). */
	state.vvH = 508;
	syncKeyboardOpen();
	assert.equal(keyboard.open, true, 'un clavier réel est toujours reconnu');

	clean();
});

/* ── 2. Le focus conservé par iOS après une rotation n'est pas un clavier ── */

test('champ focalisé avant la rotation : pas d’état clavier, un tap le rétablit', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	clean();
	state.sheetOpen = true;

	/* L'utilisateur a tapé le champ de recherche : clavier légitime. */
	state.active = new FakeInput('search');
	state.vvH = 508;
	syncKeyboardOpen();
	assert.equal(keyboard.open, true, 'saisie en cours : le clavier compte');

	/* Rotation : iOS referme le clavier mais GARDE l'input focalisé. */
	landscape(844);
	fire('orientationchange');
	assert.equal(keyboard.open, false, 'en paysage, plus de clavier affiché');

	portrait(390);
	fire('orientationchange');
	assert.equal(keyboard.open, false, 'de retour en portrait, aucun clavier');

	/* La métrique se stabilise, le champ est encore focalisé : toujours rien. */
	state.vvH = 844;
	syncKeyboardOpen();
	assert.equal(keyboard.open, false, 'un focus hérité ne masque pas la barre');

	/* L'utilisateur retape le champ : le clavier redevient une preuve. */
	fire('focusin');
	assert.equal(keyboard.open, true, 'un tap après rotation rétablit le clavier');

	/* Fermeture du volet : barre et « + » reviennent. */
	state.active = null;
	state.sheetOpen = false;
	settleNavVisibility('sheet-closed');
	t.mock.timers.tick(1500);
	assert.equal(keyboard.open, false, 'fermeture du volet : navigation rendue');

	clean();
});

/* ── 3. Hauteur de référence réinitialisée + aucun blocage d'orientation ── */

test('la hauteur de référence est réinitialisée à chaque rotation', () => {
	const kb = source('src/lib/keyboardViewport.svelte.ts');
	assert.ok(/let refHeight = 0;/.test(kb), 'référence de hauteur dédiée');
	assert.ok(/function noteLayoutChange\(\)/.test(kb), 'détection de changement de mise en page');
	assert.ok(/Math\.abs\(w - prevW\) > 32/.test(kb), 'signature largeur (un clavier ne change pas la largeur)');
	assert.ok(/if \(noteLayoutChange\(\)\)/.test(kb), 'la référence est réinitialisée à chaque mesure');
	assert.ok(/const ref = refHeight > 0 \? refHeight/.test(kb), 'le seuil compare la mise en page courante');
	assert.ok(/focusUntrusted = true/.test(kb), 'un focus hérité de la rotation ne prouve pas un clavier');
	assert.ok(/window\.addEventListener\('orientationchange', onOrientation\)/.test(kb), 'rotation écoutée');
	assert.ok(!/screen\.orientation\.lock/.test(kb), 'aucun blocage d’orientation');
});

test('Journal : volet et barre inférieure remesurés après rotation (pas de dimension figée)', () => {
	const journal = source('src/routes/espace/journal/+page.svelte');

	/* Téléphone en paysage = toujours un ÉCRAN PLEIN (sinon gabarit desktop). */
	assert.match(journal, /const PHONE_MQ = '\(max-width: 639px\), \(max-height: 520px\)'/, 'le paysage reste un téléphone');
	assert.ok(
		!/matchMedia\('\(max-width: 639px\)'\)/.test(journal),
		'plus aucun test de largeur seule pour le gabarit du volet'
	);
	assert.match(journal, /@media \(orientation: landscape\) and \(max-height: 520px\)/, 'règle paysage dédiée');
	assert.ok(journal.includes('.journal-sheet'), 'le volet porte sa classe de rotation');

	/* Rotation détectée par la largeur, jamais confondue avec une fermeture. */
	assert.match(journal, /const rotated = prevVvW > 0 && Math\.abs\(w - prevVvW\) > 32/, 'rotation = largeur changée');
	assert.match(journal, /const closed = !rotated && vvH > prevVvH \+ 4/, 'une rotation n’est pas une fermeture de clavier');

	/* Décalage vertical uniquement pour un clavier RÉELLEMENT ouvert. */
	assert.match(journal, /vvTop = keyboard\.open \? \(vv\?\.offsetTop \?\? 0\) : 0/, 'en-tête jamais décalé par une rotation');

	/* Remesure : au tick suivant ET une fois la rotation stabilisée. */
	assert.ok(/window\.addEventListener\('resize', setVh\)/.test(journal), 'resize redimensionne le volet');
	assert.ok(/window\.addEventListener\('orientationchange', onOrientation\)/.test(journal), 'rotation écoutée');
	const handler = journal.slice(journal.indexOf('const onOrientation = () =>'), journal.indexOf("window.addEventListener('resize', setVh)"));
	assert.ok(/relayout\(\);/.test(handler) && /requestAnimationFrame\(relayout\)/.test(handler) && /setTimeout\(relayout, 260\)/.test(handler), 'barre + volet remesurés après la rotation');
	assert.ok(/const relayout = \(\) => \{\s*setVh\(\);\s*setBarPos\(\);/.test(journal), 'hauteur du volet ET position de la barre');

	/* Comportements conservés. */
	assert.ok(/style:height=\{mobile \? `\$\{vvH\}px` : undefined\}/.test(journal), 'hauteur toujours dynamique (visualViewport)');
	assert.ok(/\[logListEl, bcListEl, mealSearchListEl, mealBcListEl\]/.test(journal), 'scroll-dismiss des 4 listes intact');
	assert.ok(/!keyboardOpen\}/.test(journal), 'la capsule reste masquée pendant une vraie saisie');
	assert.ok(!/screen\.orientation\.lock/.test(journal), 'aucun blocage d’orientation');
});

/* Garder le module partagé branché pour l'app (aucun listener orphelin). */
test('abonnement global refermé proprement', () => {
	unregisterSheet();
	stopWatch();
	clean();
});
