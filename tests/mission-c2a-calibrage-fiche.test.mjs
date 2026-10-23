/**
 * Mission C2a — ONGLET « CALIBRAGE » DE LA FICHE CLIENTE (CRM coach).
 *
 * Vérifié :
 *  1. MODULE : `supplementTravail` (0 h → 0,05 · 2 h → 0,15 · 6 h → 0,35 ·
 *     10 h → 0,55 · 12 h → 0,6) et `coefficientTotal` = coefficient des pas +
 *     supplément travail ;
 *  2. AFFICHAGE : les valeurs de l'onglet (vue modèle `calibrageFiche`) sont
 *     IDENTIQUES à celles du module pur pour le profil de référence — zéro
 *     calcul en double ;
 *  3. APPLICATION : la mutation Convex `calibrage.apply` écrit l'objectif
 *     (clientGoals) ET l'historique (clientGoalHistory) à la date d'effet
 *     choisie, plus un instantané (calibrageSnapshots) ;
 *  4. ANNULATION : l'annulation du ConfirmDialog n'écrit rien — seule la
 *     confirmation envoie le POST ;
 *  5. ACCÈS : une cliente est refusée (Convex + route API requireRole coach).
 *
 * Repère : le profil (60 kg · MG 26 % · coefficient 1,40) affiche EXACTEMENT
 * le module — maintenance = `cal.maintenanceKcal` = 1 739 kcal. Le repère
 * historique du module (56,6 kg · MG 26 % · C 1,40) donne lui 1 641 kcal,
 * valeur documentée dans `calibrage.ts` (repère doré Mission C1) : les deux
 * sont vérifiés ci-dessous.
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
const cal = await import(new URL('../src/lib/calibrage.ts', import.meta.url).href);
const fiche = await import(new URL('../src/lib/calibrageFiche.ts', import.meta.url).href);
const calibConvex = await import(new URL('../src/convex/calibrage.ts', import.meta.url).href);
const { hashToken } = await import(new URL('../src/convex/helpers.ts', import.meta.url).href);
const { kcalGoalForDate } = await import(new URL('../src/lib/goalHistory.ts', import.meta.url).href);

const adminPage = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');
const apiRoute = readFileSync(join(root, 'src/routes/api/coach/calibrage/+server.ts'), 'utf8');
const schema = readFileSync(join(root, 'src/convex/schema.ts'), 'utf8');

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

const TOKEN = 'session-c2a';

/** Fiche cliente test : session coach + cliente + pesées/pas/intake de préremplissage. */
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

async function ctxAvecCliente() {
	const ctx = makeCtx();
	const userId = await ctx.db.insert('users', { role: 'client', disabled: false, name: 'Cliente Test' });
	await ctx.db.insert('sessions', {
		tokenHash: await hashToken(TOKEN),
		userId,
		expiresAt: Date.now() + 3_600_000
	});
	return { ctx, userId };
}

/** Entrées valides du calibrage (profil de référence 60 kg / MG 26 %). */
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

/* ── 1 · Module : supplément travail + coefficient total ── */

test('Supplément travail : 0 h → 0,05 · 2 h → 0,15 · 6 h → 0,35 · 10 h → 0,55 · 12 h → 0,6', () => {
	assert.equal(cal.supplementTravail({ heures: 0 }), 0.05);
	assert.equal(cal.supplementTravail({ heures: 2 }), 0.15);
	assert.equal(cal.supplementTravail({ heures: 6 }), 0.35);
	assert.equal(cal.supplementTravail({ heures: 10 }), 0.55);
	assert.equal(cal.supplementTravail({ heures: 12 }), 0.6, '12 h calculerait 0,65 : plafond 0,6');
});

test('Supplément travail : ajustement du coach 0 à +0,05, appliqué APRÈS le plafond', () => {
	assert.equal(cal.supplementTravail({ heures: 12, ajustementCoach: 0.05 }), 0.65, 'plafond 0,6 + 0,05');
	assert.equal(cal.supplementTravail({ heures: 0, ajustementCoach: 0.05 }), 0.1);
	assert.equal(cal.supplementTravail({ heures: 6, ajustementCoach: 0.02 }), 0.37);
});

