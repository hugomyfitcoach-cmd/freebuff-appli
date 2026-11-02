/**
 * Tests MISSION SCAN-ROTATION — scanner mort après un aller-retour paysage.
 *
 * Constat (Preview #32, iPhone, PWA) : Journal > « Ajouter un aliment » >
 * Code-barres (scan ouvert en portrait) → paysage → portrait → plus rien ne
 * répond : la croix ne ferme pas le volet, aucun bouton ne réagit. En paysage,
 * le Journal passait aussi en mise en page ordinateur (barre latérale
 * « Espace client »).
 *
 * Deux ruptures vérifiées ici :
 *  1. le gabarit mobile du volet ne forçait que le PANNEAU (`.journal-sheet`)
 *     et laissait son conteneur en « voile + modal centré » desktop (`sm:`,
 *     640 px de large) : sur un téléphone couché (844 px), la couche affichée
 *     et la couche qui reçoit les touches divergeaient ;
 *  2. le shell appliquait ses utilitaires `md:` sur la SEULE largeur → la
 *     sidebar desktop apparaissait sur un téléphone en paysage.
 *
 * Invariants : la croix ferme toujours le volet (même si la caméra est en
 * train de s'arrêter), la caméra est réellement coupée et l'écran remis à
 * neuf, une rotation ne relance jamais le scan, le verrou de défilement est
 * re-basé, et un écran réellement grand (ordinateur / tablette) garde
 * exactement l'affichage ordinateur.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** DOM minimal : styles inline + scroll (même harnais que R5c-quinquies). */
function fakeDocument({ scrollY = 0, w = 390, h = 844 } = {}) {
	const bodyStyle = { position: '', top: '', left: '', right: '', width: '', overflow: '', paddingRight: '' };
	const htmlStyle = { overflow: '' };
	const calls = [];
	globalThis.document = {
		body: { style: bodyStyle },
		documentElement: { style: htmlStyle, scrollTop: scrollY, clientWidth: w },
	};
	globalThis.window = {
		scrollY,
		scrollX: 0,
		innerWidth: w,
		innerHeight: h,
		scrollTo: (x, y) => {
			calls.push([x, y]);
			globalThis.window.scrollY = y;
			globalThis.window.scrollX = x;
		},
		requestAnimationFrame: (fn) => fn(),
	};
	return { bodyStyle, htmlStyle, calls };
}

const { lockScroll, unlockScroll, resetScrollLock, rebaseScrollLock, scrollLockCount } = await import(
	'../src/lib/scrollLock.ts'
);

/* ─── 1. Rotation : le verrou ne se décale pas, le volet reste réactif ─── */

test('R1. rotation : le verrou reste actif et le document revient à zéro', () => {
	const { bodyStyle, calls } = fakeDocument({ scrollY: 640 });
	resetScrollLock();

	lockScroll();
	assert.equal(bodyStyle.top, '-640px');

	/* iOS laisse une position héritée après la bascule : la couche affichée
	   glissait par rapport à celle qui reçoit les touches. */
	globalThis.window.scrollY = 844;
	globalThis.window.scrollX = 0;
	rebaseScrollLock();

	assert.equal(scrollLockCount(), 1, 'le verrou ne se perd jamais pendant la rotation');
	assert.equal(bodyStyle.position, 'fixed');
	assert.equal(bodyStyle.top, '-640px', 'la position d’ouverture est conservée pour le déverrouillage');
	assert.ok(calls.length > 0, 'le document est ramené à zéro');
	assert.deepEqual(calls.at(-1), [0, 0]);
	assert.equal(globalThis.window.scrollY, 0);

	unlockScroll();
	assert.equal(scrollLockCount(), 0);
	resetScrollLock();
});

test('R2. re-base sans verrou : aucun effet (portrait, desktop)', () => {
	const { bodyStyle, calls } = fakeDocument();
	resetScrollLock();
	const before = JSON.stringify(bodyStyle);

	rebaseScrollLock();
	assert.equal(JSON.stringify(bodyStyle), before);
	assert.equal(calls.length, 0);
	assert.equal(scrollLockCount(), 0);
});

test('R3. 3 cycles ouverture/fermeture consécutifs : compteur et styles équilibrés', () => {
	const { bodyStyle, htmlStyle } = fakeDocument({ scrollY: 120 });
	resetScrollLock();

	for (let i = 0; i < 3; i += 1) {
		lockScroll();
		assert.equal(scrollLockCount(), 1, `cycle ${i + 1} : un seul verrou`);
		/* Rotation au milieu de chaque cycle. */
		rebaseScrollLock();
		assert.equal(scrollLockCount(), 1, `cycle ${i + 1} : verrou inchangé après rotation`);
		unlockScroll();
		assert.equal(scrollLockCount(), 0, `cycle ${i + 1} : plus aucun verrou`);
		assert.equal(bodyStyle.position, '', `cycle ${i + 1} : body rendu tel quel`);
		assert.equal(bodyStyle.top, '');
		assert.equal(htmlStyle.overflow, '', `cycle ${i + 1} : document de nouveau défilable`);
	}
	resetScrollLock();
});

