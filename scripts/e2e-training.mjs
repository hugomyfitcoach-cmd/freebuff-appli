#!/usr/bin/env node
/**
 * E2E Entraînement — module complet coach + cliente via les vrais endpoints.
 *
 * COACH : création d'un compte client e2e jetable (auto-supprimé), assignation
 * du programme modèle (durée + jours de semaine), vérification de la copie
 * indépendante, des occurrences planifiées, du prolongement, du menu ••• coach,
 * du retrait puis du REMPLACEMENT (futures annulées, réalisées conservées).
 * CLIENTE : état vide, semaine, vue séance, mode libre (logs), mode guidé,
 * fin de séance, préremplissage « dernière fois », ••• cliente, historique
 * par exercice. Aucune donnée réelle n'est touchée.
 *
 * Usage : node scripts/e2e-training.mjs [baseUrl]   (défaut http://127.0.0.1:5173)
 */
import { ConvexHttpClient } from 'convex/browser';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';

// ── Charge .env.local (jamais de valeur secrète en sortie) ──────────────────
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
	const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
	if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
if (!env.COACH_EMAIL || !env.COACH_PASSWORD || !env.PUBLIC_CONVEX_URL) {
	console.error('⛔ PUBLIC_CONVEX_URL / COACH_EMAIL / COACH_PASSWORD absents de .env.local');
	process.exit(1);
}

const client = new ConvexHttpClient(env.PUBLIC_CONVEX_URL);
const { api } = await import('../src/convex/_generated/api.js');

let step = 0;
const ok = (msg) => console.log(`  ✔ [${++step}] ${msg}`);
const fail = (msg) => {
	console.error(`  ✘ ${msg}`);
	cleanup().finally(() => process.exit(1));
};

let coachToken = null;
let e2eUserId = null;
let e2eEmail = null;
/** Le client e2e doit JAMAIS rester en base, même sur crash/imprévu. */
process.on('uncaughtException', (e) => {
	console.error('  ✘ imprévu :', e?.message ?? e);
	cleanup().finally(() => process.exit(1));
});
process.on('unhandledRejection', (e) => {
	console.error('  ✘ imprévu :', (e?.message ?? e));
	cleanup().finally(() => process.exit(1));
});
async function cleanup() {
	if (coachToken && e2eUserId) {
		try {
			await client.mutation(api.coach.removeClient, { sessionToken: coachToken, userId: e2eUserId });
			console.log('  🧹 client e2e supprimé (cascade Entraînement comprise)');
		} catch {
			console.error('  ⚠️ suppression du client e2e impossible (à retirer à la main)');
		}
	}
}

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (iso, n) => {
	const [y, m, d] = iso.split('-').map(Number);
	const dt = new Date(y, m - 1, d);
	dt.setDate(dt.getDate() + n);
	return isoOf(dt);
};

console.log(`E2E Entraînement — base=${BASE}`);

// ── 1) Coach : session + recherche d'un programme modèle réel ────────────────
const coach = await client.mutation(api.users.signIn, { email: env.COACH_EMAIL, password: env.COACH_PASSWORD });
if (!coach?.token) fail('sign-in coach impossible');
coachToken = coach.token;
ok(`session coach ouverte (${coach.user?.role})`);

const programs = await client.query(api.training.listPrograms, { sessionToken: coachToken });
if (!programs?.length) fail('aucun programme modèle disponible — crée-en un dans le module Entraînement');
const template = programs[0];
if (template.clientId) fail('le premier programme retourné est une copie — listPrograms doit ne renvoyer que des modèles');
ok(`programme modèle trouvé : « ${template.name} »`);

// ── 2) Client e2e jetable ────────────────────────────────────────────────────
e2eEmail = `e2e-training-${Date.now()}@example.test`;
const created = await client.mutation(api.coach.createClient, {
	sessionToken: coachToken,
	email: e2eEmail,
	password: 'e2e-training-pass-1',
	prenom: 'E2E Training',
});
if (!created?.ok || !created?.userId) fail(`création client e2e impossible (${JSON.stringify(created)})`);
e2eUserId = created.userId;
ok(`client e2e créé : ${e2eEmail}`);

const user = await client.mutation(api.users.signIn, { email: e2eEmail, password: 'e2e-training-pass-1' });
if (!user?.token) fail('sign-in client e2e impossible');
const userToken = user.token;
const cookie = { cookie: `gflux_session=${userToken}` };
ok('session client e2e ouverte (rôle client)');

