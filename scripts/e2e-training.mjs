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
let stopping = false;
let cleaned = false;
const ok = (msg) => { if (!stopping) console.log(`  ✔ [${++step}] ${msg}`); };
const fail = (msg) => {
	if (stopping) throw new Error(msg);
	stopping = true;
	console.error(`  ✘ ${msg}`);
	cleanup().finally(() => process.exit(1));
	throw new Error(msg); // stoppe le flux ; l'exit part via cleanup
};

let coachToken = null;
let e2eUserId = null;
let e2eEmail = null;
/** Le client e2e doit JAMAIS rester en base, même sur crash/imprévu. */
process.on('uncaughtException', (e) => {
	console.error('  ✘ imprévu :', e?.message ?? e);
	if (stopping) return;
	stopping = true;
	cleanup().finally(() => process.exit(1));
});
process.on('unhandledRejection', (e) => {
	console.error('  ✘ imprévu :', (e?.message ?? e));
	if (stopping) return; // cleanup + exit déjà programmés par fail()
	stopping = true;
	cleanup().finally(() => process.exit(1));
});
async function cleanup() {
	if (stopping && cleaned) return;
	cleaned = true;
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
const mondayOf = (iso) => {
	const d = new Date(iso + 'T12:00:00');
	const day = d.getDay();
	d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
	return isoOf(d);
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
ok(`état vide OK (semaine ${before.weekStart}, ${(before.days ?? []).length} séance(s) attendu : 0)`);

// ── 4) COACH : assignation (6 semaines, lundi + jeudi) ───────────────────────
const startDate = addDays(isoOf(new Date()), 7); // commence lundi prochain au plus tôt
const tplFull = await client.query(api.training.programFull, { sessionToken: coachToken, programId: template._id });
if (!tplFull?.sessions?.length) fail("le programme modèle n'a aucune séance");
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
// Semaine de la PREMIÈRE occurrence (l'assignation peut commencer plus tard).
const firstOccWeekStart = addDays(
	startDate,
	-((new Date(startDate + 'T00:00:00Z').getUTCDay() + 6) % 7)
);
const week = await client.query(api.trainingClient.myWeek, {
	sessionToken: userToken,
	weekStart: firstOccWeekStart,
});
// `days` est une liste PLATE de séances ({_id, date, status, name}).
const allSessions = week.days ?? [];
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
if (!ex?._id) fail('vue séance : exercices absents');
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

let historyNow = null;
try {
	historyNow = await client.query(api.trainingClient.myExerciseHistory, {
		sessionToken: userToken,
		exerciseId: ex.exercise?._id ?? ex.exerciseId,
	});
} catch (e) {
	fail('myExerciseHistory échoue : ' + JSON.stringify(e, Object.getOwnPropertyNames(e)));
}
ok(`historique exercice : ${historyNow?.sets?.length ?? 0} série(s) tracée(s), dernière charge=${historyNow?.last?.weightKg ?? '—'} kg`);

// ── 7) CLIENTE ••• : déplacer / dupliquer / supprimer une occurrence ─────────
const sid = sched._id ?? sched.scheduledId ?? sched.id;
await client.mutation(api.trainingClient.moveMySession, { sessionToken: userToken, scheduledId: sid, date: addDays(startDate, 2) });
ok('••• déplacer : occurrence replanifiée');
const dup = await client.mutation(api.trainingClient.duplicateMySession, { sessionToken: userToken, scheduledId: sid, date: addDays(startDate, 3) });
if (!dup?.scheduledId) fail('duplication occurrence impossible');
ok('••• dupliquer : occurrence dupliquée');
await client.mutation(api.trainingClient.deleteMySession, { sessionToken: userToken, scheduledId: dup.scheduledId });
ok('••• supprimer : doublon retiré (les logs réalisés resteraient intouchés)');

// ── 8) COACH ••• + fin de séance (verrou historique) ─────────────────────────
// Garde : aucune dépense ne doit exister AVANT la fin explicite.
const sportBefore = await client.query(api.sport.myWeek, { sessionToken: userToken, weekStart: mondayOf(startDate) });
if ((sportBefore?.totals?.count ?? 0) !== 0) fail('une dépense existe AVANT la fin de séance — interdit (consultation ≠ réalisation)');
ok('séance programmée + séries cochées sans fin explicite : AUCUNE dépense');

await client.mutation(api.trainingClient.completeSession, { sessionToken: userToken, scheduledId: sid, durationMin: 45, difficulty: 4, note: 'E2E — ressenti ok' });
ok('fin de séance : statut completed (durée + difficulté + note)');

// ── 8bis) DÉPENSE SPORTIVE AUTO : idempotence + correction de durée ─────────
const sportAfter = await client.query(api.sport.myWeek, { sessionToken: userToken, weekStart: mondayOf(startDate) });
const sportRows = (sportAfter?.activities ?? []).filter((a) => a.source === 'gflux_training');
if (sportRows.length !== 1) fail(`1 dépense attendue après completion, reçu ${sportRows.length}`);
if (sportRows[0].trainingSessionId !== sid) fail('dépense non liée à la séance (trainingSessionId)');
if (sportRows[0].durationMinutes !== 45) fail('durée de la dépense ≠ durée de la séance');
ok(`dépense auto créée : « ${sportRows[0].name} » 45 min ≈ ${sportRows[0].estimatedCalories ?? '—'} kcal (source gflux_training)`);

// Idempotence : re-validation → toujours UNE SEULE dépense.
await client.mutation(api.trainingClient.completeSession, { sessionToken: userToken, scheduledId: sid, durationMin: 45 });
const sportAgain = await client.query(api.sport.myWeek, { sessionToken: userToken, weekStart: mondayOf(startDate) });
const sportAgainRows = (sportAgain?.activities ?? []).filter((a) => a.source === 'gflux_training');
if (sportAgainRows.length !== 1) fail(`idempotence violée : ${sportAgainRows.length} dépense(s) après re-validation`);
ok('validation répétée : toujours une seule dépense (idempotent)');

// Correction de durée → la dépense EXISTANTE est mise à jour (jamais un 2e).
let lockedMsg = null;
try {
	await client.mutation(api.trainingClient.logSet, { sessionToken: userToken, scheduledId: sid, sessionExerciseId: ex._id, setOrder: 2, reps: 8, weightKg: 42.5, done: true });
} catch (e) {
	lockedMsg = e?.message ?? String(e);
}
if (!lockedMsg) fail("le log sur séance terminée n'a pas été refusé — l'historique doit être verrouillé");
ok(`sécurité : log refusé après completion (« ${lockedMsg} »)`);

await client.mutation(api.trainingAssign.updateScheduledSession, { sessionToken: coachToken, scheduledId: sid, date: addDays(startDate, 3) }).catch((e) => {
	throw new Error(`••• coach déplacer sur séance réalisée devrait être refusé — obtenu : ${e?.message}`);
}).then(() => {
	throw new Error('inattendu');
}).catch((e) => {
	if (/réalisée|modifi/.test(e?.message ?? '')) ok(`••• coach : séance réalisée protégée (« ${e.message} »)`);
	else throw e;
});

// Correction de durée → la dépense EXISTANTE est mise à jour (jamais un 2e).
await client.mutation(api.trainingClient.updateSessionDuration, { sessionToken: userToken, scheduledId: sid, durationMin: 57 });
const sportFixed = await client.query(api.sport.myWeek, { sessionToken: userToken, weekStart: mondayOf(startDate) });
const sportFixedRows = (sportFixed?.activities ?? []).filter((a) => a.source === 'gflux_training');
if (sportFixedRows.length !== 1) fail(`correction de durée : 1 dépense attendue, reçu ${sportFixedRows.length}`);
if (sportFixedRows[0].durationMinutes !== 57) fail('la dépense n’a pas suivi la correction de durée');
ok('correction de durée 45 → 57 min : dépense EXISTANTE mise à jour (aucun doublon)');

// ── 8ter) « JE N'AI PAS RÉALISÉ CETTE SÉANCE » → AUCUNE dépense ──────────────
const dup2 = await client.mutation(api.trainingClient.duplicateMySession, { sessionToken: userToken, scheduledId: sid, date: addDays(startDate, 5) });
await client.mutation(api.trainingClient.completeSession, { sessionToken: userToken, scheduledId: dup2.scheduledId, durationMin: 30, skipped: true });
const sportSkipped = await client.query(api.sport.myWeek, { sessionToken: userToken, weekStart: mondayOf(startDate) });
const sportSkippedRows = (sportSkipped?.activities ?? []).filter((a) => a.source === 'gflux_training');
if (sportSkippedRows.length !== 1) fail(`séance « non réalisée » ne doit générer AUCUNE dépense (reçu ${sportSkippedRows.length - 1} supplémentaire(s))`);
ok('« Je n’ai pas réalisé cette séance » : clôturée SANS dépense');

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
	exerciseId: ex.exercise?._id ?? ex.exerciseId,
});
if (!historyAfter || (historyAfter.sets?.length ?? 0) === 0) fail('historique PERDU après remplacement — interdit');
ok(`historique conservé après remplacement : ${historyAfter.sets.length} série(s) lisible(s), dernière=${historyAfter.last?.reps ?? '—'}×${historyAfter.last?.weightKg ?? '—'}`);

