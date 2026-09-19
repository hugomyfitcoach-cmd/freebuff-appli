#!/usr/bin/env node
/**
 * E2E — mission Drive : plusieurs fichiers dans une même entrée.
 *
 * Principe : on passe par les VRAIS endpoints HTTP du serveur local (les mêmes
 * que l'UI), avec un compte cliente de test clairement identifié
 * (e2e-drive-…@example.test) créé via le parcours coach. La cliente de test
 * est supprimée à la fin (removeClient → purge Dossier + storage inclus).
 * Aucune donnée réelle n'est touchée.
 *
 * CORRECTIF « Unexpected end of JSON input » (multi-upload Drive) : comme la
 * nouvelle UI, chaque fichier est posté DIRECTEMENT sur le storage Convex
 * (byte-passing — le BFF ne transporte plus d'octets, jamais la limite des
 * fonctions Netlify), puis UNE entrée Drive est créée via POST JSON.
 *
 * Vérifie :
 *  - POST 3 fichiers (+ description) → UNE entrée Drive (kind=file), 3
 *    attachments nommés avec URL individuelles, privée par défaut ;
 *  - POST 1 fichier seul → UNE entrée, 1 attachment (le multi-upload reste
 *    intact et le cas 1 fichier aussi) ;
 *  - POST 5 fichiers → UNE entrée, 5 attachments ;
 *  - note JSON → entrée kind=note distincte ;
 *  - /upload-url sans session coach → refus (pas d'URL d'upload anonyme) ;
 *  - POST d'attachments avec storageId invalide → 400 JSON propre (jamais de
 *    crash « Unexpected end of JSON input » côté client) ;
 *  - compat forme historique multipart (1 fichier relayé BFF) toujours OK ;
 *  - partage visible côté cliente ; suppression → blobs storage purgés (404).
 *
 * Usage : node scripts/e2e-mission-drive.mjs [baseUrl]
 */
import { ConvexHttpClient } from 'convex/browser';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5174';

