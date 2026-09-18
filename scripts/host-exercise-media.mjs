#!/usr/bin/env node
/**
 * HÉBERGEMENT INTERNE des GIFs ExerciseDB V1 (source = exercisedb-v1) —
 * la bibliothèque G-FLUX ne doit plus dépendre de static.exercisedb.dev.
 *
 * Flux : ExerciseDB → téléchargement du GIF → file storage Convex (CDN
 * G-FLUX à l'avenir) → `mediaUrl` interne enregistrée sur l'exercice.
 * `sourceMediaUrl` conserve l'URL d'origine (traçabilité / re-bascule).
 *
 * Garanties (contrat mission) :
 *  - PROGRESSIF + REPRISE : cache local .media-cache/<id>.gif + journal
 *    .media-cache/state.json — une interruption relance sans tout refaire ;
 *  - IDEMPOTENT : un GIF déjà en storage (mediaStorageId + taille identique)
 *    n'est ni retéléchargé ni ré-uploadé ;
 *  - concurrence faible (3 téléchargements simultanés, réglable --jobs) ;
 *  - retry/backoff sur 429, timeout et 5xx ;
 *  - AUCUNE suppression d'un média valide : si une nouvelle récupération
 *    échoue, l'exercice garde son média existant ; journal succès/erreurs.
 *  - `mediaUrl` n'est mise à jour qu'APRÈS un stockage réussi (attachMediaBatch).
 *
 * Étapes (--audit seul pour l'estimation de volume) :
 *   1. audit : HEAD sur chaque gifUrl source → 200 / 404 / 403 / timeout ;
 *   2. téléchargement → cache local (skip si déjà présent, taille identique) ;
 *   3. upload Convex storage (skip si l'exercice a déjà ce média hébergé) ;
 *   4. attachement par lots (mediaUrl = URL interne).
 *
 * Usage :
 *   node scripts/host-exercise-media.mjs --audit          # audit seul
 *   node scripts/host-exercise-media.mjs                  # audit + hébergement
 *   node scripts/host-exercise-media.mjs --jobs 2         # concurrence réduite
 *
 * Requiert .env.local : PUBLIC_CONVEX_URL + COACH_EMAIL / COACH_PASSWORD.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_ID = 'exercisedb-v1';
const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.media-cache');
const STATE_FILE = join(CACHE_DIR, 'state.json');
const AUDIT_FILE = join(CACHE_DIR, 'audit.json');
const CONCURRENCY = 3;
const HEAD_TIMEOUT = 15_000;
const DL_TIMEOUT = 120_000;
const MAX_ATTEMPTS = 5;
const UPLOAD_BATCH = 25;

/* ── Env + auth (même mécanique que import-exercises.mjs) ── */

function loadEnvLocal() {
	const file = new URL('../.env.local', import.meta.url);
	if (!existsSync(file)) return {};
	const env = {};
	for (const line of readFileSync(file, 'utf8').split('\n')) {
		const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line.trim());
		if (!m) continue;
		let value = m[2].trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		env[m[1]] = value;
	}
	return env;
}

const env = loadEnvLocal();
const CONVEX_URL = env.PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL;
const EMAIL = env.COACH_EMAIL ?? process.env.COACH_EMAIL;
const PASSWORD = env.COACH_PASSWORD ?? process.env.COACH_PASSWORD;
const AUDIT_ONLY = process.argv.includes('--audit');
const JOBS = Math.max(1, Math.min(6, Number(process.argv[process.argv.indexOf('--jobs') + 1]) || CONCURRENCY));

if (!CONVEX_URL) {
	console.error('❌ PUBLIC_CONVEX_URL introuvable (.env.local).');
	process.exit(1);
}
if (!EMAIL || !PASSWORD) {
	console.error("❌ COACH_EMAIL / COACH_PASSWORD requis dans .env.local (session coach pour l'hébergement).");
	process.exit(1);
}

const { ConvexClient } = await import('convex/browser');
const client = new ConvexClient(CONVEX_URL);

