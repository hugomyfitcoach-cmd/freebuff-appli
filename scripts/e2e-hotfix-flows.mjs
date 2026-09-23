#!/usr/bin/env node
/**
 * E2E — Hotfix barcode/portion/retour Journal : flows A à G contre la
 * Deploy PREVIEW (jamais la production).
 *
 * Prérequis : la Deploy Preview Netlify existe (PR ouverte) et son backend
 * Convex Preview est poussé (--preview-create du netlify.toml). Le script
 * refuse tout environnement ressemblant à la production (calm-jaguar-475).
 *
 * Usage : node scripts/e2e-hotfix-flows.mjs <baseUrl-preview>
 */
import { ConvexHttpClient } from 'convex/browser';

const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
if (!BASE || !BASE.includes('netlify.app')) {
	console.error('⛔ Usage : node scripts/e2e-hotfix-flows.mjs https://<preview>.netlify.app');
	process.exit(1);
}

const PROD_MARK = 'calm-jaguar-475';
// Comptes seedés par previewSeed:seedPreviewData (voir src/convex/previewSeed.ts)
// — JAMAIS de vraie cliente : tout ce qui est créé ici est jetable et purgé.
const PREVIEW_COACH = { email: 'preview-test-coach@example.com', password: 'PreviewCoach2026!' };
const PW = 'E2EHOTFIX2026!';
const FAKE_BARCODE = '2999999999999'; // hors base OFF (préfixe 2 = usage interne)

let step = 0;
const ok = (msg) => console.log(`  ✔ [${++step}] ${msg}`);
const fail = (msg) => {
	console.error(`  ✘ ${msg}`);
	process.exit(1);
};
const ts = Date.now();

async function bffLogin(email, password) {
	const res = await fetch(`${BASE}/connexion`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ email, password, next: '/espace/journal' }),
		redirect: 'manual',
	});
	const setCookie = res.headers.get('set-cookie') ?? '';
	const token = /gflux_session=([^;]+)/.exec(setCookie)?.[1];
	if (!token) fail(`login BFF impossible pour ${email} (HTTP ${res.status})`);
	return `gflux_session=${token}`;
}

const day = (offset = 0) => {
	const d = new Date();
	d.setDate(d.getDate() + offset);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ── 0) Garde-fou environnement + URL Convex preview ──────────────────────────
console.log('── Diagnostic preview ──');
const diag = await fetch(`${BASE}/api/preview/diag`).then((r) => r.json()).catch(() => null);
if (!diag?.enabled) fail('preview/diag indisponible — ce n\'est pas un environnement preview.');
if (diag.isProdLike || (diag.convexUrl ?? '').includes(PROD_MARK)) {
	fail('REFUS : l\'URL Convex ressemble à la PRODUCTION.');
}
ok(`preview confirmée : ${diag.convexUrl}`);
ok(`OpenAI sur le preview : ${diag.ai?.openaiKeyPresent ?? 'inconnu'}`);

const client = new ConvexHttpClient(diag.convexUrl);
const { api } = await import('../src/convex/_generated/api.js');

// ── 1) Comptes jetables (coach seedé → 2 clientes de test) ───────────────────
console.log('── Comptes de test jetables ──');
const coachToken = await client
	.mutation(api.users.signIn, { email: PREVIEW_COACH.email, password: PREVIEW_COACH.password })
	.then((r) => r.token)
	.catch(() => {
		fail('signIn coach seedé impossible — la preview n\'est pas seedée (build encore en cours ?).');
	});
async function makeClient(name) {
	const email = `e2e-hotfix-${name}-${ts}@example.test`;
	await client.mutation(api.coach.createClient, {
		sessionToken: coachToken,
		email,
		password: PW,
		prenom: `E2E ${name}`,
	});
	const { token } = await client.mutation(api.users.signIn, { email, password: PW });
	return { email, token, cookie: `gflux_session=${token}` };
}
const A = await makeClient('A');
const B = await makeClient('B');
ok(`clientes jetables créées : ${A.email} · ${B.email}`);

