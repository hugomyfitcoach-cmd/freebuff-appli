/**
 * Mission C1-quater — DURCISSEMENT DE L'OUTIL SPORT (relecture PR #22).
 *
 * Règles vérifiées sur les MUTATIONS Convex réelles (handlers appelés avec un
 * contexte en mémoire) :
 *  - une ligne v1 n'est JAMAIS recalculée : durée, date, duplication gardent
 *    son MET et ses kcal d'origine ; elle ne bascule en v2 qu'avec un
 *    changement explicite d'activité ou d'intensité ;
 *  - une ligne v2 reste calculée avec SON coût horaire stocké ;
 *  - `bpmMoyen` est EFFACÉ quand la cliente repasse à une intensité manuelle
 *    (updateActivity comme addActivity) ;
 *  - une FC à 300 BPM est refusée avec un message lisible (jamais
 *    « Server Error ») ; un poids hors bornes aussi ;
 *  - les anciennes valeurs d'intensité d'une PWA en cache (« modérée »…) sont
 *    acceptées et converties ;
 *  - zones cardio continues : 180 BPM tombe dans « 160 à 180 » (7,7) mais
 *    180,5 BPM est au-delà de 180 → plafond 8,8.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ConvexError } from 'convex/values';

const cal = await import(new URL('../src/lib/calibrage.ts', import.meta.url).href);
const sportCatalog = await import(new URL('../src/convex/sportCatalog.ts', import.meta.url).href);
const sport = await import(new URL('../src/convex/sport.ts', import.meta.url).href);
const { hashToken } = await import(new URL('../src/convex/helpers.ts', import.meta.url).href);

/* ── Contexte Convex en mémoire (db.get/insert/patch/delete/query) ── */

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
				// Convex : patcher avec undefined SUPPRIME le champ optionnel.
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
	return { db };
}

const TOKEN = 'session-c1-quater';

async function ctxAvecCliente(weightKg = 60) {
	const ctx = makeCtx();
	const userId = await ctx.db.insert('users', { role: 'client', disabled: false, name: 'Cliente Test' });
	await ctx.db.insert('sessions', {
		tokenHash: await hashToken(TOKEN),
		userId,
		expiresAt: Date.now() + 3_600_000,
	});
	await ctx.db.insert('bodyMetrics', { userId, date: '2026-10-01', weightKg });
	return { ctx, userId };
}

/** Ligne v1 figée : MET du Compendium, pas de coût horaire (barème antérieur). */
async function seedV1(ctx, userId, overrides = {}) {
	return ctx.db.insert('sportActivities', {
		userId,
		date: '2026-10-05',
		activityId: 'course-tapis',
		activityNameSnapshot: 'Course (tapis)',
		durationMinutes: 30,
		intensity: 'moderee',
		metValue: 8.3,
		coefficientSource: 'compendium',
		coefficientVersion: '1',
		weightSnapshot: 60,
		estimatedCalories: 249, // 8,3 × 60 × 0,5
		metMinutes: 249, // 8,3 × 30
		source: 'manual',
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	});
}

/** Ligne v2 : barème G-FLUX, coût horaire stocké sur la ligne. */
async function seedV2(ctx, userId, overrides = {}) {
	return ctx.db.insert('sportActivities', {
		userId,
		date: '2026-10-05',
		activityId: 'course-tapis',
		activityNameSnapshot: 'Course (tapis)',
		durationMinutes: 30,
		intensity: '130-150',
		metValue: 5.24, // 5,5 ÷ 1,05
		bpmMoyen: 140,
		coutHoraireKcalKgH: 5.5,
		coefficientSource: 'gflux_table',
		coefficientVersion: '2',
		weightSnapshot: 60,
		estimatedCalories: 165, // 5,5 × 60 × 0,5
		metMinutes: 157, // 5,24 × 30
		source: 'manual',
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	});
}

/* ── 1 · Ligne v1 : jamais recalculée ── */

test('updateActivity ligne v1 : date et durée éditables, kcal et MET inchangés', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	const v1 = await seedV1(ctx, userId);

	const res = await sport.updateActivity._handler(ctx, {
		sessionToken: TOKEN,
		activityId: v1,
		date: '2026-10-06',
		durationMinutes: 45,
	});
	assert.deepEqual(res, { ok: true, bareme: 'v1' }, 'la ligne reste en v1');

	const row = await ctx.db.get(v1);
	assert.equal(row.date, '2026-10-06', 'date modifiée');
	assert.equal(row.durationMinutes, 45, 'durée modifiée');
	assert.equal(row.coefficientVersion, '1', 'toujours v1');
	assert.equal(row.coutHoraireKcalKgH, undefined, 'jamais de coût horaire v2');
	assert.equal(row.metValue, 8.3, 'MET inchangé');
	assert.equal(row.estimatedCalories, 249, "kcal d'origine inchangées");
	assert.equal(row.metMinutes, 249, 'jamais recalculée');
});

