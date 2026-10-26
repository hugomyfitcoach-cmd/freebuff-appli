/**
 * Tests MISSION T4 — détail d'une séance + « Charges & progression » (coach).
 *
 * 1. `sessionDetail` est réservé au coach DE la cliente (rôle coach +
 *    `target.createdBy === coach._id`) et ne fait que LIRE ;
 * 2. Les séries d'une séance sont regroupées PAR EXERCICE (ordre de
 *    prescription, volume par exercice) ;
 * 3. Charge de départ = première séance, charge actuelle = dernière séance ;
 * 4. Écart positif / nul / négatif ;
 * 5. Exercice au poids du corps → répétitions (jamais des kg).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	groupSessionSets,
	exerciseProgressions,
	progressionDeltaLabel,
	formatLoggedSet,
} from '../src/lib/trainingProgress.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const panel = readFileSync(join(root, 'src/lib/components/TrainingPanel.svelte'), 'utf8');
const convexAssign = readFileSync(join(root, 'src/convex/trainingAssign.ts'), 'utf8');
const route = readFileSync(join(root, 'src/routes/api/coach/training/session-detail/+server.ts'), 'utf8');

const log = (over = {}) => ({
	date: '2026-10-05',
	setOrder: 0,
	exerciseId: 'ex-squat',
	exerciseName: 'Squat',
	mode: 'reps',
	reps: 10,
	weightKg: 30,
	durationSeconds: null,
	done: true,
	...over,
});

/* ─── 1) Autorisation : un autre coach ne peut pas lire sessionDetail ─── */

test('sessionDetail : rôle coach + coach de la cliente, lecture seule', () => {
	const query = convexAssign.slice(
		convexAssign.indexOf('export const sessionDetail'),
		convexAssign.indexOf('/* ═══════════ Écritures coach')
	);
	assert.ok(query.includes('export const sessionDetail = query('), 'query de LECTURE (jamais mutation)');
	assert.ok(query.includes('coach.role !== "coach"'), 'rôle coach exigé');
	assert.ok(query.includes('target.createdBy !== coach._id'), 'rattachement coach → cliente vérifié');
	assert.ok(query.includes('Accès réservé au coach de cette cliente.'), 'refus explicite');
	assert.ok(query.includes('by_session'), 'les séries viennent de l’occurrence demandée');
	assert.ok(query.includes('groupSessionSets('), 'regroupement par exercice via le helper partagé');
	// Route BFF : coach uniquement, calquée sur exercise-history.
	assert.ok(route.includes("await requireRole(event, 'coach')"), 'route réservée au coach');
	assert.ok(route.includes('api.trainingAssign.sessionDetail'), 'la route réutilise la query serveur');
	assert.ok(route.includes('scheduledSessionId'), 'identifiant de séance transmis');
});

test('le dépliage d’une « Réalisée » affiche les exercices SOUS la note', () => {
	const detail = panel.slice(
		panel.indexOf('{#if openNote === s._id}'),
		panel.indexOf('<div class="mt-2 flex flex-wrap gap-1.5">', panel.indexOf('{#if openNote === s._id}'))
	);
	assert.ok(detail.length > 0, 'bloc déplié présent');
	assert.ok(detail.includes('{s.note}'), 'note de la cliente rendue');
	assert.ok(detail.indexOf('{s.note}') < detail.indexOf('sessionDetail.exercises'), 'exercices sous la note');
	assert.ok(detail.includes('formatLoggedSet'), 'séries « 10 × 32 kg » / durée');
	assert.ok(detail.includes('sessionDetail.volumeKg'), 'volume total de la séance');
	assert.ok(
		panel.includes('/api/coach/training/session-detail?scheduledSessionId='),
		'chargement à l’ouverture de la pastille'
	);
});

/* ─── 2) Regroupement des séries par exercice ─── */

