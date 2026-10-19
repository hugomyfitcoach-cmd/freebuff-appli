/**
 * Mission C2a-bis — CORRECTIONS DE L'ONGLET « CALIBRAGE » (retour coach Preview).
 *
 * Vérifié :
 *  1. APPLICATION : la mutation `calibrage.apply` écrit bien clientGoals (bon
 *     objectif, bonne maintenance, macros EN GRAMMES) pour la bonne cliente ;
 *  2. CARTE « Objectifs journaliers » : à jour IMMÉDIATEMENT après application
 *     (invalidateAll + resynchronisation des champs, fiche passée en
 *     « Méthode macros (g) ») et après rechargement (mode mémorisé) ;
 *  3. JOURNAL DATÉ : le nouvel objectif s'applique à partir de la date d'effet,
 *     l'ancien avant (clientGoalHistory + baseline legacy) ;
 *  4. PRÉ-REMPLISSAGE : « Appliquer à la fiche » = résultats affichés EXACTEMENT
 *     (objectif = objectif journalier moyen · maintenance = budget ÷ 7, sport
 *     habituel inclus · macros = macros du jour type), avec badge « modifié » ;
 *  5. AVERTISSEMENTS : les trois cas — déficit > 15 % (message neutre), « dépasse
 *     le rythme conseillé » UNIQUEMENT au-delà des plafonds Alpert/Macdonald,
 *     disponibilité en énergie < 30 (vigilance) et < 24 (alerte) ;
 *  6. CONFIRMATION : « les journées passées gardent leur ancien objectif ».
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cal = await import(new URL('../src/lib/calibrage.ts', import.meta.url).href);
const fiche = await import(new URL('../src/lib/calibrageFiche.ts', import.meta.url).href);
const calibConvex = await import(new URL('../src/convex/calibrage.ts', import.meta.url).href);
const { hashToken } = await import(new URL('../src/convex/helpers.ts', import.meta.url).href);
const { kcalGoalForDate } = await import(new URL('../src/lib/goalHistory.ts', import.meta.url).href);

const adminPage = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');

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
			/* _creationTime explicite possible : sert à dater la baseline legacy. */
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

const TOKEN = 'session-c2a-bis';

/** Fiche cliente test : session coach + cliente. */
async function ctxAvecCoach() {
	const ctx = makeCtx();
	const coachId = await ctx.db.insert('users', { role: 'coach', disabled: false, name: 'Coach' });
	const userId = await ctx.db.insert('users', { role: 'client', disabled: false, name: 'Cliente Test' });
	await ctx.db.insert('sessions', {
		tokenHash: await hashToken(TOKEN),
		userId: coachId,
		expiresAt: Date.now() + 3_600_000
	});
	return { ctx, coachId, userId };
}

/** Entrées du calibrage — profil de référence 60 kg / MG 26 % / C 1,40. */
const ENTREES = {
	poidsKg: 60,
	mgPct: 26,
	pasMoyen: 10_000,
	heuresTravail: 2,
	ajustementTravail: 0,
	adaptationPct: 0,
	deficitPct: 12,
	proteinesParKgMasseMaigre: 2.3,
	seances: [{ activiteId: 'musculation', seancesParSemaine: 3, dureeMinutes: 60, choix: 'intensive' }],
	apportsSemaine: [null, null, null, null, null, null, null]
};

/* ── 1 · Application puis relecture de clientGoals (macros en grammes) ── */

test("APPLY → clientGoals : objectif, maintenance, macros EN GRAMMES pour la bonne cliente", async () => {
	const { ctx, userId } = await ctxAvecCoach();
	const res = await calibConvex.apply._handler(ctx, {
		sessionToken: TOKEN,
		userId,
		entrees: ENTREES,
		kcal: 1381,
		carbs: 150,
		protein: 102,
		fat: 46,
		maintenanceKcal: 1852,
		effectiveFrom: '2026-10-19'
	});
	assert.equal(res.ok, true);

	const goals = ctx.all('clientGoals');
	assert.equal(goals.length, 1);
	assert.equal(goals[0].userId, userId, 'bonne cliente');
	assert.equal(goals[0].kcal, 1381, 'objectif appliqué');
	assert.equal(goals[0].maintenanceKcal, 1852, 'maintenance (filet de sécurité) écrite');
	/* Macros stockées EN GRAMMES — la fiche « Méthode macros (g) » relira ces valeurs. */
	assert.equal(goals[0].carbs, 150);
	assert.equal(goals[0].protein, 102);
	assert.equal(goals[0].fat, 46);
});