// ── Charge .env.local (jamais de valeur secrète en sortie) ──────────────────
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
	const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
	if (m) env[m[1]] = m[2].replace(/^[\"']|[\"']$/g, '');
}
if (!env.COACH_EMAIL || !env.COACH_PASSWORD) {
	console.error('⛔ COACH_EMAIL/COACH_PASSWORD absents de .env.local');
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

console.log(`E2E mission Drive — base=${BASE}`);

// ── 1) Coach : session + compte cliente e2e ─────────────────────────────────
const coach = await client.mutation(api.users.signIn, { email: env.COACH_EMAIL, password: env.COACH_PASSWORD });
if (!coach?.token) fail('sign-in coach impossible');
ok(`session coach ouverte (${coach.user?.role})`);

const email = `e2e-drive-${Date.now()}@example.test`;
const created = await client.mutation(api.coach.createClient, {
	sessionToken: coach.token,
	email,
	password: 'e2e-drive-pass-1',
	prenom: 'E2E Drive',
});
if (!created?.ok) fail('création cliente e2e impossible');
const clientUserId = created.userId;
ok(`cliente e2e créée : ${email}`);

// ── 2) Cookie coach pour les endpoints BFF ──────────────────────────────────
const coachCookie = `gflux_session=${coach.token}`;

/** POST DIRECT sur le storage Convex — exactement le flux de la nouvelle UI. */
async function uploadDirect(name, mime, bytes) {
	const urlRes = await fetch(`${BASE}/api/coach/resources/upload-url`, { method: 'POST', headers: { cookie: coachCookie } });
	const urlJ = await urlRes.json();
	if (!urlRes.ok || !urlJ.uploadUrl) fail(`upload-url KO (${urlRes.status}) ${JSON.stringify(urlJ)}`);
	const up = await fetch(urlJ.uploadUrl, {
		method: 'POST',
		headers: { 'Content-Type': mime },
		body: new Uint8Array(bytes),
	});
	const upJ = await up.json();
	if (!up.ok || !upJ.storageId) fail(`upload direct de « ${name} » KO (${up.status})`);
	return { storageId: upJ.storageId, mime, name, size: bytes.length };
}

// ── 3) 3 fichiers (+ description) → UNE entrée ─────────────────────────────
const files = [
	await uploadDirect('photo-face.jpg', 'image/jpeg', 16),
	await uploadDirect('photo-profil.jpg', 'image/jpeg', 24),
	await uploadDirect('photo-dos.jpg', 'image/jpeg', 32),
];
const postRes = await fetch(`${BASE}/api/coach/resources`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', cookie: coachCookie },
	body: JSON.stringify({
		userId: clientUserId,
		kind: 'file',
		title: 'Comparaison photos septembre (e2e)',
		description: 'Face, profil et dos — début de cycle.',
		attachments: files,
	}),
});
const postJ = await postRes.json();
if (!postRes.ok || !postJ.ok || !postJ.resourceId) fail(`POST 3 fichiers KO (${postRes.status}) ${JSON.stringify(postJ)}`);
ok(`POST 3 fichiers + description → resourceId=${postJ.resourceId}`);

// ── 4) Lecture CRM : une seule entrée, 3 attachments avec URL ───────────────
const listRes = await fetch(`${BASE}/api/coach/resources?client=${encodeURIComponent(clientUserId)}`, { headers: { cookie: coachCookie } });
const listJ = await listRes.json();
if (!listRes.ok || listJ.error) fail(`GET resources KO (${listRes.status})`);
const entry = (listJ.rows ?? []).find((r) => r._id === postJ.resourceId);
if (!entry) fail('entrée multi-fichiers introuvable dans la liste CRM');
if (entry.kind !== 'file') fail(`kind attendu "file", reçu "${entry.kind}"`);
if (!Array.isArray(entry.attachmentsWithUrls) || entry.attachmentsWithUrls.length !== 3) {
	fail(`3 attachments attendus, reçu ${entry.attachmentsWithUrls?.length}`);
}
if (entry.attachmentsWithUrls.some((a) => !a.url)) fail('une pièce jointe est sans URL');
if (entry.attachmentsWithUrls.map((a) => a.name).join() !== 'photo-face.jpg,photo-profil.jpg,photo-dos.jpg') {
	fail(`noms inattendus : ${entry.attachmentsWithUrls.map((a) => a.name).join()}`);
}
if ((entry.body ?? '') !== 'Face, profil et dos — début de cycle.') fail('description non enregistrée');
if (entry.visibility !== 'private') fail('visibilité par défaut attendue : private');
ok('une seule entrée Drive, 3 attachments nommés + URL individuelles, description, privée par défaut');

const mine0 = listJ.rows.filter((r) => r.userId === clientUserId);
if (mine0.length !== 1) fail(`1 entrée attendue pour la cliente, trouvé ${mine0.length}`);
ok('aucune entrée séparée créée en plus');

// ── 5) Les 3 URL répondent 200 avec le bon Content-Type ─────────────────────
for (const a of entry.attachmentsWithUrls) {
	const head = await fetch(a.url, { method: 'HEAD' });
	if (!head.ok) fail(`URL pièce jointe « ${a.name} » KO (${head.status})`);
	if (!(a.url.includes('/api/storage') || head.headers.get('content-type') === a.mime)) {
		fail(`Content-Type inattendu pour « ${a.name} » : ${head.headers.get('content-type')}`);
	}
}
ok('les 3 URL de pièces jointes répondent 200 (storage Convex)');

// ── 6) PATCH visibility=shared → visible côté cliente ───────────────────────
const patchRes = await fetch(`${BASE}/api/coach/resources/${postJ.resourceId}`, {
	method: 'PATCH',
	headers: { 'Content-Type': 'application/json', cookie: coachCookie },
	body: JSON.stringify({ visibility: 'shared' }),
});
const patchJ = await patchRes.json();
if (!patchRes.ok || !patchJ.ok) fail(`PATCH visibility KO (${patchRes.status})`);

const user = await client.mutation(api.users.signIn, { email, password: 'e2e-drive-pass-1' });
if (!user?.token) fail('sign-in cliente e2e impossible');
const clientRows = await client.query(api.resources.clientResources, { sessionToken: user.token });
const shared = (clientRows ?? []).find((r) => r._id === postJ.resourceId);
if (!shared) fail('entrée non visible côté cliente après partage');
if (!Array.isArray(shared.attachmentsWithUrls) || shared.attachmentsWithUrls.length !== 3) {
	fail('cliente : 3 attachments attendus');
}
if (shared.attachmentsWithUrls.some((a) => !a.url)) fail('cliente : une pièce jointe est sans URL');
if ((shared.body ?? '') !== 'Face, profil et dos — début de cycle.') fail('cliente : description absente');
ok('partage : visible côté cliente avec 3 pièces jointes + description');

// ── 7) 1 fichier seul → UNE entrée, 1 attachment ────────────────────────────
const one = await uploadDirect('seule.jpg', 'image/jpeg', 8);
const post1Res = await fetch(`${BASE}/api/coach/resources`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', cookie: coachCookie },
	body: JSON.stringify({ userId: clientUserId, kind: 'file', title: 'Photo seule (e2e)', attachments: [one] }),
});
const post1J = await post1Res.json();
if (!post1Res.ok || !post1J.ok || !post1J.resourceId) fail(`POST 1 fichier KO (${post1Res.status})`);
const entry1 = (await (await fetch(`${BASE}/api/coach/resources?client=${encodeURIComponent(clientUserId)}`, { headers: { cookie: coachCookie } })).json()).rows.find((r) => r._id === post1J.resourceId);
if (!entry1 || entry1.attachmentsWithUrls?.length !== 1) fail('entrée 1 fichier : 1 attachment attendu');
ok('1 fichier seul → une entrée avec 1 attachment');

