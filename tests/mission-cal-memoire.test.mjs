/**
 * MISSION CAL-MÉMOIRE — MÉMOIRE DU CALIBRAGE.
 *
 * Vérifié :
 *  1. SCHÉMA : table additive `calibrageDrafts`, un seul brouillon par cliente
 *     (upsert), aucune migration ni champ existant touché ;
 *  2. SAUVEGARDE : modification → rechargement → valeurs retrouvées, et AUCUNE
 *     écriture `clientGoals` / `clientGoalHistory` / `calibrageSnapshots` avant
 *     « Appliquer à la fiche » ;
 *  3. MESURES : poids 7 j, pas 14 j et MG toujours rafraîchis, chacun avec son
 *     repère « précédent : X » (fenêtre précédente, jamais un zéro inventé) ;
 *  4. REPLI : sans brouillon, les décisions du dernier instantané sont reprises
 *     (sinon valeurs par défaut) — ordre brouillon → instantané → défauts ;
 *  5. ACCÈS : un autre coach est refusé (assertCoachOwnsClient), aucune écriture ;
 *  6. REMISE À ZÉRO : « Repartir des valeurs par défaut » efface le brouillon
 *     (ConfirmDialog) sans toucher aux objectifs de la fiche.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const calibConvex = await import(new URL('../src/convex/calibrage.ts', import.meta.url).href);
const helpers = await import(new URL('../src/convex/helpers.ts', import.meta.url).href);
const ficheLib = await import(new URL('../src/lib/calibrageFiche.ts', import.meta.url).href);
const { addDaysISO, hashToken, localTodayISO } = helpers;

const adminPage = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');
const schema = readFileSync(join(root, 'src/convex/schema.ts'), 'utf8');
const draftRoute = readFileSync(
	join(root, 'src/routes/api/coach/calibrage/brouillon/+server.ts'),
	'utf8'
);

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
			rowsOf(table).push({
				...structuredClone(doc),
				_id: id,
				_creationTime: doc._creationTime ?? Date.now() + seq
			});
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

const TOKEN = 'session-cal-memoire';

async function ctxAvecCoach({ autreCoach = false } = {}) {
	const ctx = makeCtx();
	const coachId = await ctx.db.insert('users', { role: 'coach', disabled: false, prenom: 'Hugo' });
	const autreId = autreCoach
		? await ctx.db.insert('users', { role: 'coach', disabled: false, prenom: 'Autre' })
		: coachId;
	const userId = await ctx.db.insert('users', {
		role: 'client',
		disabled: false,
		prenom: 'Cliente',
		heightCm: 170,
		createdBy: autreCoach ? autreId : coachId
	});
	await ctx.db.insert('sessions', {
		tokenHash: await hashToken(TOKEN),
		userId: coachId,
		expiresAt: Date.now() + 3_600_000
	});
	return { ctx, coachId, userId };
}

const ENTREES = {
	poidsKg: 60,
	mgPct: 26,
	pasMoyen: 10_000,
	heuresTravail: 2,
	ajustementTravail: 0,
	adaptationPct: 0,
	mode: 'deficit',
	deficitPct: 15,
	surplusPct: 5,
	proteinesParKgMasseMaigre: 2.3,
	seances: [{ activiteId: 'musculation', seancesParSemaine: 3, dureeMinutes: 60, choix: 'intensive' }],
	apportsSemaine: [null, null, null, null, null, null, null]
};

/* ── 1 · Schéma ── */

test('SCHÉMA : table additive calibrageDrafts, un brouillon par cliente, aucune migration', () => {
	const start = schema.indexOf('calibrageDrafts: defineTable(');
	assert.ok(start > 0, 'table calibrageDrafts présente');
	const table = schema.slice(start, start + 900);
	assert.ok(table.includes('userId: v.id("users")'), 'brouillon rattaché à la cliente');
	assert.ok(table.includes('inputs: v.record(v.string(), v.any())'), 'décisions de saisie figées');
	assert.ok(table.includes('ecartsSemaine: v.array(v.number())'), 'semaine type mémorisée');
	assert.ok(table.includes('updatedAt: v.number()'), 'horodatage de la mention');
	assert.ok(table.includes('.index("by_user", ["userId"])'), 'index by_user (lecture par cliente)');
	/* Aucun champ ajouté aux tables existantes : rien à migrer. */
	const goals = schema.slice(schema.indexOf('clientGoals: defineTable('), schema.indexOf('clientGoalHistory: defineTable('));
	assert.ok(!goals.includes('brouillon') && !goals.includes('draft'), 'clientGoals inchangé');
	const snapshots = schema.slice(schema.indexOf('calibrageSnapshots: defineTable('), schema.indexOf('calibrageDrafts: defineTable('));
	assert.ok(!snapshots.includes('draft'), 'calibrageSnapshots inchangé');
});

