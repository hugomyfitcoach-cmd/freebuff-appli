/**
 * Tests MISSION T3 — refonte visuelle de l'onglet Entraînement (TrainingPanel).
 *
 * 1. Regroupement CALENDAIRE par semaine du programme (semaine 1 = 7 jours à
 *    partir de la date de début, dernière semaine bornée à la date de fin) ;
 * 2. La semaine en cours est mise en évidence et dépliée par défaut ;
 * 3. « Se termine dans 5 jours » est orange (warn), « Terminé » une fois passé ;
 * 4. Une pastille par séance, statut calculé (aucun nouveau calcul) ;
 * 5. Les actions Déplacer / Dupliquer / Annuler restent accessibles.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	defaultOpenWeekIndex,
	groupSessionsByWeek,
	programEndBadge,
	programWeekCount,
	weekLabel,
} from '../src/lib/trainingWeeks.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const panel = readFileSync(join(root, 'src/lib/components/TrainingPanel.svelte'), 'utf8');

const START = '2026-10-05'; // lundi
const END = '2026-11-01'; // dimanche, 4 semaines pleines
const TODAY = '2026-10-21'; // semaine 3
const s = (date, over = {}) => ({ _id: `s-${date}`, date, status: 'planned', skippedAt: null, ...over });

/* ─── 1) Regroupement par semaine ─── */

test('regroupement : une entrée par semaine du programme, séances dans la bonne semaine', () => {
	const weeks = groupSessionsByWeek(
		[s('2026-10-12'), s('2026-10-05'), s('2026-10-21'), s('2026-11-01')],
		START,
		END,
		TODAY
	);
	assert.equal(programWeekCount(START, END), 4);
	assert.equal(weeks.length, 4);
	assert.deepEqual(
		weeks.map((w) => [w.index, w.start, w.end, w.sessions.map((x) => x.date)]),
		[
			[1, '2026-10-05', '2026-10-11', ['2026-10-05']],
			[2, '2026-10-12', '2026-10-18', ['2026-10-12']],
			[3, '2026-10-19', '2026-10-25', ['2026-10-21']],
			[4, '2026-10-26', '2026-11-01', ['2026-11-01']],
		]
	);
	// Libellé « Semaine 1 · 5–11 oct. » et fin bornée au programme.
	assert.equal(weeks[0].label, '5–11 oct.');
	assert.equal(weeks[3].label, '26 oct. – 1 nov.');
	assert.equal(weekLabel('2026-10-26', '2026-11-01'), '26 oct. – 1 nov.');
	// Une séance hors programme n'est jamais rattachée.
	const out = groupSessionsByWeek([s('2026-11-05')], START, END, TODAY);
	assert.equal(out.reduce((n, w) => n + w.sessions.length, 0), 0);
	// Le badge du pli compte les « Réalisée » de la semaine.
	const doneWeek = groupSessionsByWeek(
		[s('2026-10-21', { status: 'completed' }), s('2026-10-22', { status: 'completed', skippedAt: 1 }), s('2026-10-23', { status: 'planned' })],
		START,
		END,
		TODAY
	);
	assert.equal(doneWeek[2].done, 1, '« Non réalisée » ne compte pas comme faite');
});

/* ─── 2) Semaine en cours dépliée ─── */

test('semaine en cours : une seule semaine marquée, dépliée par défaut', () => {
	const weeks = groupSessionsByWeek([s('2026-10-21')], START, END, TODAY);
	assert.deepEqual(weeks.map((w) => w.isCurrent), [false, false, true, false]);
	assert.equal(defaultOpenWeekIndex(weeks), 3, 'la semaine en cours est celle qui s’ouvre');
	// Programme terminé : repli sur la première semaine (aucune semaine courante).
	const past = groupSessionsByWeek([s('2026-10-05')], START, END, '2026-12-01');
	assert.equal(past.some((w) => w.isCurrent), false);
	assert.equal(defaultOpenWeekIndex(past), 1);
	assert.equal(defaultOpenWeekIndex([]), null);
	// Le panneau ouvre bien la semaine par défaut et plie/déplie au clic.
	assert.ok(panel.includes('openWeek = defaultOpenWeekIndex('), 'semaine par défaut à l’ouverture');
	assert.ok(panel.includes('aria-expanded={openWeek === w.index}'), 'pli accessible');
	assert.ok(panel.includes('onclick={() => (openWeek = openWeek === w.index ? null : w.index)}'), 'une semaine à la fois');
});

