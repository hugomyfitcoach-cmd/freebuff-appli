/**
 * Tests MISSION NAV-FIX — barre de navigation et bouton « + » qui disparaissent.
 *
 * Constat (production, iPhone) : après des manipulations dans « Ajouter un
 * aliment » (recherche, scan code-barres, fiche aliment, fermetures), la barre
 * du bas (Accueil / Journal / Progression) ET le bouton vert flottant « + »
 * disparaissaient, Journal affiché normalement. Rouvrir l'app corrigeait.
 *
 * Cause : deux booléens `keyboardOpen` LOCAUX (AppShell pour la barre, Journal
 * pour le « + »), chacun déduit d'un `visualViewport` rétréci. iOS garde
 * parfois cette mesure amputée après la fermeture d'un volet (l'input focalisé
 * est retiré du DOM avant la fin du repli du clavier, aucun `resize` n'est
 * émis) : les deux UI restaient masquées jusqu'à un remontage complet.
 *
 * Ces tests vérifient le correctif : une source de vérité partagée
 * (src/lib/keyboardViewport.svelte.ts), une libération à CHAQUE chemin de
 * fermeture, et un garde-fou (navigation, retour au premier plan, démontage)
 * qui réaffiche barre + « + » et libère tout verrou restant dès qu'aucun volet
 * n'est réellement ouvert.
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

const state = { keyboardShrunk: false, active: null, notes: [] };

function fakeEnv() {
	const bodyStyle = { position: '', top: '', left: '', right: '', width: '', overflow: '', paddingRight: '' };
	const htmlStyle = { overflow: '' };
	globalThis.window = {
		innerHeight: 844,
		scrollX: 0,
		scrollY: 120,
		visualViewport: {
			get height() {
				// 844 - clavier 336 quand le clavier est "ouvert"
				return state.keyboardShrunk ? 508 : 844;
			},
			addEventListener() {},
			removeEventListener() {},
		},
		scrollTo: (x, y) => {
			globalThis.window.scrollX = x;
			globalThis.window.scrollY = y;
		},
		requestAnimationFrame: (fn) => {
			state.notes.push('raf');
			fn();
			return 1;
		},
		addEventListener() {},
		removeEventListener() {},
	};
	globalThis.document = {
		get activeElement() {
			return state.active;
		},
		visibilityState: 'visible',
		body: { style: bodyStyle },
		documentElement: { style: htmlStyle, scrollTop: 120, clientWidth: 1000 },
		addEventListener() {},
		removeEventListener() {},
	};
	return { bodyStyle, htmlStyle };
}

/* Rune `$state` hors compilateur Svelte : identité suffisante pour la logique. */
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

const { lockScroll, scrollLockCount, resetScrollLock } = await import('../src/lib/scrollLock.ts');
const { keyboard, syncKeyboardOpen, settleNavVisibility, registerSheetOwner, anySheetOpen } = await import(
	'../src/lib/keyboardViewport.svelte.ts'
);

/** Remet l'environnement à l'état « Journal affiché, aucun volet ouvert ». */
function clean() {
	state.keyboardShrunk = false;
	state.active = null;
	state.notes = [];
	resetScrollLock();
	syncKeyboardOpen();
}

/* ── 1. Cause exacte : une métrique de viewport figée ne bloque plus l'UI ── */

test('métrique iOS figée après fermeture : le garde-fou réaffiche barre et « + »', () => {
	clean();
	// Le clavier a été ouvert (volet de recherche) : la mesure dit « rétréci ».
	state.keyboardShrunk = true;
	syncKeyboardOpen();
	assert.equal(keyboard.open, true, 'pendant la saisie, la navigation cède la place au clavier');

	// Volet fermé : iOS n'a pas émis de resize, la mesure reste amputée.
	state.active = null;
	settleNavVisibility('visible');
	assert.equal(keyboard.open, false, 'la barre du bas et le « + » reviennent au premier plan');

	clean();
});