/* ── 2 · Modification → rechargement → valeurs retrouvées ── */

test('SAUVEGARDE : modification → rechargement → décisions retrouvées, sans toucher aux objectifs', async () => {
	const { ctx, userId } = await ctxAvecCoach();
	/* Deux sauvegardes successives (autosave) : une seule ligne conservée. */
	const first = await calibConvex.saveDraft._handler(ctx, {
		sessionToken: TOKEN,
		userId,
		entrees: ENTREES,
		ecartsSemaine: [0, 0, 0, 0, 0, 0, 0]
	});
	assert.equal(first.ok, true);
	const entreesModifiees = { ...ENTREES, deficitPct: 18, heuresTravail: 6, mode: 'surplus', surplusPct: 5 };
	const second = await calibConvex.saveDraft._handler(ctx, {
		sessionToken: TOKEN,
		userId,
		entrees: entreesModifiees,
		ecartsSemaine: [-100, 0, 0, 0, 200, 0, 0]
	});
	assert.ok(second.savedAt >= first.savedAt);

	const drafts = ctx.all('calibrageDrafts');
	assert.equal(drafts.length, 1, 'un seul brouillon par cliente');
	assert.equal(drafts[0].userId, userId);

	/* Aucun objectif / historique / instantané écrit avant « Appliquer à la fiche ». */
	assert.equal(ctx.all('clientGoals').length, 0, 'clientGoals intact');
	assert.equal(ctx.all('clientGoalHistory').length, 0, 'historique intact');
	assert.equal(ctx.all('calibrageSnapshots').length, 0, 'aucun instantané');

	/* REOUVERTURE : la fiche renvoie les décisions telles quelles. */
	const fiche = await calibConvex.fiche._handler(ctx, { sessionToken: TOKEN, userId });
	assert.ok(fiche.brouillon, 'brouillon retrouvé');
	assert.equal(fiche.brouillon.entrees.deficitPct, 18);
	assert.equal(fiche.brouillon.entrees.heuresTravail, 6);
	assert.equal(fiche.brouillon.entrees.mode, 'surplus');
	assert.deepEqual(fiche.brouillon.ecartsSemaine, [-100, 0, 0, 0, 200, 0, 0]);
	assert.equal(fiche.brouillon.updatedAt, second.savedAt);
});

test('SAUVEGARDE : semaine type invalide refusée (7 écarts attendus)', async () => {
	const { ctx, userId } = await ctxAvecCoach();
	await assert.rejects(
		() =>
			calibConvex.saveDraft._handler(ctx, {
				sessionToken: TOKEN,
				userId,
				entrees: ENTREES,
				ecartsSemaine: [0, 0]
			}),
		/7 écarts/
	);
	assert.equal(ctx.all('calibrageDrafts').length, 0, 'aucune écriture');
});

/* ── 3 · Mesures rafraîchies + « précédent » ── */