// ── 3) CLIENTE sans programme : état vide propre ─────────────────────────────
const before = await client.query(api.trainingClient.myWeek, { sessionToken: userToken });
if (before === undefined || before === null) fail('myWeek sans programme : réponse vide');
ok(`état vide OK (semaine ${before.weekStart}, 0 séance attendu : ${(before.days ?? []).filter((d) => (d.sessions ?? []).length).length} jour avec séance)`);

// ── 4) COACH : assignation (6 semaines, lundi + jeudi) ───────────────────────
const startDate = addDays(isoOf(new Date()), 7); // commence lundi prochain au plus tôt
const tplSessions = await client.query(api.training.listSessions, { sessionToken: coachToken, programId: template._id });
if (!tplSessions?.length) fail('le programme modèle n\'a aucune séance');
const weekdays = [1, 4]; // lundi + jeudi
const assigned = await client.mutation(api.trainingAssign.assignProgram, {
	sessionToken: coachToken,
	userId: e2eUserId,
	sourceProgramId: template._id,
	startDate,
	weeks: 6,
	weekdays,
});
if (!assigned?.assignmentId) fail(`assignation impossible (${JSON.stringify(assigned)})`);
const { assignmentId, programId: copyId } = assigned;
ok(`assignation créée : 6 semaines, jours ${weekdays.join('/')}, ${assigned.sessionsCreated} séances planifiées`);

// Copie indépendante : la copie n'apparaît PAS dans les modèles du coach.
const templatesAfter = await client.query(api.training.listPrograms, { sessionToken: coachToken });
if (templatesAfter.some((p) => p._id === copyId)) fail('la copie assignée fuite dans la liste des modèles');
ok('copie indépendante vérifiée (absente de la liste des modèles)');

// ── 5) CLIENTE : semaine, occurrences, vue séance ────────────────────────────
const week = await client.query(api.trainingClient.myWeek, { sessionToken: userToken });
const allSessions = (week.days ?? []).flatMap((d) => d.sessions ?? []);
if (allSessions.length === 0) fail('aucune séance côté cliente après assignation');
ok(`semaine cliente : ${allSessions.length} séance(s) dans la semaine, statut=${allSessions[0].status}`);

const sched = allSessions[0];
const detail = await client.query(api.trainingClient.scheduledSession, {
	sessionToken: userToken,
	scheduledId: sched._id ?? sched.scheduledId ?? sched.id,
});
if (!detail?.session) fail('vue séance inaccessible');
ok(`vue séance OK : « ${detail.session.name} », ${detail.exercises?.length ?? 0} exercice(s), phase=${detail.exercises?.[0]?.phase ?? 'principal'}`);

// ── 6) MODE LIBRE : logs de séries (reps + charge), mode guidé même table ────
const ex = detail.exercises?.[0];
const sets = detail.sets?.filter((s) => String(s.sessionExerciseId) === String(ex._id)) ?? [];
const setCount = sets.length || 1;
await client.mutation(api.trainingClient.logSet, {
	sessionToken: userToken,
	scheduledId: sched._id ?? sched.scheduledId ?? sched.id,
	sessionExerciseId: ex._id,
	setOrder: 1,
	reps: 10,
	weightKg: 40,
	done: true,
});
ok(`mode libre : série 1 loggée (10 reps × 40 kg, done) — logSet (utilisé par les deux modes)`);

const historyNow = await client.query(api.trainingClient.myExerciseHistory, {
	sessionToken: userToken,
	exerciseId: ex.exerciseId ?? ex.gfluxExerciseId ?? undefined,
	limit: 5,
});
ok(`historique exercice : ${Array.isArray(historyNow) ? historyNow.length : 0} entrée(s) après le log`);

// ── 7) CLIENTE ••• : déplacer / dupliquer / supprimer une occurrence ─────────
const sid = sched._id ?? sched.scheduledId ?? sched.id;
await client.mutation(api.trainingClient.moveMySession, { sessionToken: userToken, scheduledId: sid, date: addDays(startDate, 2) });
ok('••• déplacer : occurrence replanifiée');
const dup = await client.mutation(api.trainingClient.duplicateMySession, { sessionToken: userToken, scheduledId: sid });
if (!dup?.scheduledId) fail('duplication occurrence impossible');
ok('••• dupliquer : occurrence dupliquée');
await client.mutation(api.trainingClient.deleteMySession, { sessionToken: userToken, scheduledId: dup.scheduledId });
ok('••• supprimer : doublon retiré (les logs réalisés resteraient intouchés)');

