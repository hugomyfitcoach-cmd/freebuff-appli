/**
 * Tests MISSION — Séance bloquée sur « Chargement de la séance… ».
 *
 * Garde-fous du correctif (aucun spinner infini possible) :
 * 1. Helper pur (src/lib/sessionLoad.ts) : timeout 15 s, EXACTEMENT 1 retry
 *    transport, erreur applicative NON retentée, jamais plus de 2 tentatives,
 *    annulation au démontage, message utilisateur propre ;
 * 2. SessionRunner.svelte : le chemin de chargement est câblé sur le helper,
 *    l'écran d'erreur propose « Réessayer », loading retombe dans tous les cas ;
 * 3. BFF session/[id] : chaque étape loggée avec requestId, appel Convex borné
 *    par un timeout (jamais suspendu), aucune donnée sensible dans les logs.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	loadScheduledSession,
	TransportError,
	SESSION_LOAD_ERROR_MESSAGE,
	SESSION_LOAD_TIMEOUT_MS,
	MAX_ATTEMPTS,
} from '../src/lib/sessionLoad.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runner = readFileSync(join(root, 'src/lib/components/SessionRunner.svelte'), 'utf8');
const bff = readFileSync(join(root, 'src/routes/api/training/session/[id]/+server.ts'), 'utf8');

const okBody = () => ({
	scheduled: { _id: 's1', date: '2026-09-30', status: 'planned', completedAt: null, durationMin: null, startedAt: null, skippedAt: null, durationSource: null },
	session: { _id: 'sess1', name: 'Haut du corps' },
	programName: 'Programme Maison Deborah',
	estimatedMin: 30,
	exercises: [],
});

/* ─── 1) Contrats de base ─── */

test('Contrat : timeout ~15 s, 2 tentatives max (1 + 1 retry), message utilisateur propre', () => {
	assert.equal(SESSION_LOAD_TIMEOUT_MS, 15000);
	assert.equal(MAX_ATTEMPTS, 2, 'exactement 1 initial + 1 retry — jamais plus');
	assert.ok(SESSION_LOAD_ERROR_MESSAGE.includes('réessaie'), 'le message invite à réessayer');
	assert.ok(!/[A-Z_]{6,}|Convex|fetch|HTTP/.test(SESSION_LOAD_ERROR_MESSAGE), 'aucun jargon technique exposé');
});

/* ─── 2) Scénarios chargement ─── */

test('Séance normale : succès unique, data transmise via setState', async () => {
	const states = [];
	await loadScheduledSession('sched1', {
		fetchFn: async () => new Response(JSON.stringify(okBody()), { status: 200 }),
		setState: (s) => states.push(s),
	});
	assert.equal(states.length, 1);
	assert.equal(states[0].kind, 'success');
	assert.equal(states[0].data.session.name, 'Haut du corps');
});

test('Erreur réseau PUIS succès : le retry unique rattrape (2 appels, pas 3)', async () => {
	let calls = 0;
	const states = [];
	await loadScheduledSession('sched1', {
		fetchFn: async () => {
			calls++;
			if (calls === 1) throw new TypeError('fetch failed');
			return new Response(JSON.stringify(okBody()), { status: 200 });
		},
		setState: (s) => states.push(s),
	});
	assert.equal(calls, 2, 'un seul retry après l\u2019échec réseau initial');
	assert.equal(states[0].kind, 'success');
});

test('Timeout simulé : pend 50 ms avec timeout 30 ms → retry puis échec définitif (2 appels)', async () => {
	let calls = 0;
	await assert.rejects(
		loadScheduledSession('sched1', {
			timeoutMs: 30,
			fetchFn: (_url, init) =>
				new Promise((_, reject) => {
					calls++;
					init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
				}),
		}),
		TransportError
	);
	assert.equal(calls, MAX_ATTEMPTS, 'timeout → 1 retry, puis stop — jamais infini');
});

