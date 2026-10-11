/**
 * Mission UX — MODE « SAISIE MANUELLE » code-barres.
 *
 * Bug réel (vidéo 10-04, iPhone) : au tap sur le champ, la caméra plein
 * cadre reste déployée, le champ est coincé entre caméra et clavier, le CTA
 * « Rechercher le code » passe SOUS le clavier (et sous la capsule flottante)
 * et le layout ne se stabilise qu'après le 1er caractère saisi.
 *
 * Correctif structurel (pas un patch CSS) :
 *  - un VRAI état `bcManualMode` activé au focusin des 2 champs (écran
 *    « Ajouter un aliment » + fenêtre produit), sorti proprement ;
 *  - caméra REPLIÉE en bandeau compact (max-height animée, stream maintenu
 *    — jamais de re-getUserMedia) ;
 *  - champ remonté en tête de panneau (ordre flex) → toujours au-dessus du
 *    clavier via l'infra visualViewport existante (scrollFocusedIntoView),
 *    sur iOS Safari, iOS PWA, Android Chrome et Android PWA ;
 *  - DÉCODAGE suspendu (setPaused : boucle vivante, zéro décodage, porte
 *    anti faux codes remise à zéro) ;
 *  - CTA discret « Reprendre le scan » + sortie différée au blur vide
 *    (annulée au refocus → aucun saut sous le doigt).
 *
 * Périmètre intact : lookup barcode, validation GTIN/checksum (scan guard),
 * Convex, OFF, données alimentaires, invariants clavier Android.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const journal = read('src/routes/espace/journal/+page.svelte');
const scanner = read('src/lib/barcodeScanner.ts');
const off = read('src/convex/off.ts');

const count = (src, s) => src.split(s).length - 1;

/* ─── 1. Le mode existe et s'active au tap sur le champ (sans taper) ─── */