test('séries groupées par exercice, dans l’ordre de prescription', () => {
	const rows = [
		log({ exerciseId: 'ex-bench', exerciseName: 'Bench press', setOrder: 4, reps: 10, weightKg: 40 }),
		log({ exerciseId: 'ex-squat', setOrder: 2, reps: 10, weightKg: 32 }),
		log({ exerciseId: 'ex-squat', setOrder: 1, reps: 10, weightKg: 30 }),
		// Ligne saisie mais non validée : jamais comptée.
		log({ exerciseId: 'ex-squat', setOrder: 3, reps: 8, weightKg: 40, done: false }),
	];
	const groups = groupSessionSets(rows);
	assert.deepEqual(groups.map((g) => g.exerciseId), ['ex-squat', 'ex-bench']);
	assert.deepEqual(groups[0].sets.map((s) => s.setOrder), [1, 2], 'séries triées par setOrder');
	assert.equal(groups[0].sets.length, 2, 'série non validée exclue');
	assert.equal(groups[0].volumeKg, 620, 'volume = Σ reps × charge');
	assert.equal(groups[1].volumeKg, 400);
	assert.equal(formatLoggedSet(groups[0].sets[1]), '10 × 32 kg');
	// Même séance, exercice en durée : la série s'affiche en secondes, sans volume kg.
	const timed = groupSessionSets([
		log({ exerciseId: 'ex-run', exerciseName: 'Run', mode: 'time', weightKg: null, reps: null, durationSeconds: 45 }),
	]);
	assert.equal(formatLoggedSet(timed[0].sets[0]), '45 s');
	assert.equal(timed[0].volumeKg, null, 'aucune série chargée → pas de volume kg');
});

/* ─── 3) Départ = première séance, actuel = dernière ─── */

test('charge de départ = première séance, charge actuelle = dernière séance', () => {
	const rows = [
		log({ date: '2026-10-12', setOrder: 1, reps: 10, weightKg: 34 }),
		log({ date: '2026-10-05', setOrder: 0, reps: 12, weightKg: 30 }),
		log({ date: '2026-10-19', setOrder: 1, reps: 8, weightKg: 38 }),
		log({ date: '2026-10-05', setOrder: 1, reps: 10, weightKg: 32 }),
	];
	const [p] = exerciseProgressions(rows);
	assert.equal(p.startDate, '2026-10-05', 'date de la première séance');
	assert.equal(p.startValue, 32, 'dernière série de la première séance');
	assert.equal(p.currentDate, '2026-10-19', 'date de la dernière séance');
	assert.equal(p.currentValue, 38, 'dernière charge via lastLoad');
	assert.equal(p.sessions, 3, 'nombre de séances distinctes');
	assert.equal(p.unit, 'kg');
	// Tri : exercice le plus récemment travaillé en premier.
	const multi = exerciseProgressions([
		log({ exerciseId: 'ex-a', exerciseName: 'A', date: '2026-10-05' }),
		log({ exerciseId: 'ex-b', exerciseName: 'B', date: '2026-10-19' }),
	]);
	assert.deepEqual(multi.map((x) => x.exerciseId), ['ex-b', 'ex-a']);
});

/* ─── 4) Écart positif / nul / négatif ─── */

test('écart : positif en vert, nul stable, négatif en baisse', () => {
	const progression = (start, end) =>
		exerciseProgressions([
			log({ date: '2026-10-05', weightKg: start, reps: 10 }),
			log({ date: '2026-10-12', weightKg: end, reps: 10 }),
		])[0];
	const up = progression(30, 34);
	assert.equal(up.delta, 4);
	assert.equal(progressionDeltaLabel(up), '+4 kg');
	const flat = progression(30, 30);
	assert.equal(flat.delta, 0);
	assert.equal(progressionDeltaLabel(flat), '±0 kg');
	const down = progression(34, 30);
	assert.equal(down.delta, -4);
	assert.equal(progressionDeltaLabel(down), '-4 kg');
	// Le rendu colore : hausse = vert (brand), baisse = orange (warn), stable = gris.
	assert.ok(panel.includes("delta > 0 ? 'text-brand-dark' : 'text-warn'"), 'vert en hausse, orange en baisse');
	assert.ok(panel.includes("if (delta == null || delta === 0) return 'text-mist'"), 'gris si stable');
	assert.ok(panel.includes('{progressionDeltaLabel(ex)}'), 'écart affiché par exercice');
	assert.ok(panel.includes('{ex.sessions} séance'), 'nombre de séances affiché');
});

/* ─── 5) Poids du corps → répétitions ─── */

test('exercice au poids du corps : répétitions au lieu des kg', () => {
	const bw = exerciseProgressions([
		log({ exerciseId: 'ex-pull', exerciseName: 'Tractions', weightKg: null, reps: 6, date: '2026-10-05' }),
		log({ exerciseId: 'ex-pull', exerciseName: 'Tractions', weightKg: null, reps: 9, date: '2026-10-12' }),
	])[0];
	assert.equal(bw.unit, 'reps');
	assert.equal(bw.startValue, 6);
	assert.equal(bw.currentValue, 9);
	assert.equal(bw.delta, 3);
	assert.equal(progressionDeltaLabel(bw), '+3 reps');
	assert.equal(formatLoggedSet({ mode: 'reps', reps: 9, weightKg: null }), '9 reps');
	assert.ok(panel.includes('valueLabel(ex.startValue, ex.unit)'), 'unité de l’exercice respectée à l’affichage');
});