test('Deux échecs réseau → TransportError avec message utilisateur, pas de 3e appel', async () => {
	let calls = 0;
	await assert.rejects(
		loadScheduledSession('sched1', {
			fetchFn: async () => {
				calls++;
				throw new TypeError('network down');
			},
		}),
		(e) => e instanceof TransportError && e.message === SESSION_LOAD_ERROR_MESSAGE
	);
	assert.equal(calls, 2, 'deux tentatives maximum, jamais une troisième');
});

test('Erreur applicative (404 « Séance introuvable ») : message affiché, AUCUN retry', async () => {
	let calls = 0;
	const states = [];
	await loadScheduledSession('sched1', {
		fetchFn: async () => {
			calls++;
			return new Response(JSON.stringify({ error: 'Séance introuvable.' }), { status: 404 });
		},
		setState: (s) => states.push(s),
	});
	assert.equal(calls, 1, 'erreur applicative = définitive, jamais retentée');
	assert.equal(states[0].kind, 'appError');
	assert.equal(states[0].message, 'Séance introuvable.');
});

test('Corps illisible (HTML CDN) → transport réessayable, 2 tentatives puis message propre', async () => {
	let calls = 0;
	await assert.rejects(
		loadScheduledSession('sched1', {
			fetchFn: async () => {
				calls++;
				return new Response('<html>502 Bad Gateway</html>', { status: 502 });
			},
		}),
		(e) => e instanceof TransportError && e.message === SESSION_LOAD_ERROR_MESSAGE
	);
	assert.equal(calls, 2);
});

test('Démontage (abort externe) : la promesse sort sans toucher l\u2019état ni retry', async () => {
	const ac = new AbortController();
	let calls = 0;
	const promise = loadScheduledSession('sched1', {
		fetchFn: (_url, init) =>
			new Promise((resolve, reject) => {
				calls++;
				init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
			}),
		signal: ac.signal,
		setState: () => assert.fail('setState ne doit jamais être appelé après unmount'),
	});
	ac.abort();
	await assert.rejects(promise, (e) => e instanceof DOMException && e.name === 'AbortError');
	assert.equal(calls, 1, 'pas de retry après démontage');
});

/* ─── 3) SessionRunner : câblage et écran d'erreur ─── */

test('SessionRunner : chargement via le helper résilient (plus de fetch nu sans timeout)', () => {
	assert.ok(runner.includes("from '$lib/sessionLoad'"), 'le helper est importé');
	assert.ok(runner.includes('loadScheduledSession(scheduledId'), 'le chemin passe par le helper');
	assert.ok(!/await fetch\(`\/api\/training\/session\/\$\{scheduledId\}`\)/.test(runner), 'plus aucun fetch nu du chargement');
});

test('SessionRunner : loading = false GARANTI après succès ou échec définitif', () => {
	const loadChunk = runner.slice(runner.indexOf('async function loadSession()'), runner.indexOf('onMount(() =>'));
	assert.ok(loadChunk.includes('finally'), 'bloc finally présent');
	assert.ok(loadChunk.includes('if (!ctl.signal.aborted) loading = false'), 'loading retombe systématiquement (hors démontage)');
	assert.ok(loadChunk.includes('loadController?.abort()'), 'un rechargement annule la tentative en cours');
});

test('SessionRunner : écran d\u2019erreur lisible + bouton « Réessayer » + « Retour »', () => {
	assert.ok(runner.includes('Réessayer'), 'bouton Réessayer présent');
	assert.ok(runner.includes('onclick={loadSession}'), 'Réessayer relance loadSession (1 nouveau cycle fini)');
	assert.ok(runner.includes('onclick={closeRunner}'), 'Retour reste disponible');
	assert.ok(runner.includes('triangleAlert'), 'icône d\u2019erreur présente (état reconnaissable)');
	assert.ok(runner.includes('SESSION_LOAD_ERROR_MESSAGE'), 'message utilisateur propre câblé');
});

