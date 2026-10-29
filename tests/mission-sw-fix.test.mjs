/**
 * Mission SW-FIX — correctifs de revue du service worker et du filet « page
 * sans CSS ».
 *
 * Garanties verrouillées ici :
 * 1. BASCULE UNIQUE : le cache de production encore au format « gflux-<hash> »
 *    survit à la première activation du nouveau worker (sinon : une dernière
 *    page sans feuille de style), puis disparaît au déploiement suivant comme
 *    toute version N-2 ;
 * 2. DÉTERMINISME : la version précédente est désignée par le témoin, jamais
 *    par sa position dans `caches.keys()` (ordre non garanti) — même résultat
 *    quel que soit l'ordre des clés, jamais plus de 2 caches de build ;
 * 3. GARDE-FOU : si le compteur anti-boucle ne peut pas être écrit
 *    (sessionStorage indisponible, quota, navigation privée), la page N'EST
 *    PAS rechargée automatiquement ;
 * 4. detachIds : un exercice d'une AUTRE séance fait refuser l'opération.
 *
 * Le worker et le module de récupération sont chargés TELS QUELS (types
 * retirés par Node, `$service-worker` remplacé par des valeurs de build) : le
 * test porte sur le code réellement déployé.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/** Cache unique (API CacheStorage) minimal, en mémoire. */
class FakeCache {
	constructor() {
		this.entries = new Map();
	}
	async match(req) {
		const hit = this.entries.get(typeof req === 'string' ? req : req.url);
		return hit ? hit.clone() : undefined;
	}
	async put(req, res) {
		this.entries.set(typeof req === 'string' ? req : req.url, res);
	}
	async addAll(paths) {
		for (const p of paths) {
			this.entries.set(new URL(p, 'https://gflux.test').href, new Response('', { status: 200 }));
		}
	}
	async delete(req) {
		return this.entries.delete(typeof req === 'string' ? req : req.url);
	}
	async keys() {
		return [...this.entries.keys()].map((u) => new Request(u));
	}
}

/** CacheStorage minimal : `keys()` renvoie l'ordre d'insertion, que le test
 *  pilote pour prouver que le worker ne s'y fie pas. */
class FakeCaches {
	constructor(names = []) {
		this.store = new Map(names.map((n) => [n, new FakeCache()]));
	}
	async keys() {
		return [...this.store.keys()];
	}
	async open(name) {
		if (!this.store.has(name)) this.store.set(name, new FakeCache());
		return this.store.get(name);
	}
	async delete(name) {
		return this.store.delete(name);
	}
	async match() {
		return undefined;
	}
}

/** Charge `src/service-worker.ts` comme module exécutable (version de build
 *  injectée), et renvoie ses gestionnaires d'événements. */
async function loadWorker(version, cacheStorage) {
	let src = read('src/service-worker.ts');
	src = src.replace(
		/import \{ build, files, version \} from '\$service-worker';/,
		`const build = []; const files = []; const version = ${JSON.stringify(version)};`
	);
	src = src.replace(
		/import \{ isConvexStorageUrl, isFoodImgTagged \} from '\.\/lib\/foodImgTag';/,
		'const isConvexStorageUrl = () => false; const isFoodImgTagged = () => false;'
	);
	const dir = mkdtempSync(join(tmpdir(), 'gflux-sw-'));
	const file = join(dir, `sw-${version}.mjs`);
	writeFileSync(file, stripTypeScriptTypes(src));

	const handlers = new Map();
	globalThis.self = {
		addEventListener: (type, handler) => handlers.set(type, handler),
		skipWaiting: async () => {},
		registration: { showNotification: async () => {} },
		clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => null },
		location: { origin: 'https://gflux.test' },
	};
	globalThis.caches = cacheStorage;
	await import(pathToFileURL(file).href);
	return handlers;
}

async function dispatch(handlers, type) {
	const pending = [];
	handlers.get(type)?.({ waitUntil: (p) => pending.push(p), request: null });
	await Promise.all(pending);
}

/** Installe puis active un worker (comme le navigateur : install → activate). */
async function installAndActivate(version, cacheStorage) {
	const handlers = await loadWorker(version, cacheStorage);
	await dispatch(handlers, 'install');
	await dispatch(handlers, 'activate');
	return handlers;
}

test('Activation : « gflux-<hash> » survit à la bascule, puis part au déploiement suivant', async () => {
	// État d'une installation encore servie par l'ancien worker : un seul cache
	// de build au format « gflux-<hash> » + le cache d'images stable.
	const storage = new FakeCaches(['gflux-9f3a1c2b', 'gflux-img-v1']);

	await installAndActivate('build1', storage);
	let keys = await storage.keys();
	assert.ok(keys.includes('gflux-9f3a1c2b'), 'ancien format conservé comme version précédente');
	assert.ok(keys.includes('gflux-app-build1'), 'build courant en place');
	assert.ok(keys.includes('gflux-img-v1'), 'cache d’images intact');

	// Déploiement suivant : l'ancien format est du N-2 → supprimé.
	await installAndActivate('build2', storage);
	keys = await storage.keys();
	assert.ok(!keys.includes('gflux-9f3a1c2b'), 'ancien format supprimé au déploiement suivant');
	assert.ok(keys.includes('gflux-app-build1'), 'build précédent conservé');
	assert.ok(keys.includes('gflux-app-build2'), 'build courant conservé');

	// Et jamais plus de deux caches de build.
	await installAndActivate('build3', storage);
	keys = await storage.keys();
	assert.equal(keys.filter((k) => k.startsWith('gflux-app-')).length, 2, 'version courante + précédente seulement');
	assert.ok(!keys.includes('gflux-app-build1'), 'N-2 supprimé');
	assert.ok(keys.includes('gflux-app-build2'));
	assert.ok(keys.includes('gflux-app-build3'));
});