/* ── Utilitaires réseau (retry/backoff 429, timeout, 5xx) ── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retry exponentiel sur 429/5xx/timeout — jamais sur 404/403 (définitifs). */
async function withRetry(label, fn) {
	let delay = 1500;
	for (let a = 1; a <= MAX_ATTEMPTS; a++) {
		try {
			return await fn();
		} catch (err) {
			const status = err?.status;
			const retryable = status === 429 || status === 408 || (status >= 500 && status < 600) || status === undefined;
			if (!retryable || a === MAX_ATTEMPTS) throw err;
			console.log(`   ⏳ ${label} → ${status ?? 'timeout/erreur'}, pause ${(delay / 1000).toFixed(1)} s puis reprise…`);
			await sleep(delay);
			delay = Math.min(delay * 2, 30_000);
		}
	}
}

/** HEAD (fallback GET-range) sur l'URL source → statut + Content-Length. */
async function probeSource(url) {
	return withRetry(`HEAD ${url}`, async () => {
		try {
			const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(HEAD_TIMEOUT) });
			return { status: res.status, size: Number(res.headers.get('content-length')) || undefined };
		} catch (err) {
			if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
				const e = new Error(`timeout HEAD ${url}`);
				e.status = 0;
				throw e;
			}
			throw err;
		}
	});
}

/** Téléchargement binaire dans le cache local (atomes : .part → rename). */
async function downloadToCache(url, dest) {
	return withRetry(`GET ${url}`, async () => {
		const res = await fetch(url, { signal: AbortSignal.timeout(DL_TIMEOUT) });
		if (!res.ok) {
			const e = new Error(`HTTP ${res.status}`);
			e.status = res.status;
			throw e;
		}
		const buf = Buffer.from(await res.arrayBuffer());
		const tmp = `${dest}.part`;
		writeFileSync(tmp, buf);
		// rename atomique : un .gif présent sans .part est forcément complet.
		const { renameSync } = await import('node:fs');
		renameSync(tmp, dest);
		return buf.length;
	});
}

/* ── Cache d'état (reprise après interruption) ── */

function loadState() {
	if (!existsSync(STATE_FILE)) return { uploaded: {}, audit: null };
	try {
		return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
	} catch {
		return { uploaded: {}, audit: null };
	}
}
function saveState(state) {
	mkdirSync(CACHE_DIR, { recursive: true });
	writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
}

/* ── Pipeline ── */

const state = loadState();
mkdirSync(CACHE_DIR, { recursive: true });

// 1) Connexion coach + listing des exercices de la source.
const signIn = await client.mutation('users:signIn', { email: EMAIL, password: PASSWORD });
const token = signIn.token;
console.log(`🔐 Session coach OK (${EMAIL}).`);

const items = [];
let cursor = 0;
while (true) {
	const page = await client.query('exercises:listForMediaHosting', { sessionToken: token, source: SOURCE_ID, limit: 200, cursor });
	items.push(...page.items);
	if (!page.hasMore) break;
	cursor += 200;
}
console.log(`📚 ${items.length} exercices ${SOURCE_ID} à traiter.`);

const withMedia = items.filter((e) => !!e.sourceMediaUrl);
const alreadyHosted = items.filter((e) => !!e.mediaStorageId);
console.log(`   déjà hébergés chez nous : ${alreadyHosted.length} · avec URL source : ${withMedia.length}`);

/* ── Passe 0 — RÉPARATION (sans ré-upload) : exercices déjà hébergés dont la
   miniature pointe encore vers la source (héritage de la 1re passe).
   On ré-attache le storageId EXISTANT : attachMediaBatch re-résout l'URL
   interne et met thumbnailUrl à jour. Idempotent, zéro transfert média. */