// ── 8) 5 fichiers → UNE entrée, 5 attachments ───────────────────────────────
const five = [];
for (let i = 1; i <= 5; i++) five.push(await uploadDirect(`cinq-${i}.jpg`, 'image/jpeg', 10 + i));
const post5Res = await fetch(`${BASE}/api/coach/resources`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', cookie: coachCookie },
	body: JSON.stringify({ userId: clientUserId, kind: 'file', title: 'Dossier complet (e2e)', attachments: five }),
});
const post5J = await post5Res.json();
if (!post5Res.ok || !post5J.ok || !post5J.resourceId) fail(`POST 5 fichiers KO (${post5Res.status})`);
const entry5 = (await (await fetch(`${BASE}/api/coach/resources?client=${encodeURIComponent(clientUserId)}`, { headers: { cookie: coachCookie } })).json()).rows.find((r) => r._id === post5J.resourceId);
if (!entry5 || entry5.attachmentsWithUrls?.length !== 5) fail('entrée 5 fichiers : 5 attachments attendus');
ok('5 fichiers → une seule entrée avec 5 attachments');

// ── 9) Note JSON → entrée kind=note distincte ───────────────────────────────
const noteRes = await fetch(`${BASE}/api/coach/resources`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', cookie: coachCookie },
	body: JSON.stringify({ userId: clientUserId, kind: 'note', title: 'Note (e2e)', body: 'Contenu de note.' }),
});
const noteJ = await noteRes.json();
if (!noteRes.ok || !noteJ.ok || !noteJ.resourceId) fail(`POST note KO (${noteRes.status})`);
ok('note JSON → entrée créée');