test('Supplément travail : heures hors 0–12 et ajustement hors 0–0,05 refusés', () => {
	assert.throws(() => cal.supplementTravail({ heures: -1 }), cal.CalibrageError);
	assert.throws(() => cal.supplementTravail({ heures: 13 }), cal.CalibrageError);
	assert.throws(() => cal.supplementTravail({ heures: 2, ajustementCoach: -0.01 }), cal.CalibrageError);
	assert.throws(() => cal.supplementTravail({ heures: 2, ajustementCoach: 0.06 }), cal.CalibrageError);
});

test('Coefficient total = coefficient des pas + supplément travail (10 000 pas + 2 h → 1,40)', () => {
	const total = cal.coefficientTotal({ pas: 10_000, heuresTravail: 2 });
	assert.equal(total, 1.4);
	assert.equal(
		total,
		cal.coefficientNeat({ pas: 10_000 }) + cal.supplementTravail({ heures: 2 }),
		'la somme passe par les fonctions du module (aucun recalcul)'
	);
	assert.equal(cal.coefficientTotal({ pas: 16_000, heuresTravail: 6 }), 1.75, '16 000 pas (1,40) + 6 h (0,35)');
});

/* ── 2 · Affichage = module pour le profil de référence ── */

test('MODULE : repère doré 56,6 kg / MG 26 % / C 1,40 → maintenance 1 641 kcal', () => {
	assert.equal(cal.maintenanceKcal({ poidsKg: 56.6, mgPct: 26, coefficient: 1.4 }), 1641);
});

test('FICHE : valeurs affichées = module pour le profil de référence (60 kg, MG 26 %, coefficient 1,40)', () => {
	const r = fiche.resultatsFiche(ENTREES);
	/* 10 000 pas (1,25) + 2 h de travail (0,15) → coefficient total 1,40. */
	assert.equal(r.coefficient, 1.4);
	/* Chaque valeur affichée sort du module — comparaison aux fonctions unitaires. */
	const profil = cal.profilCalibrage({ poidsKg: 60, mgPct: 26, coefficient: 1.4 });
	assert.equal(r.masseMaigreKg, profil.masseMaigreKg);
	assert.equal(r.masseMaigreKg, 44.4);
	assert.equal(r.masseGrasseKg, profil.masseGrasseKg);
	assert.equal(r.metabolismeBaseKcal, Math.round(cal.metabolismeBaseBrut(60, 26)));
	assert.equal(r.maintenanceKcal, profil.maintenanceKcal, 'maintenance = module');
	assert.equal(r.maintenanceKcal, cal.maintenanceKcal({ poidsKg: 60, mgPct: 26, coefficient: 1.4 }));
	/* NB : le module donne 1 739 kcal pour 60 kg / MG 26 % — la valeur 1 641
	   du référentiel correspond au repère doré 56,6 kg / MG 26 % (verrouillé
	   dans le test « MODULE : repère doré » ci-dessus). */
	assert.equal(r.maintenanceKcal, 1739);
});

test("FICHE : sport, budget, objectif, déficit et macros = module (aucun calcul en double)", () => {
	const r = fiche.resultatsFiche(ENTREES);
	/* Sport : 3 × musculation intensive 1 h à 60 kg = 3 × (4,4 × 60 × 1). */
	const depenseSeance = cal.depenseSeanceKcal({ coefficientKcalKgH: 4.4, poidsKg: 60, heures: 1 });
	assert.equal(depenseSeance, 264);
	assert.equal(r.sportSemaineKcal, cal.sportSemaineKcal([depenseSeance, depenseSeance, depenseSeance]));
	assert.equal(r.budgetSemaineKcal, cal.budgetSemaineKcal({ maintenanceSansExercice: r.maintenanceKcal, sportSemaineKcal: r.sportSemaineKcal }));
	const bilan = cal.bilanObjectifSemaine({ budgetSemaineKcal: r.budgetSemaineKcal, deficitPct: 12 });
	assert.equal(r.deficitPct, 12, 'déficit choisi par défaut : 12 %');
	assert.equal(r.objectifSemaineKcal, bilan.objectifSemaineKcal);
	assert.equal(r.deficitSemaineKcal, bilan.deficitSemaineKcal);
	assert.equal(r.perteGraisseKg, bilan.perteGraisseKg);
	assert.equal(r.objectifCibleKcal, Math.round(bilan.objectifSemaineKcal / 7), 'objectif visé = semaine ÷ 7');
	assert.equal(r.objectifJournalierKcal, r.macros.kcalApplique, 'objectif appliqué = somme exacte 4G + 4P + 9L');
	const macros = cal.macrosJour({ kcal: r.objectifCibleKcal, poidsKg: 60, mgPct: 26, proteinesParKgMasseMaigre: 2.3 });
	assert.equal(r.macros.proteinesG, macros.proteinesG);
	assert.equal(r.macros.lipidesG, macros.lipidesG);
	assert.equal(r.macros.glucidesG, macros.glucidesG);
	assert.equal(r.macros.proteinesG, Math.round(2.3 * 44.4), 'protéines 2,3 g/kg de masse maigre');
});