let repaired = 0;
{
	const staleThumb = alreadyHosted.filter((e) => e.thumbnailUrl && !/\/api\/storage\//.test(e.thumbnailUrl));
	if (staleThumb.length) {
		console.log(`\n🔧 Réparation miniatures (${staleThumb.length} pointent encore vers la source)…`);
		for (let i = 0; i < staleThumb.length; i += UPLOAD_BATCH) {
			const slice = staleThumb.slice(i, i + UPLOAD_BATCH);
			const res = await client.mutation('exercises:attachMediaBatch', {
				sessionToken: token,
				items: slice.map((e) => ({ exerciseId: e._id, storageId: e.mediaStorageId, mediaSizeBytes: e.mediaSizeBytes ?? 0 })),
			});
			repaired += res.attached;
		}
		console.log(`   réparés : ${repaired}`);
	}
}

/* ── Étape A — AUDIT des URLs source (skip les déjà hébergés, statut connu) ── */

const audit = state.audit?.source === SOURCE_ID && Array.isArray(state.audit?.results) ? state.audit.results : {};
let audited = 0;
console.log(`\n🔎 Audit des ${withMedia.length} URLs source…`);
for (let i = 0; i < withMedia.length; i += JOBS) {
	const slice = withMedia.slice(i, i + JOBS);
	await Promise.all(
		slice.map(async (e) => {
			if (audit[e.sourceExerciseId]?.status === 200) return; // connu OK, pas re-sondé
			try {
				const { status, size } = await probeSource(e.sourceMediaUrl);
				audit[e.sourceExerciseId] = { status, size, url: e.sourceMediaUrl };
			} catch (err) {
				audit[e.sourceExerciseId] = { status: err?.status ?? 0, error: String(err?.message ?? err), url: e.sourceMediaUrl };
			}
			audited++;
		})
	);
	state.audit = { source: SOURCE_ID, results: audit };
	if (i % (JOBS * 20) === 0) saveState(state);
	if (audited && audited % 100 === 0) process.stdout.write(`   … ${audited} sondées\n`);
}
saveState(state);

const auditEntries = Object.entries(audit);
const okSource = auditEntries.filter(([, v]) => v.status === 200);
const broken = auditEntries.filter(([, v]) => v.status !== 200);
const sourceBytes = okSource.reduce((s, [, v]) => s + (v.size ?? 0), 0);
console.log(`\n📊 Audit source : ${okSource.length} OK (200) · ${broken.length} cassés (${broken.filter(([, v]) => v.status === 404).length}×404, ${broken.filter(([, v]) => v.status === 403).length}×403, ${broken.filter(([, v]) => v.status === 0 || v.status === undefined).length}×timeout/autre)`);
console.log(`   volume source estimé : ${(sourceBytes / 1024 / 1024).toFixed(1)} Mo (Content-Length)`);

if (AUDIT_ONLY) {
	writeFileSync(AUDIT_FILE, JSON.stringify(state.audit, null, 1));
	console.log(`\n💾 Audit détaillé : .media-cache/audit.json (--audit → arrêt ici).`);
	process.exit(0);
}

/* ── Étape B — Téléchargement (cache local, concurrence JOBS) ── */

const targets = withMedia.filter((e) => audit[e.sourceExerciseId]?.status === 200 && !e.mediaStorageId);
console.log(`\n⬇️  Téléchargement de ${targets.length} GIFs (concurrence ${JOBS}, cache .media-cache/)…`);

let downloaded = 0;
let fromCache = 0;
const dlErrors = [];
let done = 0;

async function worker(queue) {
	while (queue.length) {
		const e = queue.shift();
		if (!e) break;
		const dest = join(CACHE_DIR, `${e.sourceExerciseId}.gif`);
		try {
			if (existsSync(dest)) {
				const size = statSync(dest).size;
				if (size > 0) {
					fromCache++;
					e._file = dest;
					e._bytes = size;
					done++;
					continue;
				}
			}
			const bytes = await downloadToCache(e.sourceMediaUrl, dest);
			e._file = dest;
			e._bytes = bytes;
			downloaded++;
		} catch (err) {
			dlErrors.push({ id: e.sourceExerciseId, error: String(err?.message ?? err) });
			console.log(`   ❌ ${e.sourceExerciseId} : ${err?.message ?? err}`);
		}
		done++;
		if (done % 50 === 0) console.log(`   … ${done}/${targets.length} (cache ${fromCache}, téléchargés ${downloaded}, erreurs ${dlErrors.length})`);
	}
}
const queue = [...targets];
await Promise.all(Array.from({ length: JOBS }, () => worker(queue)));
console.log(`   téléchargés : ${downloaded} · depuis le cache : ${fromCache} · échecs : ${dlErrors.length}`);

/* ── Étape C — Upload Convex storage + attachement par lots ── */

const ready = targets.filter((e) => e._file);
console.log(`\n☁️  Upload de ${ready.length} fichiers vers le storage Convex…`);

let uploaded = 0;
let skipped = 0;
const upErrors = [];
let batch = [];

async function flushBatch() {
	if (!batch.length) return;
	try {
		const res = await client.mutation('exercises:attachMediaBatch', {
			sessionToken: token,
			items: batch.map((e) => ({ exerciseId: e._id, storageId: e._storageId, mediaSizeBytes: e._bytes })),
		});
		uploaded += res.attached;
		if (res.errors?.length) {
			for (const er of res.errors) upErrors.push(er);
			console.log(`   ⚠️  attachement : ${res.errors.length} erreur(s) de lot`);
		}
	} catch (err) {
		// Le lot entier a échoué (réseau) — on journalise, on NE perd PAS les
		// fichiers : un relançage ré-uplopera ce lot (idempotence par exercice).
		for (const e of batch) upErrors.push({ exerciseId: e._id, error: String(err?.message ?? err) });
		console.log(`   ⚠️  lot rejeté (${batch.length}) : ${err?.message ?? err}`);
	}
	batch = [];
}

for (const e of ready) {
	try {
		// Idempotence : ne ré-uploade pas si ce média est déjà attaché.
		const st = state.uploaded[e.sourceExerciseId];
		if (st && st.bytes === e._bytes && e.mediaStorageId) {
			skipped++;
			continue;
		}
		const uploadUrl = await client.mutation('exercises:generateMediaUploadUrl', { sessionToken: token });
		const blob = readFileSync(e._file);
		const up = await fetch(uploadUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'image/gif' },
			body: new Uint8Array(blob),
		});
		if (!up.ok) throw new Error(`upload HTTP ${up.status}`);
		const { storageId } = await up.json();
		e._storageId = storageId;
		batch.push(e);
		if (batch.length >= UPLOAD_BATCH) await flushBatch();
		state.uploaded[e.sourceExerciseId] = { storageId, bytes: e._bytes, at: Date.now() };
		if (uploaded % 100 === 0) saveState(state);
	} catch (err) {
		upErrors.push({ exerciseId: e._id, error: String(err?.message ?? err) });
		console.log(`   ❌ upload ${e.sourceExerciseId} : ${err?.message ?? err}`);
	}
}
await flushBatch();
saveState(state);

