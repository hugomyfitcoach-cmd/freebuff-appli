/**
 * Tests de COMPORTEMENT — MISSION CRM-POLISH-A (côté coach) :
 *  - carte « rendez-vous restants » du tableau de bord : RDV passé / en cours /
 *    à venir / aucun restant, et bascule au changement de minute ;
 *  - photos de suivi côté coach : ordre décroissant (récentes en haut).
 *
 * Aucune assertion sur le texte source : on exerce les modules purs.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const agendaMod = await import(new URL('../src/lib/dashAppointments.ts', import.meta.url).href);
const photosMod = await import(new URL('../src/lib/photos.ts', import.meta.url).href);

const { dayAgenda, rdvEndMs } = agendaMod;
const { sortPhotosNewestFirst } = photosMod;

/* Jour de référence : 5 novembre 2026 (heure LOCALE, comme la page Rendez-vous). */
const DAY = '2026-11-05';
const at = (h, m, s = 0) => new Date(2026, 10, 5, h, m, s, 0).getTime();

const rdv = (over = {}) => ({
	_id: `rdv-${over.time ?? '15:00'}`,
	date: DAY,
	time: '15:00',
	endTime: '15:15',
	kind: 'Suivi',
	clientName: 'Nina',
	...over
});

/* ═══════════ CARTE « RENDEZ-VOUS RESTANTS » ═══════════ */

test('RDV passé : aucun restant, aucun en cours, aucun prochain (terminé)', () => {
	const a = dayAgenda([rdv({ time: '15:00', endTime: '15:15' })], at(16, 30));
	assert.equal(a.today.length, 1, 'le RDV reste compté dans la journée');
	assert.equal(a.remaining.length, 0, 'plus aucun rendez-vous restant');
	assert.equal(a.inProgress, null, 'aucun rendez-vous en cours');
	assert.equal(a.next, null, 'aucun prochain rendez-vous');
});

test('RDV en cours : compté dans les restants et signalé « en cours »', () => {
	const r = rdv({ time: '15:00', endTime: '15:15' });
	const a = dayAgenda([r], at(15, 5));
	assert.equal(a.remaining.length, 1, 'un rendez-vous restant');
	assert.equal(a.inProgress?.time, '15:00', 'le rendez-vous en cours est celui qui a commencé');
	assert.equal(a.next, null, 'pas de « prochain » quand un RDV est en cours');
});

test('RDV à venir : restant mais pas en cours, « prochain » = le premier de la journée', () => {
	const a = dayAgenda([rdv({ time: '15:00', endTime: '15:15' }), rdv({ time: '18:45', endTime: '19:45', kind: 'Démarrage' })], at(14, 0));
	assert.equal(a.remaining.length, 2, 'les deux rendez-vous sont à venir');
	assert.equal(a.inProgress, null, 'rien en cours');
	assert.equal(a.next?.time, '15:00', 'le prochain est le plus tôt de la journée');
});

test('Aucun restant : le dernier RDV se termine à l’instant courant', () => {
	assert.equal(dayAgenda([rdv({ time: '15:00', endTime: '15:15' })], at(15, 14, 30)).remaining.length, 1);
	assert.equal(dayAgenda([rdv({ time: '15:00', endTime: '15:15' })], at(15, 15)).remaining.length, 0);
});

test('Aucun RDV aujourd’hui : journée vide (état « aucun rendez-vous »)', () => {
	const a = dayAgenda([rdv({ date: '2026-11-04' })], at(10, 0));
	assert.equal(a.today.length, 0);
	assert.equal(a.remaining.length, 0);
	assert.equal(a.inProgress, null);
	assert.equal(a.next, null);
});

