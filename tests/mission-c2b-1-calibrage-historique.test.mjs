/**
 * Mission C2b-1 — HISTORIQUE DU CALIBRAGE + MISE EN PAGE STABLE.
 *
 * Vérifié :
 *  1. LISTE : changements d'objectifs du plus récent au plus ancien, fondée sur
 *     `calibrageSnapshots` + `clientGoalHistory`, avec origine « Calibrage » ou
 *     « Saisie manuelle » (jamais de faux détail sur une ligne manuelle) ;
 *  2. DÉTAIL : un clic sur une ligne « Calibrage » déplie l'instantané figé —
 *     poids, masse grasse, pas, travail, adaptation, déficit, sport de la
 *     semaine et principaux résultats ;
 *  3. ÉTAT VIDE : « Aucun calibrage appliqué pour l'instant. » ;
 *  4. LIMITE : 5 lignes par défaut + « Voir tout » ;
 *  5. ACCÈS : refus côté serveur pour une cliente ET pour un AUTRE coach ;
 *  6. STABILITÉ : zones RÉSERVÉES (avertissements, sous-lignes, bandeau « Les
 *     résultats ont changé ») toujours rendues, avec ou sans avertissement —
 *     la saisie n'insère plus ni ne retire d'espace ; mode présentation intact.
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
const { hashToken } = await import(new URL('../src/convex/helpers.ts', import.meta.url).href);

const adminPage = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');
const histoRoute = readFileSync(join(root, 'src/routes/api/coach/calibrage/historique/+server.ts'), 'utf8');
const calibrageConvex = readFileSync(join(root, 'src/convex/calibrage.ts'), 'utf8');

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

const TOKEN = 'session-c2b-1';

/** Cliente rattachée à la coach A + session de la coach A. */
async function ctxAvecCoach() {
	const ctx = makeCtx();
	const coachId = await ctx.db.insert('users', { role: 'coach', disabled: false, name: 'Coach A' });
	const userId = await ctx.db.insert('users', {
		role: 'client',
		disabled: false,
		name: 'Cliente Test',
		createdBy: coachId
	});
	await ctx.db.insert('sessions', {
		tokenHash: await hashToken(TOKEN),
		userId: coachId,
		expiresAt: Date.now() + 3_600_000
	});
	return { ctx, coachId, userId };
}

/** Instantané de calibrage minimal : entrées + résultats + valeurs appliquées. */
function instantane(userId, coachId, { effectiveFrom, kcal, createdAt, maintenanceKcal = 2000, carbs = 200, protein = 120, fat = 55 }) {
	return {
		userId,
		inputs: {
			poidsKg: 60,
			mgPct: 26,
			pasMoyen: 10_000,
			heuresTravail: 2,
			ajustementTravail: 0.02,
			adaptationPct: 10,
			deficitPct: 12
		},
		results: {
			coefficient: 1.42,
			metabolismeBaseKcal: 1242,
			maintenanceKcal: 1739,
			maintenanceFiletKcal: maintenanceKcal,
			objectifJournalierKcal: kcal,
			budgetSemaineKcal: 12_400,
			deficitSemaineKcal: -1500,
			perteGraisseKg: 0.19,
			sportSemaineKcal: 800,
			applique: { kcal, carbs, protein, fat, maintenanceKcal, effectiveFrom }
		},
		formulaVersion: '1',
		effectiveFrom,
		date: effectiveFrom,
		createdBy: coachId,
		createdAt
	};
}

/* ═══════════ 1 · Liste triée avec son origine ═══════════ */

