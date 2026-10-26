/**
 * Tests MISSION T1 — données d'entraînement justes côté coach.
 *
 * 1. Statut affiché d'une occurrence = CALCULÉ (jamais stocké) :
 *    « Réalisée » (completed sans skippedAt), « Non réalisée » (completed avec
 *    skippedAt), « Manquée » (planned dont la date est passée), « Prévue »,
 *    « Annulée » ;
 * 2. Adhérence = « Réalisée » ÷ séances passées hors annulées (« Non réalisée »
 *    et « Manquée » comptent comme non faites) ;
 * 3. Dernière charge = série la plus récente par DATE puis par setOrder, quel
 *    que soit l'ordre d'itération renvoyé par la base ;
 * 4. Les retours de la cliente (recentNotes) sont rendus, et la note d'une
 *    séance est dépliable depuis la liste des séances.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	trainingStatus,
	trainingAdherence,
	lastLoad,
	orderByRecency,
	parisTodayISO,
	TRAINING_STATUS_LABELS,
} from '../src/lib/trainingProgress.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const panel = readFileSync(join(root, 'src/lib/components/TrainingPanel.svelte'), 'utf8');
const convexAssign = readFileSync(join(root, 'src/convex/trainingAssign.ts'), 'utf8');

const TODAY = '2026-10-25';
const s = (over) => ({ status: 'planned', date: '2026-10-01', skippedAt: null, startedAt: null, ...over });

/* ─── 1) Statuts calculés ─── */

test('Statuts : Réalisée / Non réalisée / Manquée / Prévue / Annulée', () => {
	assert.equal(trainingStatus(s({ status: 'completed', date: '2026-10-20' }), TODAY), 'done');
	assert.equal(trainingStatus(s({ status: 'completed', date: '2026-10-20', skippedAt: 1 }), TODAY), 'notDone');
	assert.equal(trainingStatus(s({ status: 'planned', date: '2026-10-20' }), TODAY), 'missed');
	assert.equal(trainingStatus(s({ status: 'planned', date: TODAY }), TODAY), 'planned');
	assert.equal(trainingStatus(s({ status: 'planned', date: '2026-10-30' }), TODAY), 'planned');
	assert.equal(trainingStatus(s({ status: 'cancelled', date: '2026-10-20' }), TODAY), 'cancelled');
	// Libellés affichés (badges texte).
	assert.equal(TRAINING_STATUS_LABELS.done, 'Réalisée');
	assert.equal(TRAINING_STATUS_LABELS.notDone, 'Non réalisée');
	assert.equal(TRAINING_STATUS_LABELS.missed, 'Manquée');
	assert.equal(TRAINING_STATUS_LABELS.planned, 'Prévue');
	assert.equal(TRAINING_STATUS_LABELS.cancelled, 'Annulée');
	assert.equal(trainingStatus(s({ status: 'completed', date: TODAY, skippedAt: 1 }), TODAY), 'notDone');
});

test('Fuseau : « aujourd\u2019hui » est la date Europe/Paris, jamais l\u2019horloge UTC brute', () => {
	// 23 h 30 UTC = le lendemain à Paris (hiver comme été).
	assert.equal(parisTodayISO(new Date('2026-10-24T22:30:00Z')), '2026-10-25');
	assert.equal(parisTodayISO(new Date('2026-01-15T23:30:00Z')), '2026-01-16');
	assert.equal(parisTodayISO(new Date('2026-01-15T10:00:00Z')), '2026-01-15');
});

/* ─── 2) Adhérence ─── */

test('Adhérence : 3 réalisées sur 5 séances attendues = 60 % (T5 : une séance faite en avance compte)', () => {
	const sessions = [
		s({ status: 'completed', date: '2026-10-01' }), // réalisée
		s({ status: 'completed', date: '2026-10-05', skippedAt: 123 }), // non réalisée → non comptée
		s({ status: 'planned', date: '2026-10-08' }), // manquée → non comptée
		s({ status: 'completed', date: '2026-10-12' }), // réalisée
		// Hors dénominateur : annulée, aujourd'hui (prévue) ; la future RÉALISÉE compte.
		s({ status: 'cancelled', date: '2026-10-02' }),
		s({ status: 'planned', date: TODAY }),
		s({ status: 'completed', date: '2026-11-05' }), // faite en avance → numérateur + dénominateur
	];
	const a = trainingAdherence(sessions, TODAY);
	assert.equal(a.past, 5, '5 séances attendues hors annulées (dont la future réalisée)');
	assert.equal(a.done, 3, '3 « Réalisée » (dont la future réalisée)');
	assert.equal(a.percent, 60);
});

test('Adhérence : « Non réalisée » n\u2019est jamais comptée comme faite, même seule séance passée', () => {
	const a = trainingAdherence([s({ status: 'completed', date: '2026-10-01', skippedAt: 1 })], TODAY);
	assert.equal(a.done, 0);
	assert.equal(a.past, 1);
	assert.equal(a.percent, 0);
	// Aucune séance passée : pas d'adhérence inventée.
	assert.equal(trainingAdherence([s({ status: 'planned', date: '2026-12-01' })], TODAY).percent, null);
});

/* ─── 3) Dernière charge ─── */