test('FICHE : disponibilité en énergie et plafonds Alpert / Macdonald = module', () => {
	const r = fiche.resultatsFiche(ENTREES);
	const mm = cal.masseMaigreBrute(60, 26);
	const dispo = cal.disponibiliteEnergieKcal({
		apportKcal: r.objectifJournalierKcal,
		exerciceKcal: r.sportSemaineKcal / 7,
		masseMaigreKg: mm
	});
	assert.equal(r.disponibiliteKcal, dispo);
	assert.equal(r.seuilsDisponibiliteKcal.haut, cal.seuilsDisponibiliteKcal(mm).haut);
	assert.equal(r.seuilsDisponibiliteKcal.bas, cal.seuilsDisponibiliteKcal(mm).bas);
	const v = cal.vitesseMaxPerte(60, 26);
	assert.equal(r.vitesseMaxAlpertKgSemaine, v.alpertKgSemaine);
	assert.equal(r.vitesseMaxMacdonaldKgSemaine, v.macdonaldKgSemaine);
	assert.equal(r.niveauDisponibilite, fiche.niveauDisponibilite(dispo));
});

test('FICHE : semaine type = module bilanSemaine (disponibilités colorées jour par jour)', () => {
	const r = fiche.resultatsFiche(ENTREES);
	const mm = cal.masseMaigreBrute(60, 26);
	const semaine = cal.bilanSemaine({
		jours: r.semaine.apportsKcal.map((apportKcal) => ({ apportKcal, exerciceKcal: r.semaine.exerciceKcal })),
		maintenance: r.maintenanceKcal,
		masseMaigreKg: mm
	});
	assert.equal(r.semaine.deficitSemaineKcal, semaine.deficitSemaineKcal);
	assert.equal(r.semaine.graisseKg, semaine.graisseKg);
	assert.deepEqual(r.semaine.disponibilitesKcal, semaine.disponibilitesKcal);
	assert.equal(r.semaine.niveauxDisponibilite.length, 7);
	/* Journée basse : un apport à 800 kcal passe sous le seuil 24 kcal/kg de MM. */
	const basse = fiche.resultatsFiche({
		...ENTREES,
		apportsSemaine: [800, null, null, null, null, null, null]
	});
	assert.equal(basse.semaine.niveauxDisponibilite[0], 'basse', '800 kcal < 24 × MM');
	assert.equal(basse.semaine.niveauxDisponibilite[1], fiche.niveauDisponibilite(basse.semaine.disponibilitesKcal[1]));
});

test('FICHE : avertissement 15 % supprimé (C2c-3), plafonds dépassés conservés', () => {
	const doux = fiche.resultatsFiche({ ...ENTREES, deficitPct: 12 });
	assert.equal('avertissementDeficit' in doux, false, 'avertissement « règle de 10 à 15 % » supprimé');
	assert.equal(doux.alertePlafonds, null);
	const dur = fiche.resultatsFiche({ ...ENTREES, deficitPct: 20 });
	assert.equal('avertissementDeficit' in dur, false, 'aucun avertissement au-delà de 15 % (C2c-3)');
	/* Masse grasse basse → plafonds serrés : la perte estimée dépasse Alpert ET
	   Macdonald → avertissement explicite. */
	const rapide = fiche.resultatsFiche({ ...ENTREES, mgPct: 5, deficitPct: 20, seances: [] });
	assert.ok(
		rapide.perteGraisseKg > rapide.vitesseMaxAlpertKgSemaine &&
			rapide.perteGraisseKg > rapide.vitesseMaxMacdonaldKgSemaine,
		'le scénario dépasse bien les deux plafonds'
	);
	assert.ok(rapide.alertePlafonds, 'avertissement plafonds présent');
	assert.ok(/Alpert/.test(rapide.alertePlafonds) && /Macdonald/.test(rapide.alertePlafonds));
});

