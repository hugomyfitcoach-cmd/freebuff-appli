import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const appHtml = read('src/app.html');
const appShell = read('src/lib/components/AppShell.svelte');
const layoutCss = read('src/routes/layout.css');
test('Accueil iOS : la safe area reprend le fond blanc du document uniquement sur cette route', () => {
	assert.match(appShell, /role === 'client' && path === '\/espace' \? 'gflux-app-client-home' : ''/);
	assert.match(layoutCss, /html:has\(\.gflux-app-client-home\),\s*body:has\(\.gflux-app-client-home\)\s*\{\s*background:\s*#ffffff;/);
	assert.match(layoutCss, /\.gflux-home-header\s*\{\s*padding-top:\s*max\(env\(safe-area-inset-top, 0px\), 0px\)/);
	assert.match(layoutCss, /html,\s*body\s*\{\s*background:\s*var\(--bg\);/);
});

test('Overscroll iOS : le fond racine est blanc sur toutes les routes cliente, pas seulement l’accueil', () => {
	assert.match(appShell, /role === 'client' \? 'gflux-app-client' : ''/);
	assert.match(layoutCss, /html:has\(\.gflux-app-client\),\s*body:has\(\.gflux-app-client\)\s*\{\s*background:\s*#ffffff;/);
});

test('La couleur système blanche est limitée à l’accueil cliente; le thème coach et les autres routes restent verts', () => {
	assert.match(appShell, /role === 'client' && path === '\/espace' \? '#FFFFFF' : '#1DB954'/);
});
