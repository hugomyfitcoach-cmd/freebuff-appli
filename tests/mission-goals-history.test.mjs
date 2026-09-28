/**
 * Tests MISSION — HISTORISATION DE L'OBJECTIF CALORIQUE (daté / effectiveFrom).
 *
 * Garde-fous :
 *  1. RÉSOLUTION : dernier `effectiveFrom` ≤ date ; historique vide → repli
 *     objectif courant (aucun faux historique inventé) ;
 *  2. MÊME JOUR : plusieurs modifications le même jour → la DERNIÈRE gagne,
 *     une seule ligne par effectiveFrom (mutation idempotente) ;
 *  3. JOURNAL : getDay / getDayForCoach servent l'objectif de la DATE
 *     CONSULTÉE (barre, restantes, comparaison) — jamais l'objectif courant ;
 *  4. VISION 360 : chaque journée des 7 journées complètes est comparée à
 *     l'objectif applicable CE jour-là ; garde-fou 60 % par objectif du jour ;
 *     cockpit : représentation multi-objectifs explicite (plage affichée) ;
 *  5. ANTI-RÉGRESSION : écriture → ligne d'historique ; schéma additif ;
 *     seed DEMO avec 2 objectifs datés.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	kcalGoalForDate,
	kcalGoalsForDates,
	hasChangeWithin,
	withCurrentGoal,
} from '../src/lib/goalHistory.ts';
import { exploitabilityThresholdKcal, visionWindow, shiftISO } from '../src/lib/vision360.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const journal = readFileSync(join(root, 'src/convex/journal.ts'), 'utf8');
const coach = readFileSync(join(root, 'src/convex/coach.ts'), 'utf8');
const schema = readFileSync(join(root, 'src/convex/schema.ts'), 'utf8');
const seedDemo = readFileSync(join(root, 'src/convex/previewSeedVision360.ts'), 'utf8');
const adminPage = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');
const dashboard = readFileSync(join(root, 'src/convex/dashboard.ts'), 'utf8');

/* ── CAS SIMPLE — 01/09 : 1 600 · 15/09 : 1 700 · 27/09 : 1 550 ── */

const SIMPLE = [
	{ kcal: 1600, effectiveFrom: '2026-09-01' },
	{ kcal: 1700, effectiveFrom: '2026-09-15' },
	{ kcal: 1550, effectiveFrom: '2026-09-27' },
];

test('CAS SIMPLE : chaque date résout vers le dernier objectif d’effet ≤ date', () => {
	assert.equal(kcalGoalForDate(SIMPLE, '2026-09-10', 999), 1600);
	assert.equal(kcalGoalForDate(SIMPLE, '2026-09-20', 999), 1700);
	assert.equal(kcalGoalForDate(SIMPLE, '2026-09-26', 999), 1700);
	assert.equal(kcalGoalForDate(SIMPLE, '2026-09-27', 999), 1550);
	assert.equal(kcalGoalForDate(SIMPLE, '2026-09-30', 999), 1550);
	assert.equal(kcalGoalForDate(SIMPLE, '2026-10-05', 999), 1550); // tient tant qu’aucun nouveau
});

test('CAS SIMPLE : le jour de l’effet lui-même porte déjà le nouvel objectif', () => {
	// Modification faite le 27 → le 27 utilise le nouveau (jamais rétroactif avant).
	assert.equal(kcalGoalForDate(SIMPLE, '2026-09-14', 0), 1600); // la veille garde l’ancien
	assert.equal(kcalGoalForDate(SIMPLE, '2026-09-15', 0), 1700);
});

test('CAS LIMITE : historique vide → repli objectif courant (aucun faux historique inventé)', () => {
	assert.equal(kcalGoalForDate([], '2026-09-10', 1600), 1600);
	// Date antérieure à la première ligne → repli aussi (pas d’invention).
	assert.equal(kcalGoalForDate(SIMPLE, '2026-08-20', 1600), 1600);
});

