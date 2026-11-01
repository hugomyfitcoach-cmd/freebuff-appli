/**
 * MISSION CAL-VIDE — LE BROUILLON DE CALIBRAGE ACCEPTE LES CHAMPS VIDES.
 *
 * Vérifié :
 *  1. VALIDATEURS : le brouillon (`saveDraft`) accepte `null` sur TOUS les
 *     champs numériques et une semaine type absente ou incomplète (7 jours au
 *     maximum) ; « Appliquer à la fiche » (`apply`) garde son validateur strict
 *     (aucun `null`) ;
 *  2. BROUILLON : un champ vidé est enregistré puis RESTAURÉ VIDE (jamais 0) ;
 *     aucun calcul n'est lancé sur une saisie incomplète (pas d'exception) ;
 *  3. APPLIQUER : le validateur d'`apply` refuse toujours `null` ;
 *  4. ÉCHEC DE SAUVEGARDE : mention discrète « Brouillon non enregistré, nouvel
 *     essai… », jamais de message technique, et « Brouillon enregistré · date
 *     heure » seulement après une sauvegarde réussie.
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
const { hashToken } = helpers;

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

const TOKEN = 'session-cal-vide';

async function ctxAvecCoach() {
	const ctx = makeCtx();
	const coachId = await ctx.db.insert('users', { role: 'coach', disabled: false, prenom: 'Hugo' });
	const userId = await ctx.db.insert('users', {
		role: 'client',
		disabled: false,
		prenom: 'Cliente',
		heightCm: 170,
		createdBy: coachId
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

/** Validateur exporté d'une mutation → champs de `entrees`. */
function champsEntrees(mutation) {
	return JSON.parse(mutation.exportArgs()).value.entrees.fieldType.value;
}

/* ── 1 · Validateurs ── */

test('VALIDATEUR : le brouillon accepte null sur tous les champs numériques, apply reste strict', () => {
	const brouillon = champsEntrees(calibConvex.saveDraft);
	/* Champs REQUIS : nombre ou null (champ vidé en cours de saisie). */
	for (const champ of ['poidsKg', 'mgPct', 'pasMoyen', 'heuresTravail']) {
		const field = brouillon[champ];
		assert.equal(field.optional, false, `${champ} toujours présent`);
		assert.equal(field.fieldType.type, 'union', `${champ} accepte le vide`);
		assert.deepEqual(
			field.fieldType.value.map((v) => v.type).sort(),
			['null', 'number'],
			`${champ} : nombre ou null uniquement`
		);
	}
	/* Champs FACULTATIFS : optionnels ET nullables. */
	for (const champ of [
		'ajustementTravail',
		'adaptationPct',
		'deficitPct',
		'surplusPct',
		'proteinesParKgMasseMaigre'
	]) {
		const field = brouillon[champ];
		assert.equal(field.optional, true, `${champ} facultatif`);
		assert.equal(field.fieldType.type, 'union', `${champ} accepte le vide`);
	}
	/* Semaine type : absente ou en cours de saisie, valeurs nulles. */
	const apports = brouillon.apportsSemaine;
	assert.equal(apports.optional, true, 'semaine type absente acceptée');
	assert.equal(apports.fieldType.type, 'array');
	assert.deepEqual(
		apports.fieldType.value.value.map((v) => v.type).sort(),
		['null', 'number'],
		'apports : nombre ou null'
	);
	/* Séance : ses nombres aussi peuvent être vidés. */
	const seance = brouillon.seances.fieldType.value.value;
	assert.equal(seance.seancesParSemaine.fieldType.type, 'union', 'séance : nombre ou null');
	assert.equal(seance.dureeMinutes.fieldType.type, 'union', 'durée : nombre ou null');

	/* « Appliquer à la fiche » : STRICT, inchangé. */
	const apply = champsEntrees(calibConvex.apply);
	for (const champ of ['poidsKg', 'mgPct', 'pasMoyen', 'heuresTravail', 'adaptationPct', 'deficitPct']) {
		assert.equal(apply[champ].fieldType.type, 'number', `apply refuse toujours null (${champ})`);
	}
	assert.equal(apply.apportsSemaine.optional, false, 'apply exige la semaine type');
	assert.equal(apply.seances.optional, false, 'apply exige la liste de séances');
});

/* ── 2 · Brouillon accepté, restauré vide, aucun calcul sur un vide ── */

