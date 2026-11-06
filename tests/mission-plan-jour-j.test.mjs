/**
 * Mission PLAN-JOUR-J — le choix de la cliente sur un plan assigné est
 * conservé le jour J.
 *
 * Constat : les items d'un plan coach sont matérialisés (copy-on-write) dans
 * `plannedEntries` à la lecture. Une date sans aucun item coach_plan était
 * traitée comme « jamais résolue » : après suppression du dernier aliment,
 * le rechargement du journal re-projetait le plan tel que prévu. Les jours
 * passés échappaient au bug (jamais re-résolus).
 *
 * Ces tests exercent les handlers Convex réels avec un contexte en mémoire
 * (db.get/insert/patch/delete/query) — aucun test sur le texte source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const journal = await import(new URL('../src/convex/journal.ts', import.meta.url).href);
const plans = await import(new URL('../src/convex/mealPlans.ts', import.meta.url).href);
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
	return { db, tables, runMutation: async () => ({ ok: true }) };
}

/* ── Dates locales comme la résolution Convex (localTodayOfTs) ── */

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

const CLIENT_TOKEN = 'session-plan-jour-j-client';
const COACH_TOKEN = 'session-plan-jour-j-coach';

/**
 * Cliente + coach + plan « Riz 100 g / Poulet 150 g » assigné sur
 * [hier, demain]. Chaque test part d'un état neuf.
 */
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
	const templateId = await ctx.db.insert('mealPlanTemplates', {
		coachId,
		name: 'Plan test',
		items: [
			{ meal: 'petit-dej', name: 'Riz', qtyGrams: 100, kcal: 350, carbs: 70, protein: 7, fat: 1 },
			{ meal: 'dejeuner', name: 'Poulet', qtyGrams: 150, kcal: 200, carbs: 0, protein: 40, fat: 5 },
		],
		totalKcal: 550,
		totalCarbs: 70,
		totalProtein: 47,
		totalFat: 6,
		createdAt: 1,
		updatedAt: 1,
	});
	await ctx.db.insert('mealPlanAssignments', {
		userId,
		templateId,
		coachId,
		startDate: yesterday,
		endDate: tomorrow,
		createdAt: 1,
	});
	return { ctx, userId, coachId, templateId };
}

const ensure = (ctx, date) =>
	plans.ensurePlanForDate._handler(ctx, { sessionToken: CLIENT_TOKEN, date });
const getDay = (ctx, date) => journal.getDay._handler(ctx, { sessionToken: CLIENT_TOKEN, date });
const getCoachDay = (ctx, userId, date) =>
	journal.getDayForCoach._handler(ctx, { sessionToken: COACH_TOKEN, userId, date });
const namesOf = (day) => day.planned.map((p) => p.name).sort();
const plannedKeys = (day) =>
	day.planned.map((p) => p.templateItemKey ?? `${p.meal}:${p.name}`).sort();

/* ── 1. Suppression le jour J ── */

test('Jour J : un aliment supprimé reste absent après rechargement (et après plusieurs)', async () => {
	const { ctx } = await setup();
	await ensure(ctx, today);
	const initial = await getDay(ctx, today);
	assert.deepEqual(namesOf(initial), ['Poulet', 'Riz'], 'les deux aliments du plan sont proposés');

	const riz = initial.planned.find((p) => p.name === 'Riz');
	await journal.removePlanned._handler(ctx, { sessionToken: CLIENT_TOKEN, plannedId: riz._id });

	// Rechargement / retour d'onglet / reconnexion = re-fetch du jour (ensure puis getDay).
	await ensure(ctx, today);
	await ensure(ctx, today);
	const after = await getDay(ctx, today);
	assert.deepEqual(namesOf(after), ['Poulet'], 'Riz supprimé ne réapparaît pas');
	assert.equal(after.plannedTotals.kcal, 200, 'les totaux prévus excluent l’aliment supprimé');
});

test('Jour J : même en supprimant TOUS les aliments, le plan ne se reprojette pas', async () => {
	const { ctx } = await setup();
	await ensure(ctx, today);
	const initial = await getDay(ctx, today);
	for (const p of initial.planned) {
		await journal.removePlanned._handler(ctx, { sessionToken: CLIENT_TOKEN, plannedId: p._id });
	}
	await ensure(ctx, today);
	const after = await getDay(ctx, today);
	assert.equal(after.planned.length, 0, 'la journée reste vide : aucun aliment du plan ne revient');
	assert.equal(after.plannedTotals.kcal, 0, 'aucun total prévu fantôme');
});

/* ── 2. Quantité modifiée ── */

test('Jour J : une quantité modifiée est conservée après rechargement', async () => {
	const { ctx } = await setup();
	await ensure(ctx, today);
	const initial = await getDay(ctx, today);
	const poulet = initial.planned.find((p) => p.name === 'Poulet');
	await journal.updatePlannedQty._handler(ctx, {
		sessionToken: CLIENT_TOKEN,
		plannedId: poulet._id,
		qtyGrams: 42,
	});

	await ensure(ctx, today);
	const after = await getDay(ctx, today);
	const updated = after.planned.find((p) => p.name === 'Poulet');
	assert.equal(updated.qtyGrams, 42, 'quantité choisie par la cliente conservée');
	assert.equal(after.planned.length, 2, 'aucun doublon créé par la re-résolution');
});