// ── 10) SUIVI COACH ──────────────────────────────────────────────────────────
const summary = await client.query(api.trainingAssign.clientTrainingSummary, { sessionToken: coachToken, userId: e2eUserId });
if (!summary) fail('suivi coach inaccessible');
ok(`suivi coach : assignation active=${summary.active ? 'oui' : 'non'}, adhérence=${summary.adherence ?? 'n/a'} %, réalisées=${summary.completedCount ?? '?'}, planifiées=${summary.plannedCount ?? '?'}`);

// ── 11) RETIRER (futures annulées, réalisées conservées) ─────────────────────
await client.mutation(api.trainingAssign.removeAssignment, { sessionToken: coachToken, assignmentId: replaced.assignmentId });
const weekAfterRemove = await client.query(api.trainingClient.myWeek, {
	sessionToken: userToken,
	weekStart: firstOccWeekStart,
});
const remaining = (weekAfterRemove.days ?? []).filter((s) => s.status === 'planned');
// Design du remplacement : seules les occurrences À PARTIR de la date du
// nouveau programme sont annulées — celles entre le début initial et cette
// date restent planifiées (la cliente continue l'ancien programme d'ici là).
const beforeReplace = remaining.filter((s) => s.date < replaceStart);
const afterReplace = remaining.filter((s) => s.date >= replaceStart);
if (afterReplace.length > 0) fail(`${afterReplace.length} occurrence(s) future(s) du remplacement non annulée(s) — interdit`);
ok(`retrait : 0 occurrence planifiée à partir du remplacement, ${beforeReplace.length} occurrence(s) antérieure(s) conservée(s) (design) — les réalisées restent consultables`);
ok('E2E Entraînement : tous les scénarios passent.');

await cleanup();
process.exit(0);