test('Activation : la version précédente ne dépend pas de l’ordre de caches.keys()', async () => {
	// Deux ordres d'insertion opposés, même état logique : courant = build3,
	// précédent (témoin) = build2, N-2 = build1. L'ancien code prenait le
	// DERNIER cache de build de la liste — il gardait donc build1 (ou le
	// courant) selon l'ordre, et supprimait build2, encore nécessaire aux pages
	// ouvertes.
	for (const order of [
		['gflux-app-build3', 'gflux-app-build2', 'gflux-app-build1'],
		['gflux-app-build1', 'gflux-app-build2', 'gflux-app-build3'],
	]) {
		const storage = new FakeCaches(['gflux-img-v1', ...order]);
		// Témoin laissé par l'activation du build précédent.
		const state = await storage.open('gflux-sw-state');
		await state.put('https://gflux.invalid/sw-build', new Response('gflux-app-build2'));

		const handlers = await loadWorker('build3', storage);
		await dispatch(handlers, 'activate');

		const keys = await storage.keys();
		assert.ok(keys.includes('gflux-app-build2'), `contexte ${order.join('>')} : précédent conservé`);
		assert.ok(keys.includes('gflux-app-build3'), `contexte ${order.join('>')} : courant conservé`);
		assert.ok(!keys.includes('gflux-app-build1'), `contexte ${order.join('>')} : N-2 supprimé`);
		assert.ok(keys.includes('gflux-img-v1'), `contexte ${order.join('>')} : images intactes`);
	}
});

/** Charge `src/lib/shellRecovery.ts` avec un `sessionStorage` donné. */
async function loadRecovery({ storage, storageThrows = false }) {
	const dir = mkdtempSync(join(tmpdir(), 'gflux-shell-'));
	const file = join(dir, 'shellRecovery.mjs');
	writeFileSync(file, stripTypeScriptTypes(read('src/lib/shellRecovery.ts')));

	let reloads = 0;
	const win = { addEventListener: () => {} };
	if (storageThrows) {
		Object.defineProperty(win, 'sessionStorage', {
			get() {
				throw new Error('accès refusé (navigation privée)');
			},
		});
	} else {
		win.sessionStorage = storage;
	}
	globalThis.window = win;
	globalThis.location = { reload: () => {} };
	globalThis.document = {
		querySelector: () => null,
		querySelectorAll: () => [],
		activeElement: null,
		readyState: 'complete',
		baseURI: 'https://gflux.test/',
	};

	const mod = await import(pathToFileURL(file).href);
	mod.installShellRecovery({ build: 'test-build', reload: () => (reloads += 1), storage });
	return { mod, reloads: () => reloads };
}

test('Garde-fou anti-boucle : écriture du compteur impossible → AUCUN rechargement', async () => {
	const quotaFull = {
		getItem: () => null,
		setItem: () => {
			throw new Error('QuotaExceededError');
		},
	};
	const { mod, reloads } = await loadRecovery({ storage: quotaFull });

	assert.equal(mod.requestShellReload(), false, 'rechargement refusé');
	assert.equal(reloads(), 0, 'page laissée telle quelle');
	// La vérification différée après `load` ne doit pas contourner la règle.
	await new Promise((r) => setTimeout(r, 400));
	assert.equal(reloads(), 0, 'toujours aucun rechargement');
});

test('Garde-fou anti-boucle : sessionStorage inaccessible → AUCUN rechargement', async () => {
	const { mod, reloads } = await loadRecovery({ storage: undefined, storageThrows: true });

	assert.equal(mod.requestShellReload(), false, 'rechargement refusé');
	assert.equal(reloads(), 0, 'aucune boucle possible sans compteur persistant');
});

test('Garde-fou anti-boucle : compteur écrit normalement → un rechargement (témoin)', async () => {
	const store = new Map();
	const working = {
		getItem: (k) => (store.has(k) ? store.get(k) : null),
		setItem: (k, v) => store.set(k, v),
	};
	const { mod, reloads } = await loadRecovery({ storage: working });

	assert.equal(mod.requestShellReload(), true, 'garde-fou posé → rechargement autorisé');
	assert.equal(reloads(), 1);
	assert.equal(mod.requestShellReload(), false, 'jamais deux rechargements d’affilée (intervalle minimal)');
	assert.equal(reloads(), 1);
});

test('detachIds : un exercice d’une AUTRE séance fait refuser l’opération', () => {
	const training = read('src/convex/training.ts');
	const sup = training.slice(
		training.indexOf('export const setSupersetGroup'),
		training.indexOf('/* ═══════════ Import d')
	);
	const detach = sup.slice(sup.indexOf('for (const id of detachIds ?? [])'));

	assert.match(detach, /se\.sessionId !== linkedSessionId/, 'appartenance à la séance vérifiée');
	assert.match(detach, /throw new ConvexError\(/, 'refus explicite, pas un ignoré silencieux');
	assert.ok(
		detach.indexOf('se.sessionId !== linkedSessionId') < detach.indexOf('ctx.db.patch'),
		'refus AVANT tout patch de la ligne'
	);
});