/* ── 2 · Carte « Objectifs journaliers » : à jour après application ── */

test("CARTE : appliquerCalibrage recharge la fiche (invalidateAll) et passe en « Méthode macros (g) »", () => {
	const fn = adminPage.slice(
		adminPage.indexOf('async function appliquerCalibrage'),
		adminPage.indexOf('/* Onglet Plan de repas')
	);
	assert.ok(fn.includes("method: 'POST'"), "l'application passe par le POST");
	/* IMMÉDIAT : la carte reflète l'écriture sans rechargement manuel. */
	assert.ok(fn.includes("goalsMode = 'grams';"), 'fiche passée en « Méthode macros (g) »');
	assert.ok(fn.includes("rememberGoalsMode('grams');"), 'le mode survit au rechargement');
	assert.ok(fn.includes('pctKcal = applyKcal;'), 'objectif resynchronisé (mode %)');
	assert.ok(fn.includes('gCarbs = applyCarbs;'), 'glucides resynchronisés (mode g)');
	assert.ok(fn.includes('gProtein = applyProtein;'), 'protéines resynchronisées (mode g)');
	assert.ok(fn.includes('gFat = applyFat;'), 'lipides resynchronisés (mode g)');
	assert.ok(
		fn.includes("maintenanceKcal = String(applyMaintenance ?? '').trim();"),
		'maintenance resynchronisée (filet de sécurité)'
	);
	assert.ok(fn.includes('await invalidateAll();'), 'les données de la fiche (clientGoals) sont rechargées');
	assert.ok(
		fn.indexOf('await invalidateAll();') > fn.indexOf("method: 'POST'"),
		'le rechargement a lieu APRÈS l’écriture'
	);
});

test('CARTE : après rechargement, objectif + maintenance + macros en grammes (mode mémorisé)', () => {
	/* Le mode de saisie est restauré au chargement — la fiche reste en « macros (g) ». */
	assert.ok(adminPage.includes("const GOALS_MODE_KEY = 'coach-goals-mode';"));
	assert.ok(adminPage.includes('localStorage.getItem(GOALS_MODE_KEY)'));
	assert.ok(adminPage.includes("if (saved === 'pct' || saved === 'grams') goalsMode = saved;"));
	assert.ok(adminPage.includes('localStorage.setItem(GOALS_MODE_KEY, m);'));
	/* L'initialisation des champs lit bien clientGoals (via client360) : objectif,
	   macros en grammes et maintenance (filet) à chaque changement de cliente. */
	assert.ok(adminPage.includes('const g = untrack(() => view?.goals);'));
	assert.ok(
		adminPage.includes("maintenanceKcal = 'maintenanceKcal' in g && g.maintenanceKcal ? String(g.maintenanceKcal) : '';"),
		'la maintenance enregistrée est relue à l’initialisation'
	);
});

/* ── 3 · Journal de la cliente : objectif daté (avant / après la date d'effet) ── */

test("JOURNAL : le nouvel objectif s'applique à la date d'effet, l'ancien avant", async () => {
	const { ctx, userId } = await ctxAvecCoach();
	/* Cliente existante : objectif 1 750 en place depuis septembre (fiche du coach). */
	await ctx.db.insert('clientGoals', {
		userId,
		kcal: 1750,
		carbs: 175,
		protein: 110,
		fat: 58,
		_creationTime: Date.parse('2026-09-01T12:00:00Z')
	});
	await calibConvex.apply._handler(ctx, {
		sessionToken: TOKEN,
		userId,
		entrees: ENTREES,
		kcal: 1381,
		carbs: 150,
		protein: 102,
		fat: 46,
		maintenanceKcal: 1852,
		effectiveFrom: '2026-10-19'
	});

	const rows = ctx
		.all('clientGoalHistory')
		.map((h) => ({ kcal: h.kcal, effectiveFrom: h.effectiveFrom }))
		.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
	assert.ok(rows.some((r) => r.kcal === 1381 && r.effectiveFrom === '2026-10-19'), 'nouvel objectif daté de la date d’effet');
	assert.ok(rows.some((r) => r.kcal === 1750 && r.effectiveFrom < '2026-10-19'), 'ancien objectif historisé (baseline)');

	/* Résolution identique à celle du Journal (lib/goalHistory) : ancien AVANT, nouveau À PARTIR de la date d'effet. */
	assert.equal(kcalGoalForDate(rows, '2026-10-18', 1381), 1750, 'la veille garde l’ancien objectif');
	assert.equal(kcalGoalForDate(rows, '2026-10-19', 1381), 1381, 'la date d’effet applique le nouvel objectif');
	assert.equal(kcalGoalForDate(rows, '2026-10-25', 1381), 1381, 'et les journées suivantes');
});