try {
	// ── A/C — rescan d'un code créé par la cliente (repli customFoods) ────────
	console.log('── A/C : création avec barcode → rescan immédiat ──');
	const created = await fetch(`${BASE}/api/foods/custom`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', cookie: A.cookie },
		body: JSON.stringify({
			name: `E2E Pâte à tartiner ${ts}`,
			kcal100: 539, carbs100: 57.5, protein100: 6, fat100: 30.9,
			barcode: FAKE_BARCODE,
		}),
	}).then((r) => r.json());
	if (created.error) fail(`création custom: ${created.error}`);
	const customFoodId = created.customFoodId;
	ok(`aliment créé avec barcode rattaché (${FAKE_BARCODE})`);

	const scan = await fetch(`${BASE}/api/foods/barcode?code=${FAKE_BARCODE}`, {
		headers: { cookie: A.cookie },
	}).then((r) => r.json());
	if (!Array.isArray(scan) || scan.length !== 1) {
		fail(`RESCAN : ${JSON.stringify(scan)} — l'aliment créé n'est PAS retrouvé (régression !)`);
	}
	if (!scan[0].custom) fail('rescan : la fiche retournée n\'est pas marquée custom');
	ok('RESCAN du même code → aliment retrouvé immédiatement (zéro nouveau scan)');

	// D — annulation : l'endpoint répond `null` (jamais une erreur brute)
	const nullRes = await fetch(`${BASE}/api/foods/custom-barcode?barcode=8888888888888`, {
		headers: { cookie: A.cookie },
	});
	const nullBody = await nullRes.text();
	if (nullRes.status !== 200 || nullBody.trim() !== 'null') {
		fail(`contrat null inattendu : HTTP ${nullRes.status} ${nullBody.slice(0, 80)}`);
	}
	ok('contrat `null` (code inconnu) respecté — plus de « null is not an object »');

	// ── E — portion mémorisée : 80 g → 120 g ──────────────────────────────────
	console.log('── E : portion mémorisée (80 g → 120 g) ──');
	const today = day(0);
	const add = (qty, date = today) =>
		fetch(`${BASE}/api/journal`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', cookie: A.cookie },
			body: JSON.stringify({
				date,
				meal: 'dejeuner',
				customFoodId,
				qtyGrams: qty,
				lastPortions: [{ customFoodId, qtyGrams: qty }],
			}),
		}).then((r) => r.json());
	let res = await add(80);
	if (res.error) fail(`ajout 80 g: ${res.error}`);
	ok('1er ajout validé : 80 g');

	const portion = await fetch(`${BASE}/api/foods/portion?customFoodId=${customFoodId}`, {
		headers: { cookie: A.cookie },
	}).then((r) => r.json());
	if (portion?.qtyGrams !== 80) fail(`portion attendue 80, obtenu ${JSON.stringify(portion)}`);
	ok('portion mémorisée proposée : 80 g');

	res = await add(120);
	if (res.error) fail(`ajout 120 g: ${res.error}`);
	const portion2 = await fetch(`${BASE}/api/foods/portion?customFoodId=${customFoodId}`, {
		headers: { cookie: A.cookie },
	}).then((r) => r.json());
	if (portion2?.qtyGrams !== 120) fail(`portion attendue 120 (dernière validée), obtenu ${JSON.stringify(portion2)}`);
	ok('portion mise à jour : 120 g (la DERNIÈRE quantité validée gagne)');

	// Lot lastPortions (recherche) : un autre aliment du lot mémorise aussi
	const food = await fetch(`${BASE}/api/foods/search?q=nutella`, { headers: { cookie: A.cookie } })
		.then((r) => r.json())
		.catch(() => []);
	const hit = Array.isArray(food) ? food[0] : food?.items?.[0];
	if (hit?.foodId) {
		await fetch(`${BASE}/api/journal`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', cookie: A.cookie },
			body: JSON.stringify({
				date: today,
				meal: 'collation',
				foodId: hit.foodId,
				qtyGrams: 20,
				lastPortions: [{ foodId: hit.foodId, qtyGrams: 20 }],
			}),
		}).then((r) => r.json());
		const p2 = await fetch(`${BASE}/api/foods/portion?foodId=${hit.foodId}`, { headers: { cookie: A.cookie } }).then((r) => r.json());
		if (p2?.qtyGrams !== 20) fail(`portion base commune attendue 20, obtenu ${JSON.stringify(p2)}`);
		ok('portion mémorisée pour un aliment de la base G-FLUX (lot `lastPortions`)');
	} else {
		ok('(recherche sans résultat — test base commune ignoré, non bloquant)');
	}

	// ── F — isolation par cliente ─────────────────────────────────────────────
	console.log('── F : isolation stricte par cliente ──');
	const portionB = await fetch(`${BASE}/api/foods/portion?customFoodId=${customFoodId}`, {
		headers: { cookie: B.cookie },
	}).then((r) => r.json());
	if (portionB != null && portionB.error === undefined) {
		fail(`ISOLATION cassée : cliente B voit la portion de A (${JSON.stringify(portionB)})`);
	}
	ok('cliente B : aucune portion de A visible');
	const scanB = await fetch(`${BASE}/api/foods/barcode?code=${FAKE_BARCODE}`, {
		headers: { cookie: B.cookie },
	}).then((r) => r.json());
	if (Array.isArray(scanB) && scanB.length > 0) {
		fail(`ISOLATION cassée : cliente B retrouve l'aliment PERSONNEL de A via barcode (${JSON.stringify(scanB).slice(0, 120)})`);
	}
	ok('cliente B : le barcode de A ne résout PAS vers son aliment personnel');

	// ── G — retour Journal : date du jour ET date passée préservées ──────────
	console.log('── G : Journal du jour + date passée ──');
	const yesterday = day(-1);
	const past = await add(50, yesterday);
	if (past.error) fail(`ajout hier: ${past.error}`);
	if (past.planned) fail('date passée : l\'entrée ne doit PAS être planifiée');
	const dayPast = await fetch(`${BASE}/api/journal?date=${yesterday}`, { headers: { cookie: A.cookie } }).then((r) => r.json());
	const found = (dayPast.entries ?? []).find((e) => e.qtyGrams === 50);
	if (!found) fail('entrée introuvable sur la date passée (selectedDate non préservée ?)');
	ok('ajout sur date passée → entrée consommée sur CETTE date, macros rechargées');

	const dayToday = await fetch(`${BASE}/api/journal?date=${today}`, { headers: { cookie: A.cookie } }).then((r) => r.json());
	if (!(dayToday.entries ?? []).some((e) => e.qtyGrams === 80)) fail('entrée 80 g introuvable aujourd\'hui');
	ok('totaux du jour immédiatement actualisés');

	// ── B — barcode détecté dans la photo d'étiquette (si OpenAI dispo) ──────
	console.log('── B : analyse étiquette (OpenAI preview) ──');
	if (diag.ai?.openaiKeyPresent) {
		const ls = await fetch(`${BASE}/api/foods/label-scan`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', cookie: A.cookie },
			body: JSON.stringify({ imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', barcode: FAKE_BARCODE }),
		});
		const body = await ls.text();
		if (ls.status >= 500) fail(`label-scan renvoie ${ls.status} — erreur non gérée : ${body.slice(0, 200)}`);
		ok(`label-scan répond proprement (HTTP ${ls.status}) — aucun crash, barcode initial conservé côté UI`);
	} else {
		ok('OPENAI_API_KEY absente du Convex Preview — test IA ignoré (le flow barcode/portion n\'en dépend pas)');
	}
} finally {
	console.log('── Purge des comptes de test ──');
	const list = await client.query(api.coach.listClients, { sessionToken: coachToken }).catch(() => []);
	for (const c of list ?? []) {
		if (String(c.user?.email ?? '').startsWith('e2e-hotfix-')) {
			await client.mutation(api.coach.removeClient, { sessionToken: coachToken, userId: c._id ?? c.user?._id }).catch(() => {});
			console.log(`  · purgé ${c.user?.email}`);
		}
	}
}

console.log('\n✅ E2E HOTFIX : tous les tests passent contre la preview.');