test('CAS LIMITE : premier objectif créé = seule ligne → s’applique dès sa date d’effet', () => {
	const first = [{ kcal: 1800, effectiveFrom: '2026-09-27' }];
	assert.equal(kcalGoalForDate(first, '2026-09-26', 1600), 1600);
	assert.equal(kcalGoalForDate(first, '2026-09-27', 1600), 1800);
});

test('MÊME JOUR : la dernière valeur posée ce jour gagne (une seule ligne par effectiveFrom)', () => {
	// 27/09 10h → 1 700, puis 14h → correction 1 750 : l’upsert remplace la
	// ligne du jour (delete + insert) au lieu d’empiler des valeurs concurrentes.
	const sameDay = [
		{ kcal: 1600, effectiveFrom: '2026-09-01' },
		{ kcal: 1750, effectiveFrom: '2026-09-27' },
	];
	assert.equal(kcalGoalForDate(sameDay, '2026-09-27', 0), 1750);
	assert.equal(kcalGoalForDate(sameDay, '2026-09-26', 0), 1600);
	// Garde-fou mutation : upsertGoalHistoryToday supprime les lignes du même
	// effectiveFrom avant d’insérer (idempotent, pas de duplication).
	const upsert = journal.slice(journal.indexOf('async function upsertGoalHistoryToday'));
	assert.ok(upsert.includes('ctx.db.delete(row._id)'), 'upsert : remplace la ligne du même jour');
	assert.ok(upsert.includes('même valeur déjà posée aujourd’hui → no-op'.replace('’', "'")), 'upsert : no-op si valeur identique');
});

test('MÊME JOUR : kcal inchangé → AUCUNE ligne d’historique créée', () => {
	// dans setClientGoals : if (!existing || existing.kcal !== kcal)
	const guard = journal.slice(journal.indexOf('if (!existing || existing.kcal !== kcal)'), journal.indexOf('if (!existing || existing.kcal !== kcal)') + 200);
	assert.ok(guard.includes('upsertGoalHistoryToday'), 'l’historisation ne se déclenche que sur changement réel');
});

/* ── MODIFICATION AUJOURD’HUI — hier garde l’ancien, aujourd’hui le nouveau ── */

test('MODIFICATION AUJOURD’HUI : hier → ancien objectif, aujourd’hui → nouveau', () => {
	const hist = [{ kcal: 1750, effectiveFrom: '2026-09-27' }];
	const fallback = 1600; // objectif courant (clientGoals.kcal) avant la 1re ligne historisée
	assert.equal(kcalGoalForDate(hist, '2026-09-26', fallback), 1600);
	assert.equal(kcalGoalForDate(hist, '2026-09-27', fallback), 1750);
	assert.equal(kcalGoalForDate(hist, '2026-09-28', fallback), 1750);
});

test('FUSEAU : la date d’effet est la date LOCALE Europe/Paris (jamais l’horloge UTC brute)', () => {
	// setClientGoals historise à localTodayISO() — la date parisienne du serveur.
	assert.ok(journal.includes('upsertGoalHistoryToday(ctx, userId, kcal, coach._id, localTodayISO())'), 'date d’effet = date locale Paris');
});

/* ── JOURNAL — l’objectif servi est celui de la date consultée ── */

