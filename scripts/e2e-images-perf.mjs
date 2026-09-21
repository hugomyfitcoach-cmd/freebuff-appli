#!/usr/bin/env node
/**
 * E2E — Audit mesure des VIGNETTES ALIMENTAIRES (Journal + recherche).
 *
 * Principe identique à e2e-performance.mjs : les VRAIS endpoints HTTP du
 * serveur local avec un compte client de test clairement identifié
 * (e2e-img-…@example.test) créé via le parcours coach, puis SUPPRIMÉ à la
 * fin. Aucune donnée réelle n'est touchée, aucun déploiement.
 *
 * Mesures produites :
 *   1. recherche → résultats texte (BFF /api/foods/search, froid puis chaud)
 *   2. page suivante (scroll infini, offset=25)
 *   3. Journal → données texte (BFF /api/journal, froid puis chaud)
 *   4. vignettes : sondage réseau des URLs d'images servies (froid/chaud,
 *      HEAD + GET partiel) — met en évidence un hôte noir / lent
 *   5. poids des images réellement téléchargées (octets)
 *
 * Usage : node scripts/e2e-images-perf.mjs [baseUrl]   (défaut http://127.0.0.1:5173)
 */
import { ConvexHttpClient } from 'convex/browser';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';

// ── Charge .env.local (jamais de valeur secrète en sortie) ──────────────────
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
	const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
	if (m) env[m[1]] = m[2].replace(/^[\"']|[\"']$/g, '');
}
if (!env.COACH_EMAIL || !env.COACH_PASSWORD || !env.PUBLIC_CONVEX_URL) {
	console.error('⛔ PUBLIC_CONVEX_URL / COACH_EMAIL / COACH_PASSWORD absents de .env.local');
	process.exit(1);
}

const client = new ConvexHttpClient(env.PUBLIC_CONVEX_URL);
const { api } = await import('../src/convex/_generated/api.js');

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate())}`;
const today = isoOf(new Date());

const ms = (t0) => Math.round(performance.now() - t0);
const fmt = (n) => (n >= 1024 * 1024 ? `${(n / 1048576).toFixed(2)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

let step = 0;
const ok = (msg) => console.log(`  ✔ [${++step}] ${msg}`);
const warn = (msg) => console.log(`  ⚠️ ${msg}`);
const fail = (msg) => {
	console.error(`  ✘ ${msg}`);
	cleanup().finally(() => process.exit(1));
};

let coachToken = null;
let e2eUserId = null;
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

/** GET mesuré — renvoie { status, json, ms }. */
async function timedGet(path, cookie) {
	const t0 = performance.now();
	try {
		const r = await fetch(`${BASE}${path}`, { headers: cookie });
		const json = await r.json().catch(() => null);
		return { status: r.status, json, ms: ms(t0) };
	} catch (e) {
		return { status: 0, json: null, ms: ms(t0), error: e?.message ?? String(e) };
	}
}

/** Sondage réseau d'une URL d'image (hors app) : GET avec timeout court. */
async function probeImage(url, { method = 'GET', maxBytes = Infinity } = {}) {
	const t0 = performance.now();
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), 10_000);
	try {
		const r = await fetch(url, { method, signal: ac.signal, headers: { 'User-Agent': 'GFluxCoaching/1.0' } });
		let bytes = 0;
		if (method === 'GET') {
			const reader = r.body?.getReader();
			if (reader) {
				for (;;) {
					const { done, value } = await reader.read();
					if (done || !value) break;
					bytes += value.length;
					if (bytes >= maxBytes) {
						await reader.cancel().catch(() => {});
						break;
					}
				}
			}
		}
		clearTimeout(timer);
		return { status: r.status, ms: ms(t0), bytes, contentType: r.headers.get('content-type') ?? '', location: r.headers.get('location') ?? undefined };
	} catch (e) {
		clearTimeout(timer);
		const aborted = e?.name === 'AbortError';
		return { status: 0, ms: ms(t0), bytes: 0, error: aborted ? 'timeout (10 s)' : (e?.message ?? String(e)) };
	}
}

console.log(`E2E Vignettes — base=${BASE}, today=${today}`);

// ── 1) Coach : session + compte client e2e jetable ──────────────────────────
const coach = await client.mutation(api.users.signIn, { email: env.COACH_EMAIL, password: env.COACH_PASSWORD });
if (!coach?.token) fail('sign-in coach impossible');
coachToken = coach.token;
ok(`session coach ouverte (${coach.user?.role})`);

const e2eEmail = `e2e-img-${Date.now()}@example.test`;
const created = await client.mutation(api.coach.createClient, {
	sessionToken: coachToken,
	email: e2eEmail,
	password: 'e2e-img-pass-1',
	prenom: 'E2E Img',
});
if (!created?.ok || !created?.userId) fail(`création client e2e impossible (${JSON.stringify(created)})`);
e2eUserId = created.userId;
ok(`client e2e créé : ${e2eEmail}`);

// ── 2) Session client → cookie BFF ──────────────────────────────────────────
const user = await client.mutation(api.users.signIn, { email: e2eEmail, password: 'e2e-img-pass-1' });
if (!user?.token) fail('sign-in client e2e impossible');
const cookie = { cookie: `gflux_session=${user.token}` };
ok('session client e2e ouverte (rôle client)');

