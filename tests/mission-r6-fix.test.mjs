/**
 * Tests MISSION R6-fix — correctifs de revue avant production.
 *
 * 1. APPARTENANCE coach/cliente : `client360`, `journal.setClientGoals` et
 *    `calibrage.apply` appliquent EXACTEMENT la règle de `coach.updateClient`
 *    (helper partagé `assertCoachOwnsClient`) : coach propriétaire → OK,
 *    autre coach → refusé, cliente SANS `createdBy` → refusée comme dans la
 *    mise à jour de fiche ;
 * 2. Volet « aliment planifié » (`editPlanned`) verrouille le scroll comme les
 *    autres volets ;
 * 3. Validation de phase : kcal = maintenance acceptée en perte de gras ;
 * 4. Commentaires corrigés (ciqualDetails chargé transitivement par le module
 *    de recherche ; seuil d'alerte surplus = 15 %).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validerObjectifPhase } from '../src/lib/phase.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const journalConvex = await import(new URL('../src/convex/journal.ts', import.meta.url).href);
const coachConvex = await import(new URL('../src/convex/coach.ts', import.meta.url).href);
const helpers = await import(new URL('../src/convex/helpers.ts', import.meta.url).href);
const { assertCoachOwnsClient, hashToken } = helpers;

const journalSrc = read('src/convex/journal.ts');
const coachSrc = read('src/convex/coach.ts');
const calibrageSrc = read('src/convex/calibrage.ts');
const journalPage = read('src/routes/espace/journal/+page.svelte');

/* ── Contexte Convex en mémoire (db.get/insert/patch/delete/query) ── */

function makeCtx() {
	const tables = new Map();
	let seq = 0;
	const rowsOf = (table) => {
		if (!tables.has(table)) tables.set(table, []);
		return tables.get(table);
	};
	function query(table) {
		const state = { constraints: [] };
		const collector = {};
		for (const op of ['eq', 'gte', 'lte', 'gt', 'lt']) {
			collector[op] = (field, value) => {
				state.constraints.push([op, field, value]);
				return collector;
			};
		}
		const matches = (doc) =>
			state.constraints.every(([op, field, value]) => {
				const v = doc[field];
				if (op === 'eq') return v === value;
				if (op === 'gte') return v >= value;
				if (op === 'lte') return v <= value;
				if (op === 'gt') return v > value;
				return v < value;
			});
		const builder = {
			withIndex(_name, fn) {
				fn(collector);
				return builder;
			},
			filter() {
				return builder;
			},
			order() {
				return builder;
			},
			async collect() {
				return rowsOf(table)
					.filter(matches)
					.map((d) => structuredClone(d));
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
			}
		};
		return builder;
	}
	const db = {
		async insert(table, doc) {
			const id = `${table}:${++seq}`;
			rowsOf(table).push({ ...structuredClone(doc), _id: id, _creationTime: Date.now() + seq });
			return id;
		},
		async get(id) {
			const table = String(id).split(':')[0];
			const row = rowsOf(table).find((d) => d._id === String(id));
			return row ? structuredClone(row) : null;
		},
		async patch(id, fields) {
			const table = String(id).split(':')[0];
			const row = rowsOf(table).find((d) => d._id === String(id));
			if (!row) throw new Error('patch() : ligne introuvable');
			for (const [k, v] of Object.entries(fields)) {
				if (v === undefined) delete row[k];
				else row[k] = v;
			}
		},
		async delete(id) {
			const table = String(id).split(':')[0];
			const rows = rowsOf(table);
			const i = rows.findIndex((d) => d._id === String(id));
			if (i >= 0) rows.splice(i, 1);
		},
		query
	};
	const all = (table) => rowsOf(table).map((d) => structuredClone(d));
	return { db, all };
}

const TOKEN = 'session-r6-coach';
const TOKEN_AUTRE = 'session-r6-autre';

/** Coach propriétaire + coach tiers + une cliente rattachée (ou non). */
async function ctxAvecCliente({ createdBy = true } = {}) {
	const ctx = makeCtx();
	const coachId = await ctx.db.insert('users', { role: 'coach', disabled: false, name: 'Coach' });
	const autreCoachId = await ctx.db.insert('users', { role: 'coach', disabled: false, name: 'Coach B' });
	const userId = await ctx.db.insert('users', {
		role: 'client',
		disabled: false,
		name: 'Cliente Test',
		...(createdBy ? { createdBy: coachId } : {})
	});
	await ctx.db.insert('sessions', {
		tokenHash: await hashToken(TOKEN),
		userId: coachId,
		expiresAt: Date.now() + 3_600_000
	});
	await ctx.db.insert('sessions', {
		tokenHash: await hashToken(TOKEN_AUTRE),
		userId: autreCoachId,
		expiresAt: Date.now() + 3_600_000
	});
	return { ctx, coachId, autreCoachId, userId };
}

const GOALS = { kcal: 2000, carbs: 210, protein: 130, fat: 50 };

/* ═══════════ 1 · Appartenance coach/cliente ═══════════ */

