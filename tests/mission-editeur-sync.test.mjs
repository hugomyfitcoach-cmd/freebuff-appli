/**
 * Mission ÉDITEUR-SYNC — prescription non rafraîchie + phase qui ne tient pas.
 *
 * Deux défauts distincts, vérifiés ici :
 *  1) la liste des exercices lisait l'APERÇU (`exercisePreview`) d'un objet
 *     jamais rafraîchi après un PATCH de série → « 1 × 10 · 60 s » alors que le
 *     panneau (et la base) disaient 15 ;
 *  2) le BFF PATCH ne transmettait PAS `phase` à la mutation : le validateur
 *     l'acceptait, mais la valeur n'était jamais écrite → retour systématique
 *     sur « Entraînement principal ».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { exercisePreview, parseRepsField, supersetLabel } from '../src/lib/training.ts';

const trainingApi = await import(new URL('../src/convex/training.ts', import.meta.url).href);
const { hashToken } = await import(new URL('../src/convex/helpers.ts', import.meta.url).href);

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const editor = read('src/lib/components/TrainingEditor.svelte');
const bff = read('src/routes/api/coach/training/session-exercises/[id]/+server.ts');
const training = read('src/convex/training.ts');
const trainingClient = read('src/convex/trainingClient.ts');
const runner = read('src/lib/components/SessionRunner.svelte');

/** Le champ `phase` du schéma est optionnel : 3 valeurs, rien d'autre. */
const PHASES = ['echauffement', 'principal', 'finisher'];

/* ═══════════ 1. La liste suit le panneau (même donnée) ═══════════ */

test('LISTE : modifier les reps met l\'aperçu à jour, sans copie locale', () => {
	const set = { _id: 's1', order: 0, repsMin: 10, repsMax: 10, restSeconds: 60 };
	const ex = { _id: 'e1', order: 0, mode: 'reps', sets: [set] };
	assert.equal(exercisePreview(ex), '1 × 10 · 60 s', 'état initial de la liste');

	// Ce que le panneau envoie (puis ce que la requête rechargée renvoie) :
	const parsed = parseRepsField('15');
	assert.deepEqual(parsed, { repsMin: 15, repsMax: 15 });
	Object.assign(set, parsed);

	// L'aperçu de la liste lit le MÊME objet que le panneau : aucune copie à
	// rafraîchir, la valeur enregistrée s'affiche immédiatement.
	assert.equal(exercisePreview(ex), '1 × 15 · 60 s');
});

test('LISTE : repos, charge, RIR et durée (mode temps) suivent aussi', () => {
	const set = { _id: 's1', order: 0, repsMin: 12, repsMax: 12, restSeconds: 60, targetWeight: 40, targetRir: 2 };
	const ex = { _id: 'e1', order: 0, mode: 'reps', sets: [set] };
	assert.equal(exercisePreview(ex), '1 × 12 · 40 kg · RIR 2 · 60 s');

	set.restSeconds = 90;
	assert.equal(exercisePreview(ex), '1 × 12 · 40 kg · RIR 2 · 90 s');

	const timed = { _id: 'e2', order: 0, mode: 'time', sets: [{ _id: 's2', order: 0, durationSeconds: 60, restSeconds: 30 }] };
	assert.equal(exercisePreview(timed), '1 × 60 s · 30 s');
	timed.sets[0].durationSeconds = 45;
	assert.equal(exercisePreview(timed), '1 × 45 s · 30 s');
});