test('BROUILLON : un champ vidé (null) est accepté et restauré VIDE', async () => {
	const { ctx, userId } = await ctxAvecCoach();
	const entreesVides = {
		...ENTREES,
		adaptationPct: null,
		heuresTravail: null,
		ajustementTravail: null,
		deficitPct: null,
		surplusPct: null,
		proteinesParKgMasseMaigre: null,
		seances: [{ activiteId: 'musculation', seancesParSemaine: null, dureeMinutes: null, choix: 'intensive' }],
		/* Semaine type EN COURS DE SAISIE : moins de 7 jours, valeurs nulles. */
		apportsSemaine: [1500, null, null]
	};
	const res = await calibConvex.saveDraft._handler(ctx, {
		sessionToken: TOKEN,
		userId,
		entrees: entreesVides,
		ecartsSemaine: [0, 0, 0, 0, 0, 0, 0]
	});
	assert.equal(res.ok, true, 'brouillon enregistré malgré les champs vides');
	assert.equal(ctx.all('calibrageDrafts').length, 1);

	const fiche = await calibConvex.fiche._handler(ctx, { sessionToken: TOKEN, userId });
	assert.equal(fiche.brouillon.entrees.adaptationPct, null, 'adaptation restaurée VIDE');
	assert.equal(fiche.brouillon.entrees.heuresTravail, null, 'heures restaurées VIDES');
	assert.equal(fiche.brouillon.entrees.deficitPct, null);
	assert.equal(fiche.brouillon.entrees.poidsKg, 60, 'les champs remplis sont conservés');
	assert.deepEqual(fiche.brouillon.entrees.apportsSemaine, [1500, null, null], 'semaine type partielle conservée');
	/* Aucun objectif écrit par le brouillon. */
	assert.equal(ctx.all('clientGoals').length, 0);
	assert.equal(ctx.all('calibrageSnapshots').length, 0);
});

test('CALCUL : aucune exception sur un vide — le calcul attend une saisie complète', () => {
	/* Un champ vide : aucune entrée stricte, donc AUCUN calcul (écran en « — »). */
	assert.equal(ficheLib.entreesCalibrageCompletes({ ...ENTREES, adaptationPct: null }), null);
	assert.equal(ficheLib.entreesCalibrageCompletes({ ...ENTREES, heuresTravail: null }), null);
	assert.equal(ficheLib.entreesCalibrageCompletes({ ...ENTREES, poidsKg: null }), null);
	assert.equal(ficheLib.entreesCalibrageCompletes({ ...ENTREES, deficitPct: null }), null);
	/* Saisie complète : les entrées strictes repartent, les calculs passent. */
	const completes = ficheLib.entreesCalibrageCompletes(ENTREES);
	assert.ok(completes, 'entrées strictes produites');
	assert.ok(ficheLib.resultatsFiche(completes).objectifJournalierKcal > 0, 'résultats calculés');
	/* Semaine type incomplète : complétée en jours « à l'objectif » (null). */
	const partielle = ficheLib.entreesCalibrageCompletes({ ...ENTREES, apportsSemaine: [1500] });
	assert.equal(partielle.apportsSemaine.length, 7, 'toujours 7 jours pour le calcul');
	assert.deepEqual(partielle.apportsSemaine.slice(1), [null, null, null, null, null, null]);
	/* Séance vidée : jamais NaN, la dépense retombe à 0. */
	const seanceVide = ficheLib.entreesCalibrageCompletes({
		...ENTREES,
		seances: [{ activiteId: 'musculation', seancesParSemaine: null, dureeMinutes: null, choix: 'intensive' }]
	});
	assert.equal(seanceVide.seances[0].dureeMinutes, 0);
	assert.ok(Number.isFinite(ficheLib.resultatsFiche(seanceVide).sportSemaineKcal));
});

test('BROUILLON : la taille reste bornée (7 apports maximum)', async () => {
	const { ctx, userId } = await ctxAvecCoach();
	await assert.rejects(
		() =>
			calibConvex.saveDraft._handler(ctx, {
				sessionToken: TOKEN,
				userId,
				entrees: { ...ENTREES, apportsSemaine: Array(8).fill(null) },
				ecartsSemaine: [0, 0, 0, 0, 0, 0, 0]
			}),
		/Brouillon invalide/,
		'huit apports refusés'
	);
	assert.equal(ctx.all('calibrageDrafts').length, 0, 'aucune écriture');
});

/* ── 3 · « Appliquer à la fiche » refuse toujours un champ vide ── */

