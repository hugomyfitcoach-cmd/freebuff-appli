/**
 * Tests MISSION 4 — correctifs cropper avatar post-test iPhone :
 *  1. Modal réellement fixe + centrée (plus coincée en haut sous le header) ;
 *  2. Pan tactile 4 directions opérationnel (bornes anti-zone-vide, iOS).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const crop = readFileSync(join(root, 'src/lib/components/AvatarCrop.svelte'), 'utf8');
const shell = readFileSync(join(root, 'src/lib/components/AppShell.svelte'), 'utf8');

/* ─── 1) Modal fixe, centrée, boutons visibles ─── */

test('Cropper : modal position:fixed indépendante du header (backdrop-blur = piège à containing block)', () => {
	assert.ok(crop.includes('fixed inset-0'), 'la modal est fixed inset-0');
	// Montée HORS du <header backdrop-blur> : un backdrop-filter fait du
	// header le containing block des fixed descendants (bug « modal en haut »).
	const headerStart = shell.indexOf('<header');
	const headerEnd = shell.indexOf('</header>');
	const mount = shell.indexOf('<AvatarCrop');
	assert.ok(mount > 0, 'AvatarCrop est monté dans AppShell');
	assert.ok(
		headerStart === -1 || headerEnd === -1 || mount < headerStart || mount > headerEnd,
		'le montage <AvatarCrop> est hors du <header> (backdrop-filter)'
	);
});

test('Cropper : carte centrée, safe-area iOS, boutons toujours visibles (hors scroll)', () => {
	// La carte remplit la modal (items-center + max-h-full) : jamais coupée en haut.
	assert.ok(/items-center justify-center/.test(crop), 'centrage vertical + horizontal fiable');
	assert.ok(crop.includes('max-h-full'), 'carte limitée à la hauteur de la modal');
	// Safe-area iPhone : encoche (top) + barre home (bottom).
	assert.ok(crop.includes('safe-area-inset-top'), 'padding safe-area haut');
	assert.ok(crop.includes('safe-area-inset-bottom'), 'padding safe-area bas');
	// La barre d'actions est shrink-0 (jamais poussée hors écran par le scroll).
	const actions = crop.indexOf('flex shrink-0 w-full gap-3');
	const scrollZone = crop.indexOf('overflow-y-auto');
	assert.ok(actions > 0 && scrollZone > 0 && actions > scrollZone, 'actions après la zone scrollable');
	assert.ok(crop.includes('shrink-0'), 'en-tête et actions shrink-0');
	// Scroll de la page derrière verrouillé tant que la modal est ouverte.
	assert.ok(crop.includes("document.body.style.overflow = 'hidden'"), 'scroll lock du body');
	// Fermeture facile : × aria-label + Annuler + Escape.
	assert.ok(crop.includes('aria-label="Fermer"'), 'bouton × présent');
	assert.ok(crop.includes('>Annuler</button>'), 'bouton Annuler présent');
	assert.ok(/Escape/.test(crop), 'touche Échap ferme la modal');
});

/* ─── 2) Pan tactile 4 directions + bornes anti-zone-vide ─── */

test('Cropper : bornes du pan NON inversées (jamais de zone vide, pan réel)', () => {
	// L'ancien clamp (min(VIEW/2, halfW)) verrouillait le centre : pan mort.
	assert.ok(!/Math\.min\(VIEW \/ 2, halfW\)/.test(crop), 'ancienne borne inversée supprimée');
	assert.ok(!/Math\.max\(VIEW \/ 2, VIEW - halfW\)/.test(crop), 'ancienne borne inversée (Y) supprimée');
	// La bonne logique : image plus petite que le carré ⇒ centrée ; sinon
	// bords pincés : cx ∈ [VIEW − halfW, halfW] (bord gauche ≤ 0 ≤ bord droit).
	assert.ok(crop.includes('clampPos'), 'clampPos présent');
	assert.ok(
		/else cx = Math\.min\(halfW, Math\.max\(VIEW - halfW, cx\)\)/.test(crop),
		'borne X correcte : cx ∈ [VIEW − halfW, halfW]'
	);
	assert.ok(
		/else cy = Math\.min\(halfH, Math\.max\(VIEW - halfH, cy\)\)/.test(crop),
		'borne Y correcte : cy ∈ [VIEW − halfH, halfH]'
	);
	// Clamp appelé à chaque frame de drag ET après chaque changement de zoom.
	assert.ok(/onTouchMove[\s\S]{0,600}clampPos\(\)/.test(crop), 'clamp appliqué pendant le drag tactile');
	assert.ok(/onZoomInput[\s\S]{0,200}clampPos\(\)/.test(crop), 'clamp appliqué après zoom');
});

test('Cropper : Touch Events non passifs (preventDefault) + souris + pinch, compatible Safari iOS', () => {
	assert.ok(/\{\s*passive:\s*false\s*\}/.test(crop), 'touchstart/touchmove NON passifs (preventDefault possible)');
	assert.ok(crop.includes("addEventListener('touchstart'"), 'touchstart branché (fiable sur iOS)');
	assert.ok(crop.includes("addEventListener('touchmove'"), 'touchmove branché');
	assert.ok(crop.includes('e.preventDefault()'), 'le geste ne scrolle plus la page');
	assert.ok(crop.includes('touch-none'), 'CSS touch-action:none (aucun geste système détourné)');
	assert.ok(crop.includes('pointerType'), 'souris via Pointer Events (desktop), tactile via Touch');
	assert.ok(crop.includes('pinch'), 'pincement 2 doigts géré (zoom conservé comme base)');
	// Delta RELATIF (ancre) : pas de calcul clientX − cx mélangé au repère viewport.
	assert.ok(/px = x - cx/.test(crop), 'ancre du drag relative (clientX − cx)');
	assert.ok(!/e\.clientX - cx/.test(crop.replace(/px = x - cx;[\s\S]*?py = y - cy;/, '')), 'pas de mélange viewport/repère carré');
});

test('Cropper : export = aperçu exact (même repère scale + cx + cy)', () => {
	// srcSize = VIEW/scale et coin source (halfW − cx)/scale : identiques à l'affichage.
	assert.ok(/srcSize = Math\.max\(1, Math\.min\(imgW, imgH\) \/ zoom\)/.test(crop), 'srcSize cohérent avec le zoom');
	assert.ok(/sx = \(halfW - cx\) \/ scale/.test(crop), 'sx dérivé de cx (repère unique)');
	assert.ok(/sy = \(halfH - cy\) \/ scale/.test(crop), 'sy dérivé de cy (repère unique)');
});
