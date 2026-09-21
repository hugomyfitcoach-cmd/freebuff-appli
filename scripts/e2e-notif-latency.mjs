#!/usr/bin/env node
/**
 * E2E — MESURE DES DÉLAIS RÉELS du mécanisme central de propagation.
 *
 * Principe : on reproduit exactement ce que fait l'app ouverte (polling
 * `GET /api/live` toutes les 5 s, compteurs + delta d'événements) avec des
 * comptes e2e créés puis supprimés (removeClient purge tout, y compris le
 * journal CRM et les événements). Aucune donnée réelle n'est touchée.
 *
 * Définition des délais mesurés :
 *   T0 = mutation métier COMMITÉE (le fetch la réponse reçue = commit)
 *   T1 = première lecture /api/live qui reflète l'événement
 *   délai = T1 − T0 (c'est « action enregistrée → visible dans l'app »,
 *   car la relecture EST la mise à jour des badges/contenus dans l'app).
 *
 * Scénarios mesurés :
 *   1. Coach → cliente : partage Drive (updateResource partagé) → badge Drive
 *   2. Coach → cliente : assignation d'un plan → événement plan_assigned
 *   3. Cliente → coach : bilan hebdo envoyé → journal CRM + version signal
 *   4. Cliente → coach : photos → journal CRM + version signal
 *
 * Usage : node scripts/e2e-notif-latency.mjs [baseUrl] [urlConvex]
 */
import { ConvexHttpClient } from 'convex/browser';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';

// ── Charge .env.local (aucune valeur secrète en sortie) ──────────────────────
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
	const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
	if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
if (!env.COACH_EMAIL || !env.COACH_PASSWORD) {
	console.error('⛔ COACH_EMAIL/COACH_PASSWORD absents de .env.local');
	process.exit(1);
}
if (!env.PUBLIC_CONVEX_URL) {
	console.error('⛔ PUBLIC_CONVEX_URL absent de .env.local');
	process.exit(1);
}

const client = new ConvexHttpClient(env.PUBLIC_CONVEX_URL);
const { api } = await import('../src/convex/_generated/api.js');

