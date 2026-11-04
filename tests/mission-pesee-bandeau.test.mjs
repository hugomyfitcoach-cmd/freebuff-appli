/**
 * Tests MISSION — Bandeau « Une pesée existe déjà aujourd'hui ».
 *
 * Règle : le bandeau dépend de l'état À L'OUVERTURE de la fiche, jamais des
 * données en direct. Sinon, l'enregistrement rafraîchit l'Accueil, la pesée du
 * jour « existe » soudain et le bandeau apparaît pendant la confirmation
 * « Pesée enregistrée », en décalant la mise en page.
 *
 * 1) Ouverture SANS pesée du jour → bandeau jamais affiché (même après
 *    l'enregistrement qui rend la pesée du jour existante) ;
 * 2) Ouverture AVEC pesée du jour → bandeau affiché, valeur pré-remplie,
 *    correction possible (comportement conservé) ;
 * 3) Le drapeau du bandeau est un instantané figé ($state posé au passage à
 *    `open`), jamais un $derived sur les props.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { peseeDuJourPresente } from '../src/lib/weightLog.ts';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const sheet = read('../src/lib/components/WeightQuickSheet.svelte');

const TODAY = '2026-11-04';

/** Effet d'ouverture de la fiche (seul endroit qui pose l'instantané). */
const effetOuverture = sheet.slice(
	sheet.indexOf("instantané de l'état de départ"),
	sheet.indexOf('/* Fermeture : la géométrie du volet'),
);

test('ouverture sans pesée du jour : le bandeau ne s’affiche pas', () => {
	assert.equal(peseeDuJourPresente(null, null, TODAY), false, 'aucune pesée : pas de bandeau');
	assert.equal(
		peseeDuJourPresente(null, '2026-11-03', TODAY),
		false,
		'pesée de la veille seulement : pas de bandeau',
	);
});

test('ouverture sans pesée : l’enregistrement ne peut pas faire apparaître le bandeau', () => {
	// L'instantané est pris à l'ouverture : aucune pesée du jour → false.
	const aLOuverture = peseeDuJourPresente(null, null, TODAY);
	assert.equal(aLOuverture, false);

	// Après l'enregistrement, les props deviennent « pesée du jour existante ».
	const apresEnregistrement = peseeDuJourPresente(68.3, TODAY, TODAY);
	assert.equal(apresEnregistrement, true, 'les données live, elles, changent bien');

	// Le bandeau lit l'instantané, pas les données live : il reste absent.
	assert.notEqual(aLOuverture, apresEnregistrement, 'instantané et live divergent : c’est le cas à couvrir');
	assert.match(sheet, /\{#if isToday\}/, 'bandeau conditionné par l’instantané');
});

test('ouverture avec pesée du jour : bandeau, pré-remplissage, correction (conservé)', () => {
	assert.equal(peseeDuJourPresente(68.3, TODAY, TODAY), true, 'pesée du jour existante → bandeau');
	assert.match(sheet, /Une pesée existe déjà aujourd'hui/);
	assert.match(sheet, /isToday \? 'Modifier ma pesée' : 'Enregistrer ma pesée'/);
	assert.match(
		sheet,
		/value = dejaSaisie && lastKg !== null \? fmtKg\(lastKg\) : '';/,
		'valeur du jour pré-remplie depuis le même instantané',
	);
});

test('le drapeau du bandeau est un instantané figé, pas un $derived sur les props', () => {
	assert.match(sheet, /let isToday = \$state\(false\);/, 'état figé');
	assert.doesNotMatch(
		sheet,
		/\$derived\(lastDate === date && lastKg !== null\)/,
		'plus de dérivation en direct sur les props',
	);
	assert.doesNotMatch(sheet, /isToday\s*=\s*\$derived/, 'jamais dérivé');
	// Une seule affectation, dans l'effet d'ouverture.
	assert.equal((sheet.match(/(?<!let )\bisToday\s*=/g) ?? []).length, 1, 'une seule écriture');
	assert.match(sheet, /let isToday = \$state\(false\);[\s\S]*\$effect\(\(\) => \{\s*if \(!open\) return;\s*untrack\(\(\) => \{/);
});

test('l’instantané n’est posé qu’au passage à `open` (aucun recalcul pendant la fiche)', () => {
	assert.ok(effetOuverture.length > 0, 'effet d’ouverture trouvé');
	assert.match(effetOuverture, /if \(!open\) return;/, 'ne s’exécute qu’à l’ouverture');
	assert.match(effetOuverture, /untrack\(\(\) => \{/, 'lecture des props hors dépendances réactives');
	assert.match(effetOuverture, /isToday = dejaSaisie;/, 'instantané posé à l’ouverture');
	// Le corps réactif de l'effet ne lit que `open` : aucune prop ne peut le relancer.
	const reactif = effetOuverture.slice(0, effetOuverture.indexOf('untrack(')).replace(/\/\*[\s\S]*?\*\//g, '');
	assert.match(reactif, /if \(!open\) return;/);
	for (const prop of ['lastKg', 'lastDate', 'date']) {
		assert.ok(!reactif.includes(prop), `\`${prop}\` lu hors untrack ne doit pas relancer l’effet`);
	}
});

test('l’instantané survit à la confirmation et à la fermeture (aucun saut de mise en page)', () => {
	// Aucune remise à zéro ni réévaluation dans le chemin d'enregistrement/fermeture.
	const apresOuverture = sheet.slice(sheet.indexOf('isToday = dejaSaisie;') + 'isToday = dejaSaisie;'.length);
	assert.doesNotMatch(apresOuverture, /^\s*isToday\s*=/m, 'aucune réécriture après l’ouverture');
	assert.doesNotMatch(sheet, /if \(!open\)\s*\{[^}]*isToday/, 'pas de remise à zéro à la fermeture');
	assert.match(sheet, /setTimeout\(\(\) => requestClose\(\), 650\)/, 'confirmation puis fermeture inchangées');
	assert.match(sheet, /\{#if done\}[\s\S]*Pesée enregistrée/, 'confirmation inchangée');
});

test('aucune autre fiche de saisie ne porte ce bandeau', () => {
	const autres = ['HydrationQuickSheet.svelte', 'QuantitySheet.svelte', 'BilanJourSheet.svelte'];
	for (const fichier of autres) {
		const src = read(`../src/lib/components/${fichier}`);
		assert.doesNotMatch(src, /existe déjà aujourd'hui/, `${fichier} : aucun bandeau équivalent`);
	}
	assert.match(read('../src/routes/espace/progression/+page.svelte'), /Touche une date pour corriger ou supprimer une valeur/);
});
