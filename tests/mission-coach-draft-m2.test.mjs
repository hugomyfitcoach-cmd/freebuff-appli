/**
 * MISSION M2 — MÉTHODE EMBARQUÉE + CONTEXTE HEBDOMADAIRE COMPLET.
 *
 * Aucun appel réseau, aucune donnée réelle, aucune écriture Convex :
 *  - la VRAIE query `coachDraft.loadContext` est exécutée contre une base
 *    Convex simulée (cliente fictive « Léa ») via le handler exposé par
 *    l'enregistrement Convex — couverture comportementale : contexte complet,
 *    données manquantes, part IA, gardes d'accès ;
 *  - la méthode (`docs/methode-gflux.md`) est vérifiée octet à octet contre
 *    sa copie serveur, avec la garde « jamais côté navigateur » ;
 *  - le lien coach « Voir les données envoyées à l'assistant » est vérifié
 *    côté CRM, et absent de toute la vue cliente.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadContext, photoAiVision } from '../src/convex/coachDraft.ts';
import { COACH_DRAFT_METHOD_REFERENCE } from '../src/convex/ai/methodeGflux.ts';
import { renderMethodModule } from '../scripts/gen-methode-gflux.mjs';
import { hashToken, addDaysISO, localTodayISO } from '../src/convex/helpers.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

/* ═════════════ 0) BASE CONVEX SIMULÉE (minimum pour la vraie query) ═════════════ */

/**
 * `ctx.db` minimal : `get`, et `query(table).withIndex(builder)` où le
 * builder enregistre eq/gte/lte/gt/lt puis filtre réellement les lignes —
 * `order`, `collect`, `first`, `unique` comme Convex.
 */
function makeDb(tables) {
	const query = (table) => {
		let rows = (tables[table] ?? []).map((r) => ({ ...r }));
		const chain = {
			withIndex(_name, builder) {
				const constraints = [];
				const recorder = {};
				for (const op of ['eq', 'gte', 'lte', 'gt', 'lt']) {
					recorder[op] = (field, value) => {
						constraints.push([field, op, value]);
						return recorder;
					};
				}
				builder(recorder);
				rows = rows.filter((r) =>
					constraints.every(([field, op, value]) => {
						const v = r[field];
						if (op === 'eq') return v === value;
						if (op === 'gte') return v >= value;
						if (op === 'lte') return v <= value;
						if (op === 'gt') return v > value;
						return v < value;
					})
				);
				return chain;
			},
			order(dir) {
				rows = [...rows].sort((a, b) => (a._creationTime - b._creationTime) * (dir === 'desc' ? -1 : 1));
				return chain;
			},
			collect: async () => rows,
			first: async () => rows[0] ?? null,
			unique: async () => rows[0] ?? null,
		};
		return chain;
	};
	return {
		query,
		async get(id) {
			for (const rows of Object.values(tables)) {
				const found = rows.find((r) => r._id === id);
				if (found) return { ...found };
			}
			return null;
		},
	};
}

const now = Date.now();
const todayISO = localTodayISO();
const day = (offset) => addDaysISO(todayISO, offset);

/** Cliente fictive « Léa » sur la semaine du bilan 2026-10-05 → 2026-10-11. */
const coach1 = { _id: 'coach1', _creationTime: 1, email: 'hugo@coaching.test', nom: 'Dupont', prenom: 'Hugo', role: 'coach', passwordHash: 'x' };
const coach2 = { _id: 'coach2', _creationTime: 2, email: 'autre@coaching.test', nom: 'Martin', prenom: 'Zoé', role: 'coach', passwordHash: 'x' };
const lea = {
	_id: 'client1',
	_creationTime: 3,
	email: 'lea@cliente.test',
	nom: 'Élise',
	prenom: 'Léa',
	role: 'client',
	passwordHash: 'x',
	createdBy: 'coach1',
	// Formule : champ absent → coaching (repli historique).
	cycle: { contra: 'none', noDate: false, lmp: day(-17), len: 28, updatedAt: 1 },
};