let step = 0;
const ok = (msg) => console.log(`  ✔ [${++step}] ${msg}`);
const fail = (msg) => {
	console.error(`  ✘ ${msg}`);
	process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Boucle de polling e2e — MÊME contrat que lib/notificationPoll.ts :
 * relit /api/live toutes les 5 s jusqu'à ce que `done(result)` soit vrai.
 * Retourne le délai en ms entre l'instant du commit et la détection.
 */
async function pollUntil({ cookie, done, since, budgetMs = 40_000 }) {
	const start = Date.now();
	while (Date.now() - start < budgetMs) {
		const r = await fetch(`${BASE}/api/live?since=${since}`, {
			headers: { cookie },
			cache: 'no-store',
		});
		if (r.ok) {
			const j = await r.json();
			if (done(j)) return { delayMs: Date.now() - start, result: j };
		}
		await sleep(5_000);
	}
	return { delayMs: null, result: null };
}

const results = [];

console.log(`E2E délais notifications — base=${BASE}`);

// ── 1) Sessions coach + cliente e2e ─────────────────────────────────────────
const coach = await client.mutation(api.users.signIn, { email: env.COACH_EMAIL, password: env.COACH_PASSWORD });
if (!coach?.token) fail('sign-in coach impossible');
ok(`session coach ouverte (${coach.user?.role})`);
const coachCookie = `gflux_session=${coach.token}`;

const email = `e2e-notif-${Date.now()}@example.test`;
const created = await client.mutation(api.coach.createClient, {
	sessionToken: coach.token,
	email,
	password: 'e2e-notif-pass-1',
	prenom: 'E2E Notif',
});
if (!created?.ok) fail('création cliente e2e impossible');
const clientId = created.userId;
ok(`cliente e2e créée (${email})`);

const clientSession = await client.mutation(api.users.signIn, {
	email,
	password: 'e2e-notif-pass-1',
});
if (!clientSession?.token) fail('sign-in cliente impossible');
const clientCookie = `gflux_session=${clientSession.token}`;
ok('session cliente ouverte');

// Amorçage des pollers : premier /api/live des deux côtés (comme l'app).
await fetch(`${BASE}/api/live?since=0`, { headers: { cookie: clientCookie } });
await fetch(`${BASE}/api/live?since=0`, { headers: { cookie: coachCookie } });
ok('état initial des deux pollers lu (/api/live)');

let globalError = null;
try {
	// ── 2) SCÉNARIO A — Drive : coach partage une entrée → badge cliente ────
	const add = await client.mutation(api.resources.addResource, {
		sessionToken: coach.token,
		userId: clientId,
		kind: 'note',
		title: 'E2E latence Drive',
		body: 'Note de mesure de délai.',
	});
	if (!add?.ok) fail('création entrée Drive impossible');
	// Baseline cliente (badge drive = 0 attendu).
	const c0 = await (await fetch(`${BASE}/api/live?since=0`, { headers: { cookie: clientCookie } })).json();
	const baseDrive = c0.drive ?? 0;
	const tCommit = Date.now();
	await client.mutation(api.resources.updateResource, {
		sessionToken: coach.token,
		resourceId: add.resourceId,
		visibility: 'shared',
	});
	const driveRes = await pollUntil({
		cookie: clientCookie,
		since: tCommit,
		done: (j) => (j.drive ?? 0) > baseDrive,
	});
	results.push([
		'Coach → cliente : Drive partagé → badge Drive (polling 5 s)',
		driveRes.delayMs,
		driveRes.result?.drive,
	]);
	ok(`Drive partagé détecté côté cliente en ${driveRes.delayMs ?? '>40 000'} ms (drive=${driveRes.result?.drive})`);

	// ── 3) SCÉNARIO B — Plan assigné → événement plan_assigned (delta) ──────
	const tpl = await client.mutation(api.mealPlans.createTemplate, {
		sessionToken: coach.token,
		name: `E2E latence ${Date.now()}`,
		items: [{ meal: 'dejeuner', ciqualLabel: 'Banane, chair sans peau, crue', qtyGrams: 120 }],
	});
	if (!tpl?.ok) fail('création plan impossible');
	const today = new Date().toISOString().slice(0, 10);
	const tAssign = Date.now();
	const assigned = await client.mutation(api.mealPlans.assignTemplate, {
		sessionToken: coach.token,
		userId: clientId,
		templateId: tpl.templateId,
		startDate: today,
		endDate: today,
	});
	if (!assigned?.ok) fail('assignation plan impossible');
	const planRes = await pollUntil({
		cookie: clientCookie,
		since: tAssign,
		done: (j) => (j.events ?? []).some((e) => e.kind === 'plan_assigned'),
	});
	results.push([
		'Coach → cliente : plan assigné → événement plan_assigned (delta)',
		planRes.delayMs,
		planRes.result?.events?.find((e) => e.kind === 'plan_assigned')?.label ?? null,
	]);
	ok(`Événement plan_assigned reçu côté cliente en ${planRes.delayMs ?? '>40 000'} ms`);

	// ── 4) SCÉNARIO C — Bilan hebdo envoyé → signal coach (journalVersion) ──
	const j0 = await (await fetch(`${BASE}/api/live?since=0`, { headers: { cookie: coachCookie } })).json();
	const baseVersion = j0.journalVersion ?? 0;
	// Lundi de la semaine courante en date LOCALE (comme l'app) — jamais
	// toISOString() : sa date UTC peut différer de la date locale près de minuit.
	const monday = (() => {
		const d = new Date();
		const day = (d.getDay() + 6) % 7;
		d.setDate(d.getDate() - day);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	})();
	const tCheckin = Date.now();
	const submitted = await client.mutation(api.checkins.submit, {
		sessionToken: clientSession.token,
		weekStart: monday,
		answers: { motivation: 4, adherence: 'oui' },
	});
	if (!submitted?.checkinId) fail(`soumission bilan impossible : ${JSON.stringify(submitted)}`);
	const coachRes = await pollUntil({
		cookie: coachCookie,
		since: tCheckin,
		done: (j) => (j.journalVersion ?? 0) > baseVersion && (j.notifications ?? 0) > (j0.notifications ?? 0),
	});
	results.push([
		'Cliente → coach : bilan hebdo envoyé → badge + journal CRM (temps réel)',
		coachRes.delayMs,
		coachRes.result?.notifications,
	]);
	ok(`Bilan visible côté coach en ${coachRes.delayMs ?? '>40 000'} ms (badge=${coachRes.result?.notifications})`);

	// ── 5) SCÉNARIO D — Photos cliente → signal coach ───────────────────────
	const uploadUrl = await client.mutation(api.photos.generateUploadUrl, {
		sessionToken: clientSession.token,
	});
	if (!uploadUrl) fail('upload-url photos impossible');
	const up = await fetch(uploadUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'image/jpeg' },
		body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0, 0, 1, 2, 3, 4]),
	});
	const upJ = await up.json();
	if (!up.ok || !upJ.storageId) fail('upload photo impossible');
	const tPhoto = Date.now();
	const sent = await client.mutation(api.photos.submitOne, {
		sessionToken: clientSession.token,
		step: 'demarrage',
		storageId: upJ.storageId,
		label: 'E2E',
	});
	if (!sent?.ok) fail(`envoi photo impossible : ${JSON.stringify(sent)}`);
	const photoRes = await pollUntil({
		cookie: coachCookie,
		since: tPhoto,
		done: (j) => (j.journalVersion ?? 0) > (coachRes.result?.journalVersion ?? baseVersion),
	});
	results.push([
		'Cliente → coach : photos envoyées → badge + journal CRM (temps réel)',
		photoRes.delayMs,
		photoRes.result?.notifications,
	]);
	ok(`Photos visibles côté coach en ${photoRes.delayMs ?? '>40 000'} ms`);
} catch (e) {
	globalError = e;
	console.error('\n⛔ ERREUR pendant les scénarios :', e?.message ?? e);

	// ── 6) TABLEAU FINAL ────────────────────────────────────────────────────
	console.log('\n══════ DÉLAIS MESURÉS (action commitée → visible dans l app) ══════');
	for (const [label, ms, extra] of results) {
		console.log(`  ${label} : ${ms ?? '>40 000 (HORS DÉLAI)'} ms${extra != null ? ` (état: ${extra})` : ''}`);
	}
} finally {
	// ── Nettoyage : la cliente e2e est purgée (journal + événements inclus) ──
	await client.mutation(api.coach.removeClient, { sessionToken: coach.token, userId: clientId }).catch(() => {});
	console.log('\n  ✔ cliente e2e supprimée (données purgées)');
	process.exit(globalError ? 1 : 0);
}