test('MESURES : poids 7 j, pas 14 j et MG relus avec leur repère « précédent »', async () => {
	const { ctx, userId } = await ctxAvecCoach();
	const today = localTodayISO();
	/* Poids : 70 kg il y a 10 j (fenêtre précédente), 68 et 67 sur les 7 j. */
	await ctx.db.insert('bodyMetrics', { userId, date: addDaysISO(today, -10), weightKg: 70 });
	await ctx.db.insert('bodyMetrics', { userId, date: addDaysISO(today, -3), weightKg: 68 });
	await ctx.db.insert('bodyMetrics', { userId, date: addDaysISO(today, -1), weightKg: 67 });
	/* Masse grasse : deux points US Navy (tour de taille qui baisse). */
	await ctx.db.insert('bodyMetrics', { userId, date: addDaysISO(today, -20), waistCm: 82, hipCm: 95, neckCm: 35 });
	await ctx.db.insert('bodyMetrics', { userId, date: addDaysISO(today, -2), waistCm: 78, hipCm: 95, neckCm: 35 });
	/* Pas : 8 000 il y a 20 j (fenêtre précédente), 10 000 et 12 000 récents. */
	await ctx.db.insert('dailySteps', { userId, date: addDaysISO(today, -20), count: 8000, createdAt: 1 });
	await ctx.db.insert('dailySteps', { userId, date: addDaysISO(today, -3), count: 10_000, createdAt: 2 });
	await ctx.db.insert('dailySteps', { userId, date: addDaysISO(today, -1), count: 12_000, createdAt: 3 });

	const fiche = await calibConvex.fiche._handler(ctx, { sessionToken: TOKEN, userId });
	assert.equal(fiche.poids.valeur, 67.5, 'moyenne des pesées sur 7 jours');
	assert.equal(fiche.poids.precedent, 70, 'précédent = dernière pesée d’avant la fenêtre 7 j');
	assert.equal(fiche.pasMoyen.valeur, 11_000, 'moyenne des pas sur 14 jours');
	assert.equal(fiche.pasMoyen.precedent, 8000, 'précédent = moyenne des 14 jours d’avant');
	assert.ok(fiche.masseGrasse.valeur > 0, 'MG rafraîchie (US Navy)');
	assert.ok(fiche.masseGrasse.precedent !== null, 'MG précédente présente');
	assert.ok(
		fiche.masseGrasse.precedent > fiche.masseGrasse.valeur,
		'MG précédente = avant-dernière estimation (taille plus large)'
	);
	/* Aucun brouillon encore : les décisions par défaut s’appliquent. */
	assert.equal(fiche.brouillon, null);
	assert.equal(fiche.dernierInstantane, null);
});

/* ── 4 · Repli sur le dernier instantané ── */

test('REPLI : sans brouillon, le dernier instantané fournit les décisions (mesures à part)', async () => {
	const { ctx, coachId, userId } = await ctxAvecCoach();
	await ctx.db.insert('calibrageSnapshots', {
		userId,
		inputs: { ...ENTREES, deficitPct: 20, heuresTravail: 6, apportsSemaine: [1500, 1500, 1500, 1500, 1700, null, null] },
		results: { objectifJournalierKcal: 1500, applique: { kcal: 1500 } },
		formulaVersion: 'test',
		effectiveFrom: addDaysISO(localTodayISO(), -3),
		date: addDaysISO(localTodayISO(), -3),
		createdBy: coachId,
		createdAt: Date.now() - 1000
	});
	const fiche = await calibConvex.fiche._handler(ctx, { sessionToken: TOKEN, userId });
	assert.equal(fiche.brouillon, null, 'aucun brouillon');
	assert.ok(fiche.dernierInstantane, 'dernier instantané exposé');
	assert.equal(fiche.dernierInstantane.entrees.deficitPct, 20);
	assert.equal(fiche.dernierInstantane.objectifJournalierKcal, 1500);
	/* Ordre de restauration lisible dans la page : brouillon → instantané → défauts. */
	const load = adminPage.slice(adminPage.indexOf('async function loadCalibrage'), adminPage.indexOf('$effect(() => {', adminPage.indexOf('async function loadCalibrage')));
	assert.ok(load.includes('if (pre.brouillon)'), '1) brouillon');
	assert.ok(load.indexOf('if (pre.brouillon)') < load.indexOf('else if (pre.dernierInstantane)'), '2) instantané');
	assert.ok(load.indexOf('else if (pre.dernierInstantane)') < load.lastIndexOf('calibrageDefauts()'), '3) défauts');
	assert.ok(load.includes('calBrouillonSource = \'brouillon\''), 'source mémorisée : brouillon');
	assert.ok(load.includes('calBrouillonSource = \'instantane\''), 'source mémorisée : instantané');
	assert.ok(load.includes('calBrouillonSource = \'defauts\''), 'source mémorisée : défauts');
});