test('JOURNAL getDay : objectifs = historique résolu à la DATE CONSULTÉE', () => {
	const getDay = journal.slice(journal.indexOf('export const getDay = query'), journal.indexOf('export const getWeek = query'));
	assert.ok(/loadGoalHistory\(ctx, user(Id)?/.test(getDay), 'getDay charge l’historique');
	assert.ok(getDay.includes('kcalGoalForDate(goalHistory, date,'), 'getDay résout à la date consultée (jamais aujourd’hui)');
});

test('JOURNAL getDayForCoach : même résolution datée (vue coach)', () => {
	const getDayForCoach = journal.slice(journal.indexOf('export const getDayForCoach = query'), journal.indexOf('export const getWeek = query') > 0 ? journal.indexOf('export const getWeek = query') : undefined);
	assert.ok(getDayForCoach.includes('kcalGoalForDate(goalHistory, date,'), 'getDayForCoach : objectif de la date consultée');
});

test('JOURNAL getWeek : objectifs jour par jour (Performance — jamais un objectif unique étalé)', () => {
	const getWeek = journal.slice(journal.indexOf('export const getWeek = query'), journal.indexOf('export const getWeek = query') + 4000);
	assert.ok(getWeek.includes('loadGoalHistory'), 'getWeek charge l’historique');
	assert.ok(getWeek.includes('kcalGoalForDate(goalHistory, d,'), 'getWeek : un objectif par DATE de la semaine');
});

test('JOURNAL : calories restantes / barre dérivent de goals.kcal déjà résolu (un seul calcul)', () => {
	// Le Journal ne refait pas un calcul séparé : totals.kcal vs goals.kcal.
	assert.ok(journal.includes('goals: { ...baseGoals, kcal: dayKcal }'), 'getDay injecte l’objectif daté dans goals');
	// La page Journal client consomme goals.kcal — vérifie le câblage source.
	const journalPage = readFileSync(join(root, 'src/routes/espace/journal/+page.svelte'), 'utf8');
	assert.ok(/goals\??\.kcal/.test(journalPage), 'la page Journal utilise goals.kcal (objectif daté servi par getDay)');
});

/* ── VISION 360 — chaque journée comparée à SON objectif ── */

test('VISION 360 : la fenêtre résout un objectif PAR JOURNÉE (kcalGoalsForDates)', () => {
	const days = visionWindow('2026-09-17').days; // 10 → 16 sept : traverse le changement du 15
	const goals = kcalGoalsForDates(SIMPLE, days, 999);
	assert.equal(goals.get('2026-09-10'), 1600); // avant le changement
	assert.equal(goals.get('2026-09-15'), 1700); // jour d’effet
	assert.equal(goals.get('2026-09-16'), 1700);
	// La fenêtre ne contient JAMAIS today.
	assert.ok(!days.includes('2026-09-17'));
});

test('VISION 360 client360 : garde-fou 60 % évalué avec goalForDay (objectif de CE jour)', () => {
	const c360 = coach.slice(coach.indexOf('export const client360'), coach.indexOf('export const client360') + 40000);
	assert.ok(c360.includes('withCurrentGoal('), 'historique fusionné avec l’objectif courant (lecture)');
	assert.ok(c360.includes('const goalForDay = (date: string)'), 'résolution par journée');
	assert.ok(c360.includes('foodAverages(foodTotals, days, goalForDay)'), 'moyennes + garde-fou : objectif par jour (pas l’objectif global)');
});

test('GARDE-FOU : seuil calculé avec l’objectif HISTORIQUE du jour, pas l’objectif actuel', () => {
	// Journée avec objectif historique 1 400 → seuil 840, même si aujourd’hui 1 900.
	assert.equal(exploitabilityThresholdKcal(1400), 840);
	assert.equal(exploitabilityThresholdKcal(2000), 1200);
	// Simulation : jour J avec objectif 1 400 (historique) alors que l’objectif
	// courant est 1 900 (seuil 1 140) — le jour J doit rester évalué à 840.
	const hist = [{ kcal: 1400, effectiveFrom: '2026-09-01' }, { kcal: 1900, effectiveFrom: '2026-09-20' }];
	const goalForDay = (d) => kcalGoalForDate(hist, d, 1900);
	assert.equal(goalForDay('2026-09-10'), 1400);
	assert.equal(exploitabilityThresholdKcal(goalForDay('2026-09-10')), 840);
	assert.equal(exploitabilityThresholdKcal(goalForDay('2026-09-25')), 1140);
});

test('GARDE-FOU : journée sous le seuil de SON époque reste exclue même si l’objectif a monté', () => {
	// 720 kcal le jour où l’objectif était 1 600 (seuil 960) → partielle,
	// même si l’objectif courant est passé à 2 000 (seuil 1 200).
	const hist = [{ kcal: 1600, effectiveFrom: '2026-09-01' }, { kcal: 2000, effectiveFrom: '2026-09-25' }];
	const goalForDay = (d) => kcalGoalForDate(hist, d, 2000);
	assert.equal(exploitabilityThresholdKcal(goalForDay('2026-09-20')), 960);
	assert.ok(720 < exploitabilityThresholdKcal(goalForDay('2026-09-20')), '720 < 960 : exclue du jour concerné');
});

/* ── COCKPIT — représentation multi-objectifs (proposition documentée) ── */

test('COCKPIT : objectif affiché = celui de la dernière journée + mention plage si multi', () => {
	// Le cas ambigu est rendu EXPLICITE, pas masqué : cockpit.calories expose
	// goalChanged + distinctGoals, l’UI affiche « Objectif : X → Y le DD/MM ».
	const c360 = coach.slice(coach.indexOf('const goalChangedInWindow = hasChangeWithin'), coach.indexOf('const goalChangedInWindow = hasChangeWithin') + 5000);
	assert.ok(c360.includes('distinctGoals.length === 1 ? distinctGoals[0] : windowGoals[windowGoals.length - 1]'), 'valeur affichée : objectif de la dernière journée si plusieurs');
	assert.ok(c360.includes('goalChanged: goalChangedInWindow'), 'le changement dans la fenêtre est exposé au cockpit');
	const ui = adminPage.slice(adminPage.indexOf('cockpit.calories.goalChanged'), adminPage.indexOf('cockpit.calories.goalChanged') + 800);
	assert.ok(ui.includes('distinctGoals'), 'UI : plage multi-objectifs affichée (transparence, pas de moyenne d’objectifs inventée)');
});

/* ── withCurrentGoal — fusion lecture objectif courant ── */

test('withCurrentGoal : l’objectif courant devient effectif aujourd’hui sans créer de ligne', () => {
	// Historique posé avant la fonctionnalité : aucune ligne. L’objectif
	// courant (1 750) est réputé applicable aujourd’hui seulement.
	const merged = withCurrentGoal([], 1750, '2026-09-27');
	assert.deepEqual(merged, [{ kcal: 1750, effectiveFrom: '2026-09-27' }]);
	assert.equal(kcalGoalForDate(merged, '2026-09-26', 1600), 1600, 'hier : repli ancien objectif (pas de réécriture)');
	assert.equal(kcalGoalForDate(merged, '2026-09-27', 1600), 1750);
});

test('withCurrentGoal : aucune ligne virtuelle redondante si la dernière ligne == objectif courant', () => {
	const merged = withCurrentGoal([{ kcal: 1750, effectiveFrom: '2026-09-20' }], 1750, '2026-09-27');
	assert.equal(merged.length, 1, 'pas de doublon');
});

test('withCurrentGoal : une ligne du même jour avec une autre valeur → la ligne courante gagne', () => {
	// Cas pathologique (ligne non nettoyée) : la lecture reste déterministe.
	const merged = withCurrentGoal([{ kcal: 1600, effectiveFrom: '2026-09-27' }], 1750, '2026-09-27');
	assert.equal(kcalGoalForDate(merged, '2026-09-27', 0), 1750);
});

/* ── CAS LIMITES — mois / année / formats ── */

test('CAS LIMITE : changement de mois et d’année', () => {
	const hist = [
		{ kcal: 1600, effectiveFrom: '2025-12-15' },
		{ kcal: 1550, effectiveFrom: '2026-01-02' },
	];
	assert.equal(kcalGoalForDate(hist, '2025-12-31', 0), 1600);
	assert.equal(kcalGoalForDate(hist, '2026-01-01', 0), 1600);
	assert.equal(kcalGoalForDate(hist, '2026-01-02', 0), 1550);
	assert.equal(kcalGoalForDate(hist, '2026-03-01', 0), 1550);
});

test('CAS LIMITE : comparaison lexicale ISO = ordre chronologique (clamp de sécurité)', () => {
	// Les clés yyyy-mm-dd se comparent lexicalement : 2026-09-27 > 2026-09-9
	// ne peut pas arriver (format fixe). Garde-fou anti format invalide.
	assert.throws(() => kcalGoalForDate([{ kcal: 1, effectiveFrom: '27/09/2026' }], '2026-09-27', 0), /yyyy-mm-dd/);
	assert.throws(() => kcalGoalForDate([], '27-09-2026', 0), /yyyy-mm-dd/);
});

/* ── SÉCURITÉ DU MODÈLE — additive, rétrocompatible, seed DEMO ── */

test('MODÈLE : table clientGoalHistory additive (kcal/effectiveFrom/createdBy/createdAt)', () => {
	const table = schema.slice(schema.indexOf('clientGoalHistory'), schema.indexOf('clientGoalHistory') + 700);
	assert.ok(table.includes('kcal: v.number()'), 'kcal stocké');
	assert.ok(table.includes('effectiveFrom: v.string()'), 'date d’effet yyyy-mm-dd');
	assert.ok(table.includes('createdBy'), 'traçabilité coach');
	assert.ok(table.includes('createdAt'), 'horodatage');
	assert.ok(table.includes('by_user_from'), 'index lecture rapide par (userId, effectiveFrom)');
});

test('ANTI-RÉGRESSION : clientGoals.kcal reste la source courante (rétrocompatibilité)', () => {
	assert.ok(journal.includes('insert("clientGoals"'), 'clientGoals toujours écrit (objectif courant)');
	// Aucune écriture rétroactive : l’historique n’est JAMAIS réécrit pour les
	// dates passées (upsert uniquement à effectiveFrom = aujourd’hui).
	assert.ok(!/effectiveFrom:\s*(?!todayISO)[a-zA-Z]/.test(journal.slice(journal.indexOf('upsertGoalHistoryToday'), journal.indexOf('export const setClientGoals'))), 'historisation uniquement à todayISO');
});

test('SEED DEMO : deux objectifs datés dans l’historique (verrou anti-prod conservé)', () => {
	assert.ok(seedDemo.includes('clientGoalHistory'), 'le seed DEMO pose un historique synthétique');
	assert.ok(/effectiveFrom:\s*addDaysISO\(todayISO,\s*-14\)/.test(seedDemo), 'objectif 1 (J-14)');
	assert.ok(/effectiveFrom:\s*addDaysISO\(todayISO,\s*-3\)/.test(seedDemo), 'objectif 2 (J-3) — la fenêtre Vision 360 traverse un changement');
	assert.ok(seedDemo.includes('if (row) await db.patch(row._id, { kcal: gh.kcal });'), 'idempotent au re-seed (patch si la ligne existe)');
});

/* ── VISION 360 : le suivi de la règle de cohérence calories/protéines ── */

test('COHÉRENCE : le garde-fou daté reste UNE définition partagée calories + protéines', () => {
	// foodAverages reçoit goalForDay UNE fois : calories et protéines utilisent
	// exactement les mêmes jours exploitables, évalués avec l’objectif du jour.
	const c360 = coach.slice(coach.indexOf('const food360 = foodAverages'), coach.indexOf('const food360 = foodAverages') + 200);
	assert.ok(c360.includes('goalForDay'), 'une seule source d’objectif pour les deux moyennes');
});

/* ── PHASE 2 — BASELINE LEGACY : l’ANCIENNE valeur est historisée ──
   Cause du bug prod : setClientGoals n’historisait que la NOUVELLE valeur ;
   pour les clientes sans historique, les dates antérieures retombaient sur
   le repli « objectif courant » → hier réécrit avec le nouvel objectif. */

test('LEGACY : la mutation capture l’ANCIEN objectif à la première modification (jamais inventé)', () => {
	assert.ok(journal.includes('BASELINE LEGACY'), 'bloc baseline legacy documenté dans setClientGoals');
	assert.match(journal, /kcal: existing\.kcal/, 'valeur de la baseline = l’ancienne valeur connue juste avant le changement');
	// Ancre NON INVENTÉE : date de création de la ligne clientGoals (première trace horodatée).
	assert.ok(journal.includes('localTodayISO(new Date(existing._creationTime))'), 'ancre = _creationTime de clientGoals (aucune fausse date précise)');
	// Jamais si l’historique couvre déjà plus ancien ; idempotent (même valeur déjà posée → no-op).
	assert.match(journal, /earliestFrom === null \|\| baselineFrom < earliestFrom/, 'baseline refusée si l’historique est déjà plus ancien');
	assert.match(journal, /sameDay\.some\(\(row\) => row\.kcal === existing\.kcal\)/, 'baseline déjà posée → no-op');
	// Première définition (aucune ligne clientGoals existante) → rien à capturer.
	assert.match(journal, /if \(existing\) \{\s*const history = await loadGoalHistory/, 'baseline uniquement sur MODIFICATION (pas à la création)');
});

test('LEGACY : scénario 1600 → 1750 — hier ne récupère JAMAIS le nouvel objectif', () => {
	// Avant correctif : une seule ligne (1750 @ aujourd’hui) → hier retombait sur
	// le repli « objectif courant » (1750) = passé réécrit. Avec la baseline
	// (1600 posée à la date de création de clientGoals), hier reste à 1600 —
	// y compris avec le repli de lecture fixé à la valeur APRÈS changement.
	const hist = [
		{ kcal: 1600, effectiveFrom: '2026-08-01' }, // baseline legacy (date de création clientGoals)
		{ kcal: 1750, effectiveFrom: '2026-09-28' }, // changement du jour
	];
	const courant = 1750; // clientGoals.kcal APRÈS modification (fallback de lecture)
	assert.equal(kcalGoalForDate(hist, '2026-09-27', courant), 1600, 'hier : ancien objectif');
	assert.equal(kcalGoalForDate(hist, '2026-09-26', courant), 1600, 'avant-hier : ancien objectif');
	assert.equal(kcalGoalForDate(hist, '2026-09-28', courant), 1750, 'aujourd’hui : nouvel objectif');
	assert.equal(kcalGoalForDate(hist, '2026-09-29', courant), 1750, 'demain : nouvel objectif (effet forward)');
});

test('LEGACY : seconde modification 1750 → 1550 — les dates antérieures restent intactes', () => {
	const hist = [
		{ kcal: 1600, effectiveFrom: '2026-08-01' },
		{ kcal: 1750, effectiveFrom: '2026-09-28' },
		{ kcal: 1550, effectiveFrom: '2026-10-05' },
	];
	assert.equal(kcalGoalForDate(hist, '2026-09-27', 1550), 1600);
	assert.equal(kcalGoalForDate(hist, '2026-10-04', 1550), 1750);
	assert.equal(kcalGoalForDate(hist, '2026-10-05', 1550), 1550);
});

test('DASHBOARD (accueil) : le garde-fou 60 % du récap 7 jours utilise l’objectif PAR JOUR', () => {
	assert.match(dashboard, /import \{ kcalGoalForDate, withCurrentGoal \} from "\.\.\/lib\/goalHistory";/, 'même résolution partagée que Journal / Vision 360');
	assert.match(dashboard, /const kcalGoal360 = \(date: string\): number =>/, 'résolution fonction par date (plus un scalaire)');
	assert.match(dashboard, /kcalGoalForDate\(withCurrentGoal\(goalHistoryRows, kcalGoal, parisTodayISO\(ts\)\), date, kcalGoal\)/, 'historique fusionné avec l’objectif courant (règles Vision 360)');
	assert.match(dashboard, /foodAverages\([\s\S]*?kcalGoal360\s*\)/, 'moyennes + garde-fou : objectif applicable à CHAQUE journée');
	assert.match(dashboard, /goal: kcalGoal360\(visionEnd\)/, 'objectif affiché du récap = celui de la dernière journée de la fenêtre (J-1)');
});
