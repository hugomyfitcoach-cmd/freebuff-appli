/**
 * Mission C2c-4 — CALIBRAGE : instantané serveur fiable, date d'effet,
 * cohérence du mode présentation.
 *
 * Vérifié :
 *  1. DATE FUTURE REFUSÉE CÔTÉ SERVEUR : la mutation `calibrage.apply` lève
 *     une ConvexError claire pour toute date d'effet > aujourd'hui (fuseau
 *     Europe/Paris), sans AUCUNE écriture, et n'a aucune tâche programmée ;
 *     aujourd'hui reste accepté. Côté écran : plafond `max` = aujourd'hui +
 *     même message avant la confirmation ;
 *  2. INSTANTANÉ RECALCULÉ CÔTÉ SERVEUR : les résultats sont recalculés par
 *     `resultatsFiche` à partir des entrées validées (semaine type
 *     personnalisée `apportsSemaine` comprise), identiques à ceux de l'écran,
 *     et le navigateur ne fournit JAMAIS de résultats ; l'objectif appliqué
 *     reste celui du bloc « Appliquer à la fiche » ;
 *  3. PRÉSENTATION = VALEURS APPLIQUÉES : objectif et macros du bloc
 *     « Appliquer », semaine type appliquée (calSemaine, jours personnalisés)
 *     — jamais les valeurs calculées non retenues (calR) ;
 *  4. MAINTENANCE DE PRÉSENTATION = MAINTENANCE TOTALE (maintenanceFiletKcal,
 *     sport habituel inclus), comme partout ailleurs.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ConvexError } from 'convex/values';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const calibConvex = await import(new URL('../src/convex/calibrage.ts', import.meta.url).href);
const { hashToken, localTodayISO, addDaysISO } = await import(
	new URL('../src/convex/helpers.ts', import.meta.url).href
);
const fiche = await import(new URL('../src/lib/calibrageFiche.ts', import.meta.url).href);
const saisie = await import(new URL('../src/lib/calibrageSaisie.ts', import.meta.url).href);

const adminPage = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');
const convexSource = readFileSync(join(root, 'src/convex/calibrage.ts'), 'utf8');

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

const TOKEN = 'session-c2c-4';

async function ctxAvecCoach() {
	const ctx = makeCtx();
	const coachId = await ctx.db.insert('users', { role: 'coach', disabled: false, name: 'Coach' });
	const userId = await ctx.db.insert('users', { role: 'client', disabled: false, name: 'Cliente Test', createdBy: coachId });
	await ctx.db.insert('sessions', {
		tokenHash: await hashToken(TOKEN),
		userId: coachId,
		expiresAt: Date.now() + 3_600_000
	});
	return { ctx, coachId, userId };
}

/** Profil de référence avec une SEMAINE TYPE PERSONNALISÉE (journées hautes/basses). */
const ENTREES = {
	poidsKg: 56.6,
	mgPct: 26,
	pasMoyen: 8000,
	heuresTravail: 2,
	ajustementTravail: 0,
	adaptationPct: 0,
	deficitPct: 12,
	proteinesParKgMasseMaigre: 2.3,
	seances: [{ activiteId: 'musculation', seancesParSemaine: 2, dureeMinutes: 45, choix: 'moderee' }],
	apportsSemaine: [1400, null, 1800, null, 1500, null, null]
};

/** Bloc « Appliquer à la fiche » : valeurs SÉLECTIONNÉES par le coach. */
const APPLIQUE = { kcal: 1550, carbs: 170, protein: 110, fat: 60, maintenanceKcal: 1900 };

/* ═══════════ 1 · Date future refusée côté serveur ═══════════ */

test("DATE FUTURE : la mutation serveur refuse toute date d'effet > aujourd'hui (Europe/Paris), sans écriture", async () => {
	const futur = addDaysISO(localTodayISO(), 1);
	const { ctx, userId } = await ctxAvecCoach();
	await assert.rejects(
		() =>
			calibConvex.apply._handler(ctx, {
				sessionToken: TOKEN,
				userId,
				entrees: ENTREES,
				...APPLIQUE,
				effectiveFrom: futur
			}),
		(e) => e instanceof ConvexError && /futur/i.test(e.message),
		'ConvexError claire si date future'
	);
	assert.equal(ctx.all('clientGoals').length, 0, 'aucun objectif écrit');
	assert.equal(ctx.all('clientGoalHistory').length, 0, 'aucun historique écrit');
	assert.equal(ctx.all('calibrageSnapshots').length, 0, 'aucun instantané écrit');
});