test("LISTE : changements triés du plus récent au plus ancien, origine « Calibrage » / « Saisie manuelle »", async () => {
	const { ctx, coachId, userId } = await ctxAvecCoach();
	/* Trois changements : 27/10 (calibrage), 20/10 (saisie manuelle), 13/10 (calibrage). */
	await ctx.db.insert('clientGoalHistory', { userId, kcal: 1800, effectiveFrom: '2026-10-27', createdBy: coachId, createdAt: 3000 });
	await ctx.db.insert('clientGoalHistory', { userId, kcal: 1700, effectiveFrom: '2026-10-20', createdBy: coachId, createdAt: 2000 });
	await ctx.db.insert('clientGoalHistory', { userId, kcal: 1600, effectiveFrom: '2026-10-13', createdBy: coachId, createdAt: 1000 });
	await ctx.db.insert('calibrageSnapshots', instantane(userId, coachId, { effectiveFrom: '2026-10-27', kcal: 1800, createdAt: 3001, maintenanceKcal: 2050, carbs: 210, protein: 130, fat: 50 }));
	await ctx.db.insert('calibrageSnapshots', instantane(userId, coachId, { effectiveFrom: '2026-10-13', kcal: 1600, createdAt: 1001, maintenanceKcal: 1900, carbs: 180, protein: 115, fat: 48 }));

	const lignes = await calibConvex.historique._handler(ctx, { sessionToken: TOKEN, userId });
	assert.equal(lignes.length, 3, 'trois changements d’objectif');
	assert.deepEqual(lignes.map((l) => l.effectiveFrom), ['2026-10-27', '2026-10-20', '2026-10-13'], 'du plus récent au plus ancien');
	assert.deepEqual(lignes.map((l) => l.origine), ['calibrage', 'manuelle', 'calibrage'], 'origines correctes');

	/* Ligne « Calibrage » : maintenance + macros viennent de l'instantané appliqué. */
	assert.equal(lignes[0].kcal, 1800);
	assert.equal(lignes[0].maintenanceKcal, 2050);
	assert.deepEqual(lignes[0].macros, { glucidesG: 210, proteinesG: 130, lipidesG: 50 }, 'macros en grammes');
	assert.equal(lignes[2].kcal, 1600);
	assert.equal(lignes[2].maintenanceKcal, 1900);

	/* Ligne « Saisie manuelle » : pas d'instantané → pas de faux détail ni de
	   macros inventées (non historisées par le chemin d'écriture). */
	assert.equal(lignes[1].kcal, 1700);
	assert.equal(lignes[1].maintenanceKcal, null);
	assert.equal(lignes[1].macros, null);
	assert.equal(lignes[1].detail, null, 'aucun détail sur une ligne manuelle');
});

test("LISTE : instantané orphelin (réapplication le même jour) tracé en ligne « Calibrage »", async () => {
	const { ctx, coachId, userId } = await ctxAvecCoach();
	/* L'historique daté garde la DERNIÈRE valeur du jour ; l'instantané éclipsé
	   reste visible comme son propre changement. */
	await ctx.db.insert('clientGoalHistory', { userId, kcal: 1800, effectiveFrom: '2026-10-27', createdBy: coachId, createdAt: 3000 });
	await ctx.db.insert('calibrageSnapshots', instantane(userId, coachId, { effectiveFrom: '2026-10-27', kcal: 1800, createdAt: 3001 }));
	await ctx.db.insert('calibrageSnapshots', instantane(userId, coachId, { effectiveFrom: '2026-10-27', kcal: 1650, createdAt: 2001 }));

	const lignes = await calibConvex.historique._handler(ctx, { sessionToken: TOKEN, userId });
	assert.equal(lignes.length, 2);
	assert.equal(lignes[0].kcal, 1800, 'la plus récente en premier');
	assert.equal(lignes[1].kcal, 1650);
	assert.ok(lignes.every((l) => l.origine === 'calibrage'));
	assert.ok(lignes.every((l) => l.detail !== null), 'chaque application garde son instantané');
});

/* ═══════════ 2 · Détail d'un instantané ═══════════ */

