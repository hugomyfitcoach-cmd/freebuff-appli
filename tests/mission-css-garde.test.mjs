import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { recordIncident, incidentAllowed } from '../src/convex/appVersion.ts';

const html = readFileSync(new URL('../src/app.html', import.meta.url), 'utf8');
const extract = (name) => {
	const match = html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\s*\\}`));
	assert.ok(match, `${name} présente dans la garde inline`);
	return vm.runInNewContext(`(${match[0]})`);
};
const decide = extract('cssGuardDecision');
const shellCache = extract('shellCache');

test('CSS témoin : rien ; absent : reload, réparation, bandeau', () => {
	assert.equal(decide(true, 0, true), 'none');
	assert.equal(decide(false, 0, true), 'reload');
	assert.equal(decide(false, 1, true), 'repair');
	assert.equal(decide(false, 2, true), 'banner');
	assert.equal(decide(false, 0, false), 'banner');
});

function guardHarness({ online = true, hidden = false, count = null, response = true, witness = false } = {}) {
	const script = html.match(/<script>\s*\/\* Garde autonome[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, '');
	const events = {}, docEvents = {}, timers = [], frames = [], store = new Map();
	if (count !== null) store.set('gflux-css-guard', String(count));
	let reloads = 0, probes = 0, deletes = 0;
	const elements = [];
	const document = {
		hidden, activeElement: null, documentElement: { setAttribute() {}, appendChild: (e) => elements.push(e) },
		body: { appendChild: (e) => elements.push(e) }, querySelector: () => null, querySelectorAll: () => [],
		createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {} }),
		createTextNode: () => ({}), addEventListener: (name, fn) => { docEvents[name] = fn; },
	};
	const navigator = { onLine: online, userAgent: 'test' };
	const caches = { keys: async () => ['gflux-app-old', 'gflux-img-v1'], delete: async () => { deletes++; return true; } };
	const window = { caches, addEventListener: (name, fn) => { events[name] = fn; } };
	const sandbox = {
		window, document, navigator, caches, URL, Promise,
		location: { href: 'https://app.test/', reload: () => { reloads++; } },
		sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
		getComputedStyle: () => ({ getPropertyValue: () => witness ? '1' : '' }),
		fetch: async () => { probes++; return { ok: response }; },
		requestAnimationFrame: (fn) => frames.push(fn), setTimeout: (fn, ms) => { timers.push({ fn, ms }); },
	};
	vm.runInNewContext(script, sandbox);
	return { events, docEvents, timers, frames, store, document, navigator, elements,
		setWitness: (value) => { witness = value; }, stats: () => ({ reloads, probes, deletes }) };
}
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

test('garde attend load, réseau, premier plan et restauration bfcache', async () => {
	const h = guardHarness({ online: false, hidden: true });
	assert.equal(h.timers.length, 0, 'pas de délai de déclenchement avant load');
	h.events.online(); await settle();
	assert.equal(h.stats().reloads, 0);
	h.events.load(); await settle();
	assert.equal(h.stats().reloads, 0);
	h.navigator.onLine = true; h.events.online(); await settle();
	assert.equal(h.stats().reloads, 0);
	h.document.hidden = false; h.docEvents.visibilitychange(); await settle();
	assert.equal(h.stats().reloads, 1);
	const b = guardHarness();
	b.setWitness(true); b.events.load(); b.setWitness(false);
	b.events.pageshow({ persisted: true });
	b.docEvents.visibilitychange(); await settle();
	assert.equal(b.stats().reloads, 0);
	b.frames.shift()(); b.frames.shift()();
	assert.equal(b.timers[0].ms, 500);
	b.timers.shift().fn(); await settle();
	assert.equal(b.stats().reloads, 1);
});

test('réparation exige le réseau et témoin sain remet les compteurs à zéro', async () => {
	const h = guardHarness({ count: 1, response: false });
	h.events.load(); await settle();
	assert.deepEqual(h.stats(), { reloads: 0, probes: 1, deletes: 0 });
	assert.equal(h.elements.length, 1);
	assert.equal(h.store.get('gflux-css-guard'), '1');
	h.store.set('gflux-shell-reload', 'x'); h.setWitness(true); h.docEvents.visibilitychange();
	assert.equal(h.store.has('gflux-css-guard'), false);
	assert.equal(h.store.has('gflux-shell-reload'), false);
});

test('la réparation conserve le cache des images', () => {
	assert.equal(shellCache('gflux-app-build'), true);
	assert.equal(shellCache('gflux-sw-state'), true);
	assert.equal(shellCache('gflux-img-v1'), false);
	assert.equal(shellCache('autre-cache'), false);
});

test('limite transactionnelle : 20 rapports par utilisatrice sur 24 h', async () => {
	assert.equal(incidentAllowed(19), true);
	assert.equal(incidentAllowed(20), false);
	let count = 19;
	const inserted = [];
	const user = { _id: 'user1' };
	const db = {
		query(table) {
			if (table === 'sessions') return { withIndex: () => ({ unique: async () => ({ userId: user._id, expiresAt: Date.now() + 10000 }) }) };
			assert.equal(table, 'appIncidents');
			return { withIndex: (_name, query) => {
				const q = { eq: (field, value) => { assert.equal(field, 'userId'); assert.equal(value, user._id); return q; }, gte: () => q };
				query(q);
				return { take: async () => Array(count).fill({}) };
			} };
		},
		get: async () => user,
		insert: async (_table, doc) => { inserted.push(doc); count++; },
	};
	const report = { sessionToken: 'session', build: 'build1', witness: 'missing', styles: [], controller: true, caches: [], userAgent: 'test', action: 'reload' };
	assert.deepEqual(await recordIncident._handler({ db }, report), { recorded: true });
	assert.deepEqual(await recordIncident._handler({ db }, report), { recorded: false });
	assert.equal(inserted.length, 1);
	assert.equal(inserted[0].userId, user._id);
	assert.equal('sessionToken' in inserted[0], false);
});
