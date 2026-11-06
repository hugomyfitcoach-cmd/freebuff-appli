/**
 * Mission CSS-GARDE-FIX (C) — réassignation le jour J.
 *
 * Règle : lors d'une nouvelle assignation, si la date du jour est déjà
 * matérialisée sur l'assignation remplacée, elle l'est aussi sur la nouvelle.
 * La journée en cours garde l'ancien plan (items mangés/modifiés compris), le
 * nouveau plan s'applique à partir du lendemain. Aucune ligne n'est supprimée.
 *
 * Ces tests exercent les handlers Convex réels avec un contexte en mémoire —
 * aucune assertion sur le texte source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const plans = await import(new URL('../src/convex/mealPlans.ts', import.meta.url).href);
const journal = await import(new URL('../src/convex/journal.ts', import.meta.url).href);
const { hashToken } = await import(new URL('../src/convex/helpers.ts', import.meta.url).href);

/* ── Contexte Convex en mémoire (db.get/insert/patch/delete/query) ── */

function makeCtx() {
	const tables = new Map();
	let seq = 0;
	const rowsOf = (table) => {
		if (!tables.has(table)) tables.set(table, []);
		return tables.get(table);
	};
	const constraintsOf = (fn) => {
		const constraints = [];
		const collector = {};
		for (const op of ['eq', 'gte', 'lte', 'gt', 'lt']) {
			collector[op] = (field, value) => {
				constraints.push([op, field, value]);
				return collector;
			};
		}
		fn(collector);
		return constraints;
	};
	const matches = (doc, constraints) =>
		constraints.every(([op, field, value]) => {
			const v = doc[field];
			if (op === 'eq') return v === value;
			if (op === 'gte') return v >= value;
			if (op === 'lte') return v <= value;
			if (op === 'gt') return v > value;
			return v < value;
		});
	function query(table) {
		const state = { constraints: [], order: 'asc' };
		const builder = {
			withIndex(_name, fn) {
				state.constraints = constraintsOf(fn);
				return builder;
			},
			filter() {
				return builder;
			},
			order(dir) {
				state.order = dir;
				return builder;
			},
			async collect() {
				const out = rowsOf(table).filter((d) => matches(d, state.constraints));
				out.sort((a, b) =>
					state.order === 'desc' ? b._creationTime - a._creationTime : a._creationTime - b._creationTime
				);
				return out.map((d) => structuredClone(d));
			},
			async unique() {
				const out = await builder.collect();
				if (out.length > 1) throw new Error('unique() : plusieurs lignes');
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
			rowsOf(table).push({ ...structuredClone(doc), _id: id, _creationTime: seq });
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
				// Convex : patcher avec undefined SUPPRIME le champ optionnel.
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
		query,
	};
	return { db, tables };
}

/* ── Dates locales, mêmes conventions que localTodayOfTs côté Convex ── */

const isoLocal = (d) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = isoLocal(new Date());
const dayOffset = (n) => {
	const d = new Date();
	d.setDate(d.getDate() + n);
	return isoLocal(d);
};
const tomorrow = dayOffset(1);
const yesterday = dayOffset(-1);

const CLIENT_TOKEN = 'session-reassign-client';
const COACH_TOKEN = 'session-reassign-coach';

const items = (foods) => foods.map(([meal, name, qtyGrams, kcal]) => ({ meal, name, qtyGrams, kcal, carbs: 0, protein: 0, fat: 0 }));

/** Cliente + coach + plan A (Riz/Poulet) assigné [hier, demain] + plan B (Saumon/Avocat). */
async function setup() {
	const ctx = makeCtx();
	const coachId = await ctx.db.insert('users', { role: 'coach', disabled: false, name: 'Coach Test' });
	const userId = await ctx.db.insert('users', {
		role: 'client',
		disabled: false,
		name: 'Cliente Test',
		createdBy: coachId,
	});
	await ctx.db.insert('sessions', {
		tokenHash: await hashToken(CLIENT_TOKEN),
		userId,
		expiresAt: Date.now() + 3_600_000,
	});
	await ctx.db.insert('sessions', {
		tokenHash: await hashToken(COACH_TOKEN),
		userId: coachId,
		expiresAt: Date.now() + 3_600_000,
	});
	const templateA = await ctx.db.insert('mealPlanTemplates', {
		coachId,
		name: 'Plan A',
		items: items([
			['petit-dej', 'Riz', 100, 350],
			['dejeuner', 'Poulet', 150, 200],
		]),
		totalKcal: 550,
		totalCarbs: 70,
		totalProtein: 47,
		totalFat: 6,
		createdAt: 1,
		updatedAt: 1,
	});
	const templateB = await ctx.db.insert('mealPlanTemplates', {
		coachId,
		name: 'Plan B',
		items: items([
			['dejeuner', 'Saumon', 120, 250],
			['collation', 'Avocat', 80, 130],
		]),
		totalKcal: 380,
		totalCarbs: 12,
		totalProtein: 30,
		totalFat: 22,
		createdAt: 2,
		updatedAt: 2,
	});
	const assignmentId = await ctx.db.insert('mealPlanAssignments', {
		userId,
		templateId: templateA,
		coachId,
		startDate: yesterday,
		endDate: tomorrow,
		createdAt: 1,
	});
	return { ctx, userId, coachId, templateA, templateB, assignmentId };
}

const ensure = (ctx, date) => plans.ensurePlanForDate._handler(ctx, { sessionToken: CLIENT_TOKEN, date });
const getDay = (ctx, date) => journal.getDay._handler(ctx, { sessionToken: CLIENT_TOKEN, date });
const namesOf = (day) => day.planned.map((p) => p.name).sort();
const reassign = (ctx, userId, templateId) =>
	plans.assignTemplate._handler(ctx, {
		sessionToken: COACH_TOKEN,
		userId,
		templateId,
		startDate: today,
		endDate: tomorrow,
	});

/* ── 1. La journée garde l'ancien plan, le nouveau démarre demain ── */

test('Réassignation le jour J : aucun aliment du nouveau plan aujourd’hui, présent demain', async () => {
	const { ctx, userId, templateB, assignmentId } = await setup();
	await ensure(ctx, today);
	assert.deepEqual(namesOf(await getDay(ctx, today)), ['Poulet', 'Riz'], 'plan A proposé aujourd’hui');
	const rowsBefore = await ctx.db.query('plannedEntries').collect();

	await reassign(ctx, userId, templateB);

	await ensure(ctx, today);
	const sameDay = await getDay(ctx, today);
	assert.deepEqual(namesOf(sameDay), ['Poulet', 'Riz'], 'la journée garde l’ancien plan');
	assert.equal(sameDay.plannedTotals.kcal, 550, 'totaux de l’ancien plan inchangés');
	assert.equal(
		sameDay.planned.some((p) => p.name === 'Saumon' || p.name === 'Avocat'),
		false,
		'aucun aliment du nouveau plan aujourd’hui'
	);

	await ensure(ctx, tomorrow);
	const next = await getDay(ctx, tomorrow);
	assert.deepEqual(namesOf(next), ['Avocat', 'Saumon'], 'le nouveau plan s’applique dès le lendemain');
});

test('Aucune ligne supprimée : items du jour intacts et ancienne assignation seulement retirée', async () => {
	const { ctx, userId, templateB, assignmentId } = await setup();
	await ensure(ctx, today);
	const rowsBefore = await ctx.db.query('plannedEntries').collect();
	assert.equal(rowsBefore.length, 2);

	await reassign(ctx, userId, templateB);
	await ensure(ctx, today);

	const rowsAfter = await ctx.db.query('plannedEntries').collect();
	assert.deepEqual(
		rowsAfter.map((r) => r._id).sort(),
		rowsBefore.map((r) => r._id).sort(),
		'les items planifiés du jour sont les mêmes lignes'
	);
	const assignments = await ctx.db.query('mealPlanAssignments').collect();
	assert.equal(assignments.length, 2, 'l’ancienne assignation n’est pas supprimée');
	assert.ok(assignments.find((a) => a._id === assignmentId)?.removedAt, 'elle est marquée retirée');
	const fresh = assignments.find((a) => a._id !== assignmentId);
	assert.ok((fresh.materializedDates ?? []).includes(today), 'la date du jour est reportée sur la nouvelle');
	assert.equal(fresh.templateId, templateB);
});

/* ── 2. Règle bornée : sans matérialisation du jour, le nouveau plan s'applique ── */

test('Réassignation sans journée déjà matérialisée : le nouveau plan s’applique aujourd’hui', async () => {
	const { ctx, userId, templateB } = await setup();
	await reassign(ctx, userId, templateB);
	await ensure(ctx, today);
	assert.deepEqual(namesOf(await getDay(ctx, today)), ['Avocat', 'Saumon']);
});

/* ── 3. Journée mangée/modifiée puis rechargée : aucun doublon ── */

test('Tous les aliments du jour mangés ou modifiés : rechargement sans doublon', async () => {
	const { ctx } = await setup();
	await ensure(ctx, today);
	const initial = await getDay(ctx, today);
	const riz = initial.planned.find((p) => p.name === 'Riz');
	const poulet = initial.planned.find((p) => p.name === 'Poulet');
	await journal.eatPlanned._handler(ctx, { sessionToken: CLIENT_TOKEN, plannedId: riz._id, clientDate: today });
	await journal.updatePlannedQty._handler(ctx, {
		sessionToken: CLIENT_TOKEN,
		plannedId: poulet._id,
		qtyGrams: 42,
	});

	await ensure(ctx, today);
	await ensure(ctx, today);
	const after = await getDay(ctx, today);
	assert.equal(after.planned.length, 1, 'un seul item prévu restant');
	assert.deepEqual(namesOf(after), ['Poulet']);
	assert.equal(after.planned[0].qtyGrams, 42, 'quantité modifiée conservée');
	assert.equal(after.entries.length, 1, 'l’aliment mangé n’est pas dupliqué');
	assert.equal(after.entries[0].name, 'Riz');
});

test('Journée mangée en totalité puis réassignée : rien ne revient, rien n’est perdu', async () => {
	const { ctx, userId, templateB } = await setup();
	await ensure(ctx, today);
	const day = await getDay(ctx, today);
	for (const p of day.planned) {
		await journal.eatPlanned._handler(ctx, { sessionToken: CLIENT_TOKEN, plannedId: p._id, clientDate: today });
	}

	await reassign(ctx, userId, templateB);
	await ensure(ctx, today);

	const after = await getDay(ctx, today);
	assert.equal(after.planned.length, 0, 'aucun aliment du nouveau plan aujourd’hui');
	assert.equal(after.entries.length, 2, 'les aliments mangés restent intacts');
	assert.deepEqual(after.entries.map((e) => e.name).sort(), ['Poulet', 'Riz']);
});