test('REPLI : les écarts de la semaine type sont reconstruits depuis l’instantané', () => {
	const fn = adminPage.slice(
		adminPage.indexOf('function ecartsDepuisInstantane'),
		adminPage.indexOf('function ecartsNormalises')
	);
	assert.ok(fn.includes('objectifJournalierKcal'), 'objectif de l’instantané');
	assert.ok(fn.includes('apports'), 'apports figés');
	assert.ok(fn.includes('Math.round(a - objectif)'), 'écart = apport − objectif');
});

/* ── 5 · Accès coach propriétaire ── */

test('ACCÈS : un autre coach est refusé par saveDraft, clearDraft et fiche — aucune écriture', async () => {
	const { ctx, userId } = await ctxAvecCoach({ autreCoach: true });
	for (const fn of ['saveDraft', 'clearDraft', 'fiche']) {
		await assert.rejects(
			() =>
				calibConvex[fn]._handler(ctx, {
					sessionToken: TOKEN,
					userId,
					...(fn === 'saveDraft' ? { entrees: ENTREES, ecartsSemaine: [0, 0, 0, 0, 0, 0, 0] } : {})
				}),
			(e) => e instanceof Error && /coach de cette cliente/.test(e.message),
			`${fn} refuse un coach non propriétaire`
		);
	}
	assert.equal(ctx.all('calibrageDrafts').length, 0, 'aucun brouillon écrit');
});

/* ── 6 · Remise à zéro + réalignement après application ── */

test('REMISE À ZÉRO : clearDraft efface le brouillon, la fiche repart des défauts', async () => {
	const { ctx, userId } = await ctxAvecCoach();
	await calibConvex.saveDraft._handler(ctx, {
		sessionToken: TOKEN,
		userId,
		entrees: ENTREES,
		ecartsSemaine: [0, 0, 0, 0, 0, 0, 0]
	});
	assert.equal(ctx.all('calibrageDrafts').length, 1);
	const cleared = await calibConvex.clearDraft._handler(ctx, { sessionToken: TOKEN, userId });
	assert.equal(cleared.cleared, 1);
	assert.equal(ctx.all('calibrageDrafts').length, 0, 'brouillon effacé');
	const fiche = await calibConvex.fiche._handler(ctx, { sessionToken: TOKEN, userId });
	assert.equal(fiche.brouillon, null);
	/* Toujours aucune écriture d’objectifs. */
	assert.equal(ctx.all('clientGoals').length, 0);
});

test('APPLIQUER : le brouillon est réaligné sur ce qui vient d’être appliqué', async () => {
	const { ctx, userId } = await ctxAvecCoach();
	await calibConvex.saveDraft._handler(ctx, {
		sessionToken: TOKEN,
		userId,
		entrees: { ...ENTREES, deficitPct: 25, heuresTravail: 10 },
		ecartsSemaine: [0, 0, 0, 0, 0, 0, 0]
	});
	const res = await calibConvex.apply._handler(ctx, {
		sessionToken: TOKEN,
		userId,
		entrees: { ...ENTREES, apportsSemaine: [1400, 1400, 1400, 1400, 1600, null, null] },
		kcal: 1400,
		carbs: 140,
		protein: 110,
		fat: 45,
		maintenanceKcal: 1850,
		effectiveFrom: localTodayISO()
	});
	assert.equal(res.ok, true);
	assert.ok(Number.isFinite(res.brouillonSavedAt), 'horodatage du brouillon réaligné');
	const drafts = ctx.all('calibrageDrafts');
	assert.equal(drafts.length, 1, 'toujours un seul brouillon');
	assert.equal(drafts[0].inputs.deficitPct, ENTREES.deficitPct, 'anciennes décisions remplacées');
	/* Écarts = apports appliqués − objectif journalier calculé par le module. */
	const objectif = ficheLib.resultatsFiche(drafts[0].inputs).objectifJournalierKcal;
	const apports = drafts[0].inputs.apportsSemaine;
	assert.deepEqual(
		drafts[0].ecartsSemaine,
		apports.map((a) => (typeof a === 'number' ? Math.round(a - objectif) : 0))
	);
});