const session = async (id, token, userId) => ({
	_id: id,
	_creationTime: 1,
	tokenHash: await hashToken(token),
	userId,
	expiresAt: now + 86_400_000,
});

const checkin1 = {
	_id: 'checkin1',
	_creationTime: 100,
	userId: 'client1',
	weekStart: '2026-10-05',
	weekLabel: 'S41 - 05 oct. 2026',
	status: 'nouveau',
	answers: {
		motivation: 4,
		adherence: 'partiel',
		faim: 'oui',
		hydratation: 'variable',
		digestion: 'ok',
		pas: '8000-10000',
		cycle: 'luteale',
		evolution: 'baisse',
		besoin_retour: 'ecrit',
		point_retour: 'Les week-ends sont plus difficiles à suivre.',
		victoire: 'Toutes mes séances de musculation ont été faites.',
	},
};

/** Entrées du journal : 7 derniers jours terminés (J-7 → J-1) + 7 précédents (J-14 → J-8). */
const entry = (id, date, meal, kcal, protein, mealGroup) => ({
	_id: id,
	_creationTime: 200,
	userId: 'client1',
	date,
	meal,
	name: 'Plat',
	qtyGrams: 100,
	carbs: 0,
	fat: 0,
	kcal,
	protein,
	...(mealGroup ? { mealGroup } : {}),
});

const diaryEntries = [
	// J-7 : repas analysé photo (900 kcal) + dîner manuel (700) → jour exploitable.
	entry('e1', day(-7), 'dejeuner', 500, 40, 'analyse:a1'),
	entry('e2', day(-7), 'dejeuner', 400, 35, 'analyse:a1'),
	entry('e3', day(-7), 'diner', 700, 35),
	// J-6 : repas mixte (analyse 650 + ajout manuel 150) → journée partielle.
	entry('e4', day(-6), 'dejeuner', 650, 50, 'analyse:a2'),
	entry('e5', day(-6), 'collation', 150, 10),
	// J-5 : saisie manuelle seule (1 200) → jour exploitable.
	entry('e6', day(-5), 'diner', 1200, 90),
	// Fenêtre précédente : une journée renseignée, sans aucune analyse photo.
	entry('e7', day(-11), 'diner', 1200, 80),
];

const bodyMetrics = [
	// Mensurations : dernier relevé vs précédent (fenêtre indépendante).
	{ _id: 'm1', _creationTime: 1, userId: 'client1', date: day(-20), weightKg: 62.3, waistCm: 72, hipCm: 97, neckCm: 31, createdAt: 1 },
	// Fenêtre précédente (J-14 → J-8) : la pesée de référence des écarts.
	{ _id: 'm2', _creationTime: 2, userId: 'client1', date: day(-8), weightKg: 61.9, createdAt: 2 },
	{ _id: 'm3', _creationTime: 3, userId: 'client1', date: day(-5), weightKg: 61.5, createdAt: 3 },
	// J-1 : pesée la plus récente (aujourd'hui inclus côté carte).
	{ _id: 'm4', _creationTime: 4, userId: 'client1', date: day(-1), weightKg: 61.2, waistCm: 71, hipCm: 96.5, neckCm: 30.5, createdAt: 4 },
];