test('Changement de minute : à venir → en cours → terminé, sans recharger les données', () => {
	const items = [rdv({ time: '15:00', endTime: '15:15' })];
	// 14:59 — le RDV est encore à venir.
	const avant = dayAgenda(items, at(14, 59));
	assert.equal(avant.inProgress, null);
	assert.equal(avant.next?.time, '15:00');
	// 15:00 — la minute suivante le passe en cours.
	const pendant = dayAgenda(items, at(15, 0));
	assert.equal(pendant.inProgress?.time, '15:00');
	assert.equal(pendant.next, null);
	// 15:15 — la fin du créneau le retire des restants.
	const apres = dayAgenda(items, at(15, 15));
	assert.equal(apres.inProgress, null);
	assert.equal(apres.remaining.length, 0);
	assert.equal(apres.next, null);
});

test('Durée = heure de début + durée : barème du type quand endTime manque', () => {
	// Suivi = 15 min, Démarrage = 60 min (mêmes règles que le planning).
	assert.equal(rdvEndMs({ _id: 'a', date: DAY, time: '09:00', kind: 'Suivi' }) - new Date(2026, 10, 5, 9, 0).getTime(), 15 * 60_000);
	assert.equal(rdvEndMs({ _id: 'b', date: DAY, time: '09:00', kind: 'Démarrage' }) - new Date(2026, 10, 5, 9, 0).getTime(), 60 * 60_000);
	const demarrage = [rdv({ time: '09:00', endTime: undefined, kind: 'Démarrage' })];
	assert.equal(dayAgenda(demarrage, at(9, 59)).remaining.length, 1, 'un Démarrage de 60 min court encore à 09:59');
	assert.equal(dayAgenda(demarrage, at(10, 0)).remaining.length, 0, 'terminé à 10:00');
});

test('Fin de créneau explicite prioritaire sur le barème du type', () => {
	// Un « Démarrage » saisi 10:00 → 11:30 reste compté à 11:00.
	const items = [rdv({ time: '10:00', endTime: '11:30', kind: 'Démarrage' })];
	assert.equal(dayAgenda(items, at(11, 0)).remaining.length, 1);
	assert.equal(dayAgenda(items, at(11, 30)).remaining.length, 0);
});

/* ═══════════ PHOTOS DE SUIVI — ORDRE DÉCROISSANT ═══════════ */

test('Photos : les plus récentes en haut, les plus anciennes (Démarrage) en bas', () => {
	const demarrage = { _id: 'p1', step: 'demarrage', date: '2026-01-10', createdAt: 1000 };
	const mois1 = { _id: 'p2', step: 'mois1', date: '2026-02-10', createdAt: 2000 };
	const mois2 = { _id: 'p3', step: 'mois2', date: '2026-03-10', createdAt: 3000 };
	const sorted = sortPhotosNewestFirst([demarrage, mois1, mois2]);
	assert.deepEqual(sorted.map((p) => p._id), ['p3', 'p2', 'p1']);
	assert.equal(sorted[sorted.length - 1].step, 'demarrage', 'le Démarrage termine la liste');
});

test('Photos : tri par date de réception décroissante (pas par ordre d’arrivée dans la liste)', () => {
	const rows = [
		{ _id: 'vieux', date: '2026-09-01', createdAt: 1_700_000_000_000 },
		{ _id: 'recent', date: '2026-09-02', createdAt: 1_800_000_000_000 },
		{ _id: 'milieu', date: '2026-09-03', createdAt: 1_750_000_000_000 }
	];
	assert.deepEqual(sortPhotosNewestFirst(rows).map((p) => p._id), ['recent', 'milieu', 'vieux']);
});

test('Photos : égalité d’horodatage départagée par la date de dépôt, liste d’origine intacte', () => {
	const rows = [
		{ _id: 'a', date: '2026-01-10', createdAt: 500 },
		{ _id: 'b', date: '2026-03-10', createdAt: 500 }
	];
	assert.deepEqual(sortPhotosNewestFirst(rows).map((p) => p._id), ['b', 'a']);
	assert.deepEqual(rows.map((p) => p._id), ['a', 'b'], 'la liste reçue n’est jamais modifiée');
});
