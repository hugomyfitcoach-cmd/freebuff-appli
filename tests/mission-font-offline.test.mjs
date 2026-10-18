/**
 * Mission POLICE HORS LIGNE — Lato retombe sur la police système en mode avion.
 *
 * Cause : Lato était chargée depuis Google Fonts (fonts.googleapis.com /
 * fonts.gstatic.com) — sans réseau, la CSS distante échoue et toute l'app
 * s'affiche en police système.
 *
 * Correction verrouillée ici :
 * 1. les woff2 Lato 400/700/900 (latin + latin-ext) sont hébergés dans
 *    l'app (static/fonts/, v25, licence SIL OFL) ;
 * 2. les @font-face locaux (src/routes/layout.css) remplacent la CSS Google —
 *    rendu identique en ligne, Lato disponible hors ligne ;
 * 3. les polices sont dans le précache du service worker ;
 * 4. la page d'erreur servie par le SW hors ligne garde aussi Lato.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const appHtml = read('src/app.html');
const layoutCss = read('src/routes/layout.css');
const sw = read('src/service-worker.ts');

const FONT_FILES = [
	'static/fonts/lato-400-latin.woff2',
	'static/fonts/lato-400-latin-ext.woff2',
	'static/fonts/lato-700-latin.woff2',
	'static/fonts/lato-700-latin-ext.woff2',
	'static/fonts/lato-900-latin.woff2',
	'static/fonts/lato-900-latin-ext.woff2'
];

test('Les 6 woff2 Lato (400/700/900 × latin/latin-ext) sont hébergés dans l\u2019app', () => {
	for (const f of FONT_FILES) {
		assert.ok(existsSync(join(root, f)), `${f} présent dans static/fonts/`);
		const buf = readFileSync(join(root, f));
		assert.ok(buf.length > 1000, `${f} : fichier woff2 non vide`);
		assert.equal(buf.subarray(0, 4).toString('latin1'), 'wOF2', `${f} : en-tête woff2 valide`);
	}
});

test('Licence SIL OFL livrée avec les polices (Lato est sous OFL)', () => {
	assert.ok(existsSync(join(root, 'static/fonts/OFL.txt')), 'static/fonts/OFL.txt présent');
	assert.match(read('static/fonts/OFL.txt'), /SIL Open Font License/);
});

test('Les @font-face locaux déclarent Lato 400, 700 et 900 en woff2', () => {
	for (const w of [400, 700, 900]) {
		const block = new RegExp(
			`@font-face\\s*\\{[^}]*font-weight:\\s*${w};[^}]*src:\\s*url\\('/fonts/lato-${w}-(latin|latin-ext)\\.woff2'\\)[^}]*\\}`
		);
		assert.match(layoutCss, block, `@font-face Lato ${w} local`);
	}
	assert.match(layoutCss, /font-display:\s*swap/, 'comportement de chargement identique (swap)');
	assert.match(layoutCss, /unicode-range:/, 'sous-ensembles latin + latin-ext conservés (parité visuelle)');
});

test('Plus aucune dépendance aux polices Google Fonts (hors ligne garanti)', () => {
	// Aucune balise <link> (CSS Google / preconnect) et aucune url() distante :
	// les seules occurrences tolérées sont les commentaires de documentation.
	assert.ok(!/<link[^>]+fonts\.(googleapis|gstatic)\.com/.test(appHtml), 'app.html : plus de <link> Google Fonts');
	assert.ok(!/url\([^)]*fonts\.(googleapis|gstatic)\.com/.test(layoutCss), 'layout.css : url() uniquement locales');
	assert.ok(!/url\([^)]*fonts\.(googleapis|gstatic)\.com/.test(sw), 'service worker : aucune police distante');
	assert.ok(!/src:\s*url\((?!['"]\/fonts\/)/.test(layoutCss), 'toutes les src @font-face pointent vers /fonts/ local');
});

test('Les polices sont dans le précache du service worker', () => {
	assert.match(sw, /const FONTS = \[/, 'liste explicite des polices');
	for (const f of FONT_FILES) {
		assert.ok(sw.includes(`'${f.replace('static', '')}'`), `précache : ${f.replace('static', '')}`);
	}
	assert.match(sw, /\.\.\.FONTS\.filter\(\(f\) => !files\.includes\(f\)\)\]/, 'FONTS inclus dans ASSETS');
	assert.match(sw, /c\.addAll\(ASSETS\)/, 'install précache ASSETS (polices comprises)');
});

test('La page d\u2019erreur du SW garde Lato hors ligne (via le précache)', () => {
	const style = sw.slice(sw.indexOf('<style>'), sw.indexOf('</style>'));
	assert.match(style, /@font-face \{[^}]*font-weight: 400;[^}]*url\('\/fonts\/lato-400-latin\.woff2'\)[^}]*\}/);
	assert.match(style, /@font-face \{[^}]*font-weight: 700;[^}]*url\('\/fonts\/lato-700-latin\.woff2'\)[^}]*\}/);
	assert.match(style, /@font-face \{[^}]*font-weight: 900;[^}]*url\('\/fonts\/lato-900-latin\.woff2'\)[^}]*\}/);
});
