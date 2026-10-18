/**
 * Mission NOTIFICATIONS COHÉRENTES — badge de la barre du bas (/api/live) et
 * cartes de l'Accueil (getDashboard) se mettent à jour sur le même signal.
 *
 * Correction verrouillée ici :
 * 1. RÈGLES DE FRAÎCHEUR UNIQUES (lib/notificationFreshness) : msgFresh,
 *    non-lu retours et non-lu Drive définis une seule fois, partagés entre
 *    getDashboard et notificationCounts — les deux surfaces ne peuvent plus
 *    diverger (audit iPhone : badge « 1 » mais carte « Ton coach » absente) ;
 * 2. TYPES 2/3/4 (événements coach) : chaque mutation concernée émet un
 *    recordClientEvent dédié (message, retour, Drive — publication ET retrait)
 *    que l'Accueil traite dans onLiveEvent pour rafraîchir la carte ;
 * 3. TYPES 1/5 (liés à une heure) : état exposé dans /api/live (bilanDue,
 *    reminder) et l'Accueil se rafraîchit à la transition false → true ;
 * 4. INVARIANTS : polling 30 s conservé, cache no-store conservé, état
 *    « Données momentanément indisponibles » de l'Accueil conservé.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	coachMessageFresh,
	coachMessageUnread,
	driveUnreadCount,
	isUnreadFeedback,
} from '../src/lib/notificationFreshness';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const dashboard = read('src/convex/dashboard.ts');
const coach = read('src/convex/coach.ts');
const resources = read('src/convex/resources.ts');
const live = read('src/routes/api/live/+server.ts');
const poll = read('src/lib/notificationPoll.ts');
const home = read('src/routes/espace/+page.svelte');

/* ══════════ 1. Règles de fraîcheur partagées (unitaires) ══════════ */

const H = 3600 * 1000;

test('Fraîcheur message : expiration stricte, repli 24 h, repli jour', () => {
	// Horodatage d'expiration : strictement avant l'expiration.
	assert.equal(coachMessageFresh({ coachMessageExpiresAt: 1000 }, 999, '2026-01-01'), true);
	assert.equal(coachMessageFresh({ coachMessageExpiresAt: 1000 }, 1000, '2026-01-01'), false);
	// Publication horodatée sans expiration : moins de 24 h.
	assert.equal(coachMessageFresh({ coachMessageAt: 1000 }, 23 * H, '2026-01-01'), true);
	assert.equal(coachMessageFresh({ coachMessageAt: 1000 }, 25 * H, '2026-01-01'), false);
	// Ancien format : jour exact.
	assert.equal(coachMessageFresh({ coachMessageDate: '2026-01-01' }, 5 * H, '2026-01-01'), true);
	assert.equal(coachMessageFresh({ coachMessageDate: '2026-01-01' }, 5 * H, '2026-01-02'), false);
});

test('Non-lu message : « Vu » consomme le non-lu, message non daté jamais non lu', () => {
	const base = { coachMessageAt: 1000, coachMessageExpiresAt: 10 * H };
	assert.equal(coachMessageUnread(base, 5 * H, '2026-01-01'), true);
	// Marqué « Vu » après la publication → plus non lu.
	assert.equal(coachMessageUnread({ ...base, coachMessageReadAt: 2000 }, 5 * H, '2026-01-01'), false);
	// Sans horodatage de publication : jamais non lu.
	assert.equal(coachMessageUnread({ coachMessageDate: '2026-01-01' }, 5 * H, '2026-01-01'), false);
	// Périmé : jamais non lu.
	assert.equal(coachMessageUnread({ coachMessageAt: 1000 }, 25 * H, '2026-01-01'), false);
});

test('Non-lu retour de bilan : publication non consultée, re-publication relance', () => {
	const c = { status: 'retour_envoye', _creationTime: 0 };
	assert.equal(isUnreadFeedback(c), true);
	// Consulté après la publication → lu.
	assert.equal(isUnreadFeedback({ ...c, feedbackAt: 100, feedbackReadAt: 200 }), false);
	// Re-publication (feedbackAt postérieur à la lecture) → non lu à nouveau.
	assert.equal(isUnreadFeedback({ ...c, feedbackAt: 300, feedbackReadAt: 200 }), true);
	// Brouillon : jamais compté.
	assert.equal(isUnreadFeedback({ status: 'nouveau', feedbackAt: 300, _creationTime: 0 }), false);
});

test('Non-lu Drive : uniquement les partagés après la consultation', () => {
	const rows = [
		{ visibility: 'shared', sharedAt: 500 }, // nouveau
		{ visibility: 'shared', sharedAt: 100 }, // déjà vu
		{ visibility: 'private', sharedAt: 900 }, // privé : jamais compté
		{ visibility: 'shared' }, // jamais partagé : jamais compté
	];
	assert.equal(driveUnreadCount(rows, 200), 1);
	assert.equal(driveUnreadCount(rows, null), 2); // jamais consulté : tout le partagé
	assert.equal(driveUnreadCount(rows, 1000), 0);
});

/* ══════════ Harmonisation getDashboard ↔ notificationCounts ══════════ */