test('un champ réellement focalisé garde le clavier (jamais de fermeture forcée)', () => {
	clean();
	state.keyboardShrunk = true;
	state.active = new FakeInput('text');

	settleNavVisibility('navigate');
	assert.equal(keyboard.open, true, 'une vraie saisie en cours n’est pas interrompue');

	clean();
});

test('un champ non éditable (bouton, case à cocher) ne compte pas comme clavier', () => {
	clean();
	state.active = new FakeInput('button');
	syncKeyboardOpen({ trustViewport: false });
	assert.equal(keyboard.open, false);

	state.active = new FakeInput('checkbox');
	syncKeyboardOpen({ trustViewport: false });
	assert.equal(keyboard.open, false);

	clean();
});

test('mesure en direct : un rétrécissement sans champ focalisé reste valable pendant une saisie', () => {
	clean();
	// Cas légitime (clavier iOS en cours, focus pas encore posé) : on ne casse
	// pas le comportement historique tant qu'un volet est ouvert.
	state.keyboardShrunk = true;
	const stop = registerSheetOwner(() => true);
	settleNavVisibility('sheet-closed');
	assert.equal(keyboard.open, true, 'un volet réellement ouvert garde son clavier');
	stop();
	clean();
});

/* ── 2. Chaque chemin de fermeture libère l'état (un seul mécanisme) ── */

test('fermeture d’un volet : barre et « + » reviennent (croix, glissement, retour iOS, scan annulé)', () => {
	clean();
	const sheet = { open: true };
	const stop = registerSheetOwner(() => sheet.open);

	state.keyboardShrunk = true;
	state.active = new FakeInput('search');
	syncKeyboardOpen();
	assert.equal(keyboard.open, true);

	// Fermeture : le volet passe à false et l'input quitte le DOM — le garde-fou
	// est appelé par le nettoyage de l'effet partagé (cf. câblage plus bas).
	sheet.open = false;
	state.active = null;
	settleNavVisibility('sheet-closed');

	assert.equal(keyboard.open, false, 'la barre du bas est réaffichée');
	assert.equal(anySheetOpen(), false, 'plus aucun volet ouvert');

	stop();
	clean();
});

test('enchaînement fiche → recherche : la réouverture immédiate n’est pas refermée', () => {
	clean();
	const fiche = { open: true };
	const recherche = { open: false };
	const stop1 = registerSheetOwner(() => fiche.open);
	const stop2 = registerSheetOwner(() => recherche.open);

	state.keyboardShrunk = true;
	state.active = new FakeInput('text');
	syncKeyboardOpen();

	fiche.open = false;
	recherche.open = true; // nouveau volet ouvert dans la même foulée
	state.active = new FakeInput('search');
	settleNavVisibility('sheet-closed');

	assert.equal(keyboard.open, true, 'la recherche qui s’enchaîne garde son clavier');

	stop1();
	stop2();
	clean();
});

/* ── 3. Verrou restant libéré (fermeture pendant un chargement, démontage) ── */

test('fermeture / démontage : tout verrou de défilement restant est libéré', () => {
	const { bodyStyle, htmlStyle } = fakeEnv();
	clean();

	lockScroll();
	lockScroll(); // verrou orphelin (volet démonté sans rendre le sien)
	assert.equal(scrollLockCount(), 2);
	assert.equal(bodyStyle.position, 'fixed');

	settleNavVisibility('unmount', { force: true });

	assert.equal(scrollLockCount(), 0, 'document redevenu défilable');
	assert.equal(bodyStyle.position, '', 'styles du body rendus tels quels');
	assert.equal(htmlStyle.overflow, '');
	assert.equal(keyboard.open, false);

	clean();
});

test('fermeture d’un volet : le verrou n’est pas libéré au milieu du fondu de sortie', () => {
	fakeEnv();
	clean();
	const sheet = { open: true };
	const stop = registerSheetOwner(() => sheet.open);

	lockScroll();
	sheet.open = false;
	settleNavVisibility('sheet-closed');

	// Le Journal restaure la position lui-même à la fin de l'animation : le
	// garde-fou ne coupe pas le fondu (aucune libération immédiate ici).
	assert.equal(scrollLockCount(), 1);

	resetScrollLock();
	stop();
	clean();
});

