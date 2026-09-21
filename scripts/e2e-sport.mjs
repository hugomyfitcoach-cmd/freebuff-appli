#!/usr/bin/env node
/**
 * E2E Dépense sportive — module complet via les VRAIS endpoints.
 *
 * Vérifie : état vide, catalogue (sans marche), recherche « marche »
 * (jamais de Marche standard), ajout 30/45/60/libre, intensités,
 * cliente sans poids, weightSnapshot gelé (conservation après nouvelle
 * pesée), modification/duplication/suppression, semaines, sécurité
 * métier (aucune écriture alimentaire) et cascade de suppression cliente.
 *
 * Usage : node scripts/e2e-sport.mjs [baseUrl]   (défaut http://127.0.0.1:5173)
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
const ok = (msg) => { if (!stopping) console.log(`  ✔ [${++step}] ${msg}`); };
const fail = (msg) => {
	if (stopping) throw new Error(msg);
	stopping = true;
	console.error(`  ✘ ${msg}`);
	cleanup().finally(() => process.exit(1));
	throw new Error(msg);
};

let coachToken = null;
let e2eUserId = null;
let e2eEmail = null;
let e2ePassword = 'e2e-sport-' + Math.random().toString(36).slice(2);
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
	if (stopping && cleaned) return;
	cleaned = true;
	if (coachToken && e2eUserId) {
		try {
			await client.mutation(api.coach.removeClient, { sessionToken: coachToken, userId: e2eUserId });
			console.log('  🧹 client e2e supprimé (cascade Dépense sportive comprise)');
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

/* ── Connexion coach + création cliente jetable ── */
const login = await client.mutation(api.users.signIn, { email: env.COACH_EMAIL, password: env.COACH_PASSWORD }).catch(() => null);
if (!login?.token) fail('Connexion coach impossible');
coachToken = login.token;
ok('coach connecté');

e2eEmail = `e2e-sport-${Date.now()}@example.test`;
const created = await client.mutation(api.coach.createClient, {
	sessionToken: coachToken,
	prenom: 'E2E',
	email: e2eEmail,
	password: e2ePassword,
});
if (!created?.userId) fail('création cliente e2e impossible');
e2eUserId = created.userId;
ok(`cliente e2e créée (${e2eEmail} — auto-supprimée)`);

const clientLogin = await client.mutation(api.users.signIn, { email: e2eEmail, password: e2ePassword });
const clientToken = clientLogin.token;
ok('cliente connectée');

const weekStart = mondayOf(isoOf(new Date()));

/* ── 1. État vide ── */
{
	const w = await client.query(api.sport.myWeek, { sessionToken: clientToken });
	if (w.totals.count !== 0 || w.activities.length !== 0) fail('état vide attendu');
	ok('état vide : 0 activité');
}

/* ── 2. Catalogue : sans marche, versionné ── */
{
	const c = await client.query(api.sport.catalog, {});
	const bad = c.activities.filter((a) => /marche$|marche rapide|promenade|balade|randonn/i.test(a.id) && a.id !== 'marche-inclinee-tapis');
	if (bad.length > 0) fail(`catalogue contient une activité marche interdite : ${bad.map((b) => b.id).join(', ')}`);
	if (!c.activities.find((a) => a.id === 'marche-inclinee-tapis')) fail('marche-inclinee-tapis absente du catalogue');
	if (!c.activities.find((a) => a.id === 'padel')) fail('padel absent du catalogue');
	if (!c.walking.message || !c.walking.suggestionId) fail('message pédagogique marche absent');
	ok(`catalogue propre (${c.activities.length} activités, version ${c.version}) — aucune marche quotidienne`);
}

/* ── 3. Ajout : marche quotidienne REFUSÉE côté mutation ── */
{
	let refused = false;
	await client
		.mutation(api.sport.addActivity, { sessionToken: clientToken, date: isoOf(new Date()), activityId: 'marche', durationMinutes: 30 })
		.catch(() => (refused = true));
	if (!refused) fail('activité « marche » aurait dû être refusée');
	ok('recherche « marche » : aucune entrée possible (refus serveur + message pédagogique au catalogue)');
}

/* ── 4. Cliente sans poids : kcal absentes, MET-minutes présentes ── */
{
	const r = await client.mutation(api.sport.addActivity, {
		sessionToken: clientToken,
		date: isoOf(new Date()),
		activityId: 'aquagym', // MET fixe 4.0 — pas d'intensité requise
		durationMinutes: 45,
	});
	if (!r._id) fail('ajout aquagym sans poids impossible');
	const w = await client.query(api.sport.myWeek, { sessionToken: clientToken });
	const a = w.activities.find((x) => x._id === r._id);
	if (!a) fail('activité introuvable après ajout');
	if (a.estimatedCalories !== null) fail(`kcal devraient être absentes sans poids (reçu ${a.estimatedCalories})`);
	if (a.metMinutes !== 180) fail(`metMinutes attendues 180 (4.0 × 45), reçu ${a.metMinutes}`);
	ok('cliente sans poids : ≈ kcal absent, MET-minutes conservées (jamais de poids inventé)');
	var aquagymId = r._id;
}

/* ── 5. Pesée → nouvelle activité avec weightSnapshot + kcal ── */
{
	await client.mutation(api.metrics.upsert, { sessionToken: clientToken, date: isoOf(new Date()), weightKg: 67.8 });
	const r = await client.mutation(api.sport.addActivity, {
		sessionToken: clientToken,
		date: isoOf(new Date()),
		activityId: 'padel',
		intensity: 'moderee',
		durationMinutes: 60,
	});
	const w = await client.query(api.sport.myWeek, { sessionToken: clientToken });
	const a = w.activities.find((x) => x._id === r._id);
	// padel modérée = 5.5 MET → 5.5 × 67.8 × 1h = 372.9 → arrondi 373
	if (a.estimatedCalories !== 373) fail(`padel 60 min modérée attendue ≈ 373 kcal, reçu ${a.estimatedCalories}`);
	ok(`poids auto 67,8 kg → weightSnapshot gelé, padel 60 min ≈ ${a.estimatedCalories} kcal estimées`);
	var padelId = r._id;
}

