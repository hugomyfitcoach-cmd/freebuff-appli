/**
 * Mission C2b-2c — LIMITE DE DÉFICIT ET ENTRÉES RÉSILIENTES (onglet Calibrage).
 *
 * Vérifié :
 *  1. Déficit 0 à 30 % accepté : 22 → calcul normal ; 27 → calcul fait avec
 *     « Déficit au-delà de 25 % à prendre en compte. » EN PLUS des
 *     avertissements existants (inchangés) ;
 *  2. Déficit 31 → champ refusé (« Maximum 30 % » sous le champ), les résultats
 *     restent affichés avec la dernière valeur valide ;
 *  3. Même principe pour poids, masse grasse, pas, adaptation, protéines :
 *     valeur vide ou hors limites → message sous le champ, jamais d'écran de
 *     résultats vidé ;
 *  4. Serveur (mutation `apply`) : 30 % accepté, 31 % refusé sans écriture.
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
const saisie = await import(new URL('../src/lib/calibrageSaisie.ts', import.meta.url).href);
const calibrageConvex = await import(new URL('../src/convex/calibrage.ts', import.meta.url).href);
const { hashToken } = await import(new URL('../src/convex/helpers.ts', import.meta.url).href);

const adminPage = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');

/** Entrées valides de référence (profil de l'exemple du module : 60 kg, MG 26 %). */
const ENTREES = {
	poidsKg: 60,
	mgPct: 26,
	pasMoyen: 8000,
	heuresTravail: 4,
	ajustementTravail: 0,
	adaptationPct: 0,
	deficitPct: 12,
	proteinesParKgMasseMaigre: 2.3,
	seances: [],
	apportsSemaine: [null, null, null, null, null, null, null]
};

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

const TOKEN = 'session-c2b-2c';

/** Contexte : une coach connectée + une cliente cible. */
async function ctxAvecCoach() {
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
		userId: coachId,
		expiresAt: Date.now() + 3_600_000
	});
	return { ctx, coachId, userId };
}

/* ═══ 1 · Déficit 22 → calcul normal · 27 → message « au-delà de 25 % » ═══ */

test('Déficit 22 % : calcul normal, avertissement > 15 % inchangé, rien au-delà de 25 %', () => {
	const r = fiche.resultatsFiche({ ...ENTREES, deficitPct: 22 });
	assert.equal(r.deficitPct, 22);
	assert.equal(
		r.objectifSemaineKcal,
		Math.round(r.budgetSemaineKcal * (1 - 22 / 100)),
		'formule objectif = budget × (1 − déficit) inchangée'
	);
	assert.ok(r.objectifJournalierKcal > 0, 'calcul complet : objectif journalier affichable');
	assert.equal(
		r.avertissementDeficit,
		'Déficit supérieur à la règle de 10 à 15 % : décision du coach.',
		'avertissement existant > 15 % inchangé'
	);
	assert.equal(r.avertissementDeficitEleve, null, '22 % ≤ 25 % : aucun message « au-delà de 25 % »');
	assert.equal(saisie.messageChampCalibrage('deficitPct', 22), null, 'saisie 22 acceptée');
});

test('Déficit 27 % : calcul fait + « Déficit au-delà de 25 % à prendre en compte. » EN PLUS', () => {
	const r = fiche.resultatsFiche({ ...ENTREES, deficitPct: 27 });
	assert.equal(r.deficitPct, 27, 'le calcul est bien fait à 27 %');
	assert.equal(r.objectifSemaineKcal, Math.round(r.budgetSemaineKcal * (1 - 27 / 100)));
	assert.equal(r.avertissementDeficitEleve, 'Déficit au-delà de 25 % à prendre en compte.');
	assert.equal(
		r.avertissementDeficit,
		'Déficit supérieur à la règle de 10 à 15 % : décision du coach.',
		'avertissement existant inchangé, affiché EN PLUS'
	);
	/* Les autres avertissements existants restent présents et inchangés. */
	assert.ok('alertePlafonds' in r, 'plafonds Alpert / Macdonald inchangés');
	assert.ok('avertissementDisponibilite' in r, 'disponibilité en énergie inchangée');
	assert.equal(r.perteGraisseKg, Math.round((r.deficitSemaineKcal / 7700) * 100) / 100, 'perte estimée = déficit ÷ 7 700');
});

test('Le message « au-delà de 25 % » vient du module (25 % pile : aucun message)', () => {
	const bilan25 = cal.bilanObjectifSemaine({ budgetSemaineKcal: 10_000, deficitPct: 25 });
	assert.equal(bilan25.avertissementDeficitEleve, null, 'strictement au-delà de 25 %');
	const bilan26 = cal.bilanObjectifSemaine({ budgetSemaineKcal: 10_000, deficitPct: 26 });
	assert.equal(bilan26.avertissementDeficitEleve, 'Déficit au-delà de 25 % à prendre en compte.');
	assert.equal(bilan26.avertissement, 'Déficit supérieur à la règle de 10 à 15 % : décision du coach.');
});

/* ═══ 2 · Déficit 31 → champ refusé, résultats toujours affichés ═══ */

test('Déficit 31 % : champ refusé avec « Maximum 30 % », calcul bloqué', () => {
	assert.equal(saisie.messageChampCalibrage('deficitPct', 31), 'Maximum 30 %');
	assert.equal(saisie.messageChampCalibrage('deficitPct', 30), null, '30 % accepté');
	assert.equal(saisie.messageChampCalibrage('deficitPct', -1), 'Minimum 0 %');
	assert.equal(saisie.messageChampCalibrage('deficitPct', undefined), 'Déficit requis.');
	assert.ok(!saisie.saisiesCalibrageValides({ ...ENTREES, deficitPct: 31 }), '31 % = saisie invalide');
	assert.throws(() => fiche.resultatsFiche({ ...ENTREES, deficitPct: 31 }), /0 à 30 %/, 'module : 31 % refusé');
});

