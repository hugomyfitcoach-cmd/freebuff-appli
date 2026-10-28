/**
 * Mission IMPORT-SÉANCE — importer les exercices d'une séance dans plusieurs
 * séances.
 *
 * Besoin : le coach a créé « Échauffement type » (1 séance, 8 exercices) et
 * veut l'ajouter au début de chaque séance d'un autre programme sans tout
 * ressaisir.
 *
 * Ces tests exécutent le VRAI handler Convex (`importSessionExercises`) sur un
 * contexte en mémoire, puis relisent par la vraie requête de l'éditeur
 * (`programFull`) et par le découpage d'affichage partagé (`supersetBlocks`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { supersetBlocks, importNoticeLabel } from '../src/lib/training.ts';
import { planSessionLayout } from '../src/convex/trainingLayout.ts';

const trainingApi = await import(new URL('../src/convex/training.ts', import.meta.url).href);
const { hashToken } = await import(new URL('../src/convex/helpers.ts', import.meta.url).href);

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/* ─────────── Contexte Convex en mémoire (db.get/insert/patch/delete/query) ─────────── */

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
				// Convex : patcher avec undefined supprime le champ optionnel.
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
	return { db, storage: { async getUrl() { return null; } } };
}

const TOKEN_A = 'session-import-a';
const TOKEN_B = 'session-import-b';

async function seedCoach(ctx, token, name) {
	const coachId = await ctx.db.insert('users', { role: 'coach', disabled: false, name });
	await ctx.db.insert('sessions', {
		tokenHash: await hashToken(token),
		userId: coachId,
		expiresAt: Date.now() + 3_600_000,
	});
	return coachId;
}

async function seedProgram(ctx, coachId, name, sessionNames) {
	const programId = await ctx.db.insert('trainingPrograms', { coachId, name, createdAt: 1, updatedAt: 1 });
	const sessionIds = [];
	for (const [i, sname] of sessionNames.entries()) {
		sessionIds.push(await ctx.db.insert('trainingSessions', { programId, name: sname, order: i, createdAt: 1 }));
	}
	return { programId, sessionIds };
}

/** Exercice de bibliothèque + ligne de séance + séries (prescription complète). */
async function addExercise(ctx, sessionId, order, opts = {}) {
	const exerciseId = await ctx.db.insert('exercises', { gfluxExerciseId: `g${order}`, name: opts.name ?? `Exercice ${order}` });
	const seId = await ctx.db.insert('trainingSessionExercises', {
		sessionId,
		exerciseId,
		order,
		mode: opts.mode ?? 'reps',
		createdAt: order,
		...(opts.tempo !== undefined ? { tempo: opts.tempo } : {}),
		...(opts.coachNote !== undefined ? { coachNote: opts.coachNote } : {}),
		...(opts.techniqueNote !== undefined ? { techniqueNote: opts.techniqueNote } : {}),
		...(opts.phase !== undefined ? { phase: opts.phase } : {}),
		...(opts.supersetGroup !== undefined ? { supersetGroup: opts.supersetGroup } : {}),
	});
	let setOrder = 0;
	for (const st of opts.sets ?? []) {
		await ctx.db.insert('trainingSets', { sessionExerciseId: seId, order: setOrder++, ...st });
	}
	return seId;
}

const sessionRows = (ctx, sessionId) =>
	ctx.db.query('trainingSessionExercises').withIndex('by_session', (q) => q.eq('sessionId', sessionId)).collect();
const setRows = (ctx, sessionExerciseId) =>
	ctx.db.query('trainingSets').withIndex('by_sessionExercise', (q) => q.eq('sessionExerciseId', sessionExerciseId)).collect();

const sortRows = (list) =>
	[...list].sort((a, b) => a.order - b.order || (a.createdAt ?? 0) - (b.createdAt ?? 0) || a._id.localeCompare(b._id));