test("DÉTAIL : la ligne « Calibrage » déplie l'instantané (poids, MG, pas, travail, adaptation, déficit, sport, résultats)", async () => {
	const { ctx, coachId, userId } = await ctxAvecCoach();
	await ctx.db.insert('clientGoalHistory', { userId, kcal: 1800, effectiveFrom: '2026-10-27', createdBy: coachId, createdAt: 3000 });
	await ctx.db.insert('calibrageSnapshots', instantane(userId, coachId, { effectiveFrom: '2026-10-27', kcal: 1800, createdAt: 3001, maintenanceKcal: 2050 }));

	const [ligne] = await calibConvex.historique._handler(ctx, { sessionToken: TOKEN, userId });
	const d = ligne.detail;
	assert.ok(d, 'détail présent');
	assert.equal(d.poidsKg, 60, 'poids');
	assert.equal(d.mgPct, 26, 'masse grasse');
	assert.equal(d.pasMoyen, 10_000, 'pas');
	assert.equal(d.heuresTravail, 2, 'travail');
	assert.equal(d.ajustementTravail, 0.02, 'ajustement du travail');
	assert.equal(d.adaptationPct, 10, 'adaptation');
	assert.equal(d.deficitPct, 12, 'déficit');
	assert.equal(d.sportSemaineKcal, 800, 'sport de la semaine');
	/* Principaux résultats — recopiés tels quels de l'instantané (jamais recalculés). */
	assert.equal(d.coefficient, 1.42);
	assert.equal(d.metabolismeBaseKcal, 1242);
	assert.equal(d.maintenanceKcal, 1739);
	assert.equal(d.maintenanceFiletKcal, 2050);
	assert.equal(d.objectifJournalierKcal, 1800);
	assert.equal(d.budgetSemaineKcal, 12_400);
	assert.equal(d.deficitSemaineKcal, -1500);
	assert.equal(d.perteGraisseKg, 0.19);

	/* L'UI déplie le détail au clic d'une ligne « Calibrage » uniquement. */
	assert.ok(adminPage.includes("aria-expanded={histoDetail === ligne.id}"), 'ligne Calibrage dépliable');
	assert.ok(
		adminPage.includes("onclick={() => (histoDetail = histoDetail === ligne.id ? null : ligne.id)}"),
		'un clic replie / déplie le détail'
	);
	assert.ok(adminPage.includes('{#if histoDetail === ligne.id && ligne.detail}'), 'détail affiché pour la ligne ouverte');
	assert.ok(adminPage.includes('{@const d = ligne.detail}'), 'détail = instantané figé');
	for (const champ of ['d.poidsKg', 'd.mgPct', 'd.pasMoyen', 'd.heuresTravail', 'd.adaptationPct', 'd.deficitPct', 'd.sportSemaineKcal']) {
		assert.ok(adminPage.includes(champ), `détail affiché : ${champ}`);
	}
});

/* ═══════════ 3 · État vide ═══════════ */

test('ÉTAT VIDE : aucune ligne → « Aucun calibrage appliqué pour l’instant. »', async () => {
	const { ctx, userId } = await ctxAvecCoach();
	const lignes = await calibConvex.historique._handler(ctx, { sessionToken: TOKEN, userId });
	assert.deepEqual(lignes, [], 'aucun changement');
	assert.ok(adminPage.includes("Aucun calibrage appliqué pour l'instant."), 'message d’état vide affiché');
	assert.ok(adminPage.includes('{:else if calHisto.length === 0}'), 'état vide = liste vide');
});

/* ═══════════ 4 · Limite de 5 lignes et « Voir tout » ═══════════ */