/* ── 3 · Application : objectif + historique + instantané ── */

test("APPLY : écrit l'objectif (clientGoals), l'historique (clientGoalHistory) et l'instantané", async () => {
	const { ctx, coachId, userId } = await ctxAvecCoach();
	/* Date d'effet PASSÉE, calculée par rapport à aujourd'hui (hier, fuseau
	   Europe/Paris) : depuis C2c-4 le serveur refuse toute date future. */
	const { localTodayISO, addDaysISO } = await import(new URL('../src/convex/helpers.ts', import.meta.url).href);
	const EFFET = addDaysISO(localTodayISO(), -1);
	const res = await calibConvex.apply._handler(ctx, {
		sessionToken: TOKEN,
		userId,
		entrees: ENTREES,
		kcal: 1630,
		carbs: 183,
		protein: 102,
		fat: 54,
		maintenanceKcal: 1739,
		effectiveFrom: EFFET
	});
	assert.equal(res.ok, true);
	assert.equal(res.effectiveFrom, EFFET);

	const goals = ctx.all('clientGoals');
	assert.equal(goals.length, 1);
	assert.equal(goals[0].kcal, 1630);
	assert.equal(goals[0].carbs, 183);
	assert.equal(goals[0].protein, 102);
	assert.equal(goals[0].fat, 54);
	assert.equal(goals[0].maintenanceKcal, 1739);

	const history = ctx.all('clientGoalHistory');
	assert.equal(history.length, 1);
	assert.equal(history[0].kcal, 1630);
	assert.equal(history[0].effectiveFrom, EFFET, "l'historique porte la DATE D'EFFET choisie");
	assert.equal(history[0].createdBy, coachId);

	const snaps = ctx.all('calibrageSnapshots');
	assert.equal(snaps.length, 1);
	assert.equal(snaps[0].userId, userId);
	assert.equal(snaps[0].formulaVersion, cal.VERSION_FORMULES_CALIBRAGE);
	assert.equal(snaps[0].effectiveFrom, EFFET);
	assert.equal(snaps[0].createdBy, coachId);
	assert.equal(snaps[0].inputs.poidsKg, 60, 'entrées figées dans l’instantané');
	assert.equal(snaps[0].results.maintenanceKcal, 1739, 'résultats = module');
	assert.equal(snaps[0].results.applique.kcal, 1630, "l'objectif appliqué est tracé");
});

test('APPLY : les journées avant la date d’effet gardent l’ancien objectif (chemin existant)', async () => {
	const { ctx, userId } = await ctxAvecCoach();
	/* Date d'effet PASSÉE, calculée par rapport à aujourd'hui (hier, fuseau
	   Europe/Paris) : depuis C2c-4 le serveur refuse toute date future. */
	const { localTodayISO, addDaysISO } = await import(new URL('../src/convex/helpers.ts', import.meta.url).href);
	const EFFET = addDaysISO(localTodayISO(), -1);
	const VEILLE = addDaysISO(EFFET, -1);
	/* Cliente existante : objectif 1 600 déjà en place, aucun historique.
	   La BASELINE legacy s'ancre sur la date de création de clientGoals : on la
	   fige dans le passé (cliente d'avant l'historisation) comme en production. */
	const goalsId = await ctx.db.insert('clientGoals', { userId, kcal: 1600, carbs: 200, protein: 90, fat: 60 });
	await ctx.db.patch(goalsId, { _creationTime: Date.parse('2026-09-01T12:00:00Z') });
	await calibConvex.apply._handler(ctx, {
		sessionToken: TOKEN,
		userId,
		entrees: ENTREES,
		kcal: 1800,
		carbs: 220,
		protein: 110,
		fat: 60,
		effectiveFrom: EFFET
	});
	const history = ctx.all('clientGoalHistory');
	/* Même chemin que setClientGoals : ligne d'effet + BASELINE legacy de l'ancien objectif. */
	const rows = history.map((h) => ({ kcal: h.kcal, effectiveFrom: h.effectiveFrom })).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
	assert.ok(rows.some((r) => r.kcal === 1800 && r.effectiveFrom === EFFET), 'nouvel objectif daté');
	assert.ok(rows.some((r) => r.kcal === 1600 && r.effectiveFrom < EFFET), 'ancien objectif historisé (baseline)');
	assert.equal(kcalGoalForDate(rows, VEILLE, 1800), 1600, 'la veille garde l’ancien objectif');
	assert.equal(kcalGoalForDate(rows, EFFET, 1800), 1800, 'la date d’effet applique le nouveau');
});