const fullTables = {
	users: [coach1, coach2, lea],
	sessions: [await session('s1', 'tok-coach', 'coach1'), await session('s2', 'tok-autre-coach', 'coach2'), await session('s3', 'tok-client', 'client1')],
	checkins: [
		checkin1,
		// 2 derniers retours publiés de la même cliente (exemples de style).
		{
			_id: 'checkin2',
			_creationTime: 90,
			userId: 'client1',
			weekStart: '2026-09-28',
			weekLabel: 'S40 - 28 sept. 2026',
			status: 'retour_envoye',
			feedback: 'Belle régularité cette semaine, on garde la structure actuelle.',
			feedbackAt: now - 8 * 86_400_000,
		},
		{
			_id: 'checkin3',
			_creationTime: 80,
			userId: 'client1',
			weekStart: '2026-09-21',
			weekLabel: 'S39 - 21 sept. 2026',
			status: 'retour_envoye',
			feedback: 'Semaine un peu chargée, mais tu as tenu l’essentiel. Contacte-moi à lea@cliente.test si besoin.',
			feedbackAt: now - 15 * 86_400_000,
		},
		// Brouillon : jamais un exemple de style.
		{
			_id: 'checkin4',
			_creationTime: 70,
			userId: 'client1',
			weekStart: '2026-09-14',
			weekLabel: 'S38 - 14 sept. 2026',
			status: 'nouveau',
			feedback: 'Brouillon non publié.',
		},
	],
	diaryEntries,
	clientGoals: [{ _id: 'g1', _creationTime: 1, userId: 'client1', kcal: 1800, carbs: 200, protein: 120, fat: 60, stepGoal: 10000 }],
	clientGoalHistory: [],
	dailySteps: [
		{ _id: 'st1', _creationTime: 1, userId: 'client1', date: day(-7), count: 9000 },
		{ _id: 'st2', _creationTime: 2, userId: 'client1', date: day(-6), count: 11000 },
		{ _id: 'st3', _creationTime: 3, userId: 'client1', date: day(-11), count: 8000 },
	],
	bodyMetrics,
	sportActivities: [
		{ _id: 'sp1', _creationTime: 1, userId: 'client1', date: day(-7), durationMinutes: 60, source: 'gflux_training', estimatedCalories: 400, metMinutes: 360 },
		{ _id: 'sp2', _creationTime: 2, userId: 'client1', date: day(-5), durationMinutes: 45, source: 'manual', estimatedCalories: 350, metMinutes: 280 },
		{ _id: 'sp3', _creationTime: 3, userId: 'client1', date: day(-11), durationMinutes: 30, source: 'manual', estimatedCalories: 250, metMinutes: 180 },
	],
	appointments: [
		// Appel passé (20 jours) — la seule date qui déclenche la règle des 15 jours.
		{ _id: 'ap1', _creationTime: 1, clientId: 'client1', coachId: 'coach1', date: day(-20), time: '10:00', endTime: '10:15', kind: 'Suivi', status: 'on_book' },
		// Rendez-vous réservé à venir.
		{ _id: 'ap2', _creationTime: 2, clientId: 'client1', coachId: 'coach1', date: day(10), time: '18:00', endTime: '18:15', kind: 'Suivi', status: 'on_book' },
		// Annulé : jamais compté, ni en dernier appel ni en prochain RDV.
		{ _id: 'ap3', _creationTime: 3, clientId: 'client1', coachId: 'coach1', date: day(-5), time: '09:00', endTime: '09:15', kind: 'Suivi', status: 'cancelled' },
	],
};

const runLoadContext = (tables, sessionToken, checkinId) =>
	loadContext._handler({ db: makeDb(tables) }, { sessionToken, checkinId });

/* ═══════════════════ 1) CONTEXTE COMPLET — CLIENTE FICTIVE ═══════════════════ */