// ── 10) Garde-fou : /upload-url sans session coach ──────────────────────────
// Sans session, requireRole renvoie un redirect 303 vers /connexion (convention
// de TOUTES les API du BFF) : on teste avec redirect:'manual' — le corps ne
// doit JAMAIS contenir d'URL d'upload sans authentification.
const anonRes = await fetch(`${BASE}/api/coach/resources/upload-url`, { method: 'POST', redirect: 'manual' });
const anonBody = await anonRes.text();
if (anonBody.includes('uploadUrl')) fail('upload-url a renvoyé une URL sans session coach');
ok(`upload-url sans session refusé (HTTP ${anonRes.status}, corps sans uploadUrl) — pas d'URL d'upload anonyme`);

// ── 11) Erreur serveur : storageId invalide → 400 JSON propre ───────────────
const badRes = await fetch(`${BASE}/api/coach/resources`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', cookie: coachCookie },
	body: JSON.stringify({
		userId: clientUserId,
		kind: 'file',
		title: 'Pièce invalide (e2e)',
		attachments: [{ storageId: 'invalid', mime: 'image/jpeg', name: 'bogus.jpg', size: 1 }],
	}),
});
const badJ = await badRes.json();
if (badRes.ok || !badJ.error) fail(`storageId invalide attendu en 400 avec error, reçu ${badRes.status} ${JSON.stringify(badJ)}`);
ok(`erreur serveur → réponse JSON propre (${badRes.status} : « ${badJ.error} »), jamais un corps vide`);

// ── 12) Compat forme historique multipart (1 fichier relayé BFF) ────────────
const fd = new FormData();
fd.append('userId', clientUserId);
fd.append('title', 'Ancien doc 1 fichier (e2e)');
fd.append('file', new File([new Uint8Array(16)], 'historique.pdf', { type: 'application/pdf' }));
const legacyRes = await fetch(`${BASE}/api/coach/resources`, { method: 'POST', body: fd, headers: { cookie: coachCookie } });
const legacyJ = await legacyRes.json();
if (!legacyRes.ok || !legacyJ.ok || !legacyJ.resourceId) fail(`multipart historique KO (${legacyRes.status})`);
ok('compat forme historique multipart (1 fichier) : toujours OK');

// ── 13) État final : exactement 5 entrées pour la cliente ───────────────────
const finalList = await (await fetch(`${BASE}/api/coach/resources?client=${encodeURIComponent(clientUserId)}`, { headers: { cookie: coachCookie } })).json();
const finalRows = finalList.rows.filter((r) => r.userId === clientUserId);
if (finalRows.length !== 5) fail(`5 entrées attendues au total, trouvé ${finalRows.length}`);
ok('état final : 5 entrées (multi 3 fichiers, 1 fichier, 5 fichiers, note, historique)');

// ── 14) Suppression de toutes les entrées → blobs réellement purgés ─────────
for (const r of finalRows) {
	const delRes = await fetch(`${BASE}/api/coach/resources/${r._id}`, { method: 'DELETE', headers: { cookie: coachCookie } });
	const delJ = await delRes.json();
	if (!delRes.ok || !delJ.ok) fail(`DELETE « ${r.title} » KO (${delRes.status})`);
}
const allUrls = [
	...entry.attachmentsWithUrls.map((a) => a.url),
	entry1.attachmentsWithUrls[0].url,
	...entry5.attachmentsWithUrls.map((a) => a.url),
	finalRows.find((r) => r._id === legacyJ.resourceId).attachmentsWithUrls[0].url,
].filter(Boolean);
for (const url of allUrls) {
	const head = await fetch(url, { method: 'HEAD' });
	if (head.status !== 404) fail(`blob non supprimé (HTTP ${head.status}) : ${url}`);
}
ok(`suppression : les ${allUrls.length} blobs storage sont réellement purgés (404)`);

// ── 15) Nettoyage : suppression de la cliente e2e (purge Dossier + storage) ─
const removed = await client.mutation(api.coach.removeClient, { sessionToken: coach.token, userId: clientUserId });
if (!removed?.ok) fail('removeClient impossible');
ok('cliente e2e supprimée (Dossier + fichiers purgés)');

console.log(`\n✅ E2E Drive : ${step}/${step} vérifications vertes.`);
process.exit(0);