// ── 3) Recherche → résultats texte (froid puis chaud) ───────────────────────
const terms = ['nutella', 'yaourt', 'coca'];
let firstImages = [];
for (const q of terms) {
	const cold = await timedGet(`/api/foods/search?q=${encodeURIComponent(q)}&v=0`, cookie);
	if (cold.status !== 200 || cold.json?.error) fail(`recherche « ${q} » → ${cold.status} ${JSON.stringify(cold.json)?.slice(0, 160)}`);
	const hot = await timedGet(`/api/foods/search?q=${encodeURIComponent(q)}&v=0`, cookie);
	const items = cold.json?.items ?? [];
	const withImg = items.filter((f) => !!f.imageUrl).length;
	const hosts = [...new Set(items.map((f) => (f.imageUrl ? new URL(f.imageUrl).hostname : null)).filter(Boolean))];
	if (!firstImages.length) firstImages = items.map((f) => f.imageUrl).filter(Boolean).slice(0, 5);
	console.log(
		`     « ${q} » → texte COLD ${cold.ms} ms / HOT ${hot.ms} ms · ${items.length} résultats · ${withImg} avec imageUrl · hôtes : ${hosts.join(', ') || '—'}`
	);
}
ok('recherche → résultats texte mesurée (froid/chaud, 3 requêtes)');

// Page suivante (scroll infini)
const page2 = await timedGet(`/api/foods/search?q=nutella&offset=25&limit=25`, cookie);
console.log(`     page 2 (offset 25) → ${page2.ms} ms · ${(page2.json?.items ?? []).length} résultats`);
ok('scroll infini → page suivante mesurée');

// ── 4) Journal → données texte (froid puis chaud) ───────────────────────────
const jCold = await timedGet(`/api/journal?date=${today}`, cookie);
if (jCold.status !== 200 || jCold.json?.error) fail(`GET /api/journal → ${jCold.status}`);
const jHot = await timedGet(`/api/journal?date=${today}`, cookie);
console.log(`     /api/journal → texte COLD ${jCold.ms} ms / HOT ${jHot.ms} ms · ${(jCold.json?.entries ?? []).length} entrées`);
ok('Journal → données texte mesurées (froid/chaud)');

// Ajout d'une entrée avec vignette (même parcours que l'app : foodId du premier résultat)
const searchForAdd = await timedGet(`/api/foods/search?q=nutella&v=0`, cookie);
const foodToAdd = (searchForAdd.json?.items ?? []).find((f) => f._id && !f.custom);
if (foodToAdd) {
	const add = await timedGet(`/api/journal?date=${today}`, { ...cookie }); // NOOP lecture (garde le schéma identique)
	void add;
	const t0 = performance.now();
	const rAdd = await fetch(`${BASE}/api/journal`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...cookie },
		body: JSON.stringify({ date: today, meal: 'dejeuner', foodId: foodToAdd._id, qtyGrams: 100 }),
	});
	const jAdd = await rAdd.json().catch(() => null);
	console.log(`     POST /api/journal (ajout « ${foodToAdd.name} ») → ${rAdd.status} en ${ms(t0)} ms`);
	if (rAdd.status !== 200 || jAdd?.error) fail(`ajout au journal impossible (${JSON.stringify(jAdd)?.slice(0, 160)})`);
	const day2 = await timedGet(`/api/journal?date=${today}`, cookie);
	const entries = day2.json?.entries ?? [];
	console.log(`     /api/journal après ajout → ${day2.ms} ms · ${entries.length} entrée(s) · snapshot imageUrl : ${entries[0]?.imageUrl ? 'OUI' : 'NON'}`);
	ok('Journal → ajout aliment + snapshot vignette vérifié');
} else {
	warn('aucun aliment trouvé pour l’ajout journal — étape sautée');
}

// ── 5) Vignettes : sondage réseau des URLs d'images servies ─────────────────
const urls = [...new Set([...firstImages, ...((jHot.json?.entries ?? []).map((e) => e.imageUrl).filter(Boolean))])].slice(0, 5);
if (!urls.length) {
	warn('aucune URL d’image servie par la recherche — rien à sonder');
} else {
	console.log(`     sondage de ${urls.length} URL(s) d'images (10 s max chacune) :`);
	for (const u of urls) {
		const u0 = new URL(u);
		const head = await probeImage(u, { method: 'HEAD' });
		if (head.status === 0) {
			console.log(`       ✘ ${u0.hostname}${u0.pathname.slice(0, 60)}… → ${head.error} après ${head.ms} ms`);
			// Les hôtes API redirigent-ils vers le même endroit ? (diagnostic)
			const alt = await probeImage(`https://world.openfoodfacts.org${u0.pathname}`, { method: 'GET', maxBytes: 1 });
			console.log(`       ↳ repli world.openfoodfacts.org même chemin → ${alt.status} ${alt.status === 301 ? `redirige vers ${alt.location ? new URL(alt.location).hostname : '?'}` : ''} en ${alt.ms} ms`);
		} else {
			const cold = await probeImage(u, { maxBytes: 100 * 1024 * 1024 });
			const hot = await probeImage(u, { maxBytes: 100 * 1024 * 1024 });
			console.log(`       ● ${u0.hostname}${u0.pathname.slice(0, 60)}… → HEAD ${head.status} · GET COLD ${cold.status} ${fmt(cold.bytes)} en ${cold.ms} ms · HOT ${fmt(hot.bytes)} en ${hot.ms} ms`);
		}
	}
	ok('vignettes → sondage réseau terminé');
}

console.log('\n✅ E2E Vignettes : mesures terminées.');
await cleanup();