test("DATE FUTURE : aujourd'hui est accepté, aucune tâche programmée, même refus à l'écran", async () => {
	const today = localTodayISO();
	const { ctx, userId } = await ctxAvecCoach();
	const res = await calibConvex.apply._handler(ctx, {
		sessionToken: TOKEN,
		userId,
		entrees: ENTREES,
		...APPLIQUE,
		effectiveFrom: today
	});
	assert.equal(res.ok, true, "la date du jour (maximum) passe");
	assert.equal(res.effectiveFrom, today);

	/* Aucune tâche programmée : le refus est immédiat, jamais reporté. */
	assert.ok(!convexSource.includes('scheduler'), "aucune tâche programmée dans apply");
	assert.ok(/messageDateEffetFuture\(effectiveFrom, localTodayISO\(\)\)/.test(convexSource), 'contrôle serveur à la date du jour Europe/Paris');

	/* Côté écran : plafond max = aujourd'hui + MÊME message avant confirmation. */
	const baliseDate = adminPage.slice(
		adminPage.lastIndexOf('<input', adminPage.indexOf('bind:value={applyDate}')),
		adminPage.indexOf('/>', adminPage.indexOf('bind:value={applyDate}')) + 2
	);
	assert.ok(baliseDate.includes('max={calDateMax}'), "l'écran plafonne la date d'effet à aujourd'hui");
	assert.ok(adminPage.includes("const calDateMax = $derived(calibragePre?.today ?? '');"), 'plafond = date du jour serveur (Europe/Paris)');
	const demarrage = adminPage.slice(
		adminPage.indexOf('function demarrerApplication'),
		adminPage.indexOf('async function appliquerCalibrage')
	);
	assert.ok(demarrage.includes('messageDateEffetFuture(applyDate, calDateMax)'), "refus écran avant la confirmation");
	assert.equal(saisie.MESSAGE_DATE_FUTURE, "La date d'effet ne peut pas être dans le futur : au maximum aujourd'hui (Europe/Paris).");
	assert.ok(demarrage.includes('MESSAGE_DATE_FUTURE') || demarrage.includes('msgDateFuture'), 'message partagé écran/serveur');
	assert.equal(saisie.messageDateEffetFuture('2026-10-24', '2026-10-23'), saisie.MESSAGE_DATE_FUTURE);
	assert.equal(saisie.messageDateEffetFuture('2026-10-23', '2026-10-23'), null, "aujourd'hui passe");
	assert.equal(saisie.messageDateEffetFuture('2026-10-22', '2026-10-23'), null, 'le passé passe');
});

/* ═══════════ 2 · results recalculé côté serveur, identique à l'écran ═══════════ */

test('INSTANTANÉ : results recalculé côté serveur = résultats de la semaine personnalisée à l’écran', async () => {
	/* Écran : `calR` = resultatsFiche(calibrageInputs) — même entrée côté serveur. */
	const ecran = fiche.resultatsFiche(ENTREES);
	const { ctx, userId } = await ctxAvecCoach();
	await calibConvex.apply._handler(ctx, {
		sessionToken: TOKEN,
		userId,
		entrees: ENTREES,
		...APPLIQUE,
		effectiveFrom: localTodayISO()
	});
	const snap = ctx.all('calibrageSnapshots')[0];
	assert.equal(snap.results.objectifJournalierKcal, ecran.objectifJournalierKcal, 'objectif recalculé = écran');
	assert.equal(snap.results.maintenanceFiletKcal, ecran.maintenanceFiletKcal, 'maintenance totale recalculée = écran');
	assert.equal(snap.results.budgetSemaineKcal, ecran.budgetSemaineKcal, 'budget recalculé = écran');
	assert.equal(snap.results.coefficient, ecran.coefficient, 'coefficient recalculé = écran');
	assert.deepEqual(snap.results.macros, ecran.macros, 'macros recalculées = écran');
	assert.deepEqual(
		snap.results.semaine.apportsKcal,
		ecran.semaine.apportsKcal,
		'semaine type personnalisée conservée telle quelle (jours saisis + jours type)'
	);
	assert.deepEqual(snap.results.semaine.apportsKcal, [1400, ecran.objectifJournalierKcal, 1800, ecran.objectifJournalierKcal, 1500, ecran.objectifJournalierKcal, ecran.objectifJournalierKcal]);
	assert.deepEqual(snap.results.semaine.disponibilitesKcal, ecran.semaine.disponibilitesKcal, 'disponibilités recalculées jour par jour');
	assert.deepEqual(snap.inputs, ENTREES, 'entrées figées telles quelles');

	/* L'objectif APPLIQUÉ reste celui du bloc « Appliquer » — jamais recalculé. */
	assert.equal(snap.results.applique.kcal, APPLIQUE.kcal);
	assert.equal(snap.results.applique.carbs, APPLIQUE.carbs);
	assert.equal(snap.results.applique.protein, APPLIQUE.protein);
	assert.equal(snap.results.applique.fat, APPLIQUE.fat);
	assert.equal(snap.results.applique.maintenanceKcal, APPLIQUE.maintenanceKcal);
	assert.equal(ctx.all('clientGoals')[0].kcal, APPLIQUE.kcal, 'objectif écrit = bloc Appliquer');

	/* Le navigateur ne fournit JAMAIS de résultats : aucun argument results,
	   stockage issu du seul recalcul serveur. */
	const argsApply = convexSource.slice(convexSource.indexOf('export const apply'), convexSource.indexOf('handler:'));
	assert.ok(!/results\s*:/.test(argsApply), "aucun argument results accepté par la mutation");
	assert.ok(convexSource.includes('resultatsFiche(entrees)'), 'recalcul serveur depuis les entrées');
	assert.ok(!convexSource.includes('body.results'), 'jamais de results du navigateur');
});