test('Contexte complet sur la cliente fictive Léa : tous les faits calculés par le code', async () => {
	const context = await runLoadContext(fullTables, 'tok-coach', 'checkin1');

	// Identité : prénom seul — jamais de nom, e-mail ni identifiant.
	assert.equal(context.prenom, 'Léa');
	const dump = JSON.stringify(context);
	assert.ok(!dump.includes('Élise'), 'nom de famille absent');
	assert.ok(!dump.includes('lea@cliente.test'), 'e-mail absent');
	assert.ok(!dump.includes('client1'), 'identifiant absent');
	assert.equal(context.weekStart, '2026-10-05');
	assert.equal(context.weekLabel, 'S41 - 05 oct. 2026');

	// Réponses du bilan de la semaine.
	assert.equal(context.answers.motivation, 4);
	assert.equal(context.answers.adherence, 'partiel');
	assert.equal(context.answers.point_retour, 'Les week-ends sont plus difficiles à suivre.');
	assert.equal(context.answers.victoire, 'Toutes mes séances de musculation ont été faites.');

	// Objectifs en vigueur + formule de la cliente (champ absent → coaching).
	assert.deepEqual(context.goals, { kcal: 1800, protein: 120, stepGoal: 10000 });
	assert.equal(context.formule, 'coaching');

	// Apport vs objectif, protéines vs objectif, jours renseignés sur 7.
	const food = context.stats.week.food;
	assert.equal(food.kcalAvg, 1400, 'moyenne sur les 2 journées exploitables (1 600 + 1 200)');
	assert.equal(food.proteinAvg, 100);
	assert.equal(food.goalKcal, 1800);
	assert.equal(food.goalProtein, 120);
	assert.equal(food.thresholdKcal, 1080, 'max(800 ; 60 % de 1 800)');
	assert.equal(food.exploitableDays, 2);
	assert.equal(food.partialDays, 1);
	assert.equal(food.absentDays, 4);
	assert.equal(food.daysWithData, 3, 'jours renseignés sur 7 (exploitables + partiels)');

	// Poids moyen et tendance, mensurations récentes.
	assert.equal(context.stats.week.weight.avg, 61.4);
	assert.equal(context.stats.week.weight.count, 2);
	// Dernière pesée et écart : les DEUX pesées les plus récentes, toutes dates
	// (aujourd'hui inclus) — même règle que la carte du bilan.
	assert.deepEqual(context.stats.week.weight.last, { date: day(-1), weightKg: 61.2 });
	assert.equal(context.stats.week.weight.delta, -0.3, '61,2 kg vs 61,5 kg — écart calculé par le code');
	assert.deepEqual(context.stats.weightTrend.last, { date: day(-1), weightKg: 61.2 });
	assert.deepEqual(context.stats.weightTrend.previous, { date: day(-5), weightKg: 61.5 });
	const mens = context.stats.mensurations;
	assert.equal(mens.date, day(-1));
	assert.equal(mens.prevDate, day(-20));
	assert.equal(mens.waistCm, 71);
	assert.equal(mens.deltas.waistCm, -1);

	// Pas moyens + sport de la semaine.
	assert.equal(context.stats.week.steps.avg, 10000);
	assert.equal(context.stats.week.steps.trackedDays, 2);
	assert.equal(context.stats.week.sport.activities, 2);
	assert.equal(context.stats.week.sport.durationMin, 105);
	assert.equal(context.stats.week.sport.kcal, 750);

	// Semaine précédente + écarts (7 jours vs 7 précédents).
	assert.equal(context.stats.previousWeek.food.kcalAvg, 1200);
	assert.equal(context.stats.previousWeek.food.daysWithData, 1);
	assert.equal(context.stats.deltas.kcalAvg, 200);
	assert.equal(context.stats.deltas.proteinAvg, 20);
	assert.equal(context.stats.deltas.stepsAvg, 2000);

	// Part des repas estimés par photo IA (voir test dédié pour les cas limites).
	assert.deepEqual(context.stats.week.photoAi, {
		kcalSharePct: 43,
		aiKcal: 1550,
		totalKcal: 3600,
		mealsWithAi: 2,
		mealsLogged: 5,
	});
	assert.equal(context.stats.previousWeek.photoAi.kcalSharePct, 0, 'semaine précédente 100 % manuelle');

	// Phase du cycle (renseignée) — formule existante réutilisée, phase exacte.
	assert.equal(context.cycle.kind, 'tracked');
	assert.equal(context.cycle.phaseLabel, 'Phase lutéale précoce');
	assert.ok(context.cycle.cycleDay >= 17 && context.cycle.cycleDay <= 19, `jour de cycle plausible (reçu ${context.cycle.cycleDay})`);

	// Dernier appel et prochain rendez-vous réservé (annulé ignoré).
	assert.equal(context.appointments.lastCallDate, day(-20));
	assert.equal(context.appointments.daysSinceLastCall, 20);
	assert.equal(context.appointments.nextAppointmentDate, day(10));

	// Exemples : les 2 derniers retours PUBLIÉS, dans l'ordre antéchronologique.
	assert.equal(context.examples.length, 2);
	assert.deepEqual(context.examples.map((e) => e.weekLabel), ['S40 - 28 sept. 2026', 'S39 - 21 sept. 2026']);
	assert.ok(context.examples[1].text.includes('[e-mail]'), 'e-mail de l’exemple nettoyé');
	assert.ok(!context.examples[1].text.includes('lea@cliente.test'));
});

