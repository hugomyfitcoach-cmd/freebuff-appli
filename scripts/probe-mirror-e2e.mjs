#!/usr/bin/env node
/**
 * Sonde E2E — Miroir G-FLUX des vignettes alimentaires (réel, post-déploiement).
 *
 * Parcours : recherche BFF (vrai endpoint) → préchauffage /api/food-image/warm.
 * Deux issues valides :
 *   A. OFF joignable → miroir créé → cache HIT au 2e appel → thumbUrl servi par
 *      la recherche → GET 200 sur l'URL storage (plafond 60 Ko).
 *   B. OFF injoignable (hôte images en panne) → échec PROPRE : ok=false avec
 *      raison off-*, statut `failed` retentable, thumbUrl ABSENT de la
 *      recherche, imageUrl intact (le repli UX reste possible).
 *
 * Compte client e2e créé puis supprimé. La ligne foodImageCache échouée est
 * purgée (issue B) ; une copie prête (issue A) reste en cache global par design.
 *
 * Usage : node scripts/probe-mirror-e2e.mjs [baseUrl]   (défaut http://127.0.0.1:5173)
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
let coachToken = null;
let e2eEmail = null;
let probeOffId = null;
const ok = (msg) => console.log(`  ✔ [${++step}] ${msg}`);
const fail = (msg) => {
	console.error(`  ✘ ${msg}`);
	cleanup().finally(() => process.exit(1));
	throw new Error(msg);
};

async function cleanup() {
	try {
		if (coachToken && probeOffId) {
			await client.mutation(api.foodImages.purgeOffId, { sessionToken: coachToken, offId: probeOffId });
			console.log('  🧹 ligne foodImageCache de la sonde purgée');
		}
	} catch { /* best effort */ }
	try {
		if (coachToken && e2eEmail) {
			const clients = await client.query(api.coach.listClients, { sessionToken: coachToken });
			const target = (clients ?? []).find((c) => c.email === e2eEmail);
			if (target) await client.mutation(api.coach.removeClient, { sessionToken: coachToken, clientId: target._id });
			console.log('  🧹 client e2e supprimé');
		}
	} catch { /* best effort */ }
}

const warm = async (cookie, offId, imageUrl) => {
	const res = await fetch(`${BASE}/api/food-image/warm`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', cookie },
		body: JSON.stringify({ images: [{ offId, imageUrl }] }),
	});
	const j = await res.json();
	// Le BFF renvoie la sortie de l'action Convex : { results: { results: [...] } }
	const results = Array.isArray(j.results) ? j.results : (j.results?.results ?? []);
	return { status: res.status, j, r: results[0] };
};

const Q = 'nutella';
console.log(`E2E miroir alimentaire — base=${BASE}`);

// 1) Coach : session + compte client e2e
const coach = await client.mutation(api.users.signIn, { email: env.COACH_EMAIL, password: env.COACH_PASSWORD });
if (!coach?.token) fail('sign-in coach impossible');
coachToken = coach.token;
ok(`session coach ouverte (${coach.user?.role})`);

const email = `e2e-mirror-${Date.now()}@example.test`;
const created = await client.mutation(api.coach.createClient, {
	sessionToken: coachToken,
	email,
	password: 'e2e-mirror-pass-1',
	prenom: 'E2E Mirror',
});
if (!created?.ok) fail('création client e2e impossible');
e2eEmail = email;
ok(`client e2e créé : ${email}`);

const user = await client.mutation(api.users.signIn, { email, password: 'e2e-mirror-pass-1' });
if (!user?.token) fail('sign-in client e2e impossible');
const cookie = `gflux_session=${user.token}`;
ok(`session cliente ouverte (${user.user?.role})`);

// 2) Recherche BFF → un candidat avec offId + imageUrl
const search = await fetch(`${BASE}/api/foods/search?q=${Q}`, { headers: { cookie } });
const searchJ = await search.json();
const hit = (searchJ.items ?? []).find((it) => it.offId && it.imageUrl && !it.thumbUrl);
if (!hit) fail(`aucun candidat sans vignette pour « ${Q} » (${search.status})`);
probeOffId = hit.offId;
ok(`candidat : « ${hit.name} » (offId=${hit.offId}) sans thumbUrl (cache froid)`);