test('Dernière charge : la plus RÉCENTE (date puis setOrder) même si l\u2019ordre d\u2019itération diffère', () => {
	const rows = [
		{ date: '2026-10-05', setOrder: 3, weightKg: 60 },
		{ date: '2026-10-12', setOrder: 1, weightKg: 55 },
		{ date: '2026-10-12', setOrder: 2, weightKg: 57.5 },
		{ date: '2026-10-12', setOrder: 3, weightKg: 62.5 },
		{ date: '2026-09-28', setOrder: 1, weightKg: 65 },
	];
	const reversed = [...rows].reverse();
	const random = [rows[3], rows[0], rows[4], rows[2], rows[1]];
	for (const list of [rows, reversed, random]) {
		assert.equal(lastLoad(list)?.weightKg, 62.5, 'série 3 du 12/10 = la plus récente');
	}
	// Même date : le setOrder le plus élevé gagne.
	assert.equal(lastLoad([{ date: '2026-10-12', setOrder: 2, weightKg: 80 }, { date: '2026-10-12', setOrder: 1, weightKg: 90 }])?.weightKg, 80);
	// Tri explicite exposé : date décroissante puis setOrder décroissant.
	assert.deepEqual(
		orderByRecency(rows).map((r) => `${r.date}#${r.setOrder}`),
		['2026-10-12#3', '2026-10-12#2', '2026-10-12#1', '2026-10-05#3', '2026-09-28#1']
	);
});

test('Dernière charge : ignore les séries sans charge, null si aucune charge', () => {
	assert.equal(lastLoad([
		{ date: '2026-10-12', setOrder: 1, weightKg: 50 },
		{ date: '2026-10-12', setOrder: 2, weightKg: null },
	])?.weightKg, 50);
	assert.equal(lastLoad([{ date: '2026-10-12', setOrder: 1, weightKg: null }]), null);
});

/* ─── 4) Affichage coach (TrainingPanel + assignmentDetail) ─── */

test('assignmentDetail expose skippedAt et startedAt (statut calculable côté coach)', () => {
	const detail = convexAssign.slice(convexAssign.indexOf('export const assignmentDetail'), convexAssign.indexOf('/* ═══════════ Écritures coach'));
	assert.ok(detail.includes('skippedAt: s.skippedAt ?? null'), 'skippedAt exposé');
	assert.ok(detail.includes('startedAt: s.startedAt ?? null'), 'startedAt exposé');
	assert.ok(!/adherence\s*:/.test(detail), 'aucun statut/adherence stocké dans le détail');
});

test('TrainingPanel : badge texte par séance, statut calculé (jamais stocké)', () => {
	assert.ok(panel.includes("from '$lib/trainingProgress'"), 'helper de calcul importé');
	assert.ok(panel.includes('trainingStatus(s, today)'), 'statut calculé par occurrence');
	assert.ok(panel.includes('TRAINING_STATUS_LABELS[statusOf(s)]'), 'libellé affiché');
	for (const tone of ['done:', 'notDone:', 'missed:', 'planned:', 'cancelled:']) {
		assert.ok(panel.includes(tone), `style de badge présent : ${tone}`);
	}
	assert.ok(/cancelled: '[^']*line-through/.test(panel), 'annulée = barrée');
});

test('TrainingPanel : retours de la cliente rendus (date, séance, effort, note)', () => {
	assert.ok(panel.includes('Retours de la cliente'), 'section « Retours de la cliente » rendue');
	assert.ok(panel.includes('summary.recentNotes as n'), 'recentNotes itéré');
	assert.ok(panel.includes('fmtISO(n.date)'), 'date du retour affichée');
	assert.ok(panel.includes('{n.name}'), 'séance du retour affichée');
	assert.ok(panel.includes('Effort {n.difficulty}/5'), 'effort ressenti « Effort 3/5 » affiché');
	assert.ok(panel.includes('{n.note}'), 'note affichée');
});

test('TrainingPanel : le 💬 de la liste déplie la note de CETTE séance', () => {
	assert.ok(/onclick=\{\(\) => \(openNote = openNote === s\._id \? null : s\._id\)\}/.test(panel), 'bouton 💬 → déplie/replie la note');
	assert.ok(panel.includes('{#if s.note}'), 'indicateur seulement si une note existe');
	assert.ok(panel.includes('{openNote === s._id}') || panel.includes('{#if openNote === s._id}'), 'affichage conditionné à la séance ouverte');
	assert.ok(/aria-expanded=\{openNote === s\._id\}/.test(panel), 'état accessible (aria-expanded)');
	const noteBlock = panel.slice(panel.indexOf('{openNote === s._id}'), panel.indexOf('{/each}', panel.indexOf('{openNote === s._id}')));
	assert.ok(noteBlock.includes('{s.note}'), 'la note de la séance est affichée dans le bloc déplié');
	assert.ok(noteBlock.includes('Effort {s.difficulty}/5'), 'effort de la séance affiché');
});

test('Cohérence serveur : adhérence et dernière charge passent par le helper partagé', () => {
	assert.ok(convexAssign.includes('trainingAdherence(live, today).percent'), 'résumé coach : adhérence calculée');
	assert.ok(convexAssign.includes('trainingAdherence(planned, today).percent'), 'liste des assignations : même règle');
	assert.ok(convexAssign.includes('&& s.skippedAt == null'), '« Non réalisée » exclue des séances faites');
	assert.ok(/lastLoad\(e\.rows\)/.test(convexAssign), 'dernière charge par exercice = helper trié');
	assert.ok(/a\.setOrder - b\.setOrder/.test(convexAssign), 'tri explicite par setOrder dans le détail');
});