/* ═══════════ 3 · Présentation = valeurs appliquées ═══════════ */

test('PRÉSENTATION : objectif et macros du bloc « Appliquer », semaine appliquée (calSemaine)', () => {
	const debut = adminPage.indexOf('{#if calPresentation}');
	const presentation = adminPage.slice(debut, adminPage.indexOf('{:else}', debut));
	assert.ok(presentation.includes('`${applyKcal.toLocaleString(\'fr-FR\')} kcal`'), "tuile objectif = objectif du bloc Appliquer");
	assert.ok(!presentation.includes('calR.objectifJournalierKcal'), "plus l'objectif calculé non retenu");
	assert.ok(presentation.includes('{applyProtein} g de protéines'), 'protéines = bloc Appliquer');
	assert.ok(presentation.includes('{applyFat} g de lipides'), 'lipides = bloc Appliquer');
	assert.ok(presentation.includes('{applyCarbs} g de glucides'), 'glucides = bloc Appliquer');
	assert.ok(!presentation.includes('calR.macros'), 'plus les macros calculées non retenues');
	assert.ok(presentation.includes('{#each calSemaine.apportsKcal as apport, i (i)}'), 'grille de la semaine = semaine appliquée');
	assert.ok(presentation.includes('calSemaine.niveauxDisponibilite[i]'), 'disponibilités de la semaine appliquée');
	assert.ok(presentation.includes('-calSemaine.deficitSemaineKcal'), 'déficit de la semaine appliquée');
	assert.ok(presentation.includes('formatPerteGraisse(Math.abs(calSemaine.graisseKg))'), 'graisse estimée = semaine appliquée');
	assert.ok(!presentation.includes('calR.semaine'), 'plus la semaine calculée non retenue');

	/* Semaine appliquée : jours personnalisés préservés, jours type = objectif appliqué. */
	const entrees = ENTREES;
	const r = fiche.resultatsFiche(entrees);
	const sem = fiche.semaineAvecObjectif(entrees, r, APPLIQUE.kcal);
	assert.equal(sem.apportsKcal[0], 1400, 'jour personnalisé préservé');
	assert.equal(sem.apportsKcal[2], 1800, 'jour personnalisé préservé');
	assert.equal(sem.apportsKcal[4], 1500, 'jour personnalisé préservé');
	assert.equal(sem.apportsKcal[1], APPLIQUE.kcal, 'jour type = objectif appliqué du bloc');
});

/* ═══════════ 4 · Maintenance de présentation = maintenance totale ═══════════ */

test('PRÉSENTATION : tuile Maintenance = maintenanceFiletKcal (sport habituel inclus)', () => {
	const debut = adminPage.indexOf('{#if calPresentation}');
	const presentation = adminPage.slice(debut, adminPage.indexOf('{:else}', debut));
	assert.ok(
		presentation.includes('`${Math.round(calR.maintenanceFiletKcal).toLocaleString(\'fr-FR\')} kcal`'),
		'tuile = maintenance totale (filet)'
	);
	assert.ok(!presentation.includes('calR.maintenanceKcal'), 'plus la maintenance sans exercice en présentation');

	/* La maintenance totale inclut bien le sport habituel, comme partout. */
	const r = fiche.resultatsFiche(ENTREES);
	assert.equal(r.maintenanceFiletKcal, Math.round(r.budgetSemaineKcal / 7), 'maintenance totale = budget ÷ 7');
	assert.ok(r.maintenanceFiletKcal > r.maintenanceKcal, 'sport habituel inclus (au-dessus de la maintenance sans exercice)');
	assert.equal(
		r.maintenanceDetailKcal.sansExerciceKcal + r.maintenanceDetailKcal.sportJournalierKcal,
		r.maintenanceFiletKcal,
		'détail = total'
	);
});