/** Les 8 exercices de « Échauffement type », avec des prescriptions variées. */
async function seedWarmup(ctx) {
	const coachId = await seedCoach(ctx, TOKEN_A, 'Coach A');
	const warmup = await seedProgram(ctx, coachId, 'Échauffement type', ['Échauffement type']);
	const source = warmup.sessionIds[0];
	const ids = [];
	for (let i = 0; i < 8; i++) {
		ids.push(
			await addExercise(ctx, source, i, {
				name: `Échauffement ${i + 1}`,
				mode: i === 0 ? 'time' : 'reps',
				tempo: i === 1 ? '3-1-1-0' : undefined,
				coachNote: i === 2 ? 'Note coach source' : undefined,
				techniqueNote: i === 3 ? 'Consigne technique source' : undefined,
				phase: i < 2 ? undefined : 'principal',
				sets:
					i === 0
						? [{ durationSeconds: 45, restSeconds: 15 }]
						: [{ repsMin: 10 + i, repsMax: 12 + i, targetWeight: 20 + i, targetRir: 2, restSeconds: 60 }],
			})
		);
	}
	return { coachId, warmupProgramId: warmup.programId, sourceSessionId: source, exerciseIds: ids };
}

/* ═══════════ 1. Import de 8 exercices dans 3 séances, au début, phase forcée ═══════════ */

test('IMPORT : 8 exercices copiés dans 3 séances, au début, en échauffement', async () => {
	const ctx = makeCtx();
	const { coachId, sourceSessionId, exerciseIds } = await seedWarmup(ctx);

	// Programme cible : 3 séances, chacune avec 1 exercice existant.
	const target = await seedProgram(ctx, coachId, 'Programme cliente', ['Jour 1', 'Jour 2', 'Jour 3']);
	const existingIds = [];
	for (const sid of target.sessionIds) {
		existingIds.push(
			await addExercise(ctx, sid, 0, {
				name: 'Développé couché',
				sets: [{ repsMin: 8, repsMax: 10, targetWeight: 40, targetRir: 1, restSeconds: 120 }],
				phase: 'principal',
			})
		);
	}

	const res = await trainingApi.importSessionExercises._handler(ctx, {
		sessionToken: TOKEN_A,
		sourceSessionId,
		sessionExerciseIds: exerciseIds,
		targetSessionIds: target.sessionIds,
		position: 'start',
		phaseMode: 'echauffement',
	});

	assert.equal(res.exerciseCount, 8, '8 exercices importés');
	assert.equal(res.sessionCount, 3, '3 séances cibles');
	assert.equal(importNoticeLabel(res.exerciseCount, res.sessionCount), '8 exercices ajoutés à 3 séances');

	for (const [ti, sid] of target.sessionIds.entries()) {
		const rows = sortRows(await sessionRows(ctx, sid));
		assert.equal(rows.length, 9, `séance ${ti + 1} : 8 copies + l'exercice existant`);
		assert.deepEqual(rows.map((r) => r.order), [0, 1, 2, 3, 4, 5, 6, 7, 8], 'positions réindexées 0..n-1');
		const copies = rows.filter((r) => !existingIds.includes(r._id));
		assert.equal(copies.length, 8);
		assert.ok(
			copies.every((r) => !exerciseIds.includes(r._id)),
			'nouveaux identifiants (aucun lien avec la source)'
		);
		assert.ok(copies.every((r) => r.phase === 'echauffement'), 'phase forcée en échauffement');
		assert.equal(rows[8]._id, existingIds[ti], "l'exercice existant passe après le bloc importé");

		// Prescription intégralement recopiée (mode temps + reps + charge + RIR + repos + notes).
		const timed = copies[0];
		assert.equal(timed.mode, 'time');
		assert.deepEqual(
			(await setRows(ctx, timed._id)).map((s) => ({ durationSeconds: s.durationSeconds, restSeconds: s.restSeconds })),
			[{ durationSeconds: 45, restSeconds: 15 }]
		);
		const third = copies[2];
		assert.equal(third.coachNote, 'Note coach source');
		assert.equal(copies[1].tempo, '3-1-1-0');
		assert.equal(copies[3].techniqueNote, 'Consigne technique source');
		const set = (await setRows(ctx, third._id))[0];
		assert.equal(set.repsMin, 12);
		assert.equal(set.repsMax, 14);
		assert.equal(set.targetWeight, 22);
		assert.equal(set.targetRir, 2);
		assert.equal(set.restSeconds, 60);

		// Vue éditeur : les copies sont bien ce que la séance affichera.
		const view = await trainingApi.programFull._handler(ctx, { sessionToken: TOKEN_A, programId: target.programId });
		const viewSession = view.sessions.find((s) => s._id === sid);
		assert.equal(viewSession.exercises.length, 9);
		assert.equal(viewSession.exercises[0].phase, 'echauffement');
		assert.equal(viewSession.exercises[0].sets.length, 1);
	}

	// SOURCE INTACTE : mêmes lignes, mêmes positions, mêmes phases, mêmes séries.
	const sourceRows = sortRows(await sessionRows(ctx, sourceSessionId));
	assert.deepEqual(sourceRows.map((r) => r._id), exerciseIds, 'aucune ligne source remplacée');
	assert.deepEqual(sourceRows.map((r) => r.order), [0, 1, 2, 3, 4, 5, 6, 7]);
	assert.equal(sourceRows[2].phase, 'principal', 'la phase de la source ne bouge pas');
	assert.equal(sourceRows[0].phase, undefined, 'aucune phase forcée dans la source');
	assert.equal((await setRows(ctx, exerciseIds[2])).length, 1, 'séries de la source intactes');
});

