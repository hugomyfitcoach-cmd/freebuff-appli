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
 * neuf, une rotation reconstruit le scan, le verrou de défilement est
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
		fn.indexOf('logOpen = false') < fn.indexOf('void stopScanner()'),
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
	assert.match(stop, /session\.controller\?\.abort\(\)/, 'le flux caméra est arrêté immédiatement');
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
	const stop = scanner.slice(scanner.indexOf('const releaseStream = () => {'), scanner.indexOf('const checkStopped = () =>'));
	const iTracks = stop.indexOf('t.stop()');
	const iPause = stop.indexOf('video.pause()');
	const iDetach = stop.indexOf('video.srcObject = null');
	const iClear = stop.indexOf('video.remove()');
	assert.ok(iTracks > 0 && iPause > iTracks, 'les pistes sont coupées puis la lecture arrêtée');
	assert.ok(iDetach > iPause, 'le flux est détaché après la mise en pause');
	assert.ok(iClear > iDetach, 'le lecteur est vidé en dernier');
	assert.match(stop, /stream = null/, 'aucune référence au flux conservée');
	assert.match(stop, /if \(stopped\) return/, 'arrêt idempotent (3 cycles sans fuite)');
});

/* ─── 3. Rotation : relance de la caméra et conservation du layout ─── */

test('R4. la rotation reconstruit le scan et maintient le layout', () => {
	const i = journal.indexOf('const onOrientation = () => {');
	const fn = journal.slice(i, journal.indexOf("window.addEventListener('resize', setVh)"));
	assert.ok(fn.length > 0, 'gestionnaire de rotation présent');
	assert.match(fn, /rebaseScrollLock\(\)/, 'le verrou de défilement est re-basé');
	assert.match(fn, /onMq\(\)/, 'le gabarit du volet est réévalué');
	assert.match(fn, /relayout\(\)/, 'les dimensions sont remesurées');
	assert.match(journal, /const onScannerOrientation = \(\) => restart\(\)/, 'rotation → reconstruction du scanner');
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
	for (const control of ['media-controls', 'media-controls-enclosure', 'media-controls-panel', 'media-controls-play-button', 'media-controls-overlay-play-button', 'media-controls-start-playback-button']) {
		assert.ok(journal.includes(`.scanner-camera-video::-webkit-${control}`), `${control} masqué sur la vidéo du scanner`);
	}
	/* La barre inférieure du volet est hors flux et ne capte que ses boutons. */
	assert.match(
		journal,
		/pointer-events-none absolute inset-x-0 bottom-\[calc\(0\.5rem\+env\(safe-area-inset-bottom\)\)\] z-10 flex justify-center px-5/
	);
	assert.equal((journal.match(/pointer-events-auto flex h-\[50px\]/g) ?? []).length, 2, 'capsules cliquables uniquement');
});