test('Jour J : remplacer un aliment (suppression + ajout) ne fait pas revenir l’original', async () => {
	const { ctx, userId } = await setup();
	await ensure(ctx, today);
	const initial = await getDay(ctx, today);
	const riz = initial.planned.find((p) => p.name === 'Riz');

	// Parcours « Remplacer » de la fiche : l'item d'origine est supprimé, un
	// nouvel aliment est ajouté comme consommé le jour même.
	await journal.removePlanned._handler(ctx, { sessionToken: CLIENT_TOKEN, plannedId: riz._id });
	const customFoodId = await ctx.db.insert('customFoods', {
		userId,
		name: 'Riz basmati',
		kcal100: 350,
		carbs100: 70,
		protein100: 7,
		fat100: 1,
		createdAt: 1,
	});
	await journal.addEntry._handler(ctx, {
		sessionToken: CLIENT_TOKEN,
		date: today,
		meal: 'petit-dej',
		customFoodId,
		qtyGrams: 80,
		clientDate: today,
	});

	await ensure(ctx, today);
	const after = await getDay(ctx, today);
	assert.deepEqual(namesOf(after), ['Poulet'], 'l’original supprimé ne réapparaît pas à côté du remplacement');
	assert.equal(after.planned.length, 1, 'aucune proposition dupliquée');
});

/* ── 3. Le plan assigné n'est pas modifié ── */

test('Lendemain : le plan reste intact et les aliments prévus apparaissent normalement', async () => {
	const { ctx, templateId } = await setup();
	await ensure(ctx, today);
	const initial = await getDay(ctx, today);
	await journal.removePlanned._handler(ctx, {
		sessionToken: CLIENT_TOKEN,
		plannedId: initial.planned.find((p) => p.name === 'Riz')._id,
	});

	await ensure(ctx, tomorrow);
	const next = await getDay(ctx, tomorrow);
	assert.deepEqual(namesOf(next), ['Poulet', 'Riz'], 'le plan du lendemain est complet');
	assert.deepEqual(
		next.planned.map((p) => [p.name, p.qtyGrams]).sort(),
		[
			['Poulet', 150],
			['Riz', 100],
		],
		'quantités d’origine du plan'
	);

	const template = await ctx.db.get(templateId);
	assert.deepEqual(
		template.items.map((i) => [i.name, i.qtyGrams]),
		[
			['Riz', 100],
			['Poulet', 150],
		],
		'le template coach n’est jamais modifié par la cliente'
	);
});

/* ── 4. Aucun doublon ── */

test('Journée sans modification : les re-résolutions successives ne dupliquent rien', async () => {
	const { ctx } = await setup();
	await ensure(ctx, today);
	await ensure(ctx, today);
	await ensure(ctx, today);
	const day = await getDay(ctx, today);
	assert.equal(day.planned.length, 2, 'toujours deux aliments, pas quatre');
	assert.equal(new Set(plannedKeys(day)).size, 2, 'une seule ligne par aliment du plan');
	assert.equal(day.plannedTotals.kcal, 550, 'totaux prévus inchangés');
});

/* ── 5. Jours passés inchangés ── */

test('Jour passé : jamais re-résolu, les entrées existantes restent intactes', async () => {
	const { ctx, userId, templateId } = await setup();
	const legacyPlanned = await ctx.db.insert('plannedEntries', {
		userId,
		date: yesterday,
		meal: 'dejeuner',
		source: 'coach_plan',
		templateId,
		templateItemKey: '1:dejeuner:Poulet',
		name: 'Poulet',
		qtyGrams: 150,
		kcal: 200,
		carbs: 0,
		protein: 40,
		fat: 5,
		createdAt: 1,
	});
	const entry = await ctx.db.insert('diaryEntries', {
		userId,
		date: yesterday,
		meal: 'petit-dej',
		name: 'Café',
		qtyGrams: 200,
		kcal: 2,
		carbs: 0,
		protein: 0,
		fat: 0,
		createdAt: 1,
	});

	await ensure(ctx, yesterday);
	const day = await getDay(ctx, yesterday);
	assert.equal(day.planned.length, 1, 'un seul item planifié historique (ni supprimé ni dupliqué)');
	assert.equal(day.planned[0]._id, legacyPlanned, 'la ligne historique est la même');
	assert.equal(day.planned[0].qtyGrams, 150, 'sa quantité est inchangée');
	assert.equal(day.entries.length, 1, 'l’entrée consommée passée est intacte');
	assert.equal(day.entries[0]._id, entry, 'même entrée consommée');
});

/* ── 6. Validation « Mangé » et journal coach ── */

test('Mangé le jour J : l’item ne revient pas en prévu et le coach voit l’entrée réelle', async () => {
	const { ctx, userId } = await setup();
	await ensure(ctx, today);
	const initial = await getDay(ctx, today);
	const riz = initial.planned.find((p) => p.name === 'Riz');
	await journal.eatPlanned._handler(ctx, {
		sessionToken: CLIENT_TOKEN,
		plannedId: riz._id,
		clientDate: today,
	});

	await ensure(ctx, today);
	const after = await getDay(ctx, today);
	assert.deepEqual(namesOf(after), ['Poulet'], 'l’aliment validé ne reste pas en prévu (aucun doublon)');

	const coachDay = await getCoachDay(ctx, userId, today);
	assert.deepEqual(
		coachDay.entries.map((e) => e.name),
		['Riz'],
		'le journal coach affiche l’entrée réelle de la cliente'
	);
	assert.equal(coachDay.totals.kcal, 350, 'les calories consommées sont celles de l’entrée réelle');
});