test('LIMITE : 5 lignes par défaut, « Voir tout » déplie le reste', async () => {
	const { ctx, coachId, userId } = await ctxAvecCoach();
	for (let i = 0; i < 7; i++) {
		const day = String(27 - i).padStart(2, '0');
		await ctx.db.insert('clientGoalHistory', {
			userId,
			kcal: 1500 + i * 10,
			effectiveFrom: `2026-10-${day}`,
			createdBy: coachId,
			createdAt: 1000 + i
		});
	}
	const lignes = await calibConvex.historique._handler(ctx, { sessionToken: TOKEN, userId });
	assert.equal(lignes.length, 7, 'la requête renvoie tout l’historique');
	assert.deepEqual(
		lignes.map((l) => l.effectiveFrom),
		['2026-10-27', '2026-10-26', '2026-10-25', '2026-10-24', '2026-10-23', '2026-10-22', '2026-10-21'],
		'du plus récent au plus ancien'
	);
	assert.deepEqual(
		lignes.map((l) => l.kcal),
		[1500, 1510, 1520, 1530, 1540, 1550, 1560],
		'chaque objectif reste à sa date d’effet'
	);

	/* L'UI rogne à la limite tant que « Voir tout » n'est pas demandé. */
	assert.ok(adminPage.includes('const CAL_HISTO_LIGNES = 5;'), 'limite : 5 lignes');
	assert.ok(
		adminPage.includes('calHisto.slice(0, histoTout ? calHisto.length : CAL_HISTO_LIGNES)'),
		'les 5 dernières lignes par défaut, tout le reste sur « Voir tout »'
	);
	assert.ok(adminPage.includes("{histoTout ? 'Réduire' : `Voir tout (${calHisto.length})`}"), 'bouton « Voir tout »');
	assert.ok(
		adminPage.includes('onclick={() => (histoTout = !histoTout)}'),
		'le bouton bascule l’affichage complet'
	);
	assert.ok(adminPage.includes('{#if calHisto.length > CAL_HISTO_LIGNES}'), 'bouton visible seulement au-delà de 5');
});

/* ═══════════ 5 · Refus d'accès ═══════════ */

test('ACCÈS : une cliente est refusée — aucune donnée renvoyée', async () => {
	const { ctx, userId } = await ctxAvecCoach();
	const clientId = await ctx.db.insert('users', { role: 'client', disabled: false, name: 'Cliente' });
	await ctx.db.insert('sessions', { tokenHash: await hashToken('session-cliente'), userId: clientId, expiresAt: Date.now() + 3_600_000 });
	await assert.rejects(
		() => calibConvex.historique._handler(ctx, { sessionToken: 'session-cliente', userId }),
		(e) => e instanceof ConvexError && /coach/i.test(e.message)
	);
});

test('ACCÈS : un AUTRE coach est refusé — historique de la coach de la cliente seulement', async () => {
	const { ctx, userId } = await ctxAvecCoach();
	const autreCoach = await ctx.db.insert('users', { role: 'coach', disabled: false, name: 'Coach B' });
	await ctx.db.insert('sessions', {
		tokenHash: await hashToken('session-coach-b'),
		userId: autreCoach,
		expiresAt: Date.now() + 3_600_000
	});
	await assert.rejects(
		() => calibConvex.historique._handler(ctx, { sessionToken: 'session-coach-b', userId }),
		(e) => e instanceof ConvexError && /coach de cette cliente|réservé/i.test(e.message)
	);
	/* La coach de la cliente, elle, a bien accès. */
	const lignes = await calibConvex.historique._handler(ctx, { sessionToken: TOKEN, userId });
	assert.deepEqual(lignes, [], 'la coach de la cliente lit l’historique');
});

test('ACCÈS : autorisation vérifiée côté serveur (query + route API requireRole)', () => {
	assert.ok(calibrageConvex.includes('target.createdBy !== coach._id'), 'contrôle du rattachement coach → cliente');
	assert.ok(calibrageConvex.includes('Accès réservé au coach de cette cliente.'), 'refus explicite');
	assert.ok(histoRoute.includes("await requireRole(event, 'coach')"), 'route API réservée à la coach');
	assert.ok(histoRoute.includes('api.calibrage.historique'), 'la route réutilise la query serveur');
	assert.ok(histoRoute.includes('sessionToken: token'), 'la session est vérifiée côté Convex');
});

/* ═══════════ 6 · Zones réservées : la page ne saute plus ═══════════ */