/* ── 4 · Pré-remplissage = résultats affichés (badge « modifié ») ── */

test('PRÉ-REMPLISSAGE : objectif = objectif journalier moyen · maintenance = budget ÷ 7 · macros = jour type', () => {
	const r = fiche.resultatsFiche(ENTREES);
	/* Le filet de sécurité = budget de la semaine ÷ 7, SPORT HABITUEL INCLUS. */
	assert.equal(r.maintenanceFiletKcal, Math.round(r.budgetSemaineKcal / 7));
	assert.ok(
		r.maintenanceFiletKcal > r.maintenanceKcal,
		'le filet inclut le sport habituel (≠ maintenance sans exercice)'
	);
	/* Le CRM pré-remplit EXACTEMENT ces résultats — aucun calcul en double. */
	assert.ok(adminPage.includes('applyKcal = r.objectifJournalierKcal;'), 'objectif = objectif journalier moyen');
	assert.ok(
		adminPage.includes('applyMaintenance = String(Math.round(r.maintenanceFiletKcal));'),
		'maintenance = budget ÷ 7 (sport inclus)'
	);
	assert.ok(adminPage.includes('applyCarbs = r.macros.glucidesG;'), 'glucides = macros du jour type');
	assert.ok(adminPage.includes('applyProtein = r.macros.proteinesG;'), 'protéines = macros du jour type');
	assert.ok(adminPage.includes('applyFat = r.macros.lipidesG;'), 'lipides = macros du jour type');
});