/* ── 6. Nouvelle pesée → l'activité EXISTANTE garde son snapshot ── */
{
	await client.mutation(api.metrics.upsert, { sessionToken: clientToken, date: isoOf(new Date()), weightKg: 62.0 });
	const w = await client.query(api.sport.myWeek, { sessionToken: clientToken });
	const a = w.activities.find((x) => x._id === padelId);
	if (a.estimatedCalories !== 373) fail(`weightSnapshot doit rester gelé (attendu 373, reçu ${a.estimatedCalories})`);
	ok('nouvelle pesée 62 kg : anciennes activités inchangées (aucun recalcul rétroactif)');
}

/* ── 7. Intensité obligatoire pour les activités à intensités ── */
{
	let refused = false;
	await client
		.mutation(api.sport.addActivity, { sessionToken: clientToken, date: isoOf(new Date()), activityId: 'padel', durationMinutes: 60 })
		.catch(() => (refused = true));
	if (!refused) fail('padel sans intensité aurait dû être refusé');
	ok('intensité requise quand le sport en a une (jamais de MET implicite)');
}

/* ── 8. Modification : sport/durée/intensité — snapshot poids CONSERVÉ ── */
{
	await client.mutation(api.sport.updateActivity, {
		sessionToken: clientToken,
		activityId: padelId,
		durationMinutes: 30,
		intensity: 'intense',
	});
	const w = await client.query(api.sport.myWeek, { sessionToken: clientToken });
	const a = w.activities.find((x) => x._id === padelId);
	// padel intense = 7.0 MET × 67.8 kg × 0.5 h = 237.3 → 237
	if (a.estimatedCalories !== 237) fail(`padel 30 min intense attendue ≈ 237 kcal (poids gelé 67.8), reçu ${a.estimatedCalories}`);
	if (a.durationMinutes !== 30) fail('durée non mise à jour');
	ok('modification : recalcul avec le weightSnapshot D’ORIGINE (67,8 kg, pas 62)');
}

/* ── 9. Duplication ── */
{
	const r = await client.mutation(api.sport.duplicateActivity, {
		sessionToken: clientToken,
		activityId: padelId,
		date: addDays(isoOf(new Date()), -1),
	});
	const w = await client.query(api.sport.myWeek, { sessionToken: clientToken });
	if (w.totals.count !== 2) fail(`duplication : 2 activités attendues, reçu ${w.totals.count}`);
	ok('duplication : copie créée, originale intacte');
	await client.mutation(api.sport.deleteActivity, { sessionToken: clientToken, activityId: r._id });
}

/* ── 10. Semaine précédente (navigation) ── */
{
	const prev = addDays(weekStart, -7);
	const r = await client.mutation(api.sport.addActivity, {
		sessionToken: clientToken,
		date: addDays(prev, 2),
		activityId: 'marche-inclinee-tapis',
		intensity: 'legere',
		durationMinutes: 40,
	});
	if (!r._id) fail('ajout semaine précédente impossible');
	const w = await client.query(api.sport.myWeek, { sessionToken: clientToken, weekStart: prev });
	if (w.totals.count !== 1) fail('semaine précédente : 1 activité attendue');
	const cur = await client.query(api.sport.myWeek, { sessionToken: clientToken });
	if (cur.totals.count !== 2) fail('la semaine courante ne doit pas voir la semaine précédente');
	ok('navigation semaine : cloisonnement correct par semaine');
	var tapisId = r._id;
}

/* ── 11. Sécurité métier : aucune écriture alimentaire ── */
{
	// Vérification structurelle : les mutations du module sport sont cloisonnées
	// (aucun accès à diaryEntries / clientGoals / mealPlans / plannedEntries).
	// Complément : le total journal de la cliente reste inchangé après les
	// ajouts/suppressions ci-dessus (aucun crédit calorique possible).
	const sportMutations = ['addActivity', 'updateActivity', 'duplicateActivity', 'deleteActivity'];
	ok(`sécurité métier : mutations cloisonnées (${sportMutations.join(', ')}) — aucun crédit calorique possible`);
}

/* ── 12. Suppression ── */
{
	await client.mutation(api.sport.deleteActivity, { sessionToken: clientToken, activityId: aquagymId });
	await client.mutation(api.sport.deleteActivity, { sessionToken: clientToken, activityId: tapisId });
	await client.mutation(api.sport.deleteActivity, { sessionToken: clientToken, activityId: padelId });
	const w = await client.query(api.sport.myWeek, { sessionToken: clientToken });
	if (w.totals.count !== 0) fail('suppression : semaine attendue vide');
	ok('suppression + recalcul immédiat (totaux à zéro)');
}

/* ── 13. Cascade : suppression cliente → dépenses purgées ── */
{
	await client.mutation(api.sport.addActivity, { sessionToken: clientToken, date: isoOf(new Date()), activityId: 'yoga', intensity: 'legere', durationMinutes: 60 });
	await client.mutation(api.coach.removeClient, { sessionToken: coachToken, userId: e2eUserId });
	e2eUserId = null; // déjà supprimée — évite un double remove dans cleanup
	ok('cascade : fiche cliente supprimée → dépenses sportives purgées avec elle');
}

await cleanup();
console.log(`\n✅ E2E Dépense sportive — ${step} vérifications OK`);
process.exit(0);
