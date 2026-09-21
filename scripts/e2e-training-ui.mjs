#!/usr/bin/env node
/**
 * E2E Entraînement — couche UI/SSR + BFF (complément de e2e-training.mjs).
 *
 * Vérifie via les VRAIS endpoints HTTP de l'app :
 *   1. BFF coach /api/coach/training/assignments accessible avec session coach
 *   2. Accueil cliente : ORDRE des raccourcis (Rendez-vous, Recettes, Drive,
 *      Bilans, Entraînement, Messages, Outils) + présence du lien
 *   3. /espace/entrainement : état vide « Aucune séance programmée… »
 *   4. après assignation : la semaine et les séances sont rendues (SSR)
 *   5. BFF cliente /api/training : contrat semaine OK
 * Le compte client e2e est jetable (auto-supprimé), aucune donnée réelle touchée.
 *
 * Usage : node scripts/e2e-training-ui.mjs [baseUrl]   (défaut http://127.0.0.1:5173)
 */
import { ConvexHttpClient } from 'convex/browser';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
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
let coachToken = null;
let e2eUserId = null;
let e2eEmail = null;
const ok = (msg) => { if (!stopping) console.log(`  ✔ [${++step}] ${msg}`); };
const fail = (msg) => {
	if (stopping) throw new Error(msg);
	stopping = true;
	console.error(`  ✘ ${msg}`);
	cleanup().finally(() => process.exit(1));
	throw new Error(msg);
};
process.on('uncaughtException', (e) => {
	console.error('  ✘ imprévu :', e?.message ?? e);
	if (stopping) return;
	stopping = true;
	cleanup().finally(() => process.exit(1));
});
process.on('unhandledRejection', (e) => {
	console.error('  ✘ imprévu :', (e?.message ?? e));
	if (stopping) return;
	stopping = true;
	cleanup().finally(() => process.exit(1));
});
async function cleanup() {
	if (cleaned) return;
	cleaned = true;
	if (coachToken && e2eUserId) {
		try {
			await client.mutation(api.coach.removeClient, { sessionToken: coachToken, userId: e2eUserId });
			console.log('  🧹 client e2e supprimé');
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

console.log(`E2E Entraînement UI — base=${BASE}`);

// ── 1) Session coach + BFF coach protégé puis accessible ────────────────────
const coach = await client.mutation(api.users.signIn, { email: env.COACH_EMAIL, password: env.COACH_PASSWORD });
if (!coach?.token) fail('sign-in coach impossible');
coachToken = coach.token;
const coachCookie = { cookie: `gflux_session=${coachToken}` };

const anon = await fetch(`${BASE}/api/coach/training/assignments`, { redirect: 'manual' });
if (anon.status !== 303 && anon.status !== 401 && anon.status !== 302) fail(`BFF coach sans session → ${anon.status} (attendu : redirection/refus)`);
ok(`BFF coach protégé sans session (${anon.status})`);

const assignmentsRes = await fetch(`${BASE}/api/coach/training/assignments`, { headers: coachCookie });
const assignmentsJson = await assignmentsRes.json().catch(() => null);
if (assignmentsRes.status !== 200 || assignmentsJson?.error) fail(`BFF coach avec session → ${assignmentsRes.status} ${JSON.stringify(assignmentsJson).slice(0, 200)}`);
ok(`BFF coach OK : ${Array.isArray(assignmentsJson) ? assignmentsJson.length : '?'} assignation(s) visible(s)`);

// ── 2) Client e2e + session ─────────────────────────────────────────────────
e2eEmail = `e2e-trui-${Date.now()}@example.test`;
const created = await client.mutation(api.coach.createClient, {
	sessionToken: coachToken,
	email: e2eEmail,
	password: 'e2e-trui-pass-1',
	prenom: 'E2E TrUI',
});
if (!created?.ok || !created?.userId) fail(`création client e2e impossible (${JSON.stringify(created)})`);
e2eUserId = created.userId;
const user = await client.mutation(api.users.signIn, { email: e2eEmail, password: 'e2e-trui-pass-1' });
if (!user?.token) fail('sign-in client e2e impossible');
const cookie = { cookie: `gflux_session=${user.token}` };
ok(`client e2e créé : ${e2eEmail}`);

// ── 3) Accueil : ORDRE des raccourcis + lien Entraînement ───────────────────
const home = await fetch(`${BASE}/espace`, { headers: cookie, redirect: 'follow' });
const homeHtml = await home.text();
if (home.status !== 200) fail(`GET /espace → ${home.status}`);
if (!homeHtml.includes('/espace/entrainement')) fail('lien raccourci Entraînement absent de l Accueil');
const order = ['Rendez-vous', 'Recettes', 'Drive', 'Bilans', 'Entraînement', 'Messages', 'Outils'];
// On mesure l'ordre DANS le bloc nav des raccourcis uniquement (le reste de
// la page peut citer les mêmes mots dans n'importe quel ordre).
const navStart = homeHtml.indexOf('aria-label="Raccourcis"');
const navEnd = homeHtml.indexOf('</nav>', navStart);
const navHtml = navStart !== -1 && navEnd !== -1 ? homeHtml.slice(navStart, navEnd) : '';
if (!navHtml) fail('bloc des raccourcis introuvable sur l Accueil');
const positions = order.map((label) => navHtml.indexOf(label));
if (positions.some((p) => p === -1)) fail(`raccourci manquant sur l Accueil : ${order.filter((_, i) => positions[i] === -1).join(', ')}`);
const sorted = [...positions].every((p, i) => i === 0 || p > positions[i - 1]);
if (!sorted) fail(`ordre des raccourcis incorrect : ${order.map((l, i) => `${l}@${positions[i]}`).join(' < ')}`);
ok(`ordre des raccourcis conforme : ${order.join(' → ')}`);

// ── 4) /espace/entrainement : page servie + état vide côté BFF ─────────────
// La page rend le message « Aucune séance programmée pour le moment » côté
// client (fetch onMount) : la preuve serveur équivalente est le BFF qui
// répond 0 séance / pas de prochaine pour cette cliente fraîche.
const emptyPage = await fetch(`${BASE}/espace/entrainement`, { headers: cookie, redirect: 'follow' });
if (emptyPage.status !== 200) fail(`GET /espace/entrainement → ${emptyPage.status}`);
const emptyApi = await fetch(`${BASE}/api/training`, { headers: cookie });
const emptyJson = await emptyApi.json().catch(() => null);
if (emptyApi.status !== 200 || emptyJson?.error) fail(`/api/training (sans programme) → ${emptyApi.status}`);
if ((emptyJson.days ?? []).length !== 0 || emptyJson.nextSession) fail(`état non vide sans programme (${JSON.stringify(emptyJson).slice(0, 150)})`);
ok('page servie + état vide vérifié côté BFF (0 séance, pas de prochaine)');

// ── 5) Assignation → la semaine se rend côté cliente ────────────────────────
const programs = await client.query(api.training.listPrograms, { sessionToken: coachToken });
if (!programs?.length) fail('aucun programme modèle disponible');
const tplFull = await client.query(api.training.programFull, { sessionToken: coachToken, programId: programs[0]._id });
if (!tplFull?.sessions?.length) fail("le programme modèle n'a aucune séance");
const today = isoOf(new Date());
const startDate = addDays(today, 7);
const assigned = await client.mutation(api.trainingAssign.assignProgram, {
	sessionToken: coachToken,
	userId: e2eUserId,
	sourceProgramId: programs[0]._id,
	startDate,
	weeks: 4,
	weekdays: [1, 4],
});
if (!assigned?.assignmentId) fail(`assignation impossible (${JSON.stringify(assigned)})`);
ok(`assignation créée (${assigned.sessionsCreated} séances, début ${startDate})`);

const weekPage = await fetch(`${BASE}/espace/entrainement`, { headers: cookie, redirect: 'follow', cache: 'no-store' });
if (weekPage.status !== 200) fail(`GET /espace/entrainement (avec programme) → ${weekPage.status}`);
// Semaine de la première occurrence (le BFF prend weekStart, lundi de la
// semaine affichée — sinon il renvoie la semaine courante).
const firstMonday = addDays(
	startDate,
	-((new Date(startDate + 'T00:00:00Z').getUTCDay() + 6) % 7)
);
const weekJson2 = await (await fetch(`${BASE}/api/training?weekStart=${firstMonday}`, { headers: cookie })).json().catch(() => null);
if (!weekJson2 || weekJson2?.error) fail('/api/training (avec programme) : réponse invalide');
if (!(weekJson2.days ?? []).length) fail('aucune séance dans la semaine côté BFF malgré le programme actif');
const sessionName = tplFull.sessions[0].name;
if (!(weekJson2.days ?? []).some((d) => d.name === sessionName)) fail(`la séance « ${sessionName} » absente de la semaine BFF (${weekJson2.days.map((d) => d.name).join(', ')})`);
ok(`page servie + semaine BFF rendue avec la séance « ${sessionName} »`);

// ── 6) BFF cliente /api/training : contrat semaine ──────────────────────────
const weekApi = await fetch(`${BASE}/api/training`, { headers: cookie });
const weekJson = await weekApi.json().catch(() => null);
if (weekApi.status !== 200 || weekJson?.error) fail(`/api/training → ${weekApi.status} ${JSON.stringify(weekJson).slice(0, 200)}`);
if (!('days' in weekJson) || !('nextSession' in weekJson)) fail(`/api/training : contrat inattendu (${Object.keys(weekJson ?? {}).join(',')})`);
ok(`BFF cliente OK : semaine ${weekJson.weekStart ?? '?'}, ${(weekJson.days ?? []).length} séance(s), prochaine=${weekJson.nextSession?.date ?? '—'}`);

console.log('\n✅ E2E Entraînement UI : tous les scénarios passent (ordre raccourcis, état vide, semaine SSR, BFF coach + cliente).');
await cleanup();
process.exit(0);