/* ═══════════════════ 2) DONNÉES MANQUANTES — GÉRÉES SANS ZÉRO INVENTÉ ═══════════════════ */

test('Cliente sans aucune donnée : jours vides, pas de cycle, pas de rendez-vous', async () => {
	const empty = {
		...fullTables,
		users: [...fullTables.users],
		diaryEntries: [],
		dailySteps: [],
		bodyMetrics: [],
		sportActivities: [],
		appointments: [],
		checkins: [checkin1],
	};
	const bare = { ...lea, _id: 'client2', email: 'nina@cliente.test', prenom: 'Nina', nom: 'Petit', cycle: undefined };
	empty.users = [coach1, coach2, lea, bare];
	const checkinBare = { ...checkin1, _id: 'checkinBare', userId: 'client2', answers: {} };
	empty.checkins = [checkinBare];

	const context = await runLoadContext(empty, 'tok-coach', 'checkinBare');

	// Jours vides : 0 renseigné sur 7, moyennes indisponibles (jamais un 0).
	assert.equal(context.stats.week.food.daysWithData, 0);
	assert.equal(context.stats.week.food.exploitableDays, 0);
	assert.equal(context.stats.week.food.partialDays, 0);
	assert.equal(context.stats.week.food.absentDays, 7);
	assert.equal(context.stats.week.food.kcalAvg, null);
	assert.equal(context.stats.week.food.proteinAvg, null);

	// Part IA : total nul → « non disponible » (null), jamais 0 %.
	assert.deepEqual(context.stats.week.photoAi, {
		kcalSharePct: null,
		aiKcal: 0,
		totalKcal: 0,
		mealsWithAi: 0,
		mealsLogged: 0,
	});

	// Poids, pas, sport, mensurations absents.
	assert.equal(context.stats.week.weight.avg, null);
	assert.equal(context.stats.week.weight.count, 0);
	assert.equal(context.stats.week.weight.delta, null);
	assert.equal(context.stats.week.steps.avg, null);
	assert.equal(context.stats.week.steps.trackedDays, 0);
	assert.equal(context.stats.week.sport.activities, 0);
	assert.equal(context.stats.mensurations, null);

	// Pas de cycle renseigné, aucun rendez-vous.
	assert.equal(context.cycle, null);
	assert.deepEqual(context.appointments, {
		lastCallDate: null,
		daysSinceLastCall: null,
		nextAppointmentDate: null,
	});

	// Aucune réponse, aucun exemple.
	assert.deepEqual(context.answers, {});
	assert.deepEqual(context.examples, []);
	assert.equal(context.formule, 'coaching');
});

test('Cycle hormonal : renseigné mais sans phase estimable — jamais de fausse précision', async () => {
	const users = [coach1, { ...lea, _id: 'client3', email: 'ana@cliente.test', prenom: 'Ana', nom: 'Ruiz', createdBy: 'coach1', cycle: { contra: 'hormonal', noDate: false, updatedAt: 1 } }];
	const checkinHormonal = { ...checkin1, _id: 'checkinHormonal', userId: 'client3', answers: {} };
	const context = await runLoadContext({ ...fullTables, users, checkins: [checkinHormonal], diaryEntries: [], dailySteps: [], bodyMetrics: [], sportActivities: [], appointments: [] }, 'tok-coach', 'checkinHormonal');
	assert.equal(context.cycle.kind, 'hormonal');
	assert.equal(context.cycle.phaseLabel, null);
	assert.equal(context.cycle.cycleDay, null);
});

/* ═══════════════════════════ 3) PART IA — CALCUL EXACT ═══════════════════════════ */