test('M1. État du mode + activation au FOCUS des deux champs (tap sans taper)', () => {
	assert.ok(journal.includes('let bcManualMode = $state(false);'), 'état du mode');
	// Les 2 champs code-barres (Ajouter un aliment + fenêtre produit) activent le mode
	// via onfocus (le onfocusin existant reste dédié au repositionnement clavier) :
	assert.equal(count(journal, 'onfocus={onBcManualFocus}'), 2, 'focus → onBcManualFocus sur les 2 champs');
	assert.equal(count(journal, 'onfocusout={onBcManualBlur}'), 2, 'blur suivi sur les 2 champs');
	// L'activation suspend le décodage :
	assert.match(journal, /function enterBcManual\(\) \{[\s\S]{0,200}setPaused\(true\)/);
});

/* ─── 2. Clavier ouvert plusieurs secondes : décodage SUSPENDU, boucle vivante ─── */

test('M2. Décodage suspendu pendant la saisie, caméra allumée, boucle vivante', () => {
	// Mission scanner V3 : le tick court-circuite aussi pendant la mise en
	// arrière-plan (hiddenPaused) — la condition s'étend, l'invariant tient.
	assert.match(scanner, /if \(!decoding && !paused && !hiddenPaused\) \{/, 'le tick court-circuite la détection');
	assert.match(scanner, /setPaused: \(paused: boolean\) => void;/, 'setPaused dans le handle public');
	assert.match(scanner, /setPaused: \(value: boolean\) => \{[\s\S]{0,300}gate\.reset\(\)/, 'pause → porte remise à zéro');
	// La boucle continue de se programmer PENDANT la pause (pas de timer tué) :
	const iIf = scanner.indexOf('if (!decoding && !paused && !hiddenPaused)');
	const iTick = scanner.indexOf('timer = setTimeout(tick, FRAME_INTERVAL_MS);');
	assert.ok(iTick > iIf, 'le setTimeout reste hors du garde → boucle vivante en pause');
});

/* ─── 3. Caméra repliée : bandeau compact, pas de re-getUserMedia ─── */

test('M3. Caméra repliée en bandeau compact (transition max-height, 2 lecteurs)', () => {
	assert.equal(count(journal, "style:max-height={bcManualMode ? '7rem' : '120vh'}"), 2);
	assert.equal(count(journal, 'transition-[max-height,border-color,box-shadow]'), 2);
	// Le lecteur garde son id (le scanner y injecte la vidéo, jamais démonté) :
	assert.ok(journal.includes('id="bc-reader"') && journal.includes('id="meal-bc-reader"'));
});

/* ─── 4. Le champ remonte : ordre flex au-dessus de la caméra ─── */

test('M4. Champ de saisie remonté en tête de panneau (ordre flex, 2 écrans)', () => {
	assert.equal(count(journal, "{bcManualMode ? 'order-1' : 'order-4'} mx-auto mt-3 w-full max-w-sm"), 2, 'barre de saisie → order-1 en mode manuel');
	// Mission UX immersif : cadre PORTRAIT ÉTROIT (aspect 3/4.6 — caméra plus
	// haute), reader ABSOLU à l'intérieur (croix + indication en overlay),
	// mécanismes de repli/étendue inchangés :
	assert.equal(count(journal, "relative order-2 mx-auto aspect-[3/4.6]"), 2, 'caméra compacte sous le champ (portrait immersif)');
	assert.equal(count(journal, 'absolute inset-0">'), 2, 'reader absolu dans le cadre (overlay possible)');
	assert.ok(count(journal, 'bg-ink/55') >= 2, 'overlays discrets (croix/indication/pill lampe+zoom) sur les 2 écrans');
	// Flex column sur les 2 conteneurs scrollables (le order s'applique) :
	assert.equal(count(journal, 'class="flex flex-1 flex-col overflow-y-auto overscroll-contain px-3 pb-28 pt-3"'), 2);
});

/* ─── 5. CTA « Reprendre le scan » : retour propre au scan caméra ─── */

test('M5. CTA discret « Reprendre le scan » restaure caméra + décodage', () => {
	// 2 CTA (boutons) + 2 statuts « Décodage en pause… » + 1 commentaire de code :
	assert.ok(count(journal, 'Reprendre le scan') >= 4, 'CTA présents sur les 2 écrans');
	assert.equal(count(journal, 'onclick={exitBcManual}'), 2);
	assert.match(journal, /function exitBcManual\(\) \{[\s\S]{0,300}setPaused\(false\)/);
});

/* ─── 6. Fermeture du clavier : sortie propre, jamais de saut sous le doigt ─── */

test('M6. Blur : sortie différée (champ vide uniquement), annulée au refocus', () => {
	const fn = journal.slice(journal.indexOf('function onBcManualBlur'), journal.indexOf('function exitBcManual'));
	assert.match(fn, /setTimeout\(/, 'sortie différée (le tap sur « Rechercher » blur avant le click)');
	assert.match(fn, /if \(!bcManualFocused && !barcodeManual\.trim\(\)\) exitBcManual\(\);/, 'seulement si champ vide et non re-focusé');
	assert.match(fn, /220/, 'délai court');
	const focus = journal.slice(journal.indexOf('function onBcManualFocus'), journal.indexOf('function onBcManualBlur'));
	assert.match(focus, /clearTimeout\(bcManualBlurTimer\)/, 'refocus annule la sortie');
});

test('M7. Arrêt du scanner (produit trouvé, changement de mode) sort du mode', () => {
	const fn = journal.slice(journal.indexOf('async function stopScanner'), journal.indexOf('\t/**\n\t * REPRISE DU LECTEUR'));
	assert.match(fn, /exitBcManual\(\);/);
	// « Réessayer » (caméra refusée) relance le scan → sortie du mode aussi :
	const retry = journal.slice(journal.indexOf('function retryScanner'), journal.indexOf('async function handleScan'));
	assert.match(retry, /exitBcManual\(\);/);
});

/* ─── 7. Champ toujours au-dessus du clavier : infra visualViewport intacte ─── */

test('M8. Infra visualViewport réutilisée, AUCUN hack hauteur clavier', () => {
	assert.match(journal, /function scrollFocusedIntoView\(el: HTMLElement\)/, 'repositionnement existant conservé');
	// Invariant mission-fiche-premium : 3 champs branchés (custom + 2 code-barres)
	// + 1 depuis Repas IA multimodal (textarea « Analyse ton repas » — la dictée
	// native du clavier doit rester au-dessus, même infra visualViewport) :
	assert.equal((journal.match(/onfocusin=\{\(e\) => focusScroll\(e\.currentTarget, e\.target\)\}/g) || []).length, 4, 'wiring focusScroll : 3 champs historiques + textarea repas multimodal');
	assert.doesNotMatch(journal, /keyboardHeight|kbHeight|KEYBOARD_|clavierHauteur/i, 'aucune hauteur de clavier codée en dur');
	// Pas de repositionnement spécifique Safari : l'API est standard (visualViewport).
	assert.doesNotMatch(journal, /webkitKeyboard|webkitConvex|visualViewport\.iOS/i);
});

/* ─── 8. Saisie : chiffre, code complet, suppression/re-saisie inchangés ─── */

test('M9. Saisie inchangée : clavier numérique, Enter et bouton → lookupCode', () => {
	assert.equal(count(journal, 'inputmode="numeric" enterkeyhint="search"'), 2, 'clavier numérique + touche OK explicite');
	assert.ok(journal.includes("if (e.key === 'Enter') submitManual();"), 'Enter → recherche (écran Ajouter)');
	assert.ok(journal.includes("submitManual('meal')"), 'bouton/Enter → recherche (fenêtre produit)');
	assert.match(journal, /function submitManual\(target: 'journal' \| 'meal' = 'journal'\) \{\s*\n\t\tconst code = barcodeManual\.replace\(\/\\D\/g, ''\);\s*\n\t\tif \(code\.length >= 8\) void lookupCode\(code, target\);/, 'logique de saisie inchangée');
	// Toujours aucune recherche par caractère (invariant clavier Android) :
	assert.equal((journal.match(/oninput=\{[^}]*barcodeManual/g) ?? []).length, 0, 'aucun oninput sur le champ code-barres');
});

/* ─── 9. Petits écrans / safe-area / capsule flottante ─── */

test('M10. Safe-area respectée, CTA dégagé de la capsule flottante', () => {
	// La capsule flottante suit toujours le safe-area :
	assert.ok(journal.includes('bottom-[calc(0.625rem+env(safe-area-inset-bottom))]'));
	// Le contenu dégage au-dessus (96 → 112 px : la capsule + safe-area ne la recouvrent plus) :
	assert.equal(count(journal, 'px-3 pb-28 pt-3'), 2);
	// Hauteurs flexibles : pas de hauteur fixe fragile ajoutée (le repli = max-height animée) :
	assert.ok(journal.includes("'7rem' : '120vh'"), 'repli par max-height (jamais une hauteur de clavier estimée)');
});

/* ─── 10. Périmètre : zéro Convex / OFF / validation scan touchés ─── */

test('M11. Zéro Convex / OFF modifié ; lookup + validation scan intacts', () => {
	// Lookup barcode : même endpoint, même convex.action côté BFF :
	assert.ok(journal.includes('/api/foods/barcode?code='));
	// Validation scan guard (fb0c51e) intacte :
	assert.match(journal, /normalizeProductCode\(decoded\)/);
	// Mission V3.2 : sélection de la porte par mode (A = 2 lectures, défaut) :
	assert.match(scanner, /const gate = scanMode === 'B' \? createScanGate\(1, SCAN_CONFIRM_GAP_MS\) : createScanGate\(2, SCAN_CONFIRM_GAP_MS\)/);
	assert.equal(count(scanner, 'onDecoded(res.code)'), 1, 'toujours un seul point de sortie validé');
	// off.ts (fallback OFF dc3468d) : marqueurs intacts :
	assert.match(off, /function resolveProductName/);
	assert.match(off, /const name = resolveProductName\(p\);/);
	// La page ne parle JAMAIS directement à Convex (BFF uniquement) :
	assert.doesNotMatch(journal, /\$lib\/server\/convex|\.convex\.cloud/);
});

/* ─── 11. Invariants clavier Android préservés (tests existants) ─── */

test('M12. Invariants clavier existants intacts (scroll-dismiss, blur unique, pas de {#key})', () => {
	assert.equal((journal.match(/active\.blur\(\)/g) ?? []).length, 1, 'un seul site de blur()');
	assert.ok(!journal.includes('{#key'), 'aucun {#key} (recréation d inputs interdite)');
	assert.ok(journal.includes('programmaticScrollUntil = performance.now() + 250;'));
	assert.ok(/\[logListEl, bcListEl, mealSearchListEl, mealBcListEl\]/.test(journal));
});