// 3) Préchauffage #1 — cache MISS → pipeline miroir réel côté Convex
const w1 = await warm(cookie, hit.offId, hit.imageUrl);
if (w1.status !== 200) fail(`warm #1 KO (${w1.status}) ${JSON.stringify(w1.j)}`);
ok(`warm #1 : ok=${w1.r?.ok}${w1.r?.ok ? (w1.r.mirrored ? ' (nouvelle copie storage)' : ' (déjà prête)') : `, raison=${w1.r?.reason}`}`);

if (w1.r?.ok && w1.r?.thumbUrl) {
	// ── Issue A : OFF joignable — validation complète ──
	const thumbUrl = w1.r.thumbUrl;
	const w2 = await warm(cookie, hit.offId, hit.imageUrl);
	if (!w2.r?.ok) fail(`warm #2 KO : ${w2.r?.reason ?? JSON.stringify(w2.j)}`);
	if (!w2.r?.cached) fail(`warm #2 attendu en cache hit, reçu : ${JSON.stringify(w2.r)}`);
	ok('cache HIT → réponse depuis la copie storage (idempotent, OFF non re-contacté)');

	const search2 = await fetch(`${BASE}/api/foods/search?q=${Q}`, { headers: { cookie } });
	const search2J = await search2.json();
	const hit2 = (search2J.items ?? []).find((it) => it.offId === hit.offId);
	if (!hit2?.thumbUrl) fail('thumbUrl absent de la recherche après miroir');
	ok('recherche : miroir G-FLUX prioritaire (thumbUrl présent sur le hit)');

	const img = await fetch(thumbUrl);
	if (img.status !== 200) fail(`URL storage KO (${img.status})`);
	const ctype = img.headers.get('content-type') ?? '?';
	if (!/^image\//.test(ctype)) fail(`content-type inattendu : ${ctype}`);
	const bytes = Number(img.headers.get('content-length') ?? 0) || (await img.arrayBuffer()).byteLength;
	if (bytes > 60 * 1024) fail(`copie trop lourde : ${bytes} octets (plafond 60 Ko)`);
	ok(`copie storage servie : 200, ${ctype}, ${bytes} octets (≤ 60 Ko)`);
	probeOffId = null; // copie prête → reste en cache global (par design)
} else if (/^off-/.test(w1.r?.reason ?? '')) {
	// ── Issue B : OFF injoignable — échec propre, retentable, repli intact ──
	if (w1.r?.thumbUrl) fail('échec OFF mais thumbUrl présent — incohérent');
	ok('hôte images OFF injoignable : échec SILENCIEUX (HTTP 200, jamais une erreur UX)');

	const search2 = await fetch(`${BASE}/api/foods/search?q=${Q}`, { headers: { cookie } });
	const search2J = await search2.json();
	const hit2 = (search2J.items ?? []).find((it) => it.offId === hit.offId);
	if (hit2?.thumbUrl) fail('thumbUrl présent alors que le miroir a échoué');
	if (!hit2?.imageUrl) fail('imageUrl OFF absente — le repli UX serait cassé');
	ok('recherche : thumbUrl absent, imageUrl OFF intacte (repli UI préservé)');

	// Re-préchauffage : la ligne failed est RETENTABLE (pas un état bloquant).
	const w2 = await warm(cookie, hit.offId, hit.imageUrl);
	if (w2.status !== 200) fail(`re-warm KO (${w2.status})`);
	ok(`ligne failed retentable : re-warm exécuté (ok=${w2.r?.ok}, raison=${w2.r?.reason ?? '—'})`);
} else {
	fail(`issue inattendue : ${JSON.stringify(w1.r)}`);
}

// 4) Observabilité : stats du miroir
const stats = await client.query(api.foodImages.stats, {});
ok(`stats miroir : total=${stats.total}, ready=${stats.ready}, pending=${stats.pending}, failed=${stats.failed}`);

await cleanup();
console.log(`\n✅ E2E miroir alimentaire : ${step} vérifications vertes.`);
process.exit(0);