test('PRÉ-REMPLISSAGE : un champ ajusté par la coach affiche « modifié » et n’est jamais ré-écrasé', () => {
	/* Badge « modifié » sur les cinq champs (objectif, maintenance, macros). */
	const badges = adminPage.match(/normal-case text-warn\">modifié<\/span>/g) ?? [];
	assert.equal(badges.length, 5, 'cinq badges « modifié », un par champ ajustable');
	assert.ok(adminPage.includes('{#if applyKcal !== refKcal}'), 'objectif : badge dès qu’il s’écarte du résultat');
	assert.ok(adminPage.includes("{#if applyMaintenance !== refMaintenance}"), 'maintenance : idem');
	assert.ok(adminPage.includes('{#if applyCarbs !== refCarbs}'), 'glucides : idem');
	assert.ok(adminPage.includes('{#if applyProtein !== refProtein}'), 'protéines : idem');
	assert.ok(adminPage.includes('{#if applyFat !== refFat}'), 'lipides : idem');
	/* Les champs NON modifiés suivent les résultats affichés ; les autres restent. */
	assert.ok(adminPage.includes('if (!applyInitialise || applyKcal === refKcal)'));
	assert.ok(adminPage.includes('if (!applyInitialise || applyMaintenance === refMaintenance)'));
});

/* ── 5 · Les trois cas d'avertissement ── */

test('AVERTISSEMENT 1 : déficit > 15 % → message neutre, sans jugement de rythme', () => {
	const dur = fiche.resultatsFiche({ ...ENTREES, deficitPct: 20 });
	assert.equal(dur.avertissementDeficit, 'Déficit supérieur à la règle de 10 à 15 % : décision du coach.');
	/* « dépasse le rythme conseillé » n'apparaît JAMAIS pour un simple déficit. */
	assert.ok(!dur.avertissementDeficit.includes('rythme conseillé'));
	assert.equal(dur.alertePlafonds, null, 'perte sous les plafonds : aucun message de rythme');
	assert.ok(!adminPage.includes('dépasse le rythme conseillé'), 'le CRM ne recopie jamais ce message');
	const doux = fiche.resultatsFiche({ ...ENTREES, deficitPct: 15 });
	assert.equal(doux.avertissementDeficit, null, '15 % reste dans la règle de 10 à 15 %');
});

test('AVERTISSEMENT 2 : « dépasse le rythme conseillé » seulement au-delà des plafonds Alpert / Macdonald', () => {
	/* Sous les plafonds : aucun message de rythme (ni déficit, ni plafonds). */
	const ok = fiche.resultatsFiche({ ...ENTREES, deficitPct: 20 });
	assert.equal(ok.alertePlafonds, null);
	assert.ok(!(ok.avertissementDeficit ?? '').includes('rythme conseillé'));

	/* Au-delà du seul plafond Alpert (MG 10 % : Alpert < perte ≤ Macdonald). */
	const alpert = fiche.resultatsFiche({ ...ENTREES, mgPct: 10, deficitPct: 20, seances: [] });
	assert.ok(alpert.perteGraisseKg > alpert.vitesseMaxAlpertKgSemaine, 'scénario au-dessus d’Alpert');
	assert.ok(alpert.perteGraisseKg <= alpert.vitesseMaxMacdonaldKgSemaine, 'sous le plafond Macdonald');
	assert.ok(alpert.alertePlafonds?.includes('dépasse le rythme conseillé'), 'message de rythme affiché');
	assert.ok(alpert.alertePlafonds?.includes('Alpert') && alpert.alertePlafonds?.includes('Macdonald'));

	/* Au-delà des deux plafonds (MG 5 %). */
	const rapide = fiche.resultatsFiche({ ...ENTREES, mgPct: 5, deficitPct: 20, seances: [] });
	assert.ok(
		rapide.perteGraisseKg > rapide.vitesseMaxAlpertKgSemaine &&
			rapide.perteGraisseKg > rapide.vitesseMaxMacdonaldKgSemaine,
		'le scénario dépasse bien les deux plafonds'
	);
	assert.ok(rapide.alertePlafonds?.includes('dépasse le rythme conseillé'));
	assert.ok(rapide.alertePlafonds?.includes('Alpert') && rapide.alertePlafonds?.includes('Macdonald'));
});

test('AVERTISSEMENT 3 : disponibilité en énergie < 30 → vigilance · < 24 → alerte', () => {
	/* Profil sain : aucun avertissement de disponibilité. */
	const sain = fiche.resultatsFiche(ENTREES);
	assert.ok(sain.disponibiliteKcal >= 30, 'le profil de référence reste ≥ 30 kcal/kg');
	assert.equal(sain.avertissementDisponibilite, null);

	/* Sous 30 : vigilance. */
	const vigilance = fiche.resultatsFiche({ ...ENTREES, adaptationPct: 20, deficitPct: 12 });
	assert.ok(
		vigilance.disponibiliteKcal < 30 && vigilance.disponibiliteKcal >= 24,
		`scénario de vigilance attendu dans [24, 30) (reçu ${vigilance.disponibiliteKcal})`
	);
	assert.equal(vigilance.avertissementDisponibilite?.niveau, 'vigilance');
	assert.ok(vigilance.avertissementDisponibilite?.message.includes('30'));
	assert.ok(vigilance.avertissementDisponibilite?.message.includes('vigilance'));

	/* Sous 24 : alerte. */
	const alerte = fiche.resultatsFiche({ ...ENTREES, pasMoyen: 0, adaptationPct: 20, deficitPct: 12 });
	assert.ok(alerte.disponibiliteKcal < 24, `scénario d'alerte attendu < 24 (reçu ${alerte.disponibiliteKcal})`);
	assert.equal(alerte.avertissementDisponibilite?.niveau, 'alerte');
	assert.ok(alerte.avertissementDisponibilite?.message.includes('24'));
	assert.ok(alerte.avertissementDisponibilite?.message.includes('alerte'));

	/* Affiché dans le bloc d'avertissements du CRM. */
	assert.ok(adminPage.includes('calR.avertissementDisponibilite'), 'le CRM affiche la vigilance / alerte');
	assert.ok(
		adminPage.includes("calR.avertissementDisponibilite.niveau === 'alerte'"),
		'l’alerte est visuellement distincte (danger) de la vigilance'
	);
});

/* ── 6 · Fenêtre de confirmation ── */

test('CONFIRMATION : « les journées passées gardent leur ancien objectif »', () => {
	assert.ok(
		adminPage.includes('les journées passées gardent leur ancien objectif.'),
		'nouveau texte de la fenêtre de confirmation'
	);
	assert.ok(!adminPage.includes("gardent leur objectif d'alors"), "l'ancien texte a disparu");
});
