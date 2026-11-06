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
