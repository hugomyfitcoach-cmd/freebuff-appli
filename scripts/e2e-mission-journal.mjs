#!/usr/bin/env node
/**
 * E2E — mission Journal : Dupliquer/Planifier + Créer un repas.
 *
 * Principe : on passe par les VRAIS endpoints HTTP du serveur local (les mêmes
 * que l'UI), avec un compte client de test clairement identifié (e2e-journal-…
 * @example.test) créé via le parcours coach. Aucune donnée réelle n'est touchée.
 *
 * Usage : node scripts/e2e-mission-journal.mjs [baseUrl]
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
if (!env.COACH_EMAIL || !env.COACH_PASSWORD) {
	console.error('⛔ COACH_EMAIL/COACH_PASSWORD absents de .env.local');
	process.exit(1);
}

const client = new ConvexHttpClient(env.PUBLIC_CONVEX_URL);
const { api } = await import('../src/convex/_generated/api.js');

const today = (() => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const targetDate = (() => {
	const d = new Date();
	d.setDate(d.getDate() + 2); // future → doit créer des items PLANIFIÉS
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

let step = 0;
const ok = (msg) => console.log(`  ✔ [${++step}] ${msg}`);
const fail = (msg) => {
	console.error(`  ✘ ${msg}`);
	process.exit(1);
};

console.log(`E2E mission Journal — base=${BASE}, today=${today}, cible=${targetDate}`);

// ── 1) Coach : session + compte client e2e ──────────────────────────────────
const coach = await client.mutation(api.users.signIn, { email: env.COACH_EMAIL, password: env.COACH_PASSWORD });
if (!coach?.token) fail('sign-in coach impossible');
ok(`session coach ouverte (${coach.user?.role})`);

const email = `e2e-journal-${Date.now()}@example.test`;
const created = await client.mutation(api.coach.createClient, {
	sessionToken: coach.token,
	email,
	password: 'e2e-journal-pass-1',
	prenom: 'E2E Journal',
});
if (!created?.ok) fail('création client e2e impossible');
ok(`client e2e créé : ${email}`);

// ── 2) Connexion client (comme l'app) ───────────────────────────────────────
const user = await client.mutation(api.users.signIn, { email, password: 'e2e-journal-pass-1' });
if (!user?.token) fail('sign-in client e2e impossible');
const token = user.token;
ok(`session client ouverte (${user.user?.role})`);

// Cookie de session pour les appels HTTP BFF (gflux_session, httpOnly).
const cookieHeader = `gflux_session=${token}`;

// ── 3) Un aliment dans le journal (jour même) ───────────────────────────────
const search = await fetch(`${BASE}/api/foods/search?q=yaourt`, { headers: { cookie: cookieHeader } });
const searchJ = await search.json();
const food = searchJ.items?.[0];
if (!food?._id) fail(`recherche aliment vide (${search.status})`);
ok(`aliment trouvé : ${food.name}${food.brand ? ` — ${food.brand}` : ''}`);

const addRes = await fetch(`${BASE}/api/journal`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
	body: JSON.stringify({ date: today, meal: 'petit-dej', foodId: food._id, qtyGrams: 120 }),
});
const added = await addRes.json();
if (!added?.entryId) fail(`ajout journal KO (${addRes.status}) ${JSON.stringify(added)}`);
ok(`entrée ajoutée au journal (${added.planned ? 'planifié' : 'consommé'}) : ${added.entryId}`);

// ── 4) Dupliquer vers une date FUTURE (=> items planifiés) ──────────────────
const dupRes = await fetch(`${BASE}/api/journal/duplicate`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
	body: JSON.stringify({ entryIds: [added.entryId], plannedIds: [], targetDate, clientDate: today }),
});
const dup = await dupRes.json();
if (dup?.error) fail(`duplicateEntries : ${dup.error}`);
if (typeof dup?.created !== 'number' || dup.created < 1) fail(`duplicateEntries : created=${dup?.created}`);
ok(`Dupliquer → ${dup.created} copie(s) Convex`);

// Vérification APRÈS coup (refresh) : la cible doit contenir un item PLANIFIÉ,
// l'original doit être intact.
const dayTarget = await (await fetch(`${BASE}/api/journal?date=${targetDate}`, { headers: { cookie: cookieHeader } })).json();
const plannedOnTarget = dayTarget.planned ?? [];
const copy = plannedOnTarget.find((p) => p.foodId === food._id && p.meal === 'petit-dej');
if (!copy) fail(`copie introuvable sur ${targetDate} (planned=${plannedOnTarget.length})`);
if (copy.qtyGrams !== 120) fail(`quantité non fidèle : ${copy.qtyGrams} g`);
ok(`après refresh : copie PLANIFIÉE sur ${targetDate} (${copy.qtyGrams} g, repas=${copy.meal})`);

const dayToday = await (await fetch(`${BASE}/api/journal?date=${today}`, { headers: { cookie: cookieHeader } })).json();
const original = (dayToday.entries ?? []).find((e) => e._id === added.entryId);
if (!original) fail('original disparu après duplication !');
ok(`après refresh : original intact sur ${today} (${original.qtyGrams} g)`);

// ── 4b) Dupliquer vers le JOUR MÊME (=> copie consommée, pas planifiée) ─────
const dup2Res = await fetch(`${BASE}/api/journal/duplicate`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
	body: JSON.stringify({ entryIds: [added.entryId], plannedIds: [], targetDate: today, clientDate: today }),
});
const dup2 = await dup2Res.json();
if (dup2?.error) fail(`duplicateEntries (jour même) : ${dup2.error}`);
const dayTodayPre = await (await fetch(`${BASE}/api/journal?date=${today}`, { headers: { cookie: cookieHeader } })).json();
const consumedCopy = (dayTodayPre.entries ?? []).filter((e) => e.foodId === food._id && e.meal === 'petit-dej');
if (consumedCopy.length < 2) fail(`copie consommée absente sur ${today} (${consumedCopy.length} ligne(s))`);
ok(`Dupliquer jour même → copie CONSOMMÉE présente (${consumedCopy.length} lignes au total)`);

// ── 5) Créer un repas depuis la sélection ───────────────────────────────────
const mealName = `E2E repas ${today}`;
const mealRes = await fetch(`${BASE}/api/meals`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
	body: JSON.stringify({
		fromSelection: true,
		name: mealName,
		ingredients: [
			{
				foodId: food._id,
				qtyGrams: 120,
				name: original.name,
				brand: original.brand,
				imageUrl: original.imageUrl,
				kcal: original.kcal,
				carbs: original.carbs,
				protein: original.protein,
				fat: original.fat,
			},
		],
	}),
});
const mealJ = await mealRes.json();
if (mealJ?.error) fail(`createMealFromSelection : ${mealJ.error}`);
if (!mealJ?.mealId) fail(`createMealFromSelection : pas de mealId (${JSON.stringify(mealJ)})`);
ok(`Créer un repas → mealId Convex`);

// Vérification APRÈS coup : le repas existe dans « Mes Repas ».
const meals = await (await fetch(`${BASE}/api/meals`, { headers: { cookie: cookieHeader } })).json();
const list = meals.items ?? meals.meals ?? meals;
const found = (Array.isArray(list) ? list : []).find((m) => m._id === mealJ.mealId);
if (!found) fail('repas introuvable dans Mes Repas après refresh');
ok(`après refresh : repas « ${found.name} » dans Mes Repas (${found.kcal} kcal)`);

// ── 6) Contrat « Mangé » (eatManyPlanned déployé) : un item PLANIFIÉ FUTUR
// doit être refusé par la LOGIQUE MÉTIER (message clair), jamais par un
// « Server Error » — preuve que le backend déployé accepte le contrat
// (clientDate inclus) et applique la garde « jamais manger au futur ».
const eatRes = await fetch(`${BASE}/api/journal/planned`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
	body: JSON.stringify({ plannedIds: [copy._id], clientDate: today }),
});
const eatJ = await eatRes.json();
// Contrat attendu : PAS de Server Error, et les items futurs sont ignorés
// (eaten: 0) — la garde « jamais manger au futur » saute silencieusement.
if (eatJ?.error) fail(`eatManyPlanned futur : ${eatJ.error}`);
if (/Server Error/i.test(String(eatJ?.error))) fail(`eatManyPlanned : Server Error brut`);
if (eatJ?.eaten !== 0) fail(`eatManyPlanned futur : eaten=${eatJ?.eaten} (attendu 0)`);
ok(`contrat « Mangé » OK : item futur ignoré (eaten=0, pas de Server Error)`);

console.log('\n✅ E2E mission Journal : les 2 parcours passent (duplication + repas), données vérifiées après refresh.');
process.exit(0);
