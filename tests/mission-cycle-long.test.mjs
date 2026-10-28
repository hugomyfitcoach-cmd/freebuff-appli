/**
 * Tests MISSION — Durée de cycle jusqu'à 45 jours.
 *
 * 1) Bornes : 21–45 partout (sélecteurs, validation serveur), 28 par défaut ;
 * 2) Validation : 39 et 45 acceptés, 46 refusé ;
 * 3) Calcul inchangé : cycle de 39 j → ovulation J25, lutéale tardive jusqu'à
 *    J39 ; cycle de 28 j → ovulation J14 (aucune régression) ;
 * 4) Lisibilité : les plages de phases couvrent tout le cycle, y compris 45 j.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	CYCLE_LENGTH_MAX,
	CYCLE_LENGTH_MIN,
	CYCLE_LENGTH_OPTIONS,
	getCyclePhase,
	isValidCycleLength,
	phaseRanges,
} from '../src/lib/cycle.ts';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const users = read('../src/convex/users.ts');
const schema = read('../src/convex/schema.ts');
const form = read('../src/lib/components/CycleForm.svelte');
const home = read('../src/routes/espace/+page.svelte');

/** Jour du cycle visé → date de référence (règles au 2026-10-01). */
function dayOf(lmp, cycleLength, day) {
	const ref = new Date(lmp + 'T00:00:00');
	ref.setDate(ref.getDate() + day - 1);
	return getCyclePhase(lmp, cycleLength, ref);
}

test('bornes : 21 à 45 jours, 28 toujours proposé et par défaut', () => {
	assert.equal(CYCLE_LENGTH_MIN, 21);
	assert.equal(CYCLE_LENGTH_MAX, 45);
	assert.equal(CYCLE_LENGTH_OPTIONS[0], 21);
	assert.equal(CYCLE_LENGTH_OPTIONS.at(-1), 45);
	assert.equal(CYCLE_LENGTH_OPTIONS.length, 25, '21…45 inclus, sans trou');
	assert.ok(CYCLE_LENGTH_OPTIONS.includes(28));
	assert.ok(CYCLE_LENGTH_OPTIONS.includes(39));
	assert.ok(CYCLE_LENGTH_OPTIONS.includes(45));
	assert.ok(!CYCLE_LENGTH_OPTIONS.includes(46));
});

test('validation serveur : 39 et 45 acceptés, 20 et 46 refusés', () => {
	assert.equal(isValidCycleLength(39), true);
	assert.equal(isValidCycleLength(45), true);
	assert.equal(isValidCycleLength(21), true);
	assert.equal(isValidCycleLength(28), true);
	assert.equal(isValidCycleLength(46), false);
	assert.equal(isValidCycleLength(20), false);
	assert.equal(isValidCycleLength(38.5), false);
	assert.equal(isValidCycleLength('39'), false);
	assert.equal(isValidCycleLength(undefined), false);
	// Le serveur utilise la même validation, sans borne recopiée en dur.
	assert.match(users, /isValidCycleLength\(lenN\)/);
	assert.match(users, /CYCLE_LENGTH_MIN.*CYCLE_LENGTH_MAX/);
	assert.doesNotMatch(users, /lenN > 32|lenN < 21 /);
	// Message neutre : bornes uniquement, aucune alerte ni pathologie.
	assert.match(users, /doit être comprise entre \$\{CYCLE_LENGTH_MIN\} et \$\{CYCLE_LENGTH_MAX\} jours/);
	assert.doesNotMatch(users, /anormal|patholog|inquiét/i);
	assert.match(schema, /21–45/);
});

test('cycle de 39 jours : ovulation J25, lutéale tardive jusqu’à J39', () => {
	const ov = dayOf('2026-10-01', 39, 25);
	assert.equal(ov.ovulationDay, 25);
	assert.equal(ov.cycleDay, 25);
	assert.equal(ov.key, 'ovulation');

	const late = dayOf('2026-10-01', 39, 39);
	assert.equal(late.cycleDay, 39, 'le 39e jour est bien atteint');
	assert.equal(late.key, 'luteal-late');

	const ranges = phaseRanges(39, 25);
	assert.deepEqual(ranges.find((r) => r.key === 'menses'), { key: 'menses', from: 1, to: 5 });
	assert.deepEqual(
		ranges.find((r) => r.key === 'luteal-late'),
		{ key: 'luteal-late', from: 33, to: 39 },
		'fin de cycle couverte jusqu’à J39',
	);
	assert.equal(dayOf('2026-10-01', 39, 33).key, 'luteal-late');
});

test('cycle de 28 jours : calcul inchangé (ovulation J14)', () => {
	const ov = getCyclePhase('2026-10-01', 28);
	assert.equal(ov.ovulationDay, 14);
	const ranges = phaseRanges(28, 14);
	assert.deepEqual(
		ranges.map((r) => [r.key, r.from, r.to]),
		[
			['menses', 1, 5],
			['follicular', 6, 11],
			['ovulation', 12, 15],
			['luteal-early', 16, 21],
			['luteal-late', 22, 28],
		],
	);
	assert.equal(dayOf('2026-10-01', 28, 14).key, 'ovulation');
	assert.equal(dayOf('2026-10-01', 28, 28).key, 'luteal-late');
});

test('45 jours : plages de phases continues et couvrant tout le cycle', () => {
	for (const len of [39, 45]) {
		const { ovulationDay } = getCyclePhase('2026-10-01', len);
		const ranges = phaseRanges(len, ovulationDay);
		assert.equal(ranges[0].from, 1);
		assert.equal(ranges.at(-1).to, len, `la frise couvre J1 → J${len}`);
		for (let i = 1; i < ranges.length; i++) {
			assert.equal(ranges[i].from, ranges[i - 1].to + 1, `aucun trou à ${len} j`);
			assert.ok(ranges[i].to >= ranges[i].from, `plage non vide à ${len} j`);
		}
	}
	const r45 = phaseRanges(45, getCyclePhase('2026-10-01', 45).ovulationDay);
	assert.equal(getCyclePhase('2026-10-01', 45).ovulationDay, 31);
	assert.equal(dayOf('2026-10-01', 45, 45).key, 'luteal-late');
	assert.equal(r45.at(-1).to, 45);
});

test('les deux sélecteurs proposent la liste partagée (39 et 45 inclus)', () => {
	assert.match(form, /import \{ CYCLE_LENGTH_OPTIONS/);
	assert.match(form, /\{#each CYCLE_LENGTH_OPTIONS as n \(n\)\}/);
	assert.match(home, /\{#each CYCLE_LENGTH_OPTIONS as n\}/);
	assert.doesNotMatch(form, /\{ length: 12 \}/, 'plus de plage 21–32 recopiée');
	assert.doesNotMatch(home, /\{ length: 12 \}/);
});