test('Déficit 31 % : les résultats restent affichés avec la dernière valeur valide', () => {
	assert.ok(
		adminPage.includes('const calR = $derived(calResults.results ?? calDerniersResultats);'),
		'calR = derniers résultats valides quand la saisie courante est invalide'
	);
	assert.ok(adminPage.includes('let calDerniersResultats = $state<ResultatsFicheCalibrage | null>(null);'));
	assert.ok(
		adminPage.includes('if (!saisiesCalibrageValides(calibrageInputs)) return { results: null, error: null };'),
		'saisie invalide : pas de nouveau calcul (messages sous les champs), jamais d’effacement'
	);
	assert.ok(
		/min="0" max="30" step="1" bind:value=\{calibrageInputs\.deficitPct\}/.test(adminPage),
		'champ déficit borné 0 à 30'
	);
	assert.ok(adminPage.includes('{#if calR && calR.avertissementDeficitEleve}'), 'message > 25 % affiché');
});

/* ═══ 3 · Poids vide → message sous le champ, résultats conservés ═══ */

test('Poids vide ou hors limites : message sous le champ, autres entrées pareil', () => {
	assert.equal(saisie.messageChampCalibrage('poidsKg', undefined), 'Poids requis.');
	assert.equal(saisie.messageChampCalibrage('poidsKg', null), 'Poids requis.');
	assert.ok(saisie.messageChampCalibrage('poidsKg', 0), '0 kg hors limites : message');
	assert.equal(saisie.messageChampCalibrage('poidsKg', 60), null);
	assert.ok(!saisie.saisiesCalibrageValides({ ...ENTREES, poidsKg: undefined }));
	/* Même principe pour masse grasse, pas, adaptation, protéines. */
	assert.equal(saisie.messageChampCalibrage('mgPct', undefined), 'Masse grasse requise.');
	assert.equal(saisie.messageChampCalibrage('pasMoyen', undefined), 'Moyenne de pas requise.');
	assert.equal(saisie.messageChampCalibrage('adaptationPct', undefined), 'Adaptation requise.');
	assert.equal(saisie.messageChampCalibrage('proteinesParKgMasseMaigre', undefined), 'Protéines requises.');
	for (const [champ, valeur] of [
		['mgPct', 80],
		['pasMoyen', 200_000],
		['adaptationPct', 25],
		['proteinesParKgMasseMaigre', 3]
	]) {
		assert.ok(saisie.messageChampCalibrage(champ, valeur), `hors limites : message (${champ})`);
	}
});

test('Chaque champ de l’onglet porte sa ligne de message SOUS son input', () => {
	for (const champ of [
		'poidsKg',
		'mgPct',
		'pasMoyen',
		'adaptationPct',
		'proteinesParKgMasseMaigre',
		'deficitPct'
	]) {
		const input = adminPage.indexOf(`bind:value={calibrageInputs.${champ}}`);
		const message = adminPage.indexOf(`{calErreursChamps.${champ} ?? ''}`);
		assert.ok(input > 0, `input présent : ${champ}`);
		assert.ok(message > input, `message sous l’input : ${champ}`);
	}
	assert.ok(adminPage.includes('const calErreursChamps = $derived(messagesChampsCalibrage(calibrageInputs));'));
});

/* ═══ 4 · Serveur : apply accepte 30 %, refuse 31 % ═══ */

test('SERVEUR (mutation apply) : déficit 30 % accepté et écrit, 31 % refusé sans écriture', async () => {
	/* a) 30 % → accepté : objectifs + instantané écrits. */
	const a = await ctxAvecCoach();
	const res = await calibrageConvex.apply._handler(a.ctx, {
		sessionToken: TOKEN,
		userId: a.userId,
		entrees: { ...ENTREES, deficitPct: 30 },
		kcal: 2000,
		carbs: 247,
		protein: 148,
		fat: 75,
		maintenanceKcal: 2400,
		effectiveFrom: '2026-10-20'
	});
	assert.equal(res.ok, true, 'apply accepte 30 %');
	assert.equal(a.ctx.all('clientGoals').length, 1, 'objectifs écrits');
	const snaps = a.ctx.all('calibrageSnapshots');
	assert.equal(snaps.length, 1, 'instantané figé');
	assert.equal(snaps[0].inputs.deficitPct, 30, 'déficit 30 % figé dans l’instantané');
	assert.equal(snaps[0].results.deficitPct, 30);

	/* b) 31 % → refusé AVANT toute écriture. */
	const b = await ctxAvecCoach();
	await assert.rejects(
		() =>
			calibrageConvex.apply._handler(b.ctx, {
				sessionToken: TOKEN,
				userId: b.userId,
				entrees: { ...ENTREES, deficitPct: 31 },
				kcal: 2000,
				carbs: 247,
				protein: 148,
				fat: 75,
				effectiveFrom: '2026-10-20'
			}),
		/Déficit choisi invalide/,
		'31 % refusé par le serveur'
	);
	assert.equal(b.ctx.all('clientGoals').length, 0, '31 % : aucune écriture objectifs');
	assert.equal(b.ctx.all('calibrageSnapshots').length, 0, '31 % : aucun instantané');
});