test('SessionRunner : démontage → abort (aucun état suspendu derrière un changement d\u2019écran)', () => {
	assert.ok(runner.includes('onDestroy(() => {'), 'onDestroy présent');
	assert.ok(/onDestroy\(\(\) => \{[\s\S]*?loadController\?\.abort\(\)/.test(runner), 'le contrôleur est annulé au démontage');
});

/* ─── Svelte 5 : AUCUNE écriture d'état pendant le rendu (state_unsafe_mutation) ───
 * Incident : getDraft() écrivait drafts[k] lorsqu'appelée depuis le template
 * ({@const d = getDraft(ex, st.order)}) → exception pendant le flush de rendu
 * → le DOM restait sur « Chargement… » malgré loading=false. */

test('Svelte 5 : getDraft est PURE (aucune écriture) — utilisable dans le template', () => {
	const getDraftBody = runner.slice(runner.indexOf('function getDraft'), runner.indexOf('function ensureDraft'));
	assert.ok(!/drafts\[[^\]]+\]\s*=/.test(getDraftBody), 'getDraft ne doit JAMAIS écrire dans drafts');
	assert.ok(!/drafts =/.test(getDraftBody), 'getDraft ne doit JAMAIS réassigner drafts');
	assert.ok(getDraftBody.includes('?? buildDraft('), 'getDraft retombe en lecture sur buildDraft');
});

test('Svelte 5 : les écritures de brouillon vivent hors du rendu (ensureDraft / préremplissage)', () => {
	assert.ok(runner.includes('function ensureDraft'), 'ensureDraft = écriture réservée aux événements');
	assert.ok(/ensureDraft\(ex, setOrder\)/.test(runner), 'toggleFreeSet utilise ensureDraft (gestionnaire d\u2019événement)');
	assert.ok(/prefilled\[draftKey\(ex\._id, st\.order\)\]/.test(runner), 'applyLoadedSession préremplit les brouillons avant rendu');
	assert.ok(runner.includes('drafts = prefilled'), 'préremplissage assigné en une fois (contexte async, pas un rendu)');
});

test('Svelte 5 : le template mode libre n\u2019appelle que la fonction pure', () => {
	assert.ok(runner.includes('{@const d = getDraft(ex, st.order)}'), 'template : getDraft (pure) uniquement');
	assert.ok(!/{@const [^}]*ensureDraft/.test(runner), 'jamais ensureDraft dans le template');
});

/* ─── 4) BFF : observabilité requestId + anti-hang Convex ─── */

test('BFF GET : chaque étape tracée avec requestId (auth, Convex, réponse, durée)', () => {
	assert.ok(bff.includes("[training-session][${rid}]"), 'préfixe de log avec requestId');
	for (const step of ["log('auth-ok'", "log('convex-start'", "log('convex-end'", "log('respond'"]) {
		assert.ok(bff.includes(step), `étape tracée : ${step}`);
	}
	assert.ok(bff.includes('convexMs') && bff.includes('totalMs'), 'durées Convex et totales mesurées');
});

test('BFF : aucune donnée personnelle dans les logs (ni email, ni jeton, ni corps de réponse)', () => {
	const logLines = bff.split('\n').filter((l) => l.includes('log(')).join('\n');
	assert.ok(!logLines.includes('email'), 'jamais d\u2019email loggé');
	assert.ok(!logLines.includes('sessionToken') && !logLines.includes('cookies.get'), 'jamais de jeton loggé');
	assert.ok(!/log\([^)]*\bJSON\.stringify\(res/.test(bff), 'jamais de corps de réponse loggé');
});

test('BFF : appel Convex borné par un timeout — la requête ne peut jamais rester suspendue', () => {
	assert.ok(bff.includes('CONVEX_TIMEOUT_MS'), 'constante de timeout Convex définie');
	assert.ok(bff.includes('withTimeout('), 'tous les appels Convex passent par withTimeout');
	const withTimeoutCalls = (bff.match(/withTimeout\(/g) ?? []).length;
	assert.equal(withTimeoutCalls, 3, 'GET + POST + PATCH protégés (la définition ne contient pas la parenthèse immédiate)');
	assert.ok(bff.includes("status: isTimeout ? 502"), 'timeout → 502 JSON (transport réessayable côté client), jamais un pend');
});
