/**
 * Tests MISSION T2 — alerte coach 5 jours avant la fin d'un programme.
 *
 * Règle : le tick existant `notifications-tick` (toutes les 30 min, aucun
 * nouveau cron) crée UNE notification coach par assignation NON retirée dont
 * la date de fin tombe entre aujourd'hui et aujourd'hui + 5 jours (Europe/
 * Paris) — dedupKey « programme_fin_proche:<assignmentId>:<endDate> ». Aucun
 * envoi à la cliente.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	PROGRAM_END_SOON_DAYS,
	programEndAlerts,
	programEndDedupKey,
	programEndDescription,
	fmtProgramEndDate,
} from '../src/lib/programEnd.ts';
import { notifLabel, notifStyle, notifLink } from '../src/lib/notifications.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/** Lundi 26 octobre 2026 (Europe/Paris). */
const TODAY = '2026-10-26';
const assignment = (over = {}) => ({ _id: 'asg1', endDate: '2026-10-31', removedAt: null, ...over });

/* ─── 1) Fenêtre de 5 jours ─── */

test('fin dans 5 jours → une notification ; aujourd’hui compte aussi', () => {
	assert.equal(PROGRAM_END_SOON_DAYS, 5);
	const alerts = programEndAlerts([assignment({ endDate: '2026-10-31' })], TODAY);
	assert.equal(alerts.length, 1);
	assert.equal(alerts[0].assignmentId, 'asg1');
	assert.equal(alerts[0].endDate, '2026-10-31');
	assert.equal(alerts[0].dedupKey, 'programme_fin_proche:asg1:2026-10-31');
	// La borne basse (fin aujourd'hui) alerte aussi : le coach doit préparer la suite.
	assert.equal(programEndAlerts([assignment({ endDate: TODAY })], TODAY).length, 1);
});

test('fin dans 6 jours → aucune notification', () => {
	assert.equal(programEndAlerts([assignment({ endDate: '2026-11-01' })], TODAY).length, 0);
});

/* ─── 2) Anti-doublon et prolongation ─── */

test('deuxième passage → pas de doublon (même clé déjà enregistrée)', () => {
	const rows = [assignment({ endDate: '2026-10-31' })];
	const first = programEndAlerts(rows, TODAY);
	assert.equal(first.length, 1);
	const second = programEndAlerts(rows, TODAY, [first[0].dedupKey]);
	assert.equal(second.length, 0, 'la clé programme+date de fin est réutilisée → aucun second insert');
	// Clé stable d'un passage à l'autre (même programme, même date de fin).
	assert.equal(programEndDedupKey('asg1', '2026-10-31'), first[0].dedupKey);
});

test('programme retiré → aucune notification', () => {
	const removed = [assignment({ endDate: '2026-10-31', removedAt: Date.now() })];
	assert.equal(programEndAlerts(removed, TODAY).length, 0);
	// Retirée puis réassignée (nouvelle ligne) : la nouvelle alerte reste possible.
	assert.equal(programEndAlerts([assignment({ _id: 'asg2' })], TODAY).length, 1);
});

test('prolongation (nouvelle endDate) → nouvelle notification possible le moment venu', () => {
	const before = programEndAlerts([assignment({ endDate: '2026-10-31' })], TODAY);
	assert.equal(before.length, 1);
	const prolonged = [assignment({ endDate: '2026-11-10' })];
	// Programme prolongé : plus dans la fenêtre des 5 jours, aucune alerte maintenant.
	assert.equal(programEndAlerts(prolonged, TODAY, [before[0].dedupKey]).length, 0);
	// 5 jours avant la NOUVELLE fin : une alerte naît, malgré l'ancienne clé déjà posée.
	const later = programEndAlerts(prolonged, '2026-11-05', [before[0].dedupKey]);
	assert.equal(later.length, 1);
	assert.equal(later[0].dedupKey, 'programme_fin_proche:asg1:2026-11-10');
	assert.notEqual(later[0].dedupKey, before[0].dedupKey);
});

/* ─── 3) Texte et lien ─── */

test('texte : « Le programme de <Prénom> se termine le <jour JJ mois> — prépare la suite. »', () => {
	assert.equal(fmtProgramEndDate('2026-10-31'), 'samedi 31 octobre');
	assert.equal(
		programEndDescription('Léa', '2026-10-31'),
		'Le programme de Léa se termine le samedi 31 octobre — prépare la suite.'
	);
});

test('un clic ouvre l’onglet Entraînement de la fiche cliente', () => {
	assert.equal(notifLink('user123', 'programme_fin_proche'), '/admin?client=user123&section=entrainement');
});

/* ─── 4) Type déclaré dans les deux listes + branchement du tick ─── */

test('le type programme_fin_proche existe dans coachNotifKind ET dans son miroir', () => {
	const schema = read('src/convex/schema.ts');
	const unionSchema = schema.slice(schema.indexOf('export const coachNotifKind'), schema.indexOf('export default defineSchema'));
	assert.ok(unionSchema.includes('v.literal("programme_fin_proche")'), 'liste fermée Convex');

	const lib = read('src/lib/notifications.ts');
	const unionLib = lib.slice(lib.indexOf('export type CoachNotifKind'), lib.indexOf('/** Section de la Vision 360'));
	assert.ok(unionLib.includes("| 'programme_fin_proche'"), 'type miroir client');
	// Libellé, icône existante et couleur cohérente (brand, comme les autres
	// événements d’entraînement/plan).
	assert.equal(notifLabel('programme_fin_proche'), 'Fin de programme proche');
	assert.deepEqual(notifStyle('programme_fin_proche'), {
		icon: 'dumbbell',
		text: 'text-brand-dark',
		bg: 'bg-brand-light',
	});
});

test('tick : alertes créées par recordEvent avec dedupKey, jamais côté cliente', () => {
	const notif = read('src/convex/notifications.ts');
	const block = notif.slice(notif.indexOf("Fin de programme d'entraînement proche"), notif.indexOf('Purge : notifications trop anciennes'));
	assert.ok(block.includes('programEndAlerts'), 'fenêtre des 5 jours via le helper partagé');
	assert.ok(block.includes('if (a.removedAt) continue;'), 'assignations retirées exclues');
	assert.ok(block.includes('client.disabled'), 'clientes désactivées exclues');
	assert.ok(block.includes('.withIndex("by_dedup"'), 'garde anti-doublon relue en base');
	assert.ok(block.includes('dedupKey: alert.dedupKey'), 'clé programme+date de fin transmise');
	assert.ok(block.includes('"programme_fin_proche"') && block.includes('programEndDescription'), 'type et texte dédiés');
	assert.ok(!block.includes('recordClientEvent'), 'aucun événement envoyé à la cliente');
	// recordEvent sait porter la dedupKey (colonne existante du journal coach).
	assert.ok(notif.includes('dedupKey?: string;'), 'option dedupKey exposée');
	assert.ok(notif.includes('...(opts?.dedupKey ? { dedupKey: opts.dedupKey } : {})'), 'dedupKey enregistrée');
});
