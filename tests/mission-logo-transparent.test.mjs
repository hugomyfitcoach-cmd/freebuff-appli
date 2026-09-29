/**
 * Mission : logo PWA à fond transparent (plus de rectangle visible).
 *
 * Cause : `static/logo-header.jpg` (JPEG = pas de couche alpha, fond intégré)
 * créait un rectangle visible derrière le logo sur le fond de l'app.
 * Correctif : `static/logo-header.png` (PNG transparent, même ratio 1.5 que
 * l'ancien) → zéro changement de layout : mêmes classes d'affichage
 * (`h-9 w-auto` desktop, `w-[76px]` mobile), mêmes positions, mêmes marges.
 * Les variantes distinctes (logo.png avatar bilan, logo-guide, logo-outils,
 * icônes PWA du manifest) ne sont PAS touchées.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// PNG signé + présence du canal alpha (IHDR color type 6 = RGBA, 4 = RGB+alpha).
const png = readFileSync(join(root, 'static/logo-header.png'));
test('static/logo-header.png existe et est un PNG avec alpha', () => {
	assert.ok(png.length > 0, 'fichier présent');
	assert.deepEqual([...png.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'signature PNG');
	const colorType = png[25];
	assert.ok(colorType === 6 || colorType === 4, `couche alpha présente (IHDR color type ${colorType})`);
});

test('Ratio identique à l’ancien logo-header (1536×1024 = 1.5) : aucun changement de layout', () => {
	const w = png.readUInt32BE(16);
	const h = png.readUInt32BE(20);
	assert.ok(Math.abs(w / h - 1.5) < 0.01, `ratio ${w}/${h} ≈ 1.5`);
});

test('L’ancien JPEG opaque est supprimé (plus aucune source de rectangle)', () => {
	assert.ok(!existsSync(join(root, 'static/logo-header.jpg')), 'logo-header.jpg retiré');
});

test('Toutes les références pointent vers le PNG transparent, classes d’affichage intactes', () => {
	const files = [
		'src/lib/components/AppShell.svelte',
		'src/routes/connexion/+page.svelte',
		'src/routes/bilan/+page.svelte',
		'src/routes/onboarding/install/+page.svelte',
	];
	for (const f of files) {
		const src = read(f);
		assert.ok(!src.includes('logo-header.jpg'), `${f} : plus de référence au JPG`);
		assert.ok(src.includes('/logo-header.png'), `${f} : référence au PNG`);
	}
	const appshell = read('src/lib/components/AppShell.svelte');
	assert.ok(appshell.includes('class="h-9 w-auto"'), 'desktop : même hauteur (h-9 w-auto)');
	assert.ok(appshell.includes('w-[76px]'), 'mobile : même largeur (w-[76px])');
});

test('Variantes distinctes intactes (avatar bilan, guide recettes, outils, icônes PWA)', () => {
	assert.ok(existsSync(join(root, 'static/logo.png')), 'logo.png (avatar rond bilan) conservé');
	assert.ok(existsSync(join(root, 'static/logo-guide.png')), 'logo-guide.png conservé');
	assert.ok(existsSync(join(root, 'static/logo-outils.png')), 'logo-outils.png conservé');
	assert.ok(read('src/routes/bilan/+page.svelte').includes('src="/logo.png"'), 'bilan : avatar inchangé');
	assert.ok(!read('src/routes/recettes/guide.css').includes('logo-header'), 'guide recettes : aucun logo-header');
});

test('Aucune autre occurrence orpheline de logo-header.jpg dans le projet', () => {
	const files = [
		'src/app.html',
		'static/manifest.webmanifest',
		'README.md',
		'vite.config.ts',
		'netlify.toml',
	];
	for (const f of files) {
		const src = read(f);
		assert.ok(!src.includes('logo-header.jpg'), `${f} : aucune référence à l’ancien JPG`);
	}
});