test('Part des repas estimés par photo IA : kcal des analyses ÷ kcal totales, arrondie en %', () => {
	const days = ['2026-10-05', '2026-10-06', '2026-10-07'];
	// Cas mixte : repas analysé + ajouts manuels comptés comme non-IA.
	const out = photoAiVision(
		[
			entry('a', '2026-10-05', 'dejeuner', 500, 40, 'analyse:x1'),
			entry('b', '2026-10-05', 'dejeuner', 400, 35, 'analyse:x1'),
			entry('c', '2026-10-05', 'diner', 700, 35),
			entry('d', '2026-10-06', 'dejeuner', 650, 50, 'analyse:x2'),
			entry('e', '2026-10-06', 'collation', 150, 10),
			// Hors fenêtre : ignorée.
			entry('f', '2026-10-08', 'diner', 999, 50, 'analyse:x3'),
		],
		days
	);
	assert.deepEqual(out, {
		kcalSharePct: 65, // 1 550 / 2 400 = 64,58 %
		aiKcal: 1550,
		totalKcal: 2400,
		mealsWithAi: 2,
		mealsLogged: 4,
	});

	// 100 % manuel → 0 %, pas « non disponible » (le total n'est pas nul).
	const manual = photoAiVision([entry('g', '2026-10-05', 'diner', 500, 30)], days);
	assert.equal(manual.kcalSharePct, 0);
	assert.equal(manual.mealsWithAi, 0);
	assert.equal(manual.mealsLogged, 1);

	// Tout photo → 100 %.
	const allAi = photoAiVision([entry('h', '2026-10-05', 'diner', 800, 50, 'analyse:y1')], days);
	assert.equal(allAi.kcalSharePct, 100);
	assert.equal(allAi.mealsWithAi, 1);

	// Aucune calorie → part non disponible (null).
	assert.equal(photoAiVision([], days).kcalSharePct, null);
});

/* ═══════════════════════════ 4) ACCÈS — REFUS EXPLICITES ═══════════════════════════ */

test('Accès refusé à la cliente (rôle client) et à un autre coach (appartenance)', async () => {
	// La cliente concernée elle-même : rôle refusé.
	await assert.rejects(
		runLoadContext(fullTables, 'tok-client', 'checkin1'),
		/Accès réservé au coach/,
		'la cliente ne doit jamais lire le contexte assemblé'
	);

	// Un AUTRE coach, même avec l'identifiant du bilan : appartenance refusée.
	await assert.rejects(
		runLoadContext(fullTables, 'tok-autre-coach', 'checkin1'),
		/Accès refusé/,
		'un coach qui n’a pas créé la cliente est refusé'
	);

	// Contrôle positif : le coach rattaché passe bien.
	const context = await runLoadContext(fullTables, 'tok-coach', 'checkin1');
	assert.equal(context.prenom, 'Léa');
});

/* ═════════════ 5) MÉTHODE : COPIE SERVEUR EXACTE, JAMAIS CÔTÉ NAVIGATEUR ═════════════ */

test('La copie serveur de la méthode est identique octet à octet à docs/methode-gflux.md', () => {
	const editorial = readFileSync(join(root, 'docs/methode-gflux.md'), 'utf8');
	assert.equal(COACH_DRAFT_METHOD_REFERENCE, editorial);
	assert.ok(editorial.includes('depuis 15 jours'), 'règle des 15 jours présente dans la méthode');
});

test('methodReference.ts est exactement ce que produit le générateur — le .md reste la seule source', () => {
	const markdown = read('docs/methode-gflux.md');
	const expected = renderMethodModule(markdown);
	const module_ = read('src/convex/ai/methodeGflux.ts');
	assert.equal(
		module_,
		expected,
		'le module diverge du générateur : relancer scripts/gen-methode-gflux.mjs et n’éditer que le .md'
	);
	assert.ok(module_.includes('FICHIER GÉNÉRÉ, NE PAS ÉDITER'), 'en-tête de génération présent');
	assert.ok(!markdown.includes('FICHIER GÉNÉRÉ'), 'le .md est la source, jamais un fichier généré');
	const pkg = JSON.parse(read('package.json'));
	assert.ok(pkg.scripts.build.includes('gen-methode-gflux'), 'le générateur tourne à chaque build');
});