test('Fraîcheur harmonisée : les DEUX requêtes utilisent les helpers partagés', () => {
	// getDashboard ET notificationCounts appellent les mêmes règles.
	assert.ok(dashboard.includes('const msgFresh = coachMessageFresh(user, ts, day);'), 'getDashboard : coachMessageFresh');
	assert.ok(dashboard.includes('message: coachMessageUnread(user, ts, day) ? 1 : 0,'), 'getDashboard badge message');
	assert.ok(dashboard.includes('const message = coachMessageUnread(user, ts, day) ? 1 : 0;'), 'notificationCounts message');
	assert.equal(dashboard.split('isUnreadFeedback)').length - 1, 2, 'isUnreadFeedback utilisé par les deux requêtes');
	assert.equal(dashboard.split('driveUnreadCount(').length - 1, 2, 'driveUnreadCount utilisé par les deux requêtes');
	assert.equal(dashboard.split('appointmentReminderOf(').length - 1, 3, 'rappel 12 h : 1 définition + 2 usages');
	// Aucune définition locale dupliquée ne subsiste.
	assert.ok(!dashboard.includes('MSG_TTL_MS'), 'plus de MSG_TTL_MS local dans dashboard.ts');
	// Les clés du badge sont de VRAIES clés (jamais collées à la fin d'un
	// commentaire « // » qui les commenterait — piège déjà rencontré).
	assert.match(dashboard, /^[ \t]*drive: driveUnreadCount\(/m, 'clé drive hors commentaire');
	assert.match(dashboard, /^[ \t]*message: coachMessageUnread\(/m, 'clé message hors commentaire');
});

/* ══════════ Type 2 — message du coach ══════════ */

test('Type 2 : publication ET retrait du message émettent recordClientEvent', () => {
	assert.ok(
		dashboard.includes('recordClientEvent(ctx, userId, "coach_message",'),
		'setCoachMessage (publication) émet coach_message'
	);
	assert.equal(
		dashboard.split('recordClientEvent(ctx, userId, "coach_message_removed");').length - 1,
		2,
		'setCoachMessage (vidage) ET withdrawCoachBroadcast émettent coach_message_removed'
	);
	assert.ok(
		dashboard.includes('recordClientEvent(ctx, u._id, "coach_message", b.text);'),
		'stampBroadcastToClient émet coach_message'
	);
});

/* ══════════ Type 3 — retours de bilan ══════════ */

test('Type 3 : setFeedback émet feedback_published / feedback_withdrawn', () => {
	assert.ok(
		coach.includes('recordClientEvent(ctx, checkin.userId, "feedback_published", checkin.weekLabel);'),
		'publication du retour'
	);
	assert.ok(
		coach.includes('recordClientEvent(ctx, checkin.userId, "feedback_withdrawn", checkin.weekLabel);'),
		'retrait du retour'
	);
});

/* ══════════ Type 4 — dépôt dans le Drive ══════════ */

test('Type 4 : partage / retrait / suppression du Drive émettent recordClientEvent', () => {
	assert.ok(resources.includes('recordClientEvent(ctx, row.userId, "resource_shared", row.title);'), 'partage');
	assert.equal(
		resources.split('recordClientEvent(ctx, row.userId, "resource_unshared", row.title);').length - 1,
		2,
		'retour en privé ET suppression d’un contenu partagé émettent resource_unshared'
	);
	assert.ok(home.includes("badge: dash?.badges.drive ?? 0 }"), 'chip Drive de l’Accueil branché sur le non-lu');
});

/* ══════════ Types 1 & 5 — notifications liées à une heure ══════════ */

test('Type 1 : fenêtre du bilan exposée dans /api/live, rafraîchie à false → true', () => {
	assert.ok(
		dashboard.includes('isBilanWindowOpen(new Date(ts))'),
		'notificationCounts calcule bilanDue (fenêtre ven. 9h → dim. 12h + non soumis)'
	);
	assert.ok(live.includes('bilanDue: counts.bilanDue,'), '/api/live expose bilanDue');
	assert.ok(poll.includes('!prevTimed?.bilanDue && timed.bilanDue'), 'transition false → true détectée');
	assert.ok(
		poll.includes("emitLiveEvent({ kind: 'bilan_due', label: null, createdAt: Date.now() });"),
		'événement bilan_due émis'
	);
	assert.ok(home.includes("'bilan_due'"), 'l’Accueil rafraîchit la carte sur bilan_due');
});

test('Type 5 : rappel 12 h exposé dans /api/live, rafraîchi à false → true', () => {
	assert.ok(
		dashboard.includes('const reminder = appointmentReminderOf(apptRows, ts, autonomy) !== null;'),
		'notificationCounts calcule le rappel 12 h'
	);
	assert.ok(live.includes('reminder: counts.reminder,'), '/api/live expose reminder');
	assert.ok(poll.includes('!prevTimed?.reminder && timed.reminder'), 'transition false → true détectée');
	assert.ok(
		poll.includes("emitLiveEvent({ kind: 'appointment_reminder', label: null, createdAt: Date.now() });"),
		'événement appointment_reminder émis'
	);
	assert.ok(home.includes("'appointment_reminder'"), 'l’Accueil rafraîchit la carte sur appointment_reminder');
});

/* ══════════ Invariants conservés ══════════ */

test('Invariants : polling 30 s, no-store, état « données indisponibles »', () => {
	assert.ok(poll.includes('const POLL_MS = 30_000;'), 'fréquence de polling 30 s inchangée');
	assert.ok(live.includes(`'cache-control': 'no-store'`), '/api/live reste no-store');
	assert.ok(home.includes('Données momentanément indisponibles'), 'état « données indisponibles » conservé');
	// L’Accueil traite bien TOUS les types d’événements sur le même signal.
	for (const kind of [
		'plan_assigned',
		'coach_message',
		'coach_message_removed',
		'feedback_published',
		'feedback_withdrawn',
		'resource_shared',
		'resource_unshared',
		'bilan_due',
		'appointment_reminder',
	]) {
		assert.ok(home.includes(`'${kind}'`), `Accueil gère l’événement ${kind}`);
	}
});