/* ── 7 · UI : mention, debounce, bouton, aucun calcul modifié ── */

test('UI : sauvegarde automatique 800 ms, mention « Brouillon enregistré · date heure »', () => {
	assert.ok(adminPage.includes('const CAL_BROUILLON_DEBOUNCE_MS = 800;'), 'debounce ≈ 800 ms');
	assert.ok(adminPage.includes("fetch('/api/coach/calibrage/brouillon'"), 'route brouillon appelée');
	assert.ok(adminPage.includes("method: 'PUT'"), 'sauvegarde en PUT');
	assert.ok(adminPage.includes('Brouillon enregistré · '), 'mention horodatée');
	assert.ok(adminPage.includes('Brouillon enregistré · {fmtHorodatage(calBrouillonSavedAt)}'));
	assert.ok(adminPage.includes('function fmtHorodatage'), 'format date + heure');
	assert.ok(
		draftRoute.includes("await requireRole(event, 'coach')"),
		'route réservée au coach'
	);
	assert.ok(draftRoute.includes('api.calibrage.saveDraft'), 'mutation dédiée (aucun objectif écrit)');
	assert.ok(draftRoute.includes('api.calibrage.clearDraft'));
});

test('UI : « Repartir des valeurs par défaut » passe par ConfirmDialog et efface le brouillon', () => {
	const reset = adminPage.slice(
		adminPage.indexOf('async function repartirValeursDefaut'),
		adminPage.indexOf('/* ── Profil sportif habituel')
	);
	assert.ok(reset.includes("method: 'DELETE'"), 'brouillon effacé côté serveur');
	assert.ok(reset.includes('calibrageInputs = calibrageDefauts();'), 'valeurs par défaut rétablies');
	assert.ok(reset.includes('ecartsSemaine = [0, 0, 0, 0, 0, 0, 0];'), 'semaine type remise à zéro');
	assert.ok(adminPage.includes('>Repartir des valeurs par défaut</button>'), 'bouton présent');
	const dialogStart = adminPage.indexOf('open={calResetOpen}');
	const dialog = adminPage.slice(dialogStart, dialogStart + 700);
	assert.ok(dialog.includes('onconfirm={repartirValeursDefaut}'), 'confirmation obligatoire');
	assert.ok(dialog.includes('busy={calResetBusy}'), 'état d’attente');
	assert.ok(dialog.includes('onconfirm={repartirValeursDefaut}'), 'seul onconfirm agit');
});

test('UI : mesures rafraîchies avec « précédent : X » (poids, MG, pas)', () => {
	assert.equal(
		(adminPage.match(/précédent : \{(?:decimalFr\(calibragePre|Math\.round\(calibragePre)/g) ?? []).length,
		3,
		'un repère par mesure (poids, MG, pas)'
	);
	assert.ok(adminPage.includes('précédent : {decimalFr(calibragePre.poids.precedent)} kg'));
	assert.ok(adminPage.includes('précédent : {decimalFr(calibragePre.masseGrasse.precedent)} %'));
	assert.ok(adminPage.includes("précédent : {Math.round(calibragePre.pasMoyen.precedent).toLocaleString('fr-FR')}"));
});

test('UI : aucune décision n’est appliquée automatiquement — « Appliquer à la fiche » inchangé', () => {
	const apply = adminPage.slice(
		adminPage.indexOf('async function appliquerCalibrage'),
		adminPage.indexOf('/* Onglet Plan de repas')
	);
	assert.ok(apply.includes("fetch('/api/coach/calibrage'"), 'écriture des objectifs par la route existante');
	assert.ok(!apply.includes('/brouillon?userId'), 'le brouillon n’est jamais appliqué directement');
	assert.ok(apply.includes('await invalidateAll();'), 'rechargement de la fiche conservé');
	const draft = adminPage.slice(
		adminPage.indexOf('async function enregistrerBrouillon'),
		adminPage.indexOf('async function repartirValeursDefaut')
	);
	assert.ok(!draft.includes('/api/coach/calibrage\''), 'le brouillon n’appelle jamais la route « Appliquer »');
});