test('updateActivity ligne v1 : sans nouvelle intensité la ligne ne bascule jamais en v2', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	const v1 = await seedV1(ctx, userId, { intensity: 'intense' });

	// Même intensité renvoyée (PWA en cache comprise) : aucun recalcul.
	await sport.updateActivity._handler(ctx, {
		sessionToken: TOKEN,
		activityId: v1,
		intensity: 'intense',
		durationMinutes: 60,
	});
	const row = await ctx.db.get(v1);
	assert.equal(row.coefficientVersion, '1');
	assert.equal(row.metValue, 8.3);
	assert.equal(row.estimatedCalories, 249);

	// Changement EXPLICITE d'intensité : là seulement, bascule au barème v2.
	const res = await sport.updateActivity._handler(ctx, {
		sessionToken: TOKEN,
		activityId: v1,
		intensity: '160-180',
	});
	assert.deepEqual(res, { ok: true, bareme: 'v2' });
	const basculee = await ctx.db.get(v1);
	assert.equal(basculee.coefficientVersion, '2', 'bascule explicite en v2');
	assert.equal(basculee.metValue, 7.33, 'MET du barème v2 (7,7 ÷ 1,05)');
	assert.equal(basculee.estimatedCalories, 462, '7,7 × 60 kg × 1 h (durée 60, poids gelé)');
});

test('duplicateActivity ligne v1 : copie fidèle, kcal et MET inchangés', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	const v1 = await seedV1(ctx, userId);

	const res = await sport.duplicateActivity._handler(ctx, {
		sessionToken: TOKEN,
		activityId: v1,
		date: '2026-10-08',
	});
	const copy = await ctx.db.get(res._id);
	assert.equal(copy.date, '2026-10-08');
	assert.equal(copy.coefficientVersion, '1', 'la copie reste en v1');
	assert.equal(copy.coutHoraireKcalKgH, undefined);
	assert.equal(copy.metValue, 8.3, 'MET inchangé');
	assert.equal(copy.estimatedCalories, 249, "kcal d'origine");
	assert.equal(copy.metMinutes, 249);
	assert.equal(copy.intensity, 'moderee');
	// L'originale n'a pas bougé.
	const originale = await ctx.db.get(v1);
	assert.equal(originale.estimatedCalories, 249);
	assert.equal(originale.date, '2026-10-05');
});

/* ── 2 · Ligne v2 : recalcul avec SON coût horaire stocké ── */

test('updateActivity ligne v2 : volume recalculé avec le coût horaire de la ligne', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	const v2 = await seedV2(ctx, userId, { bpmMoyen: undefined });

	const res = await sport.updateActivity._handler(ctx, {
		sessionToken: TOKEN,
		activityId: v2,
		durationMinutes: 60,
	});
	assert.deepEqual(res, { ok: true, bareme: 'v2' });

	const row = await ctx.db.get(v2);
	assert.equal(row.durationMinutes, 60);
	assert.equal(row.coutHoraireKcalKgH, 5.5, 'coût horaire inchangé');
	assert.equal(row.metValue, 5.24, 'MET inchangé');
	assert.equal(row.estimatedCalories, 330, '5,5 × 60 × 1 h');
	assert.equal(row.metMinutes, 314, '5,24 × 60');
});

test('duplicateActivity ligne v2 : copie fidèle, kcal et MET inchangés', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	const v2 = await seedV2(ctx, userId);

	const res = await sport.duplicateActivity._handler(ctx, {
		sessionToken: TOKEN,
		activityId: v2,
		date: '2026-10-08',
	});
	const copy = await ctx.db.get(res._id);
	assert.equal(copy.coefficientVersion, '2');
	assert.equal(copy.coutHoraireKcalKgH, 5.5);
	assert.equal(copy.metValue, 5.24);
	assert.equal(copy.estimatedCalories, 165, "kcal d'origine");
	assert.equal(copy.bpmMoyen, 140, 'FC de la ligne copiée');
});

/* ── 3 · Purge de bpmMoyen au retour à une intensité manuelle ── */

test('updateActivity : bpmMoyen effacé quand la cliente repasse à une intensité manuelle', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	const v2 = await seedV2(ctx, userId);

	await sport.updateActivity._handler(ctx, {
		sessionToken: TOKEN,
		activityId: v2,
		intensity: 'sous-130', // intensité choisie à la main, FC effacée
	});
	const row = await ctx.db.get(v2);
	assert.equal(row.bpmMoyen, undefined, 'bpmMoyen purgé');
	assert.equal(row.intensity, 'sous-130');
	assert.equal(row.coutHoraireKcalKgH, 3.8, 'coût de la zone choisie');
});