test('ÉDITEUR : toute valeur qui pilote l\'aperçu est écrite PUIS rechargée', () => {
	// Helper unique : PATCH awaité → onReload() (la requête fait foi).
	assert.ok(/async function saveSet\(/.test(editor), 'helper de série');
	assert.ok(/async function saveExercise\(/.test(editor), 'helper de prescription');
	for (const helper of ['saveSet(', 'saveExercise(']) {
		const start = editor.indexOf(helper === 'saveSet(' ? 'async function saveSet(' : 'async function saveExercise(');
		const body = editor.slice(start, start + 320);
		assert.ok(body.includes('await send('), `${helper} : écriture awaitée`);
		assert.ok(body.includes('await onReload()'), `${helper} : rechargement après écriture`);
	}
	// Reps et champs numériques passent par saveSet (plus de send nu).
	const reps = editor.slice(editor.indexOf('function onRepsInput'), editor.indexOf('function onSetNumberInput'));
	assert.ok(reps.includes('saveSet('), 'reps → saveSet');
	assert.ok(!reps.includes("send('PATCH'"), 'reps : plus d\'écriture sans rechargement');
	const numeric = editor.slice(editor.indexOf('function onSetNumberInput'), editor.indexOf('</script>'));
	assert.ok(numeric.includes('saveSet('), 'charge / RIR / repos / durée → saveSet');
	assert.ok(!/patchExercise\(selectedExercise\._id, \{ mode \}\)/.test(editor), 'mode : plus de PATCH lancé sans attente');
	assert.ok(editor.includes('selectedExercise.mode = mode'), 'mode : retour visuel immédiat');
});

/* ═══════════ 2. Bout en bout sur les VRAIS handlers Convex ═══════════ */

/** Contexte Convex en mémoire (db.get/insert/patch/delete/query). */
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

const TOKEN = 'session-editeur-sync';

/** Coach + programme + une séance d'un exercice à 3 séries de 10 × 60 s. */
async function seedProgram() {
	const ctx = makeCtx();
	const coachId = await ctx.db.insert('users', { role: 'coach', disabled: false, name: 'Coach Test' });
	await ctx.db.insert('sessions', {
		tokenHash: await hashToken(TOKEN),
		userId: coachId,
		expiresAt: Date.now() + 3_600_000,
	});
	const programId = await ctx.db.insert('trainingPrograms', {
		coachId,
		name: 'Programme test',
		createdAt: 1,
		updatedAt: 1,
	});
	const sessionId = await ctx.db.insert('trainingSessions', { programId, name: 'Jour 1', order: 0, createdAt: 1 });
	const exerciseId = await ctx.db.insert('exercises', { gfluxExerciseId: 'g1', name: 'Squat' });
	const sessionExerciseId = await ctx.db.insert('trainingSessionExercises', {
		sessionId,
		exerciseId,
		order: 0,
		mode: 'reps',
		createdAt: 1,
	});
	const setId = await ctx.db.insert('trainingSets', {
		sessionExerciseId,
		order: 0,
		repsMin: 10,
		repsMax: 10,
		restSeconds: 60,
	});
	return { ctx, programId, sessionId, sessionExerciseId, setId };
}

test('BOUT EN BOUT : reps modifiées → la requête de la liste renvoie la nouvelle valeur', async () => {
	const { ctx, programId, setId } = await seedProgram();
	await trainingApi.updateSet._handler(ctx, { sessionToken: TOKEN, setId, fields: { repsMin: 15, repsMax: 15 } });

	// Ce que le BFF GET /programs/:id renvoie à l'éditeur (programFull).
	const view = await trainingApi.programFull._handler(ctx, { sessionToken: TOKEN, programId });
	const ex = view.sessions[0].exercises[0];
	assert.equal(ex.sets[0].repsMin, 15, 'requête : valeur enregistrée');
	assert.equal(
		exercisePreview(ex),
		'1 × 15 · 60 s',
		'la liste affiche la nouvelle prescription (plus « 1 × 10 · 60 s »)'
	);
});

test('BOUT EN BOUT : phase Échauffement enregistrée puis relue (coach)', async () => {
	const { ctx, programId, sessionExerciseId } = await seedProgram();

	// PATCH du panneau — exactement les arguments transmis par le BFF.
	await trainingApi.updateSessionExercise._handler(ctx, {
		sessionToken: TOKEN,
		sessionExerciseId,
		phase: 'echauffement',
	});

	const row = await ctx.db.get(sessionExerciseId);
	assert.equal(row.phase, 'echauffement', 'écrit en base (le BFF ne perd plus le champ)');

	const view = await trainingApi.programFull._handler(ctx, { sessionToken: TOKEN, programId });
	assert.equal(view.sessions[0].exercises[0].phase, 'echauffement', 'relu par la requête de l\'éditeur');
});

test('BOUT EN BOUT : retour à « principal » (null) retire la référence', async () => {
	const { ctx, programId, sessionExerciseId } = await seedProgram();
	await trainingApi.updateSessionExercise._handler(ctx, { sessionToken: TOKEN, sessionExerciseId, phase: 'finisher' });
	await trainingApi.updateSessionExercise._handler(ctx, { sessionToken: TOKEN, sessionExerciseId, phase: null });

	const row = await ctx.db.get(sessionExerciseId);
	assert.equal(row.phase, undefined, 'champ retiré (défaut = principal)');
	const view = await trainingApi.programFull._handler(ctx, { sessionToken: TOKEN, programId });
	assert.equal(view.sessions[0].exercises[0].phase ?? 'principal', 'principal', 'affiché « Entraînement principal »');
});

test('BOUT EN BOUT : la phase écrite est celle que la cliente verra (copie d\'assignation)', async () => {
	const { ctx, programId, sessionExerciseId } = await seedProgram();
	await trainingApi.updateSessionExercise._handler(ctx, { sessionToken: TOKEN, sessionExerciseId, phase: 'echauffement' });

	const coach = await ctx.db.query('users').withIndex('by_role', (q) => q.eq('role', 'coach')).first();
	// Copie d'assignation (programme cliente) : la phase doit suivre.
	const copyId = await trainingApi.copyProgramInto(ctx, { coachId: coach._id, sourceProgramId: programId });
	const copiedSession = await ctx.db
		.query('trainingSessions')
		.withIndex('by_program', (q) => q.eq('programId', copyId))
		.first();
	const copied = await ctx.db
		.query('trainingSessionExercises')
		.withIndex('by_session', (q) => q.eq('sessionId', copiedSession._id))
		.collect();
	assert.equal(copied[0].phase, 'echauffement', 'phase propagée à la copie assignée');
});

/* ═══════════ 3. La phase est envoyée, acceptée, relue ═══════════ */

test('BFF : `phase` est transmise à la mutation', () => {
	assert.ok(bff.includes('body.phase !== undefined'), 'branche dédiée');
	assert.ok(/phase: \(body\.phase as 'echauffement' \| 'principal' \| 'finisher' \| null\)/.test(bff), 'valeur transmise');
	// Sans ce passage, la mutation recevait `undefined` → aucun patch.
	const patch = bff.slice(bff.indexOf('updateSessionExercise'));
	assert.ok(patch.includes('phase'), 'champ présent dans l\'appel Convex');
});

test('CONVEX : le validateur accepte les 3 phases (et null = principal)', () => {
	const block = training.slice(training.indexOf('export const updateSessionExercise'), training.indexOf('/* ═══════════ Supersets'));
	for (const p of PHASES) assert.ok(block.includes(`v.literal("${p}")`), `phase ${p} acceptée`);
	assert.ok(block.includes('v.null()'), 'null accepté (= principal, champ retiré)');
	assert.ok(block.includes('patch.phase = phase ?? undefined'), 'null → référence retirée');
});

test('ÉDITEUR : le sélecteur enregistre la phase et recharge', () => {
	const block = editor.slice(editor.indexOf('Phase du parcours') - 400, editor.indexOf('Phase du parcours') + 1400);
	assert.ok(block.includes('value={selectedExercise.phase ?? \'principal\'}'), 'la valeur affichée vient de la donnée');
	assert.ok(block.includes('if (!selectedExercise) return;'), 'garde avant écriture');
	assert.ok(/saveExercise\(id, \{ phase: v === 'principal' \? null : v \}\)/.test(block), 'phase envoyée (principal → null)');
	assert.ok(block.includes('selectedExercise.phase = v'), 'affichage immédiat');
	assert.ok(!/patchExercise\([^)]*phase/.test(block), 'plus d\'écriture de phase sans attente ni rechargement');
});

test('LECTURE : la phase est exposée au coach ET à la cliente', () => {
	assert.ok(training.includes('phase: se.phase,'), 'vue éditeur : phase lue dans la requête programme');
	assert.ok(trainingClient.includes('phase: se.phase ?? "principal"'), 'vue cliente : phase exposée (défaut principal)');
});

/* ═══════════ 3. Côté cliente : l'ordre suit la phase enregistrée ═══════════ */

test('CLIENTE : ordre échauffement → principal → finisher depuis la phase enregistrée', () => {
	assert.ok(/PHASE_ORDER: Record<string, number> = \{ echauffement: 0, principal: 1, finisher: 2 \}/.test(runner), 'ordre canonique');
	assert.ok(/function phasesOf\(exs: Ex\[\]\): string\[\]/.test(runner), 'regroupement par phase');
	assert.ok(runner.includes('PHASE_ORDER[a] ?? 1'), 'tri par phase (jamais l\'ordre de la base)');
	assert.ok(
		/supersetBlocks\(data\.exercises\.filter\(\(e\) => \(e\.phase \?\? 'principal'\) === phase\)\)/.test(runner),
		'les exercices affichés sont filtrés sur leur phase'
	);
	// Le parcours guidé suit le MÊME ordre de phase que l'affichage libre.
	assert.ok(/const guidedExercises = \$derived\(/.test(runner), 'parcours guidé ordonné par phase');
	assert.ok(/const gEx = \$derived\(guidedExercises\[gExIdx\]/.test(runner), 'l\'étape guidée vient de cet ordre');
	assert.ok(!/gExIdx < data\.exercises\.length/.test(runner), 'plus de parcours guidé dans l\'ordre brut');

	// Les copies (assignation cliente + duplication de séance) conservent la phase.
	const copies = training.match(/\.\.\.\(se\.phase \? \{ phase: se\.phase \} : \{\}\)/g) ?? [];
	assert.ok(copies.length >= 2, 'copyProgramInto ET duplicateSession copient la phase');
});

/* ═══════════ 4. Repères de non-régression ═══════════ */

test('NON-RÉGRESSION : les libellés et la structure des séances sont intacts', () => {
	assert.equal(supersetLabel(2), 'Superset');
	assert.equal(supersetLabel(3), 'Triset');
	assert.equal(supersetLabel(4), 'Circuit × 4');
	assert.ok(!editor.includes('prompt('), 'aucune boîte native');
	assert.ok(editor.includes('onReload'), 'l\'éditeur continue de recharger via la page');
});
