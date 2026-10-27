/**
 * Tests MISSION HOTFIX-RENAME — la fenêtre « Renommer la séance » de
 * l'éditeur de programme (/admin/entrainement) accepte de nouveau la saisie.
 *
 * Cause : le ConfirmDialog unifié (fusion PR #21 + #25) forçait le focus sur
 * « Annuler » à l'ouverture et interceptait les touches au niveau de la
 * fenêtre (preventDefault), si bien que le champ de saisie placé dans le
 * dialogue ne recevait jamais le clavier.
 *
 * 1. Aucun gestionnaire n'empêche la saisie dans un champ d'un ConfirmDialog ;
 * 2. Entrée valide, Échap annule ; le focus va dans le champ à l'ouverture ;
 * 3. Le renommage applique la valeur saisie, immédiatement ;
 * 4. Les autres confirmations gardent leurs libellés et comportements.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const dialog = read('src/lib/components/ConfirmDialog.svelte');
const editor = read('src/lib/components/TrainingEditor.svelte');
const runner = read('src/lib/components/SessionRunner.svelte');
const bilan = read('src/lib/components/BilanCard.svelte');
const trainingPage = read('src/routes/admin/entrainement/+page.svelte');
const adminPage = read('src/routes/admin/+page.svelte');

/** Corps du gestionnaire clavier du dialogue. */
const keyHandler = dialog.slice(
	dialog.indexOf('function onKeydown'),
	dialog.indexOf('</script>')
);

/* ─── 1) Aucun gestionnaire n'empêche la saisie ─── */

test('le dialogue n’intercepte pas les frappes dans un champ', () => {
	// Aucun preventDefault avant l'aiguillage par touche : la saisie d'un
	// caractère ordinaire n'est jamais bloquée à l'entrée du gestionnaire.
	const preamble = keyHandler.slice(0, keyHandler.indexOf("event.key === 'Escape'"));
	assert.ok(preamble.includes('if (!open || busy) return;'), 'garde open / busy seulement');
	assert.ok(!/preventDefault/.test(preamble), 'aucun preventDefault global');
	// Et aucun filtre « n'importe quelle touche » / branche par défaut qui
	// avalerait les caractères.
	assert.ok(!/key\.length/.test(keyHandler), 'pas de filtre sur la longueur de la touche');
	assert.ok(!/else\s*\{[^}]*preventDefault/.test(keyHandler), 'pas de branche par défaut bloquante');
	assert.ok(
		(keyHandler.match(/event\.preventDefault\(\)/g) || []).length <= 3,
		'preventDefault limité à Échap / Entrée dans un champ / Tab'
	);
	// Le champ de renommage ne porte aucun gestionnaire clavier local qui
	// pourrait avaler les caractères.
	const renameDialog = editor.slice(
		editor.indexOf('title="Renommer la séance"'),
		editor.indexOf('title="Supprimer la séance ?"')
	);
	const input = renameDialog.slice(renameDialog.indexOf('<input'), renameDialog.indexOf('/>'));
	assert.ok(input.includes('bind:value={renameValue}'), 'champ lié à la valeur');
	assert.ok(!input.includes('onkeydown'), 'aucun onkeydown sur le champ');
	assert.ok(!/preventDefault/.test(input), 'aucun preventDefault sur le champ');
});

/* ─── 2) Entrée valide, Échap annule, focus dans le champ ─── */

test('Entrée valide et Échap annule, sans casser la saisie', () => {
	assert.match(keyHandler, /event\.key === 'Escape'/, 'Échap géré');
	assert.match(keyHandler, /Escape[\s\S]*?onCancel\(\)/, 'Échap annule');
	assert.match(keyHandler, /event\.key === 'Enter'/, 'Entrée gérée');
	assert.match(keyHandler, /Enter[\s\S]*?onConfirm\(\)/, 'Entrée valide');
	// Entrée ne valide que depuis un champ mono-ligne : une zone de texte
	// multiligne garde ses retours à la ligne.
	assert.match(keyHandler, /inSingleLineField/, 'Entrée limitée aux champs mono-ligne');
	assert.match(keyHandler, /'INPUT'\s*\|\|\s*target\.tagName === 'SELECT'/, 'champs texte / listes');
});

