#!/usr/bin/env node
/**
 * E2E régression — CRM Vision 360 : ouverture d'une fiche cliente.
 *
 * Contexte hotfix prod (22/09) : depuis 440f070 (Dépense sportive), le GET
 * /admin?client=<id> renvoyait HTTP 500 — la query coach.sport360 renvoie
 * { weeks, today } alors que l'UI attendait un bloc type client360.sport
 * (trend + previous) → `undefined.some` en rendu SSR. Correctif : la
 * normalisation est faite côté BFF (+page.server.ts), avec garde-fous UI.
 *
 * Ce scénario est strictement LECTURE SEULE : login coach + GET. Aucune
 * mutation, aucun compte jetable, aucune donnée cliente touchée.
 *
 * Vérifie :
 *   1. GET /admin (liste) → 200
 *   2. GET /admin?client=<id> sur plusieurs fiches réelles → 200, page
 *      complète (Vision 360 présente, jamais « Internal Server Error »)
 *   3. Retour liste → 200 (navigation 360 ↔ CRM)
 *   4. Param fiche invalide → 200 sans crash (tiroir simplement fermé)
 *
 * Usage : node scripts/e2e-vision360-fiche.mjs [baseUrl]   (défaut http://127.0.0.1:5173)
 */
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
	const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
	if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
if (!env.COACH_EMAIL || !env.COACH_PASSWORD) {
	console.error('⛔ COACH_EMAIL / COACH_PASSWORD absents de .env.local');
	process.exit(1);
}

let step = 0;
const ok = (msg) => console.log(`  ✔ [${++step}] ${msg}`);
const fail = (msg) => {
	console.error(`  ✘ ${msg}`);
	process.exit(1);
};

let cookie = '';
async function get(path) {
	const res = await fetch(BASE + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
	const sc = res.headers.getSetCookie?.() ?? [];
	for (const c of sc) {
		const kv = c.split(';')[0];
		if (kv.startsWith('gflux_session=')) cookie = kv;
	}
	return res;
}
const assertPage = (res, what) => {
	if (res.status !== 200) fail(`${what} → HTTP ${res.status} (attendu 200)`);
	return res.text();
};
const assertNoServerError = (body, what) => {
	if (/Internal Server Error/i.test(body)) fail(`${what} → page « Internal Server Error »`);
	if (/TypeError:/.test(body)) fail(`${what} → TypeError en rendu SSR`);
};

// 1. Login coach (POST action nommée — aucun effet de bord métier)
const form = new URLSearchParams({ email: env.COACH_EMAIL, password: env.COACH_PASSWORD, next: '/admin' });
const login = await fetch(`${BASE}/connexion?/login`, {
	method: 'POST',
	redirect: 'manual',
	headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE },
	body: form.toString(),
});
const sc = login.headers.getSetCookie?.() ?? [];
for (const c of sc) {
	const kv = c.split(';')[0];
	if (kv.startsWith('gflux_session=')) cookie = kv;
}
if (!cookie) fail('Login coach impossible (aucun cookie de session)');
ok('Login coach');

// 2. Liste CRM
const admin = await get('/admin');
const adminBody = await assertPage(admin, 'GET /admin');
if (!adminBody.includes('Vision 360')) fail('La liste CRM ne semble pas rendue (menion « Vision 360 » absente)');
ok('GET /admin → 200 (liste CRM rendue)');

// 3. Ouverture de fiches réelles (comme un clic 360° / refresh direct d'URL)
const ids = [...new Set([...adminBody.matchAll(/\?client=([a-zA-Z0-9]+)/g)].map((m) => m[1]))];
if (ids.length === 0) fail('Aucun lien fiche cliente trouvé dans la liste CRM');
const toTest = ids.slice(0, 5);
for (const id of toTest) {
	const res = await get(`/admin?client=${id}`);
	const body = await assertPage(res, `GET /admin?client=${id}`);
	assertNoServerError(body, `GET /admin?client=${id}`);
	if (!/Vision 360|Dépense sportive/.test(body)) fail(`GET /admin?client=${id} → fiche incomplète`);
}
ok(`Fiches clientes ouvertes directement : ${toTest.length}/${toTest.length} → 200, rendu complet`);

// 4. Retour à la liste (navigation 360 ↔ CRM)
const back = await get('/admin');
const backBody = await assertPage(back, 'Retour GET /admin');
assertNoServerError(backBody, 'Retour GET /admin');
ok('Retour à la liste CRM → 200');

// 5. Param fiche invalide : jamais de crash (tiroir fermé, liste affichée)
const bad = await get('/admin?client=zzzzzzzzzzzzzzzzzzzzzzzz');
const badBody = await assertPage(bad, 'GET /admin?client=<invalide>');
assertNoServerError(badBody, 'GET /admin?client=<invalide>');
ok('Param fiche invalide → 200 sans crash');

console.log(`\n✅ Vision 360 fiche cliente : ${step}/${step} vérifications vertes (lecture seule, aucune donnée modifiée)`);
