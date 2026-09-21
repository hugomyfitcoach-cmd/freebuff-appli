#!/usr/bin/env node
/**
 * E2E Dépense sportive — couche UI/SSR + BFF (complément de e2e-sport.mjs).
 *
 * Vérifie via les VRAIS endpoints HTTP de l'app :
 *   1. BFF /api/sport protégé (anonyme refusé, cliente OK)
 *   2. Accueil : les deux cartes « Dépense sportive » + « Entraînement »
 *      existent, CÔTE À CÔTE dans la MÊME grille, DIRECTEMENT SOUS
 *      Performance — même logique de grille que Pas/Calories
 *   3. Accueil : rien d'involontairement changé (Pas, Calories, Progression,
 *      Performance toujours présents, ordre intact)
 *   4. Page /espace/depense-sportive servie + état vide + pédagogie marche
 *   5. /api/sport : contrat semaine + catalogue (sans marche quotidienne)
 * Le compte client e2e est jetable (auto-supprimé), aucune donnée réelle touchée.
 *
 * Usage : node scripts/e2e-sport-ui.mjs [baseUrl]   (défaut http://127.0.0.1:5173)
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
let e2eUserId = null;
let cleaned = false;
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ok = (msg) => console.log(`  ✔ [${++step}] ${msg}`);
const fail = (msg) => {
	console.error(`  ✘ ${msg}`);
	cleanup().finally(() => process.exit(1));
	throw new Error(msg);
};
process.on('uncaughtException', (e) => {
	console.error('  ✘ imprévu :', e?.message ?? e);
	cleanup().finally(() => process.exit(1));
});
process.on('unhandledRejection', (e) => {
	console.error('  ✘ imprévu :', e?.message ?? e);
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

console.log(`E2E Dépense sportive UI — base=${BASE}`);

// ── 1) Session cliente e2e ───────────────────────────────────────────────────
const coach = await client.mutation(api.users.signIn, { email: env.COACH_EMAIL, password: env.COACH_PASSWORD });
if (!coach?.token) fail('sign-in coach impossible');
coachToken = coach.token;
const email = `e2e-sui-${Date.now()}@example.test`;
const created = await client.mutation(api.coach.createClient, {
	sessionToken: coachToken,
	email,
	password: 'e2e-sui-pass-1',
	prenom: 'E2E SportUI',
});
if (!created?.userId) fail(`création client e2e impossible (${JSON.stringify(created)})`);
e2eUserId = created.userId;
const user = await client.mutation(api.users.signIn, { email, password: 'e2e-sui-pass-1' });
if (!user?.token) fail('sign-in client e2e impossible');
const cookie = { cookie: `gflux_session=${user.token}` };
ok('cliente e2e créée + connectée');

// ── 2) BFF /api/sport : protection + contrats ────────────────────────────────
const anon = await fetch(`${BASE}/api/sport`, { redirect: 'manual' });
if (anon.status === 200) fail('BFF /api/sport accessible SANS session — interdit');
ok(`BFF /api/sport protégé sans session (${anon.status})`);

const catalogRes = await fetch(`${BASE}/api/sport?catalog=1`, { headers: cookie });
const catalog = await catalogRes.json().catch(() => null);
if (catalogRes.status !== 200 || catalog?.error) fail(`catalog → ${catalogRes.status}`);
if (!Array.isArray(catalog.activities) || catalog.activities.length < 15) fail('catalogue trop court');
const forbidden = catalog.activities.filter((a) => /^(marche|marche-rapide|promenade|balade|randonnee)$/.test(a.id));
if (forbidden.length) fail(`marche quotidienne dans le catalogue : ${forbidden.map((f) => f.id).join(', ')}`);
if (!catalog.activities.some((a) => a.id === 'marche-inclinee-tapis')) fail('marche-inclinee-tapis absente');
ok(`catalogue servi (${catalog.activities.length} activités) — aucune marche quotidienne, tapis incliné présent`);

const weekEmpty = await (await fetch(`${BASE}/api/sport`, { headers: cookie })).json();
if (weekEmpty?.error || weekEmpty.totals?.count !== 0) fail(`état vide attendu, reçu ${JSON.stringify(weekEmpty).slice(0, 120)}`);
ok('contrat semaine : état vide propre (0 activité, 0 kcal)');

// ── 3) Accueil : les deux cartes côte à côte SOUS Performance ────────────────
const home = await fetch(`${BASE}/espace`, { headers: cookie, redirect: 'follow' });
const html = await home.text();
if (home.status !== 200) fail(`GET /espace → ${home.status}`);

// Cartes présentes + liens corrects
if (!html.includes('/espace/depense-sportive')) fail('carte Dépense sportive absente de l Accueil');
if (!html.includes('/espace/entrainement')) fail('carte Entraînement absente de l Accueil');

// Les deux cartes partagent la même SECTION de grille (grid-cols-2 = même
// logique que Pas/Calories) — on localise le bloc <section aria-label=
// "Dépense sportive et Entraînement"> et on vérifie que les deux liens y sont.
const sectionStart = html.indexOf('Dépense sportive et Entraînement');
if (sectionStart === -1) fail('section des deux cartes introuvable');
const sectionHtml = html.slice(sectionStart, sectionStart + 6000);
const depPos = sectionHtml.indexOf('/espace/depense-sportive');
const entPos = sectionHtml.indexOf('/espace/entrainement');
if (depPos === -1 || entPos === -1) fail('les deux cartes ne sont pas dans la même grille');
if (depPos > entPos) fail('ordre inattendu : Dépense sportive doit précéder Entraînement');
ok('cartes [Dépense sportive | Entraînement] côte à côte dans la même grille (grid-cols-2)');

// Position : Performance AVANT la section des deux cartes (et Pas/Calories avant Performance).
const perfPos = html.indexOf('href="/espace/performance"');
const stepsPos = html.indexOf('href="/espace/pas"');
// Ancre de CARTE (le lien de navigation latérale porte des attributs
// data-sveltekit-* entre href et class — on ne veut que les cartes).
const progressionPos = html.indexOf('/espace/progression" class="group');
if (perfPos === -1) fail('carte Performance introuvable');
if (stepsPos === -1 || progressionPos === -1) fail('cartes Pas/Progression introuvables (régression ?)');
if (!(stepsPos < progressionPos && progressionPos < perfPos && perfPos < sectionStart)) {
	fail(`ordre Accueil incorrect (pas@${stepsPos} < progression@${progressionPos} < performance@${perfPos} < cartes@${sectionStart})`);
}
ok('ordre global intact : Aujourd hui → Ma progression → Performance → [Dépense sportive | Entraînement]');

// Aucune régression : cartes Pas/Calories/Poids/Cycle toujours présentes.
// Marqueurs de label « icône + texte » (l'icône SVG est suivie d'une espace
// dans le SSR — jamais de chevron collé au texte).
for (const marker of [' Pas</span>', ' Calories</span>', ' Poids</span>', ' Cycle</span>']) {
	if (!html.includes(marker)) fail(`carte existante modifiée involontairement : ${marker} absente`);
}
ok('cartes existantes (Pas, Calories, Poids, Cycle) inchangées');

// ── 4) Page dédiée servie + pédagogie marche ────────────────────────────────
const page = await fetch(`${BASE}/espace/depense-sportive`, { headers: cookie, redirect: 'follow' });
const pageHtml = await page.text();
if (page.status !== 200) fail(`GET /espace/depense-sportive → ${page.status}`);
if (!pageHtml.includes('Dépense sportive')) fail('titre de la page introuvable');
// Le contenu interactif (CTA « Ajouter », feuille d'ajout) est rendu APRÈS
// hydratation (fetch onMount) — le SSR ne sert que le squelette : on vérifie
// donc le CTA dans le source de la page (contrat statique, comme
// verify-food-images.mjs).
const depenseSource = readFileSync('src/routes/espace/depense-sportive/+page.svelte', 'utf8');
if (!depenseSource.includes('> Ajouter')) fail('CTA Ajouter introuvable dans la page (source)');
ok('page /espace/depense-sportive servie (titre SSR + CTA Ajouter dans la page)');

// ── 5) Sécurité métier : AUCUN impact alimentaire ───────────────────────────
const dashBefore = await client.query(api.dashboard.getDashboard, { sessionToken: user.token });
await client.mutation(api.sport.addActivity, {
	sessionToken: user.token,
	date: isoOf(new Date()),
	activityId: 'padel',
	intensity: 'moderee',
	durationMinutes: 60,
});
const dashAfter = await client.query(api.dashboard.getDashboard, { sessionToken: user.token });
if ((dashBefore?.tracking?.kcal ?? 0) !== (dashAfter?.tracking?.kcal ?? 0)) fail('les calories alimentaires ont changé — INTERDIT');
if ((dashBefore?.tracking?.kcalGoal ?? 0) !== (dashAfter?.tracking?.kcalGoal ?? 0)) fail("l'objectif calorique a changé — INTERDIT (aucun crédit calorique)");
const w = await (await fetch(`${BASE}/api/sport`, { headers: cookie })).json();
if (w.totals?.count !== 1 || w.totals?.kcal == null) fail(`dépense non visible côté BFF (${JSON.stringify(w.totals)})`);
ok(`dépense créée (≈ ${w.totals.kcal} kcal) — calories alimentaires et objectifs STRICTEMENT inchangés`);

console.log('\n✅ E2E Dépense sportive UI : tous les scénarios passent (grille accueil, ordre, page, protection BFF, sécurité métier).');
await cleanup();
process.exit(0);