/* ── 4 · Annulation sans écriture + accès ── */

test('ANNULATION : le ConfirmDialog n’écrit rien — seul onconfirm envoie le POST', () => {
	/* La confirmation obligatoire est bien branchée : confirm → POST, cancel → fermeture seule. */
	assert.ok(adminPage.includes('<ConfirmDialog'), "l'onglet utilise ConfirmDialog");
	assert.ok(adminPage.includes('onconfirm={appliquerCalibrage}'), 'la confirmation déclenche la seule écriture');
	const cancel = adminPage.slice(adminPage.indexOf('oncancel='), adminPage.indexOf('oncancel=') + 220);
	assert.ok(!cancel.includes('fetch('), 'annulation = fermeture, aucune requête');
	assert.ok(/oncancel=\{\(\) => \{ calConfirmOpen = false; applyError = ''; \}\}/.test(adminPage), "l'annulation ne fait que fermer la fenêtre");
	/* Rien n'est jamais appliqué automatiquement : pas d'effet qui déclenche l'application. */
	const postCount = (adminPage.match(/fetch\('\/api\/coach\/calibrage', \{[\s\S]{0,40}method: 'POST'/g) ?? []).length;
	assert.equal(postCount, 1, "un seul POST d'application, dans appliquerCalibrage");
	const calls = (adminPage.match(/appliquerCalibrage/g) ?? []).length;
	assert.equal(calls, 2, 'définition + onconfirm — jamais appelé ailleurs (aucune application automatique)');
});

test('ACCÈS : une cliente est refusée par apply — AUCUNE écriture', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	await assert.rejects(
		() =>
			calibConvex.apply._handler(ctx, {
				sessionToken: TOKEN,
				userId: userId,
				entrees: ENTREES,
				kcal: 1630,
				carbs: 183,
				protein: 102,
				fat: 54,
				effectiveFrom: '2026-10-27'
			}),
		(e) => e instanceof ConvexError && /coach/i.test(e.message)
	);
	assert.equal(ctx.all('clientGoals').length, 0, 'aucun objectif écrit');
	assert.equal(ctx.all('clientGoalHistory').length, 0, 'aucun historique écrit');
	assert.equal(ctx.all('calibrageSnapshots').length, 0, 'aucun instantané écrit');
});

test('ACCÈS : une cliente est refusée par fiche (lecture du pré-remplissage)', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	await assert.rejects(
		() => calibConvex.fiche._handler(ctx, { sessionToken: TOKEN, userId }),
		(e) => e instanceof ConvexError && /coach/i.test(e.message)
	);
});

test('API : /api/coach/calibrage est réservé au coach (requireRole coach, GET et POST)', () => {
	assert.ok(apiRoute.includes("await requireRole(event, 'coach')"), 'GET et POST passent par requireRole');
	assert.equal((apiRoute.match(/requireRole\(event, 'coach'\)/g) ?? []).length, 2);
	assert.ok(apiRoute.includes('api.calibrage.fiche') && apiRoute.includes('api.calibrage.apply'));
});

test('SCHÉMA : table calibrageSnapshots additive (entrées, résultats, version, date, auteur)', () => {
	const table = schema.slice(schema.indexOf('calibrageSnapshots'), schema.indexOf('calibrageSnapshots') + 900);
	assert.ok(table.includes('inputs: v.record(v.string(), v.any())'), 'entrées figées');
	assert.ok(table.includes('results: v.record(v.string(), v.any())'), 'résultats figés');
	assert.ok(table.includes('formulaVersion: v.string()'), 'version des formules');
	assert.ok(table.includes('date: v.string()'), "date de l'instantané");
	assert.ok(table.includes('createdBy: v.id("users")'), 'auteur');
	assert.ok(table.includes('by_user'), 'index lecture par cliente');
});

test('MODULE : version des formules exposée pour les instantanés', () => {
	assert.equal(typeof cal.VERSION_FORMULES_CALIBRAGE, 'string');
	assert.ok(cal.VERSION_FORMULES_CALIBRAGE.length > 0);
	assert.equal(fiche.resultatsFiche(ENTREES).versionFormules, cal.VERSION_FORMULES_CALIBRAGE);
});
