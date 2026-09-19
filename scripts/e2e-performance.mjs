#!/usr/bin/env node
/**
 * E2E — page Performance + carte Accueil (semaine du Journal).
 *
 * Principe : on passe par les VRAIS endpoints HTTP du serveur local (les mêmes
 * que l'UI) avec un compte client de test clairement identifié
 * (e2e-perf-…@example.test) créé via le parcours coach, puis SUPPRIMÉ à la
 * fin. Aucune donnée réelle n'est touchée. Vérifie précisément les 5 scénarios
 * de l'incident « 500 Internal Error » du 15/09/2026 (fonction Convex
 * journal:getWeek absente du déploiement production) :
 *
 *   1. Accueil → Ma performance (carte + lien)
 *   2. ouverture de la semaine en cours (SSR de la page)
 *   3. semaine précédente (API, comme le chevron ‹)
 *   4. semaine suivante (API, comme le chevron ›)
 *   5. refresh complet de la page Performance (re-SSR)
 *
 * Usage : node scripts/e2e-performance.mjs [baseUrl]   (défaut http://127.0.0.1:5173)
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

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mondayOf = (d) => {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	const day = x.getDay();
	x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
	return x;
};
const today = isoOf(new Date());
const monday = isoOf(mondayOf(new Date()));
const prevMonday = isoOf(new Date(mondayOf(new Date()).getTime() - 7 * 864e5));
const nextMonday = isoOf(new Date(mondayOf(new Date()).getTime() + 7 * 864e5));

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
			console.log('  🧹 client e2e supprimé');
		} catch {
			console.error('  ⚠️ suppression du client e2e impossible (à retirer à la main)');
		}
	}
}

console.log(`E2E Performance — base=${BASE}, today=${today}, semaine=${monday} → ${nextMonday}`);

// ── 1) Coach : session + compte client e2e jetable ──────────────────────────
const coach = await client.mutation(api.users.signIn, { email: env.COACH_EMAIL, password: env.COACH_PASSWORD });
if (!coach?.token) fail('sign-in coach impossible');
coachToken = coach.token;
ok(`session coach ouverte (${coach.user?.role})`);

e2eEmail = `e2e-perf-${Date.now()}@example.test`;
const created = await client.mutation(api.coach.createClient, {
	sessionToken: coachToken,
	email: e2eEmail,
	password: 'e2e-perf-pass-1',
	prenom: 'E2E Perf',
});
if (!created?.ok || !created?.userId) fail(`création client e2e impossible (${JSON.stringify(created)})`);
e2eUserId = created.userId;
ok(`client e2e créé : ${e2eEmail}`);

// ── 2) Connexion client (comme l'app) → cookie de session BFF ───────────────
const user = await client.mutation(api.users.signIn, { email: e2eEmail, password: 'e2e-perf-pass-1' });
if (!user?.token) fail('sign-in client e2e impossible');
const cookie = { cookie: `gflux_session=${user.token}` };
ok('session client e2e ouverte (rôle client)');

// ── Scénario 1 : Accueil → Ma performance ───────────────────────────────────
const home = await fetch(`${BASE}/espace`, { headers: cookie, redirect: 'follow' });
const homeHtml = await home.text();
if (home.status !== 200) fail(`GET /espace → ${home.status}`);
if (!homeHtml.includes('/espace/performance')) fail('carte « Performance » introuvable sur l’Accueil (lien absent)');
ok('Accueil OK — carte « Performance » présente avec lien vers /espace/performance');

// ── Scénario 2 : ouverture de la semaine en cours (la page ne doit PAS être un 500) ──
const perf = await fetch(`${BASE}/espace/performance`, { headers: cookie, redirect: 'follow' });
const perfHtml = await perf.text();
if (perf.status !== 200) fail(`GET /espace/performance → ${perf.status} (bug d'origine : 500 Internal Error)`);
if (!perfHtml.includes('Semaine en cours')) fail('la page Performance n’affiche pas « Semaine en cours »');
const daysRendered = (perfHtml.match(/Performance du \d{4}-\d{2}-\d{2}/g) ?? []).length;
if (daysRendered !== 7) fail(`la page Performance ne rend pas les 7 jours (trouvés : ${daysRendered})`);
ok('Ma performance → 200, 7 jours rendus (SSR journal:getWeek OK)');

// ── Scénario 3 : semaine précédente (même appel que le chevron ‹) ───────────
const prev = await fetch(`${BASE}/api/journal/week?start=${prevMonday}`, { headers: cookie });
const prevJ = await prev.json();
if (prev.status !== 200 || prevJ?.error) fail(`semaine précédente → ${prev.status} ${JSON.stringify(prevJ)}`);
if (prevJ.start !== prevMonday || prevJ.days?.length !== 7) fail(`semaine précédente : contrat inattendu (${JSON.stringify(prevJ).slice(0, 200)})`);
ok(`semaine précédente OK (${prevJ.start} → ${prevJ.end}, 7 jours, tous tracked=false attendus : ${prevJ.days.filter((d) => d.tracked).length} renseignés)`);

// ── Scénario 4 : semaine suivante (même appel que le chevron ›) ─────────────
const next = await fetch(`${BASE}/api/journal/week?start=${nextMonday}`, { headers: cookie });
const nextJ = await next.json();
if (next.status !== 200 || nextJ?.error) fail(`semaine suivante → ${next.status} ${JSON.stringify(nextJ)}`);
if (nextJ.start !== nextMonday || nextJ.days?.length !== 7) fail(`semaine suivante : contrat inattendu (${JSON.stringify(nextJ).slice(0, 200)})`);
ok(`semaine suivante OK (${nextJ.start} → ${nextJ.end}, 7 jours)`);

// ── Scénario 5 : refresh complet de la page Performance ─────────────────────
const perf2 = await fetch(`${BASE}/espace/performance`, { headers: cookie, redirect: 'follow', cache: 'no-store' });
const perf2Html = await perf2.text();
if (perf2.status !== 200) fail(`refresh GET /espace/performance → ${perf2.status}`);
if (!perf2Html.includes('Semaine en cours')) fail('après refresh : « Semaine en cours » absent');
ok('refresh complet OK — la page recharge en 200 (plus jamais de 500)');

console.log('\n✅ E2E Performance : les 5 scénarios passent (accueil, semaine courante, ‹, ›, refresh).');
await cleanup();
process.exit(0);