/* ─── 2. Fermeture : la croix agit toujours, la caméra est coupée ─── */

const journal = source('src/routes/espace/journal/+page.svelte');
const scanner = source('src/lib/barcodeScanner.ts');

test('C1. la fermeture du volet précède l’arrêt caméra (croix jamais inerte)', () => {
	const fn = journal.slice(journal.indexOf('async function closeLog()'), journal.indexOf('function resetScanState()'));
	assert.ok(fn.length > 0, 'closeLog existe');
	assert.ok(
		fn.indexOf('logOpen = false') < fn.indexOf('await stopScanner()'),
		'le volet se referme AVANT d’attendre l’arrêt du flux'
	);
	assert.ok(/resetScanState\(\)/.test(fn), 'l’état de scan est remis à zéro à la fermeture');
});

test('C2. fermeture : caméra ET lecteur arrêtés, état de scan neuf pour la réouverture', () => {
	const fn = journal.slice(journal.indexOf('function resetScanState()'), journal.indexOf('async function loadFavorites'));
	for (const champ of ['barcodeStatus', 'barcodeError', 'barcodePermBlocked', 'barcodeManual', 'scannerCaps', 'torchOn']) {
		assert.match(fn, new RegExp(`${champ} =`), `${champ} réinitialisé`);
	}
	assert.match(fn, /exitBcManual\(\);/, 'le mode saisie manuelle est abandonné');

	const stop = journal.slice(journal.indexOf('async function stopScanner()'), journal.indexOf('/**\n\t * REPRISE DU LECTEUR'));
	assert.match(stop, /await scanner\.stop\(\)/, 'le flux caméra est arrêté');
	assert.match(stop, /scanner = null/, 'le handle est libéré');
});

test('C3. un flux obtenu APRÈS la fermeture est coupé immédiatement (pas de caméra orpheline)', () => {
	const fn = journal.slice(journal.indexOf('async function startScanner('), journal.indexOf('/** Ouvrir un formulaire'));
	const iGuard = fn.indexOf('!el.isConnected');
	const iStop = fn.indexOf('await handle.stop()');
	const iAssign = fn.indexOf('scanner = handle');
	assert.ok(iGuard > 0 && iStop > iGuard, 'garde de fermeture avant toute affectation');
	assert.ok(iAssign > iStop, 'le handle n’est retenu que si l’écran est toujours là');
	assert.match(fn, /elId === 'bc-reader' && !logOpen/, 'volet refermé → flux refusé');
});

test('C4. arrêt réel du média : lecture en pause, flux détaché, conteneur vidé', () => {
	const stop = scanner.slice(scanner.indexOf('stop: async () =>'), scanner.indexOf('resolution: () => ({ ...trackResolution })'));
	const iTracks = stop.indexOf('t.stop()');
	const iPause = stop.indexOf('video.pause()');
	const iDetach = stop.indexOf('video.srcObject = null');
	const iClear = stop.indexOf('container.replaceChildren()');
	assert.ok(iTracks > 0 && iPause > iTracks, 'les pistes sont coupées puis la lecture arrêtée');
	assert.ok(iDetach > iPause, 'le flux est détaché après la mise en pause');
	assert.ok(iClear > iDetach, 'le lecteur est vidé en dernier');
	assert.match(stop, /stream = null/, 'aucune référence au flux conservée');
	assert.match(stop, /if \(stopped\) return/, 'arrêt idempotent (3 cycles sans fuite)');
});

/* ─── 3. Rotation : ni coupure ni relance de la caméra ─── */

test('R4. une rotation ne coupe et ne relance jamais le scan', () => {
	const i = journal.indexOf('const onOrientation = () => {');
	const fn = journal.slice(i, journal.indexOf("window.addEventListener('resize', setVh)"));
	assert.ok(fn.length > 0, 'gestionnaire de rotation présent');
	assert.match(fn, /rebaseScrollLock\(\)/, 'le verrou de défilement est re-basé');
	assert.match(fn, /onMq\(\)/, 'le gabarit du volet est réévalué');
	assert.match(fn, /relayout\(\)/, 'les dimensions sont remesurées');
	assert.ok(!/startScanner|stopScanner/.test(fn), 'aucun redémarrage/arrêt caméra sur rotation');
});

/* ─── 4. Paysage téléphone = affichage mobile ─── */