/* ═══════════ 2. Circuit source recréé — sans doublon de clé ni fusion ═══════════ */

test('CIRCUIT : recréé comme circuit distinct dans chaque cible, sans doublon de clé', async () => {
	const ctx = makeCtx();
	const coachId = await seedCoach(ctx, TOKEN_A, 'Coach A');
	const src = await seedProgram(ctx, coachId, 'Circuit type', ['Circuit type']);
	const sourceSessionId = src.sessionIds[0];
	const ids = [];
	for (let i = 0; i < 5; i++) {
		ids.push(
			await addExercise(ctx, sourceSessionId, i, {
				...(i >= 1 && i <= 3 ? { supersetGroup: 'sup:src' } : {}),
				sets: [{ repsMin: 10, repsMax: 10, restSeconds: 30 }],
			})
		);
	}

	// Cibles : un circuit EXISTANT qui porte DÉJÀ l'identifiant de la source.
	const target = await seedProgram(ctx, coachId, 'Programme cible', ['Jour 1', 'Jour 2']);
	const existing = [];
	for (const sid of target.sessionIds) {
		const a = await addExercise(ctx, sid, 0, { supersetGroup: 'sup:src', sets: [{ repsMin: 12, repsMax: 12 }] });
		const b = await addExercise(ctx, sid, 1, { supersetGroup: 'sup:src', sets: [{ repsMin: 12, repsMax: 12 }] });
		existing.push([a, b]);
	}

	const args = {
		sessionToken: TOKEN_A,
		sourceSessionId,
		sessionExerciseIds: ids,
		targetSessionIds: target.sessionIds,
		position: 'start',
		phaseMode: 'keep',
	};
	await trainingApi.importSessionExercises._handler(ctx, args);

	const importedGroups = [];
	for (const [ti, sid] of target.sessionIds.entries()) {
		const rows = sortRows(await sessionRows(ctx, sid));
		assert.deepEqual(rows.map((r) => r.order), rows.map((_, i) => i), 'positions canoniques');

		// Le circuit EXISTANT garde son identifiant et ses 2 membres.
		const kept = rows.filter((r) => existing[ti].includes(r._id));
		assert.deepEqual(kept.map((r) => r.supersetGroup), ['sup:src', 'sup:src']);
		assert.equal(kept.length, 2);

		// Le circuit importé est un groupe NOUVEAU, contigu, 3 membres.
		const blocks = supersetBlocks(rows);
		const keys = blocks.map((b) => b.key);
		assert.equal(new Set(keys).size, keys.length, 'aucune clé de bloc en double');
		assert.ok(blocks.filter((b) => b.group).every((b) => b.exercises.length >= 2), 'aucun faux circuit');

		const copies = rows.filter((r) => !existing[ti].includes(r._id));
		const importedGroup = copies.find((r) => r.supersetGroup)?.supersetGroup;
		assert.ok(importedGroup, 'circuit importé présent');
		assert.notEqual(importedGroup, 'sup:src', "l'identifiant de la source n'est jamais réutilisé");
		assert.equal(copies.filter((r) => r.supersetGroup === importedGroup).length, 3);

		// Contiguïté du bloc importé (les circuits ne se coupent pas).
		const positions = rows.map((r) => (r.supersetGroup === importedGroup ? 1 : 0));
		const run = positions.join('');
		assert.ok(run.includes('111'), 'les 3 membres sont contigus');
		importedGroups.push(importedGroup);
	}
	assert.notEqual(importedGroups[0], importedGroups[1], 'un circuit DISTINCT par séance cible');

	// Deuxième import dans la même séance : aucun circuit fusionné, aucune clé en double.
	await trainingApi.importSessionExercises._handler(ctx, {
		...args,
		targetSessionIds: [target.sessionIds[0]],
	});
	const rows = sortRows(await sessionRows(ctx, target.sessionIds[0]));
	assert.equal(rows.length, 12, 'deux imports de 5 + le circuit existant de 2');
	const groups = new Set(rows.map((r) => r.supersetGroup).filter(Boolean));
	assert.equal(groups.size, 3, 'sup:src existant + 2 circuits importés distincts');
	const blocks = supersetBlocks(rows);
	const keys = blocks.map((b) => b.key);
	assert.equal(new Set(keys).size, keys.length, 'toujours aucune clé en double');
	assert.equal(blocks.reduce((n, b) => n + b.exercises.length, 0), rows.length, 'aucun exercice perdu');

	// La mise en page canonique est idempotente sur le résultat.
	const plan = planSessionLayout(rows);
	assert.deepEqual(plan.orderedIds, rows.map((r) => r._id));

	// La source n'a jamais bougé (ni groupe, ni position).
	const sourceRows = sortRows(await sessionRows(ctx, sourceSessionId));
	assert.deepEqual(sourceRows.map((r) => r._id), ids);
	assert.deepEqual(sourceRows.map((r) => r.supersetGroup), [undefined, 'sup:src', 'sup:src', 'sup:src', undefined]);
});