/* ─── 3) Fin de programme : orange à 5 jours ─── */

test('« Se termine dans 5 jours » en orange, « Terminé » une fois passé', () => {
	assert.deepEqual(programEndBadge('2026-10-31', '2026-10-26'), {
		label: 'Se termine dans 5 jours',
		tone: 'warn',
	});
	assert.equal(programEndBadge('2026-11-01', '2026-10-26').tone, 'calm', '6 jours : pas d’alerte orange');
	assert.equal(programEndBadge('2026-10-26', '2026-10-26').tone, 'warn');
	assert.deepEqual(programEndBadge('2026-10-25', '2026-10-26'), { label: 'Terminé', tone: 'over' });
	// Rendu : tone warn → classe orange existante (text-warn).
	assert.ok(panel.includes("endBadge?.tone === 'warn' ? 'text-warn'"), 'orange sur la carte d’en-tête');
	assert.ok(panel.includes('{endBadge?.label'), 'libellé affiché');
});

/* ─── 4) Une pastille par séance, statut calculé ─── */

test('une pastille par séance avec nom, jour et statut en couleur', () => {
	assert.equal((panel.match(/data-status=\{statusOf\(s\)\}/g) || []).length, 1, 'un seul rendu par séance');
	assert.ok(panel.includes('{#each w.sessions as s (s._id)}'), 'une pastille par séance de la semaine');
	assert.ok(panel.includes('trainingStatus(s, today)'), 'statut calculé par la lib partagée');
	assert.ok(panel.includes('TRAINING_STATUS_LABELS[statusOf(s)]'), 'libellé du statut');
	for (const tone of ['done:', 'notDone:', 'missed:', 'planned:', 'cancelled:']) {
		assert.ok(panel.includes(tone), `style de statut présent : ${tone}`);
	}
	assert.ok(/cancelled: '[^']*line-through/.test(panel), 'annulée barrée');
	assert.ok(panel.includes('uppercase tracking-wide text-ink'), 'nom de séance en majuscules');
	assert.ok(panel.includes('{fmtDay(s.date)}'), 'jour affiché dans la pastille');
	assert.ok(panel.includes('durationLabel(s)') && panel.includes('Effort {s.difficulty}/5'), 'durée + effort sur une réalisée');
});

/* ─── 5) Actions et sections conservées ─── */

test('Déplacer / Dupliquer / Annuler restent accessibles depuis le détail', () => {
	for (const label of ['Déplacer', 'Dupliquer', 'Annuler']) {
		assert.ok(panel.includes(`>${label}</button>`), `action ${label} présente`);
	}
	assert.ok(panel.includes('moveFor = s; moveDate = s.date'), 'déplacement : logique inchangée');
	assert.ok(panel.includes('dupFor = s; dupDate = s.date'), 'duplication : logique inchangée');
	assert.ok(panel.includes('cancelOccurrence(s, true)') && panel.includes('cancelOccurrence(s, false)'), 'annulation/restauration');
	assert.ok(panel.includes('{#if openNote === s._id}'), 'détail déplié sous la pastille');
	assert.ok(panel.includes('{s.note}'), 'note de la cliente dans le détail');
	// Sections T1 / T4 conservées telles quelles.
	assert.ok(panel.includes('Retours de la cliente'), 'section Retours conservée');
	assert.ok(panel.includes('Charges & progression par exercice'), 'section Charges conservée');
	// En-tête : nom, période, semaine X sur Y, réalisées/passées, adhérence.
	assert.ok(panel.includes('{summary.active.programName}'), 'nom du programme');
	assert.ok(panel.includes('Du <strong>{fmtISO(summary.active.startDate)}</strong> au'), 'période du programme');
	assert.ok(panel.includes('sur {weekGroups.length'), 'semaine X sur Y');
	assert.ok(panel.includes('{adherence.done}') && panel.includes('{adherence.past}'), 'réalisées / passées');
	assert.ok(panel.includes('{adherence.percent == null'), 'adhérence en %');
	// Aucune longue liste « Séances planifiées » ne subsiste.
	assert.ok(!panel.includes('Séances planifiées ('), 'ancienne liste remplacée par la vue par semaine');
});