test('L1. le volet force AUSSI son conteneur (plus de voile desktop sur téléphone couché)', () => {
	const iMedia = journal.indexOf('@media (orientation: landscape) and (max-height: 520px)');
	assert.ok(iMedia > 0, 'règle paysage conservée (acquis ROTATION)');
	const block = journal.slice(iMedia, journal.indexOf('</style>', iMedia));
	assert.match(block, /\.journal-sheet-backdrop\s*\{[^}]*display: block !important/, 'conteneur remis en plein écran');
	assert.match(block, /\.journal-sheet-backdrop\s*\{[^}]*padding: 0 !important/, 'aucun centrage desktop');
	assert.match(block, /\.bc-stage\s*\{[^}]*flex: 1 1 auto/, 'la caméra remplit la hauteur libre');
	assert.match(block, /\.bc-stage\s*\{[^}]*aspect-ratio: auto !important/, 'plus de cadre portrait qui déborde');
	assert.equal((journal.match(/class="[^"]*journal-sheet-backdrop"/g) ?? []).length, 2, 'les 2 volets portent la classe');
	assert.equal((journal.match(/bc-stage relative/g) ?? []).length, 2, 'les 2 lecteurs portent la classe');
});

test('L2. shell : un écran court et tactile garde l’affichage mobile', () => {
	const shell = source('src/lib/components/AppShell.svelte');
	const iStyle = shell.indexOf('<style>');
	assert.ok(iStyle > 0, 'bloc de règles du shell');
	const css = shell.slice(iStyle);

	assert.match(css, /@media \(max-height: 540px\) and \(pointer: coarse\)/, 'condition = écran court + pointeur tactile');
	assert.ok(!/min-width/.test(css), 'aucune largeur seule ne peut rebasculer un téléphone en desktop');
	assert.match(css, /\.gflux-shell-sidebar\s*\{[^}]*display: none !important/, 'sidebar masquée');
	assert.match(css, /\.gflux-shell-main\s*\{[^}]*padding-left: 0 !important/, 'plus de gouttière desktop');
	assert.match(css, /\.gflux-shell-mobile-header\s*\{[^}]*display: block !important/, 'header mobile restauré');
	assert.match(css, /\.gflux-shell-mobile-nav\s*\{[^}]*display: flex !important/, 'barre du bas restaurée');

	const markup = shell.slice(0, iStyle);
	for (const classe of ['gflux-shell-sidebar', 'gflux-shell-main', 'gflux-shell-mobile-header', 'gflux-shell-mobile-nav']) {
		assert.ok(markup.includes(classe), `${classe} appliquée au balisage`);
	}
});

test('L3. ordinateur et tablette : affichage desktop inchangé', () => {
	const shell = source('src/lib/components/AppShell.svelte');
	/* Les utilitaires desktop d'origine restent la référence (aucun remplacement
	   global) : la sidebar n'est conditionnée que par la règle « écran court
	   tactile » ajoutée, qui ne peut pas matcher un pointeur fin ni une grande
	   hauteur. */
	assert.match(shell, /class="gflux-shell-sidebar fixed inset-y-0 left-0 z-50 hidden w-64 flex-col border-r border-line md:flex/);
	assert.match(shell, /gflux-shell-main flex min-w-0 flex-1 flex-col md:pl-64/);
	assert.match(shell, /gflux-shell-mobile-header sticky top-0 z-40 border-b border-line backdrop-blur md:hidden/);

	/* Le volet desktop garde son gabarit sm: en grand écran. */
	assert.match(journal, /class="fixed inset-0 z-50 bg-soft sm:flex sm:items-center sm:justify-center sm:bg-ink\/40 sm:p-6 journal-sheet-backdrop"/);
	assert.match(journal, /absolute inset-x-0 top-0 flex h-full w-full flex-col overflow-hidden bg-soft sm:relative/);
});

test('L4. aucun élément invisible ne capte les touches sur l’écran de scan', () => {
	/* Le calque de repères (voile, cadre, coins, pastille) est transparent aux
	   gestes : la croix et la barre inférieure restent cliquables. */
	assert.match(scanner, /pointerEvents: 'none',/);
	assert.match(scanner, /container\.append\(video, guide\)/);
	/* La barre inférieure du volet est hors flux et ne capte que ses boutons. */
	assert.match(
		journal,
		/pointer-events-none absolute inset-x-0 bottom-\[calc\(0\.5rem\+env\(safe-area-inset-bottom\)\)\] z-10 flex justify-center px-5/
	);
	assert.equal((journal.match(/pointer-events-auto flex h-\[50px\]/g) ?? []).length, 2, 'capsules cliquables uniquement');
});

test('M1. manifest PWA : orientation portrait (Android installé)', () => {
	const manifest = JSON.parse(source('static/manifest.webmanifest'));
	assert.equal(manifest.orientation, 'portrait');
	assert.equal(manifest.display, 'standalone');
});

