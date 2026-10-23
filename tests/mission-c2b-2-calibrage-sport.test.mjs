/**
 * Mission C2b-2 — NOTE PERFORMANCE · MENU COACH · PRÉ-REMPLISSAGE SPORTIF.
 *
 * Vérifié :
 *  1. PERFORMANCE : la ligne « Ta maintenance inclut déjà ton sport habituel
 *     (environ Y kcal par semaine). » s'affiche sous le déficit de la semaine
 *     quand l'objectif en vigueur vient d'un calibrage dont le sport de la
 *     semaine > 0 ; absente après une saisie manuelle et avec un sport à 0 ;
 *  2. MENU : « Outils & calibrage » retiré du menu latéral COACH, conservé côté
 *     cliente, page toujours accessible par son adresse (/outils) ;
 *  3. PRÉ-REMPLISSAGE : réponse structurée → séance pré-remplie (activité,
 *     intensité, séances/sem, durée) ; texte libre → rien interprété, réponse
 *     affichée telle quelle ; réponse absente → rien ; profil déjà rempli →
 *     bouton masqué.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const perf = await import(new URL('../src/lib/perf.ts', import.meta.url).href);
const sportPrefill = await import(new URL('../src/lib/sportPrefill.ts', import.meta.url).href);
const journalConvex = await import(new URL('../src/convex/journal.ts', import.meta.url).href);
const { hashToken } = await import(new URL('../src/convex/helpers.ts', import.meta.url).href);

const perfPage = readFileSync(join(root, 'src/routes/espace/performance/+page.svelte'), 'utf8');
const appShell = readFileSync(join(root, 'src/lib/components/AppShell.svelte'), 'utf8');
const adminPage = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');
const journalConvexSrc = readFileSync(join(root, 'src/convex/journal.ts'), 'utf8');

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

const TOKEN = 'session-c2b-2';
const PASSE = '2020-01-01'; // date d'effet passée garantie ≤ aujourd'hui
const FUTUR = '2099-01-01'; // date d'effet future garantie > aujourd'hui

async function ctxAvecCliente() {
	const ctx = makeCtx();
	const coachId = await ctx.db.insert('users', { role: 'coach', disabled: false, name: 'Coach' });
	const userId = await ctx.db.insert('users', {
		role: 'client',
		disabled: false,
		name: 'Cliente Test',
		createdBy: coachId
	});
	await ctx.db.insert('sessions', {
		tokenHash: await hashToken(TOKEN),
		userId,
		expiresAt: Date.now() + 3_600_000
	});
	return { ctx, coachId, userId };
}

/** Instantané `calibrageSnapshots` minimal : objectif appliqué + sport de la semaine. */
function instantane(userId, coachId, { effectiveFrom, kcal, createdAt, sportSemaineKcal = 800, maintenanceKcal = 2050 }) {
	return {
		userId,
		inputs: { poidsKg: 60, mgPct: 26 },
		results: {
			sportSemaineKcal,
			maintenanceFiletKcal: maintenanceKcal,
			objectifJournalierKcal: kcal,
			applique: { kcal, carbs: 210, protein: 130, fat: 50, maintenanceKcal, effectiveFrom }
		},
		formulaVersion: '1',
		effectiveFrom,
		date: effectiveFrom,
		createdBy: coachId,
		createdAt
	};
}

/* ═══════════ 1 · Note Performance « sport habituel inclus » ═══════════ */

test('NOTE : objectif issu d’un calibrage avec sport > 0 → note avec Y kcal/semaine', () => {
	const sport = perf.sportHabituelObjectifEnVigueur(
		[{ kcal: 1800, effectiveFrom: PASSE, createdAt: 3000 }],
		[
			{
				effectiveFrom: PASSE,
				createdAt: 3001,
				kcalApplique: 1800,
				sportSemaineKcal: 1287
			}
		],
		'2026-10-19'
	);
	assert.equal(sport, 1287, 'sport de la semaine du calibrage en vigueur');
	assert.equal(
		perf.noteMaintenanceSport(sport),
		'Ta maintenance inclut déjà ton sport habituel (environ ' + (1287).toLocaleString('fr-FR') + ' kcal par semaine).'
	);
});

test('NOTE : objectif saisi à la main → aucune note', () => {
	/* Ligne d'historique sans instantané apparié = saisie manuelle. */
	assert.equal(
		perf.sportHabituelObjectifEnVigueur(
			[{ kcal: 1700, effectiveFrom: PASSE, createdAt: 2000 }],
			[
				{
					effectiveFrom: PASSE,
					createdAt: 3001,
					kcalApplique: 1800,
					sportSemaineKcal: 1287
				}
			],
			'2026-10-19'
		),
		null,
		'saisie manuelle → null'
	);
	/* Historique vide (objectif antérieur à l'historisation) → réputé manuel. */
	assert.equal(
		perf.sportHabituelObjectifEnVigueur([], [{ effectiveFrom: PASSE, createdAt: 1, kcalApplique: 1800, sportSemaineKcal: 500 }], '2026-10-19'),
		null
	);
});