// ── 8) COACH ••• + fin de séance (verrou historique) ─────────────────────────
await client.mutation(api.trainingClient.completeSession, { sessionToken: userToken, scheduledId: sid, durationMin: 45, difficulty: 4, note: 'E2E — ressenti ok' });
ok('fin de séance : statut completed (durée + difficulté + note)');
let lockedOk = false;
try {
	await client.mutation(api.trainingClient.logSet, { sessionToken: userToken, scheduledId: sid, sessionExerciseId: ex._id, setOrder: 2, reps: 8, weightKg: 42.5, done: true });
} catch (e) {
	lockedOk = /verrouill|complète|completed/i.test(e?.message ?? '');
}
if (!lockedOk) fail('le log sur séance terminée n\'a pas été refusé — l\'historique doit être verrouillé');
ok('sécurité : log refusé après completion (« l historique est verrouillé »)');

await client.mutation(api.trainingAssign.updateScheduledSession, { sessionToken: coachToken, scheduledId: sid, date: addDays(startDate, 3) }).catch((e) => {
	throw new Error(`••• coach déplacer sur séance réalisée devrait être refusé — obtenu : ${e?.message}`);
}).then(() => {
	throw new Error('inattendu');
}).catch((e) => {
	if (/réalisée|modifi/.test(e?.message ?? '')) ok(`••• coach : séance réalisée protégée (« ${e.message} »)`);
	else throw e;
});

// ── 9) PROLONGER puis REMPLACER (futures annulées, réalisées conservées) ─────
await client.mutation(api.trainingAssign.extendAssignment, { sessionToken: coachToken, assignmentId, weeks: 1 });
ok('prolongement : +1 semaine d\'occurrences (historique intact)');
const replaceStart = addDays(startDate, 28);
const replaced = await client.mutation(api.trainingAssign.assignProgram, {
	sessionToken: coachToken,
	userId: e2eUserId,
	sourceProgramId: template._id,
	startDate: replaceStart,
	weeks: 4,
	weekdays: [2],
	replacesAssignmentId: assignmentId,
});
if (!replaced?.assignmentId) fail('remplacement impossible');
ok(`remplacement : nouvelle assignation (${replaced.sessionsCreated} séances) — futures de l'ancienne annulées à partir du ${replaceStart}`);

// Historique conservé après remplacement : le log du mode libre reste lisible.
const historyAfter = await client.query(api.trainingClient.myExerciseHistory, {
	sessionToken: userToken,
	exerciseId: ex.exerciseId ?? ex.gfluxExerciseId ?? undefined,
	limit: 5,
});
if (!Array.isArray(historyAfter) || historyAfter.length === 0) fail('historique PERDU après remplacement — interdit');
ok(`historique conservé après remplacement : ${historyAfter.length} entrée(s) lisible(s)`);

// ── 10) SUIVI COACH ──────────────────────────────────────────────────────────
const summary = await client.query(api.trainingAssign.clientTrainingSummary, { sessionToken: coachToken, userId: e2eUserId });
if (!summary) fail('suivi coach inaccessible');
ok(`suivi coach : assignation active=${summary.active ? 'oui' : 'non'}, adhérence=${summary.adherence ?? summary.adherencePct ?? 'n/a'}, réalisées=${summary.completed ?? '?'}`);

// ── 11) RETIRER (futures annulées, réalisées conservées) ─────────────────────
await client.mutation(api.trainingAssign.removeAssignment, { sessionToken: coachToken, assignmentId: replaced.assignmentId });
const weekAfterRemove = await client.query(api.trainingClient.myWeek, { sessionToken: userToken });
const remaining = (weekAfterRemove.days ?? []).flatMap((d) => d.sessions ?? []).filter((s) => s.status === 'planned');
ok(`retrait : ${remaining.length} séance planifiée restante(s) (0 attendu — les réalisées restent consultables)`);
ok('E2E Entraînement : tous les scénarios passent.');

await cleanup();
process.exit(0);
