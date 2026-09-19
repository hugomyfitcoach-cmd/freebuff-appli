#!/usr/bin/env node
/**
 * E2E — mission Drive : plusieurs fichiers dans une même note.
 *
 * Principe : on passe par les VRAIS endpoints HTTP du serveur local (les mêmes
 * que l'UI), avec un compte cliente de test clairement identifié
 * (e2e-drive-…@example.test) créé via le parcours coach. La cliente de test
 * est supprimée à la fin (removeClient → purge Dossier + storage inclus).
 * Aucune donnée réelle n'est touchée.
 *
 * Vérifie :
 *  - POST multipart 3 fichiers + description → UNE seule entrée Drive
 *    (kind=file) avec 3 attachments ;
 *  - URL de lecture individuelle pour chaque pièce jointe ;
 *  - visibilité privée par défaut, PATCH shared visible côté cliente ;
 *  - description + attachments servis à la page cliente « Ressources » ;
 *  - compat ancienne forme (1 fichier) : createFileResource toujours OK ;
 *  - suppression → blobs storage réellement supprimés (404).
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

// ── 3) POST multipart : 3 fichiers + description → UNE entrée ───────────────
function tinyFile(name, mime, bytes) {
	return new File([new Uint8Array(bytes)], name, { type: mime });
}
const files = [
	tinyFile('photo-face.jpg', 'image/jpeg', 16),
	tinyFile('photo-profil.jpg', 'image/jpeg', 24),
	tinyFile('photo-dos.jpg', 'image/jpeg', 32),
];
const fd = new FormData();
fd.append('userId', clientUserId);
fd.append('title', 'Comparaison photos septembre (e2e)');
fd.append('description', 'Face, profil et dos — début de cycle.');
for (const f of files) fd.append('file', f);

const postRes = await fetch(`${BASE}/api/coach/resources`, { method: 'POST', body: fd, headers: { cookie: coachCookie } });
const postJ = await postRes.json();
if (!postRes.ok || !postJ.ok || !postJ.resourceId) fail(`POST multipart KO (${postRes.status}) ${JSON.stringify(postJ)}`);
ok(`POST multipart 3 fichiers + description → resourceId=${postJ.resourceId}`);

// ── 4) Lecture CRM : une seule entrée, 3 attachments avec URL ───────────────
const listRes = await fetch(`${BASE}/api/coach/resources?client=${encodeURIComponent(clientUserId)}`, { headers: { cookie: coachCookie } });
const listJ = await listRes.json();
if (!listRes.ok || listJ.error) fail(`GET resources KO (${listRes.status})`);
const entry = (listJ.rows ?? []).find((r) => r._id === postJ.resourceId);
if (!entry) fail('entrée introuvable dans la liste CRM');
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

// Aucune entrée parasite créée en plus pour cette cliente.
const mine = listJ.rows.filter((r) => r.userId === clientUserId);
if (mine.length !== 1) fail(`1 entrée attendue pour la cliente, trouvé ${mine.length}`);
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

// ── 7) Compat ancienne forme (1 fichier) ────────────────────────────────────
const legacy = await client.mutation(api.resources.addResource, {
	sessionToken: coach.token,
	userId: clientUserId,
	kind: 'file',
	title: 'Ancien doc 1 fichier (e2e)',
	storageId: entry.attachmentsWithUrls[0].storageId, // blob e2e déjà présent (supprimé ensuite avec l'entrée multi)
	mime: 'image/jpeg',
	name: 'photo-face.jpg',
	size: 16,
});
if (!legacy?.ok || !legacy.resourceId) fail('createFileResource (forme 1 fichier) KO');
ok('compat forme historique 1 fichier : createFileResource OK');

// ── 8) Suppression de l'entrée multi-fichiers → blobs purgés ────────────────
const delRes = await fetch(`${BASE}/api/coach/resources/${postJ.resourceId}`, { method: 'DELETE', headers: { cookie: coachCookie } });
const delJ = await delRes.json();
if (!delRes.ok || !delJ.ok) fail(`DELETE KO (${delRes.status})`);
for (const a of entry.attachmentsWithUrls) {
	const head = await fetch(a.url, { method: 'HEAD' });
	if (head.status !== 404) fail(`blob « ${a.name} » non supprimé (HTTP ${head.status})`);
}
ok('suppression : les 3 blobs storage sont réellement purgés (404)');

// ── 9) Nettoyage : suppression de la cliente e2e (purge Dossier + storage) ──
const removed = await client.mutation(api.coach.removeClient, { sessionToken: coach.token, userId: clientUserId });
if (!removed?.ok) fail('removeClient impossible');
ok('cliente e2e supprimée (Dossier + fichiers purgés)');

console.log(`\n✅ E2E Drive : ${step}/${step} vérifications vertes.`);
process.exit(0);