test('NOTE : sport du calibrage à 0 → aucune note', () => {
	assert.equal(
		perf.sportHabituelObjectifEnVigueur(
			[{ kcal: 1800, effectiveFrom: PASSE, createdAt: 3000 }],
			[{ effectiveFrom: PASSE, createdAt: 3001, kcalApplique: 1800, sportSemaineKcal: 0 }],
			'2026-10-19'
		),
		null
	);
});

test('NOTE : saisie manuelle APRÈS un calibrage → note retirée (objectif en vigueur = manuel)', () => {
	assert.equal(
		perf.sportHabituelObjectifEnVigueur(
			[
				{ kcal: 1800, effectiveFrom: PASSE, createdAt: 1000 },
				{ kcal: 1750, effectiveFrom: '2026-10-01', createdAt: 2000 }
			],
			[{ effectiveFrom: PASSE, createdAt: 1001, kcalApplique: 1800, sportSemaineKcal: 800 }],
			'2026-10-19'
		),
		null
	);
});

test('NOTE : calibrage à date d’effet future → pas encore en vigueur', () => {
	assert.equal(
		perf.sportHabituelObjectifEnVigueur(
			[{ kcal: 1800, effectiveFrom: FUTUR, createdAt: 3000 }],
			[{ effectiveFrom: FUTUR, createdAt: 3001, kcalApplique: 1800, sportSemaineKcal: 800 }],
			'2026-10-19'
		),
		null
	);
});

test('NOTE getWeek : ligne après un calibrage avec sport, absente après saisie manuelle et sport à 0', async () => {
	/* a) Calibrage appliqué avec sport > 0 → note exposée par getWeek. */
	{
		const { ctx, coachId, userId } = await ctxAvecCliente();
		await ctx.db.insert('clientGoals', { userId, kcal: 1800, carbs: 210, protein: 130, fat: 50, maintenanceKcal: 2050 });
		await ctx.db.insert('clientGoalHistory', { userId, kcal: 1800, effectiveFrom: PASSE, createdBy: coachId, createdAt: 3000 });
		await ctx.db.insert('calibrageSnapshots', instantane(userId, coachId, { effectiveFrom: PASSE, kcal: 1800, createdAt: 3001, sportSemaineKcal: 1287 }));
		const week = await journalConvex.getWeek._handler(ctx, { sessionToken: TOKEN, start: '2026-10-19' });
		assert.equal(week.sportHabituelKcal, 1287, 'calibrage avec sport → Y kcal/semaine');
	}
	/* b) Objectif saisi à la main (aucun instantané) → pas de note. */
	{
		const { ctx, coachId, userId } = await ctxAvecCliente();
		await ctx.db.insert('clientGoals', { userId, kcal: 1700, carbs: 210, protein: 130, fat: 50, maintenanceKcal: 2050 });
		await ctx.db.insert('clientGoalHistory', { userId, kcal: 1700, effectiveFrom: PASSE, createdBy: coachId, createdAt: 3000 });
		const week = await journalConvex.getWeek._handler(ctx, { sessionToken: TOKEN, start: '2026-10-19' });
		assert.equal(week.sportHabituelKcal, null, 'saisie manuelle → pas de ligne');
	}
	/* c) Calibrage appliqué avec sport = 0 → pas de note. */
	{
		const { ctx, coachId, userId } = await ctxAvecCliente();
		await ctx.db.insert('clientGoals', { userId, kcal: 1800, carbs: 210, protein: 130, fat: 50, maintenanceKcal: 2050 });
		await ctx.db.insert('clientGoalHistory', { userId, kcal: 1800, effectiveFrom: PASSE, createdBy: coachId, createdAt: 3000 });
		await ctx.db.insert('calibrageSnapshots', instantane(userId, coachId, { effectiveFrom: PASSE, kcal: 1800, createdAt: 3001, sportSemaineKcal: 0 }));
		const week = await journalConvex.getWeek._handler(ctx, { sessionToken: TOKEN, start: '2026-10-19' });
		assert.equal(week.sportHabituelKcal, null, 'sport à 0 → pas de ligne');
	}
});

test('NOTE UI : affichée sous le déficit de la semaine, masquée sans calibrage', () => {
	assert.ok(journalConvexSrc.includes('sportHabituelKcal: sportHabituelObjectifEnVigueur('), 'getWeek décide via l’instantané réutilisé');
	assert.ok(journalConvexSrc.includes('calibrageSnapshots'), 'getWeek réutilise le dernier instantané calibrageSnapshots');
	assert.ok(perfPage.includes('{#if week.sportHabituelKcal}'), 'ligne conditionnée au calibrage');
	assert.ok(perfPage.includes('{noteMaintenanceSport(week.sportHabituelKcal)}'), 'texte exact via noteMaintenanceSport');
	/* Placement : après le bloc « Perte de graisse théorique estimée » (déficit). */
	const finDeficit = perfPage.indexOf('selon le déficit calorique cumulé');
	const note = perfPage.indexOf('noteMaintenanceSport(week.sportHabituelKcal)');
	assert.ok(finDeficit > 0 && note > finDeficit, 'note affichée sous le déficit de la semaine');
});