/* ═══════════ 3. Contrôles de propriété (même règle que le reste du module) ═══════════ */

test('REFUS : programme source appartenant à un autre coach', async () => {
	const ctx = makeCtx();
	const { sourceSessionId, exerciseIds } = await seedWarmup(ctx); // appartient au coach A
	const coachB = await seedCoach(ctx, TOKEN_B, 'Coach B');
	const targetB = await seedProgram(ctx, coachB, 'Programme de B', ['Jour 1']);

	await assert.rejects(
		() =>
			trainingApi.importSessionExercises._handler(ctx, {
				sessionToken: TOKEN_B,
				sourceSessionId,
				sessionExerciseIds: exerciseIds,
				targetSessionIds: [targetB.sessionIds[0]],
				position: 'start',
				phaseMode: 'echauffement',
			}),
		/Programme introuvable/,
		'la séance source du coach A est refusée au coach B'
	);
	assert.equal((await sessionRows(ctx, targetB.sessionIds[0])).length, 0, 'aucune écriture dans la cible');
	assert.equal((await sessionRows(ctx, sourceSessionId)).length, 8, 'la source reste intacte');
});

test("REFUS : séance cible d'un autre programme / autre coach", async () => {
	const ctx = makeCtx();
	const { sourceSessionId, exerciseIds } = await seedWarmup(ctx);
	const coachB = await seedCoach(ctx, TOKEN_B, 'Coach B');
	const foreign = await seedProgram(ctx, coachB, 'Programme de B', ['Jour 1']);

	await assert.rejects(
		() =>
			trainingApi.importSessionExercises._handler(ctx, {
				sessionToken: TOKEN_A,
				sourceSessionId,
				sessionExerciseIds: exerciseIds,
				targetSessionIds: [foreign.sessionIds[0]],
				position: 'start',
				phaseMode: 'echauffement',
			}),
		/Programme introuvable/,
		'la cible appartient à un autre coach'
	);
	assert.equal((await sessionRows(ctx, foreign.sessionIds[0])).length, 0);

	// Sélection vide / séance source hors de la sélection : refusées aussi.
	await assert.rejects(
		() =>
			trainingApi.importSessionExercises._handler(ctx, {
				sessionToken: TOKEN_A,
				sourceSessionId,
				sessionExerciseIds: [],
				targetSessionIds: [sourceSessionId],
				position: 'start',
				phaseMode: 'echauffement',
			}),
		/Sélectionne au moins un exercice/
	);
});