test('le focus va dans le champ du dialogue à l’ouverture', () => {
	assert.match(dialog, /function firstField\(\)/, 'premier champ détecté');
	assert.match(dialog, /firstField\(\)\s*\?\?\s*cancelButton/, 'champ prioritaire sur « Annuler »');
	assert.match(dialog, /target\?\.focus\(\)/, 'focus posé sur la cible');
	assert.ok(
		!/\n\s*cancelButton\?\.focus\(\);/.test(dialog),
		'plus de focus inconditionnel sur « Annuler »'
	);
	assert.match(dialog, /return \(\) => previous\?\.focus\?\.\(\)/, 'focus rendu au déclencheur à la fermeture');
});

/* ─── 3) Le renommage applique la valeur saisie ─── */

test('« Renommer » applique la valeur saisie immédiatement', () => {
	const fn = editor.slice(
		editor.indexOf('function confirmRenameSession'),
		editor.indexOf('async function duplicateSession')
	);
	assert.match(fn, /const name = renameValue\.trim\(\)/, 'lit la valeur saisie');
	assert.match(fn, /sessionNames\[target\._id\] = name/, 'mise à jour locale immédiate');
	assert.match(
		fn,
		/send\('PATCH', `\/api\/coach\/training\/sessions\/\$\{target\._id\}`, \{ name \}\)/,
		'persistance de la valeur saisie'
	);
	// Le dialogue transmet bien la validation à cette fonction.
	assert.match(
		editor,
		/title="Renommer la séance"[\s\S]*?onconfirm=\{confirmRenameSession\}/,
		'« Renommer » → confirmRenameSession'
	);
});

/* ─── 4) Les autres confirmations sont inchangées ─── */

test('les autres confirmations gardent libellés et comportements', () => {
	// Valeurs par défaut du composant.
	assert.match(dialog, /confirmLabel = 'Confirmer'/, 'libellé par défaut');
	assert.match(dialog, /cancelLabel = 'Annuler'/, 'annulation par défaut');
	assert.match(dialog, /if \(!open \|\| busy\) return;/, 'inerte pendant busy');
	assert.match(dialog, /onclick=\{\(\) => !busy && onConfirm\(\)\}/, 'confirmation par clic explicite');
	assert.match(dialog, /onclick=\{\(\) => !busy && onCancel\(\)\}/, 'annulation par clic explicite');
	assert.match(dialog, /event\.target === event\.currentTarget/, 'clic sur le fond = annulation');

	// Suppressions : libellés et garde busy conservés.
	assert.match(
		editor,
		/title="Supprimer la séance \?"[\s\S]*?confirmLabel="Supprimer"/,
		'« Supprimer la séance ? » → Supprimer'
	);
	assert.match(
		editor,
		/title="Retirer cet exercice \?"[\s\S]*?confirmLabel="Retirer"/,
		'« Retirer cet exercice ? » → Retirer'
	);
	assert.match(
		trainingPage,
		/title="Supprimer le programme \?"[\s\S]*?confirmLabel="Supprimer"/,
		'« Supprimer le programme ? » → Supprimer'
	);
	assert.match(
		runner,
		/title="Quitter la séance \?"[\s\S]*?confirmLabel="Annuler la séance"[\s\S]*?cancelLabel="Garder en cours"/,
		'« Quitter la séance ? » inchangé'
	);
	assert.match(
		bilan,
		/title="Remplacer le texte actuel \?"[\s\S]*?confirmLabel="Remplacer"/,
		'brouillon IA inchangé'
	);
	assert.match(
		adminPage,
		/title=\{`Appliquer à la fiche de \$\{selected\.user\.prenom\} \?`\}[\s\S]*?confirmLabel="Appliquer"/,
		'calibrage inchangé'
	);
	// Aucun autre dialogue ne contient de champ de saisie : le changement de
	// cible du focus ne concerne que le renommage.
	const fieldDialogs = [editor, runner, bilan, trainingPage, adminPage].filter((src) =>
		/<ConfirmDialog[\s\S]*?<input[\s\S]*?<\/ConfirmDialog>/.test(src)
	);
	assert.equal(fieldDialogs.length, 1, 'un seul dialogue avec un champ (renommage)');
	assert.equal(fieldDialogs[0], editor, 'c’est l’éditeur de programme');
});
