/**
 * Mission CSS-GARDE-FIX (B) — rapports d'incident durcis.
 *
 * La mutation `recordIncident` est publique : un appel direct contourne le BFF.
 * Ces tests exercent le handler réel et la normalisation BFF avec un contexte
 * Convex en mémoire (db.get/insert/query) — aucune assertion sur le texte
 * source : seuls les comportements observables sont vérifiés.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { recordIncident } = await import(new URL('../src/convex/appVersion.ts', import.meta.url).href);
const { hashToken } = await import(new URL('../src/convex/helpers.ts', import.meta.url).href);
const { readCappedText, normalizeIncident, INCIDENT_BODY_LIMIT } = await import(
	new URL('../src/lib/server/incident.ts', import.meta.url).href
);

/* ── Contexte Convex en mémoire (db.get/insert/query) ── */

function makeDb() {
	const tables = new Map();
	let seq = 0;
	const rowsOf = (table) => {
		if (!tables.has(table)) tables.set(table, []);
		return tables.get(table);
	};
	const matches = (doc, constraints) =>
		constraints.every(([op, field, value]) => (op === 'eq' ? doc[field] === value : doc[field] >= value));
	function query(table) {
		const constraints = [];
		const builder = {
			withIndex(_name, fn) {
				const collector = {
					eq(field, value) {
						constraints.push(['eq', field, value]);
						return collector;
					},
					gte(field, value) {
						constraints.push(['gte', field, value]);
						return collector;
					},
				};
				fn(collector);
				return builder;
			},
			async collect() {
				return rowsOf(table).filter((d) => matches(d, constraints)).map((d) => structuredClone(d));
			},
			async unique() {
				const out = await builder.collect();
				return out[0] ?? null;
			},
			async first() {
				return (await builder.collect())[0] ?? null;
			},
			async take(n) {
				return (await builder.collect()).slice(0, n);
			},
		};
		return builder;
	}
	const db = {
		async insert(table, doc) {
			const id = `${table}:${++seq}`;
			rowsOf(table).push({ ...structuredClone(doc), _id: id });
			return id;
		},
		async get(id) {
			const table = String(id).split(':')[0];
			return rowsOf(table).find((r) => r._id === String(id)) ?? null;
		},
		query,
	};
	return { db, count: (table) => rowsOf(table).length };
}

async function setupAccounts() {
	const ctx = makeDb();
	const userId = await ctx.db.insert('users', { role: 'client', disabled: false, name: 'Cliente A' });
	const otherId = await ctx.db.insert('users', { role: 'client', disabled: false, name: 'Cliente B' });
	await ctx.db.insert('sessions', {
		tokenHash: await hashToken('session-a'),
		userId,
		expiresAt: Date.now() + 3_600_000,
	});
	await ctx.db.insert('sessions', {
		tokenHash: await hashToken('session-b'),
		userId: otherId,
		expiresAt: Date.now() + 3_600_000,
	});
	return { ...ctx, userId, otherId };
}

const report = (over = {}) => ({
	sessionToken: 'session-a',
	build: 'build-1',
	witness: 'missing',
	styles: [],
	controller: true,
	caches: [],
	userAgent: 'Mozilla/5.0 (iPhone)',
	action: 'reload',
	...over,
});

/* ── 1. Session obligatoire ── */

test('rapport sans session valide ignoré : aucune écriture', async () => {
	const ctx = makeDb();
	assert.deepEqual(await recordIncident._handler(ctx, report({ sessionToken: undefined })), { recorded: false });
	assert.deepEqual(await recordIncident._handler(ctx, report({ sessionToken: 'jeton-inconnu' })), {
		recorded: false,
	});
	assert.equal(ctx.count('appIncidents'), 0, 'aucune ligne pour un rapport anonyme');
});

/* ── 2. Liste fermée ── */

test('valeur hors liste refusée : témoin, état de feuille, cache, empreinte, user agent', async () => {
	const ctx = await setupAccounts();
	const refused = [
		report({ witness: 'inconnu' }),
		report({ styles: [{ path: '/_app/immutable/entry/app.css', state: 'regles' }] }),
		report({ caches: ['gflux-app-v1', 'service-worker'] }),
		report({ build: 'x'.repeat(65) }),
		report({ userAgent: 'Mozilla <script>alert(1)</script>' }),
		report({ styles: [{ path: '/upload/secret.css', state: 'loaded' }] }),
	];
	for (const bad of refused) {
		await assert.rejects(() => recordIncident._handler(ctx, bad), /Rapport invalide/);
	}
	assert.equal(ctx.count('appIncidents'), 0, 'aucun rapport hors liste stocké');
});