test('APPLIQUER : adaptationPct null toujours refusé par le validateur strict', async () => {
	const { ctx, userId } = await ctxAvecCoach();
	const apply = champsEntrees(calibConvex.apply);
	assert.equal(apply.adaptationPct.fieldType.type, 'number', 'null refusé à la frontière');
	/* Le brouillon accepte la même valeur : c'est bien le SEUL chemin assoupli. */
	const brouillon = champsEntrees(calibConvex.saveDraft);
	assert.equal(brouillon.adaptationPct.fieldType.value.some((v) => v.type === 'null'), true);
	/* Aucun objectif n'est écrit par une sauvegarde de brouillon avec un vide. */
	await calibConvex.saveDraft._handler(ctx, {
		sessionToken: TOKEN,
		userId,
		entrees: { ...ENTREES, adaptationPct: null },
		ecartsSemaine: [0, 0, 0, 0, 0, 0, 0]
	});
	assert.equal(ctx.all('clientGoals').length, 0);
	assert.equal(ctx.all('clientGoalHistory').length, 0);
});

/* ── 4 · Échec de sauvegarde : mention discrète, aucun message technique ── */

test('ÉCHEC : mention « Brouillon non enregistré, nouvel essai… », aucun message brut', () => {
	const fn = adminPage.slice(
		adminPage.indexOf('async function enregistrerBrouillon'),
		adminPage.indexOf('$effect(() => {', adminPage.indexOf('async function enregistrerBrouillon'))
	);
	assert.ok(fn.length > 0, 'sauvegarde automatique présente');
	assert.ok(
		adminPage.includes("const MESSAGE_BROUILLON_ECHEC = 'Brouillon non enregistré, nouvel essai…'"),
		'mention exacte'
	);
	assert.ok(fn.includes('calBrouillonErreur = MESSAGE_BROUILLON_ECHEC'), 'échec → mention discrète');
	assert.ok(!fn.includes('.message'), 'aucun message technique affiché');
	assert.ok(fn.includes('calBrouillonSavedAt = 0'), 'aucune mention « enregistré » pendant l’échec');
	assert.ok(fn.includes('calBrouillonErreur = \'\''), 'succès → erreur effacée');
	/* L'échec ne fige pas : la modification suivante reprogramme une sauvegarde. */
	assert.ok(
		fn.length > 0 &&
			adminPage.includes(
				'calBrouillonScheduler.schedule(userId, (estCourant) => enregistrerBrouillon(userId, signature, estCourant))'
			),
		'nouvel essai à la modification suivante'
	);
	/* La mention horodatée n'apparaît qu'après une sauvegarde réussie. */
	const mention = adminPage.slice(
		adminPage.indexOf('<div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-cream/60'),
		adminPage.indexOf('>Repartir des valeurs par défaut</button>')
	);
	assert.ok(mention.includes('aria-live="polite"'), 'mention du brouillon localisée');
	assert.ok(mention.includes('{#if calBrouillonErreur}'), 'erreur prioritaire dans la mention');
	assert.ok(
		mention.indexOf('{#if calBrouillonErreur}') < mention.indexOf('Brouillon enregistré · '),
		'jamais « enregistré » en cas d’échec'
	);
	/* Plus aucun affichage d'erreur technique pour le brouillon dans le CRM. */
	assert.ok(!adminPage.includes("bg-danger-light px-3 py-2 text-[11px] font-semibold text-danger\">{calBrouillonErreur}"));
});

test('RESTAURATION : un null du brouillon se restaure vide, jamais remplacé par 0', () => {
	const fn = adminPage.slice(
		adminPage.indexOf('function calibrageRestaure'),
		adminPage.indexOf('/** Écarts de la semaine type')
	);
	assert.ok(fn.includes('Partial<EntreesSaisieCalibrage>'), 'brouillon nullable accepté');
	for (const champ of ['poidsKg', 'mgPct', 'pasMoyen']) {
		assert.ok(
			fn.includes(`entrees.${champ} !== undefined ? entrees.${champ} : base.${champ}`),
			`${champ} : null conservé (restauré vide)`
		);
	}
	assert.ok(fn.includes('apportsSemaine.length <= 7'), 'semaine type partielle restaurée');
	/* Aucun champ numérique n'est forcé à 0 au retour du brouillon. */
	assert.ok(!/poidsKg:\s*poids \?\? entrees\.poidsKg \?\? base\.poidsKg/.test(fn));
});