/* ── 4. Câblage : une seule source de vérité pour la barre ET le « + » ── */

const appShell = source('src/lib/components/AppShell.svelte');
const journal = source('src/routes/espace/journal/+page.svelte');

test('AppShell : la barre du bas lit l’état partagé, plus un booléen local', () => {
	assert.ok(appShell.includes("from '../keyboardViewport.svelte'"), 'module partagé importé');
	assert.ok(appShell.includes('startKeyboardWatch()'), 'écoute globale branchée');
	assert.ok(!/let keyboardOpen = \$state/.test(appShell), 'plus de copie locale du booléen');
	assert.ok(
		/role === 'client' && primaryLinks\.length > 0 && !keyboard\.open/.test(appShell),
		'la barre est rendue sur l’état partagé'
	);
});

test('AppShell : garde-fou à chaque navigation', () => {
	const afterNav = appShell.slice(appShell.indexOf('afterNavigate(() => {'));
	const body = afterNav.slice(0, afterNav.indexOf('});'));
	assert.ok(body.includes("settleNavVisibility('navigate')"), 'la navigation réaffiche la barre et le « + »');
});

test('Journal : le bouton « + » lit le MÊME état que la barre', () => {
	assert.ok(journal.includes("from '$lib/keyboardViewport.svelte'"), 'module partagé importé');
	assert.ok(!/let keyboardOpen = \$state/.test(journal), 'plus de booléen local (source unique)');
	assert.ok(
		/const keyboardOpen = \$derived\(keyboard\.open\)/.test(journal),
		'le clavier du Journal est un miroir en lecture seule de l’état partagé'
	);
	assert.ok(
		journal.includes('!mealPhotoOpen && !keyboardOpen'),
		'le « + » disparaît pour un volet ouvert ou un clavier réel — jamais pour un état bloqué'
	);
});

test('Journal : chaque fermeture de volet libère l’état (un seul point)', () => {
	assert.ok(journal.includes('registerSheetOwner(() => true)'), 'volet déclaré au registre partagé');
	assert.ok(
		journal.includes('desinscrire();'),
		'le volet quitte le registre partagé à sa fermeture'
	);
	assert.ok(
		journal.includes("settleNavVisibility('sheet-closed')"),
		'la fermeture — croix, glissement, retour iOS, scan annulé, chargement — libère l’état'
	);
	assert.ok(
		journal.includes("settleNavVisibility('unmount', { force: true })"),
		'le démontage libère clavier et verrou restants'
	);
	// UNE seule liste de volets : le verrou de défilement ET le registre partagé
	// partent du même calcul `locked` (aucun volet oublié d'un côté ou de l'autre).
	const effet = journal.slice(journal.indexOf('let fondFigé = false'), journal.indexOf('onDestroy('));
	const union = effet.slice(effet.indexOf('const locked ='), effet.indexOf(';', effet.indexOf('const locked =')));
	assert.ok(union, 'liste des volets présente dans l’effet de verrou');
	for (const flag of ['logOpen', '!!qtyFood', '!!editEntry', '!!editPlanned', '!!qtyMealSel', 'calOpen', 'dupOpen', 'mealCreateOpen', 'mealPhotoOpen', 'bilanOpen']) {
		assert.ok(union.includes(flag), `le volet « ${flag} » fait partie de la liste unique`);
	}
	assert.ok(effet.includes('if (!locked) return;'), 'le registre partagé suit ce même calcul');
});

test('Journal : balayage, retour arrière et démontage passent par le garde-fou', () => {
	assert.ok(journal.includes("settleNavVisibility('sheet-closed')"), 'fermeture');
	assert.ok(journal.includes('onDestroy('), 'démontage');
});