/* ═══════════ 4. Le contrat UI/BFF porte bien la fonctionnalité ═══════════ */

test("UI + BFF : bouton, volet complet, rappel d'assignation et contrat de mutation", () => {
	const editor = read('src/lib/components/TrainingEditor.svelte');
	const bff = read('src/routes/api/coach/training/import-exercises/+server.ts');
	const training = read('src/convex/training.ts');
	const schema = read('src/convex/schema.ts');

	// Bouton dans l'en-tête de la séance, à côté de « Ajouter un exercice ».
	assert.ok(editor.includes('Importer des exercices'), 'libellé du bouton');
	assert.ok(editor.includes('onclick={openImport}'));
	assert.ok(
		editor.indexOf('Importer des exercices') < editor.indexOf('Ajouter un exercice'),
		'les deux boutons partagent l\'en-tête de la séance'
	);

	// Volet : source (programme + séance), exercices cochés, cibles, position, phase.
	assert.ok(editor.includes("fetch('/api/coach/training/programs')"), 'programmes du coach');
	assert.ok(editor.includes('toggleImportPick'), 'sélection des exercices');
	assert.ok(editor.includes('toggleImportTarget'), 'séances cibles');
	assert.ok(editor.includes('setImportPosition'), 'position au début / à la fin');
	assert.ok(editor.includes("importPhase = 'echauffement'"), 'phase forcée par défaut au début');
	assert.ok(editor.includes("importTargets = new Set([selectedSessionId])"), 'séance courante cochée par défaut');

	// Message court + rappel d'assignation.
	assert.ok(editor.includes('importNoticeLabel(n, k)'));
	assert.ok(editor.includes('Réassigne le programme pour que ta cliente reçoive la modification.'));

	// BFF : transmet tout le contrat.
	for (const field of ['sourceSessionId', 'sessionExerciseIds', 'targetSessionIds', 'position', 'phaseMode']) {
		assert.ok(bff.includes(field), `BFF : ${field} transmis`);
	}
	assert.ok(bff.includes('api.training.importSessionExercises'));

	// Mutation : copie + mise en page canonique, aucune suppression.
	const start = training.indexOf('export const importSessionExercises = mutation({');
	assert.ok(start > 0, 'mutation présente');
	const block = training.slice(start, training.indexOf('/* ═══════════ Séries ═══════════ */', start));
	assert.ok(block.includes('normalizeSessionLayout'), 'positions réindexées par la mise en page canonique');
	assert.ok(block.includes('ctx.db.insert("trainingSets"'), 'séries recopiées');
	assert.ok(!block.includes('ctx.db.delete'), 'aucune suppression');
	assert.ok(!block.includes('ctx.db.patch(se'), 'la source n\'est jamais patchée');
	for (const field of ['tempo', 'coachNote', 'techniqueNote', 'repsMin', 'repsMax', 'targetWeight', 'targetRir', 'restSeconds', 'durationSeconds']) {
		assert.ok(block.includes(field), `prescription copiée : ${field}`);
	}
	assert.ok(block.includes('supersetGroup'), 'les circuits sont recréés');

	// Aucun changement de schéma.
	assert.ok(schema.includes('supersetGroup: v.optional(v.string())'), 'champ optionnel inchangé');
});