test('champs en liste fermée acceptés : état de feuille et user agent tronqué à 300', async () => {
	const ctx = await setupAccounts();
	assert.deepEqual(
		await recordIncident._handler(
			ctx,
			report({
				styles: [
					{ path: '/_app/immutable/entry/app.css', state: 'missing' },
					{ path: '/_app/immutable/nodes/0.css', state: 'loaded' },
				],
				caches: ['gflux-app-v1', 'gflux-sw-state'],
				userAgent: 'A'.repeat(400),
			})
		),
		{ recorded: true }
	);
	const [row] = await ctx.db.query('appIncidents').collect();
	assert.equal(row.userAgent.length, 300, 'user agent tronqué à 300 caractères');
	assert.equal(row.styles.length, 2);
	assert.equal(row.userId, ctx.userId);
});

/* ── 3. Quota par compte ── */

test('quota : 20 rapports par compte et par 24 h, sans quota anonyme', async () => {
	const ctx = await setupAccounts();
	for (let i = 0; i < 20; i++) {
		assert.deepEqual(await recordIncident._handler(ctx, report()), { recorded: true });
	}
	assert.deepEqual(await recordIncident._handler(ctx, report()), { recorded: false }, '21e rapport refusé');
	assert.equal(ctx.count('appIncidents'), 20);
	assert.deepEqual(
		await recordIncident._handler(ctx, report({ sessionToken: 'session-b' })),
		{ recorded: true },
		'un autre compte garde son propre quota'
	);
	assert.equal(ctx.count('appIncidents'), 21);
});

/* ── 4. Plafond du corps (4 Ko) ── */

test('corps de plus de 4 Ko refusé, même sans Content-Length', async () => {
	const streamOf = (...chunks) =>
		new ReadableStream({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			},
		});
	const chunk = (n) => new Uint8Array(n).fill(97);

	const streamed = { headers: new Headers(), body: streamOf(chunk(2048), chunk(2048), chunk(1)) };
	assert.equal(await readCappedText(streamed), null, 'flux interrompu au-delà de 4 Ko → 413');

	const declared = { headers: new Headers({ 'content-length': '9000' }), body: streamOf(chunk(10)) };
	assert.equal(await readCappedText(declared), null, 'taille annoncée jamais crue');

	const exact = { headers: new Headers(), body: streamOf(chunk(2048), chunk(2048)) };
	assert.equal((await readCappedText(exact)).length, INCIDENT_BODY_LIMIT, '4 Ko pile acceptés');
});

test('normalisation BFF : action inconnue refusée, caches filtrés et bornés à 10', () => {
	assert.equal(normalizeIncident({ action: 'delete' }), null);
	assert.equal(normalizeIncident('texte'), null);
	const out = normalizeIncident({
		action: 'repair',
		build: 'b'.repeat(200),
		witness: 'present',
		controller: 1,
		userAgent: 'x'.repeat(400),
		caches: [...Array(15)].map((_, i) => `gflux-cache-${i}`).concat(['autre-cache', 'gflux_img']),
		styles: [
			{ path: '/_app/immutable/a.css', sheetNull: true, rules: 3 },
			{ path: '/_app/immutable/b.css', sheetNull: false, rules: 0 },
			{ path: '/_app/immutable/c.css', sheetNull: false, rules: null },
			{ path: '/_app/immutable/d.css', sheetNull: false, rules: 42 },
			{ path: '/evil.css', sheetNull: false, rules: 1 },
		],
	});
	assert.equal(out.action, 'repair');
	assert.equal(out.build, '', 'empreinte hors motif écartée');
	assert.equal(out.userAgent.length, 300);
	assert.equal(out.caches.length, 10, '10 noms de caches maximum');
	assert.ok(out.caches.every((name) => /^gflux-[a-z0-9-]+$/.test(name)));
	assert.deepEqual(
		out.styles.map((s) => [s.path, s.state]),
		[
			['/_app/immutable/a.css', 'missing'],
			['/_app/immutable/b.css', 'empty'],
			['/_app/immutable/c.css', 'blocked'],
			['/_app/immutable/d.css', 'loaded'],
		],
		'états énumérés, chemin hors motif écarté'
	);
});