/* ═══════════ 2 · Menu coach : lien « Outils & calibrage » retiré ═══════════ */

test('MENU : lien retiré du menu coach, conservé côté cliente, page intacte', () => {
	const groupes = appShell.slice(appShell.indexOf('COACH_GROUPS'), appShell.indexOf('const coachLinks'));
	assert.ok(!groupes.includes("href: '/outils'"), 'plus de lien /outils dans le menu coach');
	assert.ok(appShell.includes("href: '/outils', label: 'Outils & calibrage'"), 'lien cliente conservé');
	/* La page et ses fichiers restent accessibles par leur adresse. */
	assert.ok(existsSync(join(root, 'src/routes/outils/+page.svelte')), 'page /outils conservée');
	assert.ok(existsSync(join(root, 'src/routes/outils/+layout.server.ts')), 'layout /outils conservé');
});

/* ═══════════ 3 · Pré-remplissage du profil sportif habituel ═══════════ */

test('PRÉ-REMPLISSAGE : réponse structurée → séance pré-remplie (activité, intensité, séances/sem, durée)', () => {
	const diag = sportPrefill.diagnostiquerReponseSport({
		sport: 'oui',
		sportsDetail: 'musculation',
		sportFrequency: '3x'
	});
	assert.equal(diag.format, 'structuree');
	assert.equal(diag.activiteId, 'musculation');
	assert.equal(diag.seancesParSemaine, 3);
	const seances = sportPrefill.prefillProfilSportif({
		sport: 'oui',
		sportsDetail: 'musculation',
		sportFrequency: '3x'
	});
	assert.deepEqual(seances, [
		{ activiteId: 'musculation', seancesParSemaine: 3, dureeMinutes: 60, choix: 'recreative' }
	]);
	/* Libellé exact du catalogue résolu par correspondance, intensité du barème. */
	const douce = sportPrefill.prefillProfilSportif({ sport: 'oui', sportsDetail: 'Yoga', sportFrequency: '5x' });
	assert.deepEqual(douce, [{ activiteId: 'yoga', seancesParSemaine: 5, dureeMinutes: 60, choix: 'legere' }]);
});

test('PRÉ-REMPLISSAGE : réponse en texte libre → rien interprété, réponse affichée telle quelle', () => {
	const rep = { sport: 'oui', sportsDetail: 'running + danse le samedi', sportFrequency: '3x' };
	assert.equal(sportPrefill.diagnostiquerReponseSport(rep).format, 'texte-libre');
	assert.equal(sportPrefill.prefillProfilSportif(rep), null, 'aucune séance inventée depuis du texte libre');
	/* Comportement actuel : la réponse reste affichée telle quelle à côté du profil. */
	assert.ok(adminPage.includes('réponse d\'onboarding affichée telle quelle, non convertie.'), 'réponse affichée telle quelle');
	assert.ok(adminPage.includes('prefillDemarrage'), 'état de pré-remplissage piloté par le diagnostic');
	assert.ok(adminPage.includes('{#if calibrageInputs.seances.length === 0 && prefillDemarrage}'), 'bouton conditionné au diagnostic + profil vide');
	assert.ok(adminPage.includes('Pré-remplir depuis le démarrage'), 'bouton « Pré-remplir depuis le démarrage »');
});

test('PRÉ-REMPLISSAGE : réponse absente → aucun pré-remplissage', () => {
	const diag = sportPrefill.diagnostiquerReponseSport({ sport: null, sportsDetail: null, sportFrequency: null });
	assert.equal(diag.format, 'absente');
	assert.equal(sportPrefill.prefillProfilSportif({ sport: null, sportsDetail: null, sportFrequency: null }), null);
});

test('PRÉ-REMPLISSAGE : profil déjà rempli → bouton masqué, rien écrasé', () => {
	/* La condition d’affichage exige un profil VIDE : aucune écrasement possible. */
	assert.ok(adminPage.includes('{#if calibrageInputs.seances.length === 0 && prefillDemarrage}'), 'profil rempli → bouton masqué');
	assert.ok(adminPage.includes('if (!p || calibrageInputs.seances.length > 0) return;'), 'garde : jamais d’écrasement d’un profil rempli');
	/* Sport « non » : rien à pré-remplir. */
	assert.equal(sportPrefill.prefillProfilSportif({ sport: 'non', sportsDetail: null, sportFrequency: null }), null);
});