test('STABILITÉ : zone d’avertissements permanente (avec ou sans avertissement)', () => {
	/* La zone est TOUJOURS rendue : l'ancienne condition englobante a disparu. */
	assert.ok(
		!adminPage.includes('calR.avertissementDeficit || calR.alertePlafonds'),
		'plus de condition qui insère/retire la zone'
	);
	assert.ok(adminPage.includes('<div class="mt-3 min-h-[124px] space-y-2">'), 'zone d’avertissements à hauteur minimale');
	/* Les messages restent conditionnels À L'INTÉRIEUR de la zone. */
	const zone = adminPage.slice(adminPage.indexOf('min-h-[124px]'), adminPage.indexOf('min-h-[124px]') + 1200);
	assert.ok(zone.includes('{#if calR && calR.avertissementDeficit}'), 'avertissement déficit conditionnel dans la zone');
	assert.ok(zone.includes('{#if calR && calR.alertePlafonds}'), 'alerte plafonds conditionnelle dans la zone');
	assert.ok(zone.includes('{#if calR && calR.avertissementDisponibilite}'), 'vigilance disponibilité conditionnelle dans la zone');
});

test('STABILITÉ : sous-lignes et avertissement d’adaptation à espace réservé', () => {
	/* Sous-ligne « −X kcal/jour » : hauteur minimale permanente, contenu conditionnel. */
	assert.ok(adminPage.includes('min-h-[15px]'), 'sous-ligne d’adaptation réservée');
	assert.ok(
		adminPage.includes('<span class="mt-1 block min-h-[15px] text-[11px] font-semibold text-warn">{#if calR && calR.adaptationEffetKcal > 0}'),
		'effet d’adaptation affiché dans la sous-ligne réservée'
	);
	/* Avertissement d’adaptation : boîte réservée, message conditionnel dedans. */
	assert.ok(adminPage.includes('<div class="mt-1.5 min-h-[34px]">'), 'avertissement d’adaptation réservé');
	assert.ok(
		adminPage.includes('<div class="mt-1 min-h-[16px]">{#if calR.macros.alerteGlucides}'),
		'sous-ligne « alerte glucides » réservée'
	);
});

test('STABILITÉ : bandeau « Les résultats ont changé » à espace réservé', () => {
	assert.ok(adminPage.includes('<div class="mt-3 min-h-[42px]">'), 'bandeau réservé (hauteur minimale)');
	const bandeau = adminPage.slice(adminPage.indexOf('min-h-[42px]'), adminPage.indexOf('min-h-[42px]') + 800);
	assert.ok(bandeau.includes('{#if applyResultatsChanges}'), 'le bandeau s’affiche DANS la zone réservée');
	assert.ok(bandeau.includes('Les résultats ont changé'), 'libellé du bandeau inchangé');
	assert.ok(bandeau.includes('Reprendre les valeurs calculées'), 'bouton de reprise inchangé');
	/* Les zones réservées sont bien dans la vue de saisie : chaque conteneur est
	   rendu en permanence (aucun {#if} englobant immédiat). */
	/* Comptes EXACTS (mission C2b-2c : les 6 champs de saisie portent chacun
	   une ligne de message réservée `min-h-[15px]`, en plus de la sous-ligne
	   d'effet d'adaptation — 7 occurrences attendues, toutes rendues en
	   permanence et strictement dans la vue de saisie). */
	const zonesAttendues = {
		'min-h-[124px]': 1,
		'min-h-[15px]': 7,
		'min-h-[34px]': 1,
		'min-h-[16px]': 1,
		'min-h-[42px]': 1
	};
	for (const [zone, attendu] of Object.entries(zonesAttendues)) {
		const trouve = (adminPage.match(new RegExp(zone.replace(/[[\]]/g, '\\$&'), 'g')) ?? []).length;
		assert.equal(trouve, attendu, `zone ${zone} : ${attendu} occurrence(s) attendue(s)`);
	}
});

test('STABILITÉ : mode présentation inchangé (ni saisies, ni zones réservées, ni historique)', () => {
	const pres = adminPage.slice(
		adminPage.indexOf('MODE PRÉSENTATION'),
		adminPage.indexOf('Renseigne le poids et la masse grasse pour afficher le calibrage.')
	);
	assert.ok(pres.includes('Quitter le mode présentation'), 'mode présentation toujours présent');
	assert.ok(!pres.includes('bind:value'), 'aucune saisie en mode présentation');
	assert.ok(!pres.includes('min-h-['), 'aucune zone réservée ajoutée en présentation');
	assert.ok(!pres.includes('Historique'), 'historique absent de la présentation (vue épurée)');
});