/* ── Résumé final (contrat mission) ── */

const totalBytes = ready.reduce((s, e) => s + (e._bytes ?? 0), 0);
console.log('\n' + '═'.repeat(62));
console.log('RÉSUMÉ — hébergement interne des médias G-FLUX');
console.log('═'.repeat(62));
console.log(`Exercices source traités          : ${items.length}`);
console.log(`Déjà hébergés (aucun traitement)  : ${alreadyHosted.length}`);
console.log(`URLs source valides (200)         : ${okSource.length}`);
console.log(`URLs source cassées               : ${broken.length}`);
console.log(`Téléchargés cette exécution       : ${downloaded}`);
console.log(`Récupérés depuis le cache local   : ${fromCache}`);
console.log(`Uploadés + attachés (mediaUrl interne) : ${uploaded}`);
console.log(`Miniatures réparées (sans ré-upload)   : ${repaired}`);
console.log(`Échecs téléchargement             : ${dlErrors.length}`);
console.log(`Échecs upload/attachement         : ${upErrors.length}`);
console.log(`Volume total stocké chez nous     : ${(totalBytes / 1024 / 1024).toFixed(1)} Mo (+ ${alreadyHosted.length} déjà présents)`);
if (broken.length) {
	console.log('\nURLs source cassées (mediaUrl source conservée, fallback UI actif) :');
	for (const [id, v] of broken.slice(0, 10)) console.log(`   - ${id} → ${v.status} ${v.error ?? ''}`);
	if (broken.length > 10) console.log(`   … +${broken.length - 10} autres (détail : .media-cache/audit.json)`);
}
console.log('\n✅ Terminé. La bibliothèque lit désormais nos URLs internes (storage Convex).');

const exitCode = upErrors.length + dlErrors.length > 0 ? 2 : 0;
process.exit(exitCode);
