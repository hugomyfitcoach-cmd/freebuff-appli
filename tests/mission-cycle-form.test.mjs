/**
 * Tests MISSION — Formulaires cycle : durée présélectionnée + champ date iOS.
 *
 * 1) Durée : 28 quand aucune valeur, valeur enregistrée sinon, toujours un
 *    NOMBRE (jamais une chaîne ni une valeur vide) — c'est ce qui était envoyé
 *    à `users.saveCycle` et ce que le `<select>` doit pouvoir présélectionner ;
 * 2) Champ date : même largeur que les autres champs sur iPhone (100 %,
 *    min-width 0, apparence native neutralisée, texte aligné à gauche) dans
 *    TOUS les formulaires date de l'espace cliente.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	CYCLE_LENGTH_DEFAULT,
	CYCLE_LENGTH_OPTIONS,
	cycleLengthOrDefault,
} from '../src/lib/cycle.ts';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const form = read('../src/lib/components/CycleForm.svelte');
const home = read('../src/routes/espace/+page.svelte');
const progression = read('../src/routes/espace/progression/+page.svelte');
const sport = read('../src/routes/espace/depense-sportive/+page.svelte');

/* ── 1 · Durée présélectionnée ── */

test('durée : 28 par défaut, valeur enregistrée sinon, toujours un nombre accepté', () => {
	assert.equal(CYCLE_LENGTH_DEFAULT, 28);
	for (const vide of [undefined, null, '', 'abc', NaN]) {
		assert.equal(cycleLengthOrDefault(vide), 28, `valeur absente ${String(vide)} → 28`);
	}
	assert.equal(cycleLengthOrDefault(39), 39);
	assert.equal(cycleLengthOrDefault('39'), 39, 'valeur historique stockée en texte');
	assert.equal(cycleLengthOrDefault(45), 45);
	assert.equal(cycleLengthOrDefault(28), 28);
	/* Hors bornes serveur : on retombe sur 28 plutôt que d'envoyer un refus. */
	assert.equal(cycleLengthOrDefault(18), 28);
	assert.equal(cycleLengthOrDefault(46), 28);
	/* Le sélecteur doit pouvoir présélectionner la valeur renvoyée. */
	for (const n of [28, 39, 45]) {
		assert.ok(CYCLE_LENGTH_OPTIONS.includes(cycleLengthOrDefault(n)));
		assert.ok(Number.isInteger(cycleLengthOrDefault(n)));
	}
});

test('durée : les deux formulaires cycle initialisent et enregistrent via le helper', () => {
	for (const [nom, src] of [
		['CycleForm', form],
		['Accueil', home],
	]) {
		assert.match(src, /cycleLengthOrDefault\(/, `${nom} : helper partagé utilisé`);
		/* Plus de valeur liée en chaîne : les <option> portent des nombres. */
		assert.doesNotMatch(src, /String\((?:config\?\.)?len/, `${nom} : pas de durée en chaîne`);
		assert.doesNotMatch(src, /parseInt\(\s*cLen/, `${nom} : pas de parseInt sur la durée liée`);
		assert.match(
			src,
			/len:[^,\n]*cycleLengthOrDefault\(/,
			`${nom} : l'envoi passe par le helper (jamais vide)`,
		);
	}
});

/* ── 2 · Champ date sans débordement (iOS) ── */

/** Extrait la balise <input> qui suit la première occurrence de `ancre`. */
function inputAfter(src, ancre) {
	const i = src.indexOf(ancre);
	assert.ok(i > 0, `champ date présent (${ancre})`);
	const start = src.lastIndexOf('<input', i);
	return src.slice(start, src.indexOf('>', i) + 1);
}

test('champ date : même règle de largeur que la saisie sportive (cycle, pesée, mensurations)', () => {
	/* Référence : le correctif déjà validé sur la saisie sportive. */
	const reference = inputAfter(sport, 'type="date"');
	assert.match(reference, /\bw-full\b/);

	const champs = [
		['CycleForm', inputAfter(form, 'type="date"')],
		['Accueil cycle', inputAfter(home, 'id="c-lmp"')],
		['Pesée', inputAfter(progression, 'id="metric-date"')],
		['Mensurations', inputAfter(progression, 'bind:value={logDate}')],
	];
	for (const [nom, champ] of champs) {
		assert.match(champ, /\bbox-border\b/, `${nom} : box-sizing border-box`);
		assert.match(champ, /min-w-0/, `${nom} : min-width 0 (imbrique le champ natif)`);
		assert.match(champ, /appearance-none/, `${nom} : apparence iOS neutralisée (classe)`);
		assert.match(champ, /-webkit-appearance:\s*none/, `${nom} : préfixe webkit`);
		assert.match(champ, /text-left/, `${nom} : texte aligné comme les autres champs`);
		/* Pleine largeur du conteneur, jamais une largeur fixe en px. */
		assert.ok(
			/\bw-full\b/.test(champ) || /\bflex-1\b/.test(champ),
			`${nom} : occupe toute la largeur disponible`,
		);
		assert.doesNotMatch(champ, /\bw-\[?\d+px/, `${nom} : aucune largeur fixe`);
	}
});