test('updateActivity : même intensité reprise sans FC → purge aussi (choix manuel)', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	const v2 = await seedV2(ctx, userId);

	await sport.updateActivity._handler(ctx, {
		sessionToken: TOKEN,
		activityId: v2,
		intensity: '130-150', // même zone, mais plus aucune FC transmise
		durationMinutes: 45,
	});
	const row = await ctx.db.get(v2);
	assert.equal(row.bpmMoyen, undefined, 'bpmMoyen purgé');
});

test('addActivity : la création non plus ne stocke pas de FC quand une intensité est choisie', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	const res = await sport.addActivity._handler(ctx, {
		sessionToken: TOKEN,
		date: '2026-10-08',
		activityId: 'course-tapis',
		intensity: '130-150',
		durationMinutes: 30,
	});
	const row = await ctx.db.get(res._id);
	assert.equal(row.bpmMoyen, undefined, 'aucune FC stockée à la création');
	assert.equal(row.intensity, '130-150');
});

/* ── 4 · Validations : FC 40–240 BPM, poids — messages lisibles ── */

function assertErreurLisible(err, motif) {
	assert.ok(err instanceof ConvexError, `ConvexError attendu (reçu ${err?.constructor?.name})`);
	assert.match(err.message, motif);
	assert.ok(!/Server Error/i.test(err.message), 'jamais « Server Error »');
}

test('addActivity : un BPM à 300 est refusé avec un message lisible', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	await assert.rejects(
		() =>
			sport.addActivity._handler(ctx, {
				sessionToken: TOKEN,
				date: '2026-10-08',
				activityId: 'course-tapis',
				bpmMoyen: 300,
				durationMinutes: 30,
			}),
		(err) => {
			assertErreurLisible(err, /Fréquence cardiaque/);
			assert.match(err.message, /40 à 240 BPM/);
			return true;
		}
	);
});

test('updateActivity : un BPM à 300 est refusé avec un message lisible', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	const v2 = await seedV2(ctx, userId);
	await assert.rejects(
		() => sport.updateActivity._handler(ctx, { sessionToken: TOKEN, activityId: v2, bpmMoyen: 300 }),
		(err) => {
			assertErreurLisible(err, /Fréquence cardiaque/);
			assert.match(err.message, /40 à 240 BPM/);
			return true;
		}
	);
	// La ligne n'a pas été touchée.
	assert.equal((await ctx.db.get(v2)).bpmMoyen, 140);
});

test('BPM aux bornes : 40 et 240 acceptés, 39 refusé', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	const bas = await sport.addActivity._handler(ctx, {
		sessionToken: TOKEN,
		date: '2026-10-08',
		activityId: 'course-tapis',
		bpmMoyen: 40,
		durationMinutes: 30,
	});
	assert.equal((await ctx.db.get(bas._id)).intensity, 'sous-130');
	const haut = await sport.addActivity._handler(ctx, {
		sessionToken: TOKEN,
		date: '2026-10-08',
		activityId: 'course-tapis',
		bpmMoyen: 240,
		durationMinutes: 30,
	});
	assert.equal((await ctx.db.get(haut._id)).intensity, 'plus-180');
	await assert.rejects(
		() =>
			sport.addActivity._handler(ctx, {
				sessionToken: TOKEN,
				date: '2026-10-08',
				activityId: 'course-tapis',
				bpmMoyen: 39,
				durationMinutes: 30,
			}),
		(err) => {
			assertErreurLisible(err, /40 à 240 BPM/);
			return true;
		}
	);
});

test('Poids hors bornes : message clair (jamais « Server Error »)', async () => {
	const { ctx, userId } = await ctxAvecCliente(500); // 500 kg : hors bornes du barème
	await assert.rejects(
		() =>
			sport.addActivity._handler(ctx, {
				sessionToken: TOKEN,
				date: '2026-10-08',
				activityId: 'course-tapis',
				intensity: '130-150',
				durationMinutes: 30,
			}),
		(err) => {
			assertErreurLisible(err, /Poids/);
			assert.match(err.message, /20 à 400 kg/);
			return true;
		}
	);
});

/* ── 5 · Compatibilité PWA en cache : anciennes valeurs d'intensité ── */