test('règle partagée : coach propriétaire OK, autre coach refusé, sans createdBy refusé', () => {
	assert.doesNotThrow(() => assertCoachOwnsClient({ createdBy: 'coach-1' }, { _id: 'coach-1' }));
	assert.throws(
		() => assertCoachOwnsClient({ createdBy: 'coach-1' }, { _id: 'coach-2' }),
		(e) => /coach de cette cliente/i.test(e.message)
	);
	// MÊME comportement que coach.updateClient : l'absence de rattachement refuse.
	assert.throws(
		() => assertCoachOwnsClient({}, { _id: 'coach-1' }),
		(e) => /coach de cette cliente/i.test(e.message)
	);
});

test('setClientGoals : le coach propriétaire écrit les objectifs (kcal = maintenance acceptée)', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	const res = await journalConvex.setClientGoals._handler(ctx, {
		sessionToken: TOKEN,
		userId,
		...GOALS,
		maintenanceKcal: 2000,
		phase: 'perte_gras'
	});
	assert.deepEqual(res, { ok: true });
	assert.equal(ctx.all('clientGoals')[0].kcal, 2000);
});

test('setClientGoals : un autre coach est refusé', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	await assert.rejects(
		() =>
			journalConvex.setClientGoals._handler(ctx, {
				sessionToken: TOKEN_AUTRE,
				userId,
				...GOALS
			}),
		(e) => /coach de cette cliente/i.test(e.message)
	);
	assert.equal(ctx.all('clientGoals').length, 0, 'aucune écriture refusée');
});

test('sans createdBy : setClientGoals refuse EXACTEMENT comme coach.updateClient', async () => {
	const { ctx, userId } = await ctxAvecCliente({ createdBy: false });

	const messageUpdate = await coachConvex.updateClient
		._handler(ctx, { sessionToken: TOKEN, userId, prenom: 'Léa' })
		.then(
			() => null,
			(e) => e.message
		);
	const messageGoals = await journalConvex.setClientGoals
		._handler(ctx, { sessionToken: TOKEN, userId, ...GOALS })
		.then(
			() => null,
			(e) => e.message
		);

	assert.match(messageUpdate, /coach de cette cliente/i, 'updateClient refuse la cliente sans createdBy');
	assert.equal(messageGoals, messageUpdate, 'même refus, même message');
	assert.equal(ctx.all('clientGoals').length, 0, 'aucune écriture');
});

test('client360 et calibrage.apply utilisent la même règle partagée', () => {
	const client360 = coachSrc.slice(coachSrc.indexOf('export const client360'), coachSrc.indexOf('export const sport360'));
	assert.ok(client360.includes('const coach = await requireCoach(ctx, sessionToken)'));
	assert.ok(client360.includes('assertCoachOwnsClient(target, coach)'), 'client360 vérifie l’appartenance');

	const apply = calibrageSrc.slice(calibrageSrc.indexOf('export const apply'), calibrageSrc.indexOf('export const historique'));
	assert.ok(apply.includes('assertCoachOwnsClient(target, coach)'), 'calibrage.apply vérifie l’appartenance');

	const setGoals = journalSrc.slice(journalSrc.indexOf('export const setClientGoals'), journalSrc.indexOf('BASELINE LEGACY'));
	assert.ok(setGoals.includes('assertCoachOwnsClient(target, coach)'), 'setClientGoals vérifie l’appartenance');
});

/* ═══════════ 2 · Volet « aliment planifié » verrouillé ═══════════ */

test('journal : editPlanned verrouille le scroll du fond comme les autres volets', () => {
	const effet = journalPage.slice(journalPage.indexOf('let fondFigé = false'), journalPage.indexOf('onDestroy('));
	const locked = effet.slice(effet.indexOf('const locked ='), effet.indexOf(';', effet.indexOf('const locked =')));
	assert.ok(locked.includes('!!editPlanned'), 'volet planifié inclus dans le verrou');
	for (const volet of ['logOpen', '!!qtyFood', '!!editEntry', '!!qtyMealSel', 'calOpen', 'dupOpen', 'mealCreateOpen', 'mealPhotoOpen', 'bilanOpen']) {
		assert.ok(locked.includes(volet), `${volet} toujours verrouillé`);
	}
});

/* ═══════════ 3 · Validation de phase ═══════════ */

test('perte de gras : kcal = maintenance est acceptée (ancienne règle de production)', () => {
	assert.equal(validerObjectifPhase('perte_gras', 2000, 2000), null);
	assert.equal(validerObjectifPhase('perte_gras', 2001, 2000) !== null, true, 'au-dessus refusé');
});

/* ═══════════ 4 · Commentaires corrigés ═══════════ */

test('commentaires : ciqualDetails transitif et seuil surplus 15 %', () => {
	const foodDetails = read('src/convex/foodDetails.ts');
	assert.ok(!foodDetails.includes('jamais chargé par la recherche'), 'plus de mention fausse');
	assert.match(foodDetails, /ciqualDetails\.ts, chargé[\s\S]{0,40}?transitivement par le module de recherche/);

	const fiche = read('src/lib/calibrageFiche.ts');
	assert.ok(fiche.includes('Surplus élevé au-delà de 15 %'), 'seuil d’alerte surplus = 15 %');
	assert.ok(!fiche.includes('Surplus élevé au-delà de 10 %'), 'ancienne valeur retirée');
});
