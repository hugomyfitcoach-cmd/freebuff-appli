/**
 * Tests MISSION COACH-FIBRES — carte « Fibres » du journal coach (Vision 360).
 *
 * 1. MÊME valeur et MÊME objectif que la carte Fibres de l'espace cliente
 *    pour une journée donnée : `dayNutritionDetailsForCoach` réutilise le
 *    corps partagé `bilanJourForUser` → `bilanJour` / `repereFibres`
 *    (objectif = max(25 g, objectif kcal du jour × 0,015)). Aucun calcul de
 *    fibres réécrit côté coach.
 * 2. ACCÈS : la cliente d'un autre coach est refusée (`assertCoachOwnsClient`),
 *    un compte cliente ne peut pas appeler la variante coach.
 * 3. UI : 4ᵉ anneau « Fibres » (jeton --color-fibres) dans le journal coach,
 *    4 colonnes larges / 2 × 2 étroites, note « Estimation » discrète ;
 *    espace cliente inchangé (3 cartes, textes d'origine).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { hashToken } from '../src/convex/helpers.ts';
import { dayNutritionDetails, dayNutritionDetailsForCoach } from '../src/convex/journal.ts';

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const DATE = '2026-10-27';
const KCAL_OBJECTIF = 2148;
const TOKEN_COACH = 'session-coach-fibres';
const TOKEN_AUTRE = 'session-coach-fibres-autre';
const TOKEN_CLIENTE = 'session-cliente-fibres';

const COACH = { _id: 'coach-a', role: 'coach', disabled: false };
const AUTRE_COACH = { _id: 'coach-b', role: 'coach', disabled: false };
const CLIENTE = { _id: 'user-1', role: 'client', disabled: false, createdBy: COACH._id };
/** Même cliente, vue par un autre coach (celle d'un confrère). */
const CLIENTE_AUTRE = { _id: 'user-2', role: 'client', disabled: false, createdBy: AUTRE_COACH._id };

/** Entrées du jour : 2 fiches Ciqual (fibres connues) + 1 repas IA (inconnues). */
const ENTRIES = [
	{ _id: 'e1', userId: CLIENTE._id, date: DATE, meal: 'dejeuner', name: 'Pain complet ou intégral (à la farine T150)', qtyGrams: 100, kcal: 250, carbs: 40, protein: 9, fat: 2 },
	{ _id: 'e2', userId: CLIENTE._id, date: DATE, meal: 'dejeuner', name: 'Riz basmati, cuit, sans sel ajouté', qtyGrams: 100, kcal: 130, carbs: 28, protein: 3, fat: 0.3 },
	{ _id: 'e3', userId: CLIENTE._id, date: DATE, meal: 'diner', name: 'Plat maison estimé par IA', qtyGrams: 200, kcal: 300, carbs: 20, protein: 25, fat: 10 },
];

/** Contexte Convex minimal : sessions réelles (hashToken) + documents fournis. */
async function fakeCtx() {
	const users = [COACH, AUTRE_COACH, CLIENTE, CLIENTE_AUTRE];
	const session = async (token, userId) => ({
		userId,
		tokenHash: await hashToken(token),
		expiresAt: Date.now() + 60_000,
	});
	const sessions = [
		await session(TOKEN_COACH, COACH._id),
		await session(TOKEN_AUTRE, AUTRE_COACH._id),
		await session(TOKEN_CLIENTE, CLIENTE._id),
	];
	const chain = (rows) => {
		const constraints = [];
		const q = {
			eq: (field, value) => {
				constraints.push([field, value]);
				return q;
			},
		};
		const out = {
			withIndex: (_name, fn) => {
				fn?.(q);
				return out;
			},
			filter: () => out,
			order: () => out,
			take: async (n) => out.collect().then((r) => r.slice(0, n)),
			collect: async () =>
				rows.filter((r) => constraints.every(([field, value]) => r[field] === value)),
			first: async () => (await out.collect())[0] ?? null,
			unique: async () => (await out.collect())[0] ?? null,
		};
		return out;
	};
	const byId = new Map(users.map((u) => [u._id, u]));
	return {
		db: {
			query: (table) => {
				if (table === 'sessions') return chain(sessions);
				if (table === 'diaryEntries') return chain(ENTRIES);
				if (table === 'clientGoals')
					return chain([{ userId: CLIENTE._id, kcal: KCAL_OBJECTIF, carbs: 217, protein: 158, fat: 72 }]);
				if (table === 'clientGoalHistory') return chain([]);
				if (table === 'referenceFoods') return chain([]);
				if (table === 'users') return chain(users);
				return chain([]);
			},
			get: async (id) => byId.get(id) ?? null,
		},
	};
}

/* ─── 1. Même valeur et même objectif que la carte cliente ─── */

test('fibres du jour coach = fibres de la carte cliente, même repère daté', async () => {
	const ctx = await fakeCtx();
	const cliente = await dayNutritionDetails._handler(ctx, { sessionToken: TOKEN_CLIENTE, date: DATE });
	const coach = await dayNutritionDetailsForCoach._handler(ctx, {
		sessionToken: TOKEN_COACH,
		userId: CLIENTE._id,
		date: DATE,
	});

	assert.ok(cliente.fibres > 0, 'la cliente a bien des fibres connues ce jour-là');
	assert.equal(coach.fibres, cliente.fibres, 'même valeur de fibres pour la journée affichée');
	assert.equal(
		coach.repere,
		Math.max(25, Math.round(KCAL_OBJECTIF * 0.015)),
		'objectif = max(25 g, objectif kcal du jour × 0,015)'
	);
	assert.equal(coach.repere, cliente.repere, 'même objectif que la carte cliente');
	assert.equal(coach.kcal, cliente.kcal, 'mêmes kcal (aucune donnée parallèle)');
	assert.equal(coach.couverture, cliente.couverture, 'même couverture kcal');
	assert.equal(coach.fibresInconnues, 1, 'aliment sans fibres → note « Estimation » (jamais un total inventé)');
	assert.equal(coach.fibresInconnues, cliente.fibresInconnues, 'la note est la même que côté cliente');
});