test('La méthode ne voyage qu’avec les fonctions Convex — jamais dans le bundle navigateur', () => {
	const offenders = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			if (statSync(p).isDirectory()) walk(p);
			else if (/\.(ts|svelte|js)$/.test(name) && readFileSync(p, 'utf8').includes('methodeGflux')) {
				offenders.push(p.slice(root.length + 1));
			}
		}
	};
	walk(join(root, 'src'));
	for (const file of offenders) {
		assert.ok(file.startsWith('src/convex/'), `import navigateur possible : ${file}`);
	}
	assert.ok(offenders.includes('src/convex/coachDraft.ts'), 'la méthode est bien chargée par le serveur');
});

/* ═══════════════ 6) LIEN COACH « VOIR LES DONNÉES ENVOYÉES À L’ASSISTANT » ═══════════════ */

test('BilanCard : lien discret coach qui affiche le contexte assemblé', () => {
	const card = read('src/lib/components/BilanCard.svelte');
	assert.ok(card.includes('Voir les données envoyées à l’assistant'), 'libellé du lien');
	assert.ok(card.includes('Masquer les données envoyées à l’assistant'), 'refermement du panneau');
	assert.ok(card.includes('/api/coach/draft/context?checkinId='), 'contexte lu via le BFF coach');
	assert.ok(card.includes('JSON.stringify(contextData, null, 2)'), 'contexte assemblé affiché tel quel');
	assert.ok(card.includes('class="text-[11px] font-medium text-mist underline decoration-dotted'), 'lien discret');
	assert.ok(!card.includes('COACH_DRAFT_METHOD_REFERENCE'), 'jamais de méthode dans l’interface');
});

test('Jamais visible côté cliente : ni dans RecapBilan, ni par une route cliente', () => {
	const recap = read('src/lib/components/RecapBilan.svelte');
	assert.ok(!recap.includes('Voir les données envoyées'), 'aucun lien dans la vue cliente');
	assert.ok(!recap.includes('/api/coach/draft/context'), 'aucun appel de la route côté cliente');
	const espaceHits = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			if (statSync(p).isDirectory()) walk(p);
			else if (/\.(svelte|ts)$/.test(name) && readFileSync(p, 'utf8').includes('coach/draft/context')) {
				espaceHits.push(p.slice(root.length + 1));
			}
		}
	};
	walk(join(root, 'src/routes/espace'));
	assert.deepEqual(espaceHits, [], 'l’espace cliente n’appelle jamais la route de contexte');
});

test('La route BFF de contexte et la query restent réservées au coach', () => {
	const route = read('src/routes/api/coach/draft/context/+server.ts');
	assert.ok(route.includes("requireRole(event, 'coach')"), 'garde coach côté BFF');
	assert.ok(route.includes('SESSION_COOKIE'), 'jeton depuis le cookie HttpOnly');
	assert.ok(route.includes('convex.query(api.coachDraft.contextPreview'), 'query dédiée, lecture seule');
	assert.ok(!route.includes('convex.action'), 'aucun appel IA dans cette route');
	assert.ok(!route.includes('COACH_DRAFT_METHOD_REFERENCE'), 'la méthode ne transite pas par le BFF');

	const draftSource = read('src/convex/coachDraft.ts');
	const previewBlock = draftSource.slice(draftSource.indexOf('export const contextPreview = query({'));
	assert.ok(previewBlock.includes('internal.coachDraft.loadContext'), 'contexte dupliqué nulle part : même query interne');
	assert.ok(!previewBlock.includes('COACH_DRAFT_METHOD_REFERENCE'), 'la méthode n’entre jamais dans une query');
	assert.ok(draftSource.includes('target.createdBy !== coach._id'), 'appartenance vérifiée côté Convex');
});
