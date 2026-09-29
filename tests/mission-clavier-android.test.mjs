/**
 * Mission : clavier Android qui disparaît pendant la saisie.
 *
 * Cause isolée (audit) : `attachScrollDismiss` fermait le clavier (blur) sur
 * TOUT scroll du conteneur survenu ≤ 1 s après un toucher. Or sur Android
 * (viewport `interactive-widget=resizes-content`) :
 *  - le navigateur scrolle LUI-MÊME le conteneur pour révéler le champ
 *    focalisé quand le clavier s'ouvre (≈100-300 ms après le tap) ;
 *  - l'app scrolle aussi le champ au-dessus du clavier
 *    (scrollFocusedIntoView, ~200 ms après le focus).
 * Ces scrolls automatiques tombaient dans la fenêtre « geste récent » →
 * blur() en pleine saisie → clavier fermé (code-barres manuel + Créer par moi).
 * iOS n'était pas touché : Safari scrolle la FENÊTRE, pas le conteneur
 * (aucun événement scroll sur l'élément), et aucun clavier tiers.
 *
 * Correctif (structurel, aucun hack Android) : le clavier ne se ferme plus
 * que si le doigt est RÉELLEMENT posé sur la liste au moment du scroll
 * (touchstart → scroll → touchend du même geste) ; les scrolls causés par
 * l'app sont ignorés (programmaticScrollUntil).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const journal = read('src/routes/espace/journal/+page.svelte');

test('Scroll-dismiss : plus AUCUNE fenêtre temporelle après toucher (cause du bug)', () => {
	const fn = journal.slice(journal.indexOf('function attachScrollDismiss'), journal.indexOf('/* Clavier mobile : le champ qui reçoit le focus'));
	assert.ok(!fn.includes('lastTouchEnd'), 'fenêtre « 1 s après le toucher » supprimée');
	assert.ok(!/performance\.now\(\) - lastTouchEnd/.test(fn), 'aucune comparaison temporelle post-toucher');
});

test('Scroll-dismiss : le clavier ne se ferme que si le doigt est POSÉ sur la liste', () => {
	const fn = journal.slice(journal.indexOf('function attachScrollDismiss'), journal.indexOf('/* Clavier mobile : le champ qui reçoit le focus'));
	assert.ok(/if \(!touchActive\) return;/.test(fn), 'geste réel requis (touchActive)');
	assert.ok(/el\.addEventListener\('touchstart', onTouchStart, \{ passive: true \}\)/.test(fn), 'touchstart suivi');
	assert.ok(/el\.addEventListener\('touchend', onTouchEnd, \{ passive: true \}\)/.test(fn), 'touchend clôt le geste');
});

test('Scrolls causés par l’app ignorés (repositionnement du champ au-dessus du clavier)', () => {
	assert.ok(journal.includes('programmaticScrollUntil'), 'drapeau anti auto-blessure présent');
	assert.ok(/programmaticScrollUntil = performance\.now\(\) \+ 250;/.test(journal), 'posé par scrollFocusedIntoView');
	const fn = journal.slice(journal.indexOf('function attachScrollDismiss'), journal.indexOf('/* Clavier mobile : le champ qui reçoit le focus'));
	assert.ok(/programmaticScrollUntil > performance\.now\(\)/.test(fn), 'vérifié dans le handler scroll');
});

test('Le blur programmatique reste UNIQUEMENT dans le scroll-dismiss (aucun autre vol de focus)', () => {
	const matches = journal.match(/active\.blur\(\)/g) ?? [];
	assert.ok(matches.length === 1, 'un seul site de blur() dans la page');
	assert.ok(journal.includes("active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur();"), 'blur ciblé champ');
});

test('Écrans concernés bien surveillés (code-barres manuel + liste principale + recherches)', () => {
	assert.ok(/\[logListEl, bcListEl, mealSearchListEl, mealBcListEl\]/.test(journal), 'les 4 listes des écrans à clavier');
});

test('Saisie : aucun {#key} qui recréerait les inputs (Aucun re-render destructeur)', () => {
	assert.ok(!journal.includes('{#key'), 'aucun bloc {#key} dans la page Journal');
});

test('Décimales : le parsing virgule existant est intact (0,3 / 1,5 / 8,3)', () => {
	assert.ok(/parseFloat\(v\.replace\(',', '\.'\)\)/.test(journal), 'conversion virgule → point conservée');
	assert.ok(journal.includes('inputmode="decimal"'), 'clavier numérique décimal Android');
});

test('Champ code-barres manuel : saisie numérique sans recherche auto par caractère', () => {
	// La recherche ne part que sur Enter ou le bouton (jamais par caractère —
	// aucun reset/restart du scanner pendant la frappe).
	const count = (journal.match(/oninput=\{[^}]*barcodeManual/g) ?? []).length;
	assert.ok(count === 0, 'aucun oninput sur le champ code-barres');
	assert.ok(journal.includes("submitManual('meal')"), 'recherche au bouton (fenêtre produit)');
});

test('iOS / desktop : le mécanisme de repositionnement du champ reste inchangé', () => {
	assert.ok(journal.includes('function scrollFocusedIntoView'), 'suivi du champ conservé');
	assert.ok(journal.includes('vv.addEventListener(\'resize\', setVh)'), 'écoute visualViewport intacte');
	assert.ok(journal.includes('focusedFieldEl?.isConnected'), 'nettoyage focus conservé');
});