test('addActivity : l’ancienne valeur « modérée » est acceptée et convertie', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	const res = await sport.addActivity._handler(ctx, {
		sessionToken: TOKEN,
		date: '2026-10-08',
		activityId: 'course-tapis',
		intensity: 'moderee', // valeur v1 envoyée par une PWA en cache
		durationMinutes: 30,
	});
	const row = await ctx.db.get(res._id);
	assert.equal(row.intensity, '130-150', 'convertie vers la zone v2 équivalente');
	assert.equal(row.coefficientVersion, '2');
	assert.equal(row.coutHoraireKcalKgH, 5.5);
	assert.equal(row.estimatedCalories, 165, '5,5 × 60 × 0,5 h');
});

test('updateActivity : « légère » et « intense » converties selon l’activité', async () => {
	const { ctx, userId } = await ctxAvecCliente();
	const v2 = await seedV2(ctx, userId, { bpmMoyen: undefined, intensity: 'sous-130' });

	await sport.updateActivity._handler(ctx, { sessionToken: TOKEN, activityId: v2, intensity: 'intense' });
	let row = await ctx.db.get(v2);
	assert.equal(row.intensity, '160-180', 'cardio : intense → zone 160-180');

	await sport.updateActivity._handler(ctx, {
		sessionToken: TOKEN,
		activityId: v2,
		activityRef: 'yoga',
		intensity: 'legere',
	});
	row = await ctx.db.get(v2);
	assert.equal(row.intensity, 'legere', 'douce : légère reste légère');
	assert.equal(row.coutHoraireKcalKgH, 2.2);

	await sport.updateActivity._handler(ctx, {
		sessionToken: TOKEN,
		activityId: v2,
		activityRef: 'musculation',
		intensity: 'intense',
	});
	row = await ctx.db.get(v2);
	assert.equal(row.intensity, 'intensive', 'musculation : intense → intensive');
	assert.equal(row.coutHoraireKcalKgH, 4.4);
});

/* ── 6 · Zones cardio continues : 180,5 BPM tombe au-delà de 180 ── */

test('Zones continues : 180 BPM → 7,7 ; 180,5 BPM → plafond 8,8', () => {
	assert.equal(cal.coutSportif({ sport: 'cardio', bpm: 180 }).coefficientKcalKgH, 7.7, '180 BPM inclus dans 160–180');
	assert.equal(cal.coutSportif({ sport: 'cardio', bpm: 180.5 }).coefficientKcalKgH, 8.8, '180,5 BPM est au-delà de 180');
	assert.equal(cal.bandeCardio(180.5).id, 'plus-180');
	assert.equal(cal.bandeCardio(180).id, '160-180');
	/* Les bornes se rejoignent sans trou ni recouvrement. */
	let precedent = 0;
	for (const bande of cal.BANDES_CARDIO) {
		assert.equal(bande.bpmMin, precedent, `bande ${bande.id} : reprend la borne précédente`);
		precedent = bande.bpmMax;
	}
});

test('Fréquence cardiaque : bornes 40 à 240 BPM dans le module de calibrage', () => {
	assert.throws(() => cal.coutSportif({ sport: 'cardio', bpm: 35 }), /Fréquence cardiaque/);
	assert.throws(() => cal.coutSportif({ sport: 'cardio', bpm: 300 }), /Fréquence cardiaque/);
	assert.equal(cal.BPM_MIN, 40);
	assert.equal(cal.BPM_MAX, 240);
});

/* ── 7 · Côté API : mêmes bornes, message clair ── */

test('API sport : la FC est validée 40–240 BPM avec un message clair', async () => {
	const src = await import('node:fs').then((fs) =>
		fs.readFileSync(new URL('../src/routes/api/sport/+server.ts', import.meta.url), 'utf8')
	);
	assert.match(src, /bpmMoyenOuErreur/, 'validation centralisée côté API');
	assert.match(src, /BPM_MIN.*BPM_MAX|BPM_MAX.*BPM_MIN/s, 'bornes du barème réutilisées');
	assert.match(src, /Fréquence cardiaque invalide/, 'message lisible pour la cliente');
	assert.ok(!/bpmMoyen > 0/.test(src), 'plus aucune valeur silencieusement écartée');
});

/* ── 8 · Erreurs du module calibrage → ConvexError lisibles ── */

test('sportCatalog : les erreurs du module calibrage deviennent des ConvexError lisibles', () => {
	try {
		sportCatalog.estimateSportActivity({
			activityId: 'yoga',
			bpmMoyen: 300,
			durationMinutes: 60,
			weightKg: 60,
		});
		assert.fail('BPM 300 doit être refusé');
	} catch (e) {
		assertErreurLisible(e, /Fréquence cardiaque/);
	}
	try {
		sportCatalog.estimateSportActivity({
			activityId: 'yoga',
			intensity: 'legere',
			durationMinutes: 60,
			weightKg: 500,
		});
		assert.fail('Poids 500 kg doit être refusé');
	} catch (e) {
		assertErreurLisible(e, /Poids/);
	}
});