/* ─── 2. Contrôle d'accès coach ─── */

test('accès refusé : la cliente d’un autre coach (assertCoachOwnsClient)', async () => {
	const ctx = await fakeCtx();
	await assert.rejects(
		() =>
			dayNutritionDetailsForCoach._handler(ctx, {
				sessionToken: TOKEN_AUTRE,
				userId: CLIENTE._id,
				date: DATE,
			}),
		(e) => /coach de cette cliente/i.test(e.message),
		'un autre coach ne lit jamais les fibres d’une cliente qui n’est pas la sienne'
	);
});

test('accès refusé : la variante coach est réservée aux comptes coach', async () => {
	const ctx = await fakeCtx();
	await assert.rejects(
		() =>
			dayNutritionDetailsForCoach._handler(ctx, {
				sessionToken: TOKEN_CLIENTE,
				userId: CLIENTE._id,
				date: DATE,
			}),
		(e) => /Réservé au coach/i.test(e.message)
	);
});

/* ─── 3. UI : 4ᵉ anneau côté coach, espace cliente inchangé ─── */

test('journal coach : 4ᵉ carte Fibres (anneau, %, X/Yg), 4 colonnes larges / 2 × 2 étroites', () => {
	const journalDay = source('src/lib/components/JournalDay.svelte');

	assert.ok(journalDay.includes("label: 'Fibres'"), '4ᵉ carte « Fibres »');
	assert.ok(journalDay.includes("color: 'var(--color-fibres)'"), 'anneau au jeton --color-fibres');
	assert.ok(
		journalDay.includes("mode === 'coach' ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-3'"),
		'grille coach 4 colonnes / 2 × 2 ; cliente toujours 3 colonnes'
	);
	assert.ok(
		journalDay.includes('const fibresCoach = $derived(mode === \'coach\' && bilanEtat !== \'inactif\')'),
		'carte fibres activée pour le coach seulement'
	);
	assert.ok(
		journalDay.includes('{fmt(Math.round(ring.eaten))}</strong><span class="text-mist">/{fmt(ring.goal)}g</span>'),
		'« X/Yg » sous l’anneau, format des autres cartes'
	);
	assert.ok(journalDay.includes('{Math.round(pct)}%'), 'pourcentage au centre de l’anneau');
});

test('note « Estimation » discrète (jamais rouge) seulement si des fibres sont inconnues', () => {
	const journalDay = source('src/lib/components/JournalDay.svelte');
	const i = journalDay.indexOf('fibresEstimation');
	assert.ok(i > 0, 'note conditionnée à fibresInconnues');
	assert.ok(
		/fibresEstimation = \$derived\(fibresCoach && !!bilanJour && bilanJour\.fibresInconnues > 0\)/.test(
			journalDay
		),
		'même règle que la note du volet cliente'
	);
	assert.ok(
		journalDay.includes('<p class="mt-1 text-[10px] font-semibold text-mist">Estimation</p>'),
		'mention discrète en gris, jamais en rouge'
	);
});

test('textes du journal coach à la 3ᵉ personne ; espace cliente intact', () => {
	const journalDay = source('src/lib/components/JournalDay.svelte');
	assert.ok(
		journalDay.includes(": mode === 'coach' ? 'Il reste' : 'Il te reste'"),
		'« Il reste » côté coach, « Il te reste » conservé côté cliente'
	);
	assert.ok(journalDay.includes('Dans le filet de sécurité'), 'plus de 2ᵉ personne (filet)');
	assert.ok(
		journalDay.includes(": 'Dans ton filet de sécurité'"),
		'texte de l’espace cliente conservé'
	);
	assert.ok(!journalDay.includes('Ta journée reste dans le cadre'), 'ancienne formule coach retirée');
	assert.ok(journalDay.includes("const compact = $derived(mode === 'client');"), 'compacité cliente inchangée');
});

test('câblage : requête coach dédiée + route BFF + données passées au journal', () => {
	const journalConvex = source('src/convex/journal.ts');
	const admin = source('src/routes/admin/+page.svelte');
	const route = source('src/routes/api/coach/journal/bilan/+server.ts');

	assert.ok(journalConvex.includes('export const dayNutritionDetailsForCoach'), 'query coach dédiée');
	assert.ok(
		/await assertCoachOwnsClient\(ctx, target, coach\);\s*return bilanJourForUser\(ctx, target, date\);/.test(
			journalConvex
		),
		'appartenance vérifiée puis MÊME corps de calcul que la cliente'
	);
	assert.ok(
		admin.includes('bilanJour={journalBilan}') && admin.includes('bilanEtat={journalBilanEtat}'),
		'le journal coach reçoit le bilan du jour affiché'
	);
	assert.ok(
		admin.includes('`/api/coach/journal/bilan?userId=${selectedId}&date=${journalDate}`'),
		'la carte suit le changement de date'
	);
	assert.ok(
		route.includes('api.journal.dayNutritionDetailsForCoach'),
		'route BFF réservée coach → query Convex'
	);
});
