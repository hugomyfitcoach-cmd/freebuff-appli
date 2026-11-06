/**
 * MISSION DIALOG-LOOP — fenêtres du CRM (/admin).
 *
 * Une boucle d'effet Svelte 5 (`effect_update_depth_exceeded`) gelait la page :
 * deux `$effect` de la page admin relisaient l'état des fenêtres et les
 * `bind:this` (premier champ, formulaire de la fiche) tout en réécrivant cet
 * état, si bien que la croix, Échap et le clic sur le fond ne fermaient plus
 * rien. La logique d'ouverture, de fermeture et de focus vit désormais dans
 * les fonctions appelées par les clics : plus aucun effet ne touche l'état
 * des fenêtres.
 *
 * Contrat vérifié ici (aucun navigateur requis, comme les autres missions UI) :
 *  - aucun `$effect` de la page ne lit ni n'écrit l'état des fenêtres ;
 *  - « Ajouter une cliente » : ouverture/fermeture/focus dans les fonctions,
 *    croix + fond + Échap sur le MÊME chemin ;
 *  - « Fiche cliente » : empreinte + focus à l'ouverture dans la fonction,
 *    confirmation de fermeture seulement si un champ a été modifié ;
 *  - focus rendu au déclencheur à la fermeture des deux fenêtres.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const admin = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');

/** Corps des `$effect(() => { … });` de premier niveau de la page admin. */
function effectBodies(source) {
	return [...source.matchAll(/\$effect\(\(\) => \{([\s\S]*?)\n\t\}\);/g)].map((m) => m[1]);
}

/** Corps d'une fonction déclarée au premier niveau du `<script>`. */
function fn(name) {
	const start = admin.indexOf(`function ${name}(`);
	assert.ok(start > 0, `fonction ${name} présente dans la page admin`);
	return admin.slice(start, admin.indexOf('\n\t}', start) + 3);
}

const effects = effectBodies(admin);

test('aucun $effect de /admin ne lit ni n’écrit l’état des fenêtres du CRM', () => {
	assert.ok(effects.length >= 10, `effets détectés dans la page : ${effects.length}`);
	const dialogState = [
		'addClientOpen',
		'addClientFirstField',
		'addClientTrigger',
		'ficheOpen',
		'ficheFirstField',
		'ficheForm',
		'ficheSnapshot',
		'ficheDirty',
		'ficheConfirmClose'
	];
	for (const body of effects) {
		for (const state of dialogState) {
			assert.ok(
				!body.includes(state),
				`un $effect ne doit plus toucher « ${state} » (boucle d’effet) : ${body.trim().slice(0, 160)}`
			);
		}
	}
	// Les deux effets fautifs d'origine ne doivent pas revenir sous une autre forme.
	assert.doesNotMatch(admin, /\$effect\(\(\) => \{\s*if \(!addClientOpen\) return;/);
	assert.doesNotMatch(admin, /\$effect\(\(\) => \{\s*if \(!ficheOpen\) return;/);
});

test('« Ajouter une cliente » : ouverture, fermeture et focus dans les fonctions appelées par les clics', () => {
	const open = fn('openAddClient');
	assert.match(open, /addClientOpen = true;/, 'le clic ouvre la fenêtre');
	assert.match(open, /await tick\(\);/, 'le focus attend le montage de la fenêtre');
	assert.match(open, /addClientFirstField\?\.focus\(\);/, 'focus sur le premier champ');

	const close = fn('closeAddClient');
	assert.match(close, /addClientOpen = false;/, 'la fermeture referme la fenêtre');
	assert.match(close, /addClientTrigger\?\.focus\(\);/, 'le focus revient au bouton d’ouverture');

	// Déclencheur : bouton mémorisé (bind:this) + ouverture par la fonction.
	assert.match(admin, /bind:this=\{addClientTrigger\}\s*\n\s*onclick=\{openAddClient\}/);
	assert.match(admin, /onclick=\{closeAddClient\}/, 'la croix ferme la fenêtre');
	assert.equal(
		(admin.match(/onclick=\{closeAddClient\}/g) ?? []).length,
		2,
		'croix + clic sur le fond passent par la même fonction'
	);
	// Échap : même fonction, jamais une écriture d'état directe.
	assert.match(admin, /if \(addClientOpen\) closeAddClient\(\);/);
	assert.doesNotMatch(admin, /if \(addClientOpen\) addClientOpen = false;/);
});

test('« Fiche cliente » : empreinte et focus à l’ouverture, confirmation seule si un champ est modifié', () => {
	const open = fn('openFiche');
	assert.match(open, /ficheOpen = true;/, 'le clic ouvre la fiche');
	assert.match(open, /await tick\(\);/, 'l’empreinte et le focus attendent le montage du formulaire');
	assert.match(open, /ficheSnapshot = ficheSignature\(\);/, 'empreinte des valeurs d’origine');
	assert.match(open, /ficheDirty = false;/, 'la fiche s’ouvre propre');
	assert.match(open, /ficheFirstField\?\.focus\(\);/, 'focus sur le premier champ');
	assert.match(admin, /onclick=\{openFiche\}/, 'l’ouverture est branchée sur le clic');

	const request = fn('requestCloseFiche');
	assert.match(request, /if \(!ficheOpen\) return;/, 'sans fiche ouverte, rien à fermer');
	assert.match(request, /if \(ficheDirty\) ficheConfirmClose = true;/, 'confirmation si saisie en attente');
	assert.match(request, /else closeFiche\(\);/, 'fermeture directe sinon');

	const close = fn('closeFiche');
	assert.match(close, /ficheOpen = false;/, 'la fiche se referme');
	assert.match(close, /ficheTrigger\?\.focus\(\);/, 'focus rendu au bouton « Fiche »');

	assert.equal(
		(admin.match(/onclick=\{requestCloseFiche\}/g) ?? []).length,
		3,
		'fond + croix + « Annuler » passent par la même fonction'
	);
	assert.match(admin, /onconfirm=\{closeFiche\}/, '« Fermer sans enregistrer » ferme réellement la fiche');
	assert.match(admin, /else if \(ficheOpen\) requestCloseFiche\(\);/, 'Échap suit le même chemin');
});