test('B1. croix et saisie ne dépendent pas des reconstructions ou du geste de reprise', () => {
	const stage = journal.slice(journal.indexOf('<div id="bc-reader"'), journal.indexOf('<!-- Capsule flottante Recherche', journal.indexOf('<div id="bc-reader"')));
	const close = stage.match(/<button[^\n]*aria-label="Fermer"[^\n]*<\/button>/)?.[0];
	assert.ok(close);
	assert.doesNotMatch(close, /disabled|inert|pointer-events-none/);
	assert.match(close, /onclick=\{\(\) => closeLog\(\)\}/);
	const input = stage.match(/<input[\s\S]*?placeholder="Ou saisis le code[\s\S]*?\/>/)?.[0];
	assert.ok(input);
	assert.doesNotMatch(input, /disabled|inert|pointer-events-none/);
	assert.match(stage, /disabled=\{barcodeBusy\} onclick=\{\(\) => submitManual\(\)\}/);
	assert.match(stage, /scannerNeedsGesture === 'bc-reader'[\s\S]*?onclick=\{resumeScannerFromGesture\}>Toucher pour relancer la caméra/);
	assert.doesNotMatch(journal, /scannerBusy/);
});

test('M1. manifest PWA : orientation portrait (Android installé)', () => {
	const manifest = JSON.parse(source('static/manifest.webmanifest'));
	assert.equal(manifest.orientation, 'portrait');
	assert.equal(manifest.display, 'standalone');
});


/* Exécution du vrai cycle de vie journal + moteur avec caméra et DOM simulés. */
test('SCAN-ROTATION-3. rotation, reprise, piste interrompue et fermeture libèrent les flux', async () => {
	const ts = await import('typescript');
	globalThis.__SCANNER_EXPERIMENT__ = false;
	const { startBarcodeScanner, CameraPermissionError, scannerResourceProbe } = await import('../src/lib/barcodeScanner.ts');
	let playFailures = 0;
	class Element extends EventTarget {
		constructor(tag = 'div') {
			super(); this.tag = tag; this.children = []; this.parent = null; this.isConnected = true;
			this.attributes = new Map(); this.playCalls = 0;
			this.style = { setProperty(name, value) { this[name] = value; } };
			this.paused = true; this.readyState = 0; this.videoWidth = 0; this.videoHeight = 0;
		}
		append(...els) { for (const el of els) { el.parent = this; this.children.push(el); } }
		replaceChildren(...els) { for (const el of this.children) el.parent = null; this.children = []; this.append(...els); }
		remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } }
		setAttribute(name, value) { this.attributes.set(name, value); }
		removeAttribute(name) { this.attributes.delete(name); }
		pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
		play() {
			this.playCalls++;
			if (playFailures > 0) { playFailures--; return Promise.reject(new Error('play refusé')); }
			this.paused = false; return Promise.resolve();
		}
		getContext() { return {}; }
	}
	class Track extends EventTarget {
		constructor() { super(); this.readyState = 'live'; this.muted = false; this.stopCount = 0; }
		stop() { this.stopCount++; this.readyState = 'ended'; }
		getSettings() { return { width: 1920, height: 1080 }; }
		getCapabilities() { return {}; }
		async applyConstraints() {}
	}
	const originalDocument = globalThis.document;
	const originalWindow = globalThis.window;
	const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	const reader = new Element(); reader.id = 'bc-reader';
	const doc = new EventTarget();
	doc.hidden = false; doc.createElement = (tag) => new Element(tag); doc.getElementById = (id) => id === reader.id ? reader : null;
	const win = new EventTarget(); win.innerWidth = 390; win.location = { search: '' };
	win.BarcodeDetector = class { async detect() { return []; } };
	const tracks = [];
	let pending;
	const media = { getUserMedia: async () => {
		if (pending) return await pending;
		const track = new Track(); tracks.push(track);
		return { getTracks: () => [track], getVideoTracks: () => [track] };
	} };
	globalThis.document = doc; globalThis.window = win;
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: media } });
	const start = journal.indexOf('\tasync function startScanner(');
	const end = journal.indexOf('\t/** Ouvrir un formulaire', start);
	const stopStart = journal.indexOf('\tasync function stopScanner()');
	const stopEnd = journal.indexOf('\t/**\n\t * REPRISE DU LECTEUR', stopStart);
	const harness = `let scanner = null, scannerSession = null, scannerNeedsGesture = null, barcodeStatus = 'idle', barcodePermBlocked = false, barcodeError = '', bcError = '', scannerCaps = null, torchOn = false, zoomLevel = 1, bcManualMode = false, logOpen = true, barcodeBusy = false;
	function handleScan() {} function exitBcManual() { bcManualMode = false; }
	${journal.slice(start, end)} ${journal.slice(stopStart, stopEnd)}
	return { startScanner, stopScanner, resumeScannerFromGesture, state: () => ({ scannerSession, scannerNeedsGesture, barcodeStatus, barcodeBusy, logOpen }) };`;
	const javascript = ts.transpileModule(harness, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
	const app = new Function('startBarcodeScanner', 'CameraPermissionError', javascript)(startBarcodeScanner, CameraPermissionError);
	const settle = () => new Promise((resolve) => setTimeout(resolve, 320));
	try {
		await app.startScanner();
		assert.equal(reader.children.length, 2);
		const [video, guide] = reader.children;
		assert.equal(video.controls, false); assert.equal(video.playsInline, true); assert.equal(video.muted, true);
		assert.equal(video.autoplay, true); assert.equal(video.disablePictureInPicture, true);
		for (const attr of ['playsinline', 'muted', 'autoplay', 'disablepictureinpicture']) assert.ok(video.attributes.has(attr));
		assert.equal(video.attributes.has('controls'), false);
		assert.equal(video.style.pointerEvents, 'none');
		const previousPlayCalls = video.playCalls;
		video.pause();
		await Promise.resolve();
		assert.equal(video.playCalls, previousPlayCalls + 1, 'pause → nouvelle tentative play');
		assert.equal(video.paused, false);
		assert.equal(video.style.objectFit, 'cover'); assert.equal(video.style.width, '100%'); assert.equal(video.style.height, '100%');
		assert.equal(guide.style.pointerEvents, 'none');
		assert.equal(guide.children.length, 6, 'quatre voiles, un cadre et une pastille');
		win.innerWidth = 844; win.dispatchEvent(new Event('resize')); win.dispatchEvent(new Event('orientationchange'));
		assert.equal(tracks[0].stopCount, 1);
		await settle();
		assert.equal(tracks.length, 2); assert.equal(reader.children.length, 2); assert.notEqual(reader.children[1], guide);
		doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
		doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange')); win.dispatchEvent(new Event('pageshow'));
		assert.equal(tracks[1].stopCount, 1); await settle();
		assert.equal(tracks.length, 3); assert.equal(reader.children.length, 2);
		reader.children[0].readyState = 2; reader.children[0].videoWidth = 1920; reader.children[0].videoHeight = 1080;
		reader.children[0].dispatchEvent(new Event('loadeddata'));
		tracks[2].dispatchEvent(new Event('mute')); await settle();
		assert.equal(tracks[2].stopCount, 1); assert.equal(tracks.length, 4); assert.equal(reader.children.length, 2);
		reader.children[0].readyState = 2; reader.children[0].videoWidth = 1920; reader.children[0].videoHeight = 1080;
		reader.children[0].dispatchEvent(new Event('loadeddata'));
		tracks[3].dispatchEvent(new Event('ended')); await settle();
		assert.equal(tracks[3].stopCount, 1); assert.equal(tracks.length, 5);
		win.dispatchEvent(new Event('orientationchange'));
		await app.stopScanner(); await settle();
		assert.equal(reader.children.length, 0); assert.ok(tracks.every((track) => track.stopCount === 1));
		assert.equal(scannerResourceProbe().cameraStreamsOpen, 0);
		let resolvePending;
		pending = new Promise((resolve) => { resolvePending = resolve; });
		const opening = app.startScanner();
		await app.stopScanner();
		const late = new Track(); tracks.push(late);
		resolvePending({ getTracks: () => [late], getVideoTracks: () => [late] });
		await opening;
		assert.equal(late.stopCount, 1, 'flux obtenu après fermeture arrêté');
		assert.equal(reader.children.length, 0); assert.equal(scannerResourceProbe().cameraStreamsOpen, 0);

		pending = undefined;
		playFailures = 2;
		await app.startScanner();
		const refusedTrack = tracks.at(-1);
		assert.equal(refusedTrack.stopCount, 1, 'double refus initial → flux arrêté');
		await settle();
		assert.equal(reader.children.length, 2, 'double refus initial → scanner reconstruit');
		assert.notEqual(tracks.at(-1), refusedTrack);
		const resumedVideo = reader.children[0];
		playFailures = 1;
		resumedVideo.pause();
		await Promise.resolve(); await Promise.resolve();
		const pausedTrack = tracks.at(-1);
		assert.equal(pausedTrack.stopCount, 1, 'reprise refusée → flux arrêté');
		await settle();
		assert.notEqual(tracks.at(-1), pausedTrack, 'reprise refusée → scanner reconstruit');
		assert.equal(reader.children.length, 2);
		const lastVideo = reader.children[0];
		const callsBeforeClose = lastVideo.playCalls;
		await app.stopScanner();
		assert.equal(lastVideo.playCalls, callsBeforeClose, 'la fermeture ne relance pas la lecture');
		assert.equal(scannerResourceProbe().cameraStreamsOpen, 0);

		// Refus successifs : une ouverture + au plus deux reconstructions.
		playFailures = 20;
		const beforeFailures = tracks.length;
		await app.startScanner();
		await settle(); await settle(); await settle();
		assert.equal(tracks.length - beforeFailures, 3);
		assert.equal(app.state().scannerNeedsGesture, 'bc-reader');
		assert.equal(app.state().scannerSession.waitingForGesture, true);
		assert.equal(app.state().barcodeBusy, false, 'la saisie reste disponible');
		assert.equal(reader.children.length, 0);
		assert.equal(scannerResourceProbe().cameraStreamsOpen, 0);
		win.dispatchEvent(new Event('orientationchange')); win.dispatchEvent(new Event('pageshow'));
		await settle(); assert.equal(tracks.length - beforeFailures, 3, 'aucune reprise sans geste');
		playFailures = 0;
		app.resumeScannerFromGesture(); await settle();
		assert.equal(app.state().scannerNeedsGesture, null);
		assert.equal(reader.children.length, 2);
		// Une image reçue, même en mode manuel, remet le compteur à zéro.
		const image = reader.children[0];
		image.readyState = 2; image.videoWidth = 1920; image.videoHeight = 1080;
		image.dispatchEvent(new Event('loadeddata'));
		assert.equal(app.state().scannerSession.automaticRestarts, 0);
		await app.stopScanner();
		assert.equal(app.state().scannerNeedsGesture, null);

		// Une piste muette répétée sans image ne doit pas non plus boucler.
		await app.startScanner();
		for (let i = 0; i < 3; i++) {
			tracks.at(-1).dispatchEvent(new Event('mute'));
			if (i < 2) await settle();
		}
		assert.equal(app.state().scannerNeedsGesture, 'bc-reader');
		assert.equal(scannerResourceProbe().cameraStreamsOpen, 0);
		await app.stopScanner();

		// Deux relances pendant une permission en attente : seule la génération
		// courante peut s'installer, les anciens flux tardifs sont coupés.
		let resolveFirst, resolveSecond;
		pending = new Promise((resolve) => { resolveFirst = resolve; });
		const initial = app.startScanner();
		pending = new Promise((resolve) => { resolveSecond = resolve; });
		win.dispatchEvent(new Event('orientationchange')); await settle();
		pending = undefined;
		win.dispatchEvent(new Event('orientationchange')); await settle();
		assert.equal(app.state().scannerNeedsGesture, null);
		assert.equal(app.state().barcodeBusy, false);
		assert.equal(reader.children.length, 2);
		const activeTrack = tracks.at(-1);
		for (const resolve of [resolveFirst, resolveSecond]) {
			const stale = new Track(); tracks.push(stale);
			resolve({ getTracks: () => [stale], getVideoTracks: () => [stale] });
		}
		await initial; await Promise.resolve(); await Promise.resolve();
		assert.equal(tracks.at(-1).stopCount, 1);
		assert.equal(tracks.at(-2).stopCount, 1);
		assert.equal(activeTrack.stopCount, 0);
		assert.equal(reader.children.length, 2);
		await app.stopScanner();

		// Une ouverture échouée ne garde pas de session de reconstruction.
		pending = Promise.reject(new DOMException('refus', 'NotAllowedError'));
		await app.startScanner();
		assert.equal(app.state().scannerSession, null);
		assert.equal(app.state().scannerNeedsGesture, null);
		assert.equal(app.state().barcodeBusy, false);
		assert.equal(app.state().barcodeStatus, 'perm');
	} finally {
		await app.stopScanner();
		globalThis.document = originalDocument; globalThis.window = originalWindow;
		if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
		else delete globalThis.navigator;
	}
});
