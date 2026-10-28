/**
 * Tests MISSION C3-ter-a — Phase nutritionnelle (données, validation, coach).
 *
 * 1. `phaseEffective` : absent = perte de gras, valeur inconnue ignorée ;
 * 2. `validerObjectifPhase` : les trois phases et leurs bornes exactes ;
 * 3. Schéma : `clientGoals.phase` optionnel, valeurs fermées, aucune migration ;
 * 4. `calibrage.apply` : phase dérivée de `inputs.mode` et validation partagée
 *    (un surplus n'est plus refusé comme une maintenance invalide) ;
 * 5. `setClientGoals` + action `setGoals` : la phase est acceptée ;
 * 6. Formulaire coach : sélecteur de phase, aide dépendante, plus d'« Doit
 *    rester > l'objectif » ;
 * 7. Badge de phase dans l'en-tête Vision 360 ;
 * 8. Surplus 0 à 20 %, avertissement au-delà de 15 % ;
 * 9. Lectures exposant la phase (journal, dashboard).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	PHASES,
	PHASE_LIBELLES,
	phaseDepuisMode,
	phaseEffective,
	validerObjectifPhase,
	TOLERANCE_MAINTENANCE_PCT,
	SURPLUS_MAX_PCT
} from '../src/lib/phase.ts';
import * as cal from '../src/lib/calibrage.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const adminPage = read('src/routes/admin/+page.svelte');
const adminServer = read('src/routes/admin/+page.server.ts');
const convexCalibrage = read('src/convex/calibrage.ts');
const convexJournal = read('src/convex/journal.ts');
const convexDashboard = read('src/convex/dashboard.ts');
const schema = read('src/convex/schema.ts');

/* ─── 1) Phase effective ─── */

test('phaseEffective : absent = perte de gras, valeur connue conservée', () => {
	assert.equal(phaseEffective(undefined), 'perte_gras');
	assert.equal(phaseEffective(null), 'perte_gras');
	assert.equal(phaseEffective({}), 'perte_gras');
	assert.equal(phaseEffective({ phase: null }), 'perte_gras');
	assert.equal(phaseEffective({ phase: 'perte_gras' }), 'perte_gras');
	assert.equal(phaseEffective({ phase: 'maintenance' }), 'maintenance');
	assert.equal(phaseEffective({ phase: 'surplus' }), 'surplus');
	// Valeur inconnue d'une donnée ancienne : jamais de crash, repli sûr.
	assert.equal(phaseEffective({ phase: 'prise_de_masse' }), 'perte_gras');
	assert.deepEqual([...PHASES], ['perte_gras', 'maintenance', 'surplus']);
	assert.equal(PHASE_LIBELLES.perte_gras, 'Perte de gras');
	assert.equal(PHASE_LIBELLES.maintenance, 'Maintenance');
	assert.equal(PHASE_LIBELLES.surplus, 'Surplus');
});

test('phaseDepuisMode : déficit → perte de gras', () => {
	assert.equal(phaseDepuisMode('deficit'), 'perte_gras');
	assert.equal(phaseDepuisMode(undefined), 'perte_gras');
	assert.equal(phaseDepuisMode('maintenance'), 'maintenance');
	assert.equal(phaseDepuisMode('surplus'), 'surplus');
});

/* ─── 2) Validation objectif / phase ─── */

test('perte de gras : objectif inférieur ou égal à la maintenance (R6-fix)', () => {
	assert.equal(validerObjectifPhase('perte_gras', 1700, 2000), null);
	assert.equal(validerObjectifPhase('perte_gras', 1999, 2000), null);
	// R6-fix : l'ÉGALITÉ est acceptée — ancienne règle de production (≤).
	assert.equal(validerObjectifPhase('perte_gras', 2000, 2000), null);
	const auDessus = validerObjectifPhase('perte_gras', 2100, 2000);
	assert.match(auDessus, /inférieur ou égal à la maintenance \(2000 kcal\)/);
});

test('maintenance : objectif à ±5 % de la maintenance', () => {
	assert.equal(TOLERANCE_MAINTENANCE_PCT, 5);
	assert.equal(validerObjectifPhase('maintenance', 2000, 2000), null);
	assert.equal(validerObjectifPhase('maintenance', 1900, 2000), null, 'borne basse incluse');
	assert.equal(validerObjectifPhase('maintenance', 2100, 2000), null, 'borne haute incluse');
	const tropBas = validerObjectifPhase('maintenance', 1899, 2000);
	assert.match(tropBas, /Maintenance/);
	assert.match(tropBas, /entre 1900 et 2100 kcal/);
	const tropHaut = validerObjectifPhase('maintenance', 2101, 2000);
	assert.match(tropHaut, /entre 1900 et 2100 kcal/);
});

test('surplus : au-dessus de la maintenance, au plus +20 %', () => {
	assert.equal(SURPLUS_MAX_PCT, 20);
	assert.equal(validerObjectifPhase('surplus', 2001, 2000), null);
	assert.equal(validerObjectifPhase('surplus', 2200, 2000), null);
	assert.equal(validerObjectifPhase('surplus', 2400, 2000), null, 'borne haute incluse');
	const pasAssez = validerObjectifPhase('surplus', 2000, 2000);
	assert.match(pasAssez, /Surplus/);
	assert.match(pasAssez, /supérieur à la maintenance/);
	const trop = validerObjectifPhase('surplus', 2401, 2000);
	assert.match(trop, /au plus 20 % au-dessus de la maintenance \(2400 kcal maximum\)/);
});

test('validation sans maintenance (facultative) : aucune contrainte inventée', () => {
	assert.equal(validerObjectifPhase('perte_gras', 3000, null), null);
	assert.equal(validerObjectifPhase('maintenance', 3000, undefined), null);
	assert.equal(validerObjectifPhase('surplus', 1000, null), null);
	// Entrées non finies : refus explicite, jamais de NaN silencieux.
	assert.match(validerObjectifPhase('perte_gras', Number.NaN, 2000), /invalide/);
	assert.match(validerObjectifPhase('perte_gras', 1800, Number.NaN), /Maintenance invalide/);
	// Phase inconnue (appel direct hors typage) : refus explicite.
	assert.match(validerObjectifPhase('autre', 1800, 2000), /Phase inconnue/);
});

/* ─── 3) Schéma ─── */

test('schéma : clientGoals.phase optionnel et fermé (aucune migration)', () => {
	const zone = schema.slice(
		schema.indexOf('clientGoals: defineTable'),
		schema.indexOf('clientGoalHistory: defineTable')
	);
	assert.ok(zone.includes('phase: v.optional('), 'phase optionnel');
	assert.match(
		zone,
		/v\.literal\("perte_gras"\), v\.literal\("maintenance"\), v\.literal\("surplus"\)/,
		'trois phases fermées'
	);
	assert.ok(!zone.includes('phase: v.string()'), 'jamais une chaîne libre');
});

/* ─── 4) calibrage.apply ─── */

test('calibrage.apply : phase dérivée de inputs.mode et validation partagée', () => {
	assert.ok(
		convexCalibrage.includes('phaseDepuisMode(entrees.mode)'),
		'phase dérivée du mode du calibrage'
	);
	assert.match(
		convexCalibrage,
		/const p: Partial<Doc<"clientGoals">> = \{ kcal, carbs, protein, fat, phase \}/,
		'la phase est écrite avec les objectifs'
	);
	assert.match(
		convexCalibrage,
		/validerObjectifPhase\(phase, kcal, maintenanceKcal\)/,
		'règle partagée côté mutation'
	);
	// L'ancien blocage « maintenance > objectif » (qui refusait tout surplus) a disparu.
	assert.ok(
		!convexCalibrage.includes("Maintenance invalide : elle doit être supérieure à l'objectif calorique"),
		'un surplus n’est plus refusé comme une maintenance invalide'
	);
	assert.ok(convexCalibrage.includes('import { phaseDepuisMode, validerObjectifPhase }'), 'helper importé');
});

/* ─── 5) setClientGoals + action ─── */

test('setClientGoals : la phase est acceptée et validée par le même helper', () => {
	assert.match(
		convexJournal,
		/phase: v\.optional\(v\.union\(v\.literal\("perte_gras"\), v\.literal\("maintenance"\), v\.literal\("surplus"\)\)\)/,
		'argument phase fermé'
	);
	assert.ok(convexJournal.includes('validerObjectifPhase(phaseCible, kcal, maintenanceEffective)'));
	assert.ok(convexJournal.includes('if (phase !== undefined) p.phase = phase;'), 'phase écrite');
	assert.ok(
		!convexJournal.includes("Maintenance invalide : elle doit être supérieure à l'objectif calorique"),
		'ancien blocage retiré'
	);
	// `existing` est lu avant la validation, une seule fois dans setClientGoals.
	const zone = convexJournal.slice(
		convexJournal.indexOf('export const setClientGoals'),
		convexJournal.indexOf('BASELINE LEGACY')
	);
	assert.equal(
		(zone.match(/const existing = await ctx\.db/g) ?? []).length,
		1,
		'une seule lecture de clientGoals'
	);
});

test('action setGoals : transmet la phase au serveur', () => {
	const zone = adminServer.slice(
		adminServer.indexOf('setGoals: async'),
		adminServer.indexOf('googleDisconnect: async')
	);
	assert.match(zone, /const rawPhase = String\(form\.get\('phase'\)/);
	assert.ok(zone.includes('perte_gras') && zone.includes('maintenance') && zone.includes('surplus'));
	assert.match(zone, /\bphase,\s*\n\s*\}\);/, 'phase transmise à la mutation');
});

/* ─── 6) Formulaire coach ─── */

test('formulaire objectifs : sélecteur de phase et aide dépendante', () => {
	for (const id of PHASES) {
		assert.ok(adminPage.includes(`PHASE_LIBELLES.${id}`), `libellé du bouton ${id}`);
	}
	assert.ok(adminPage.includes('name="phase"'), 'champ phase envoyé au serveur');
	assert.ok(adminPage.includes('Phase nutritionnelle'), 'sélecteur libellé');
	assert.ok(adminPage.includes('{#each PHASES_FORM as phase (phase.id)}'), 'trois boutons');
	assert.ok(
		!adminPage.includes("Doit rester &gt; l'objectif") && !adminPage.includes("Doit rester > l'objectif"),
		'ancienne aide remplacée'
	);
	assert.ok(adminPage.includes('Laisse vide pour désactiver'), 'aide de maintenance conservée');
	assert.match(adminPage, /goalsPhaseAide/, 'aide dépendant de la phase');
	assert.ok(
		adminPage.includes("L'objectif doit rester inférieur à la maintenance.")
	);
	assert.ok(adminPage.includes("L'objectif doit rester à ±5 % de la maintenance."));
	assert.ok(adminPage.includes("L'objectif doit rester supérieur à la maintenance, sans dépasser +20 %."));
	// La cohérence de saisie est revalidée avant l'envoi (même helper).
	assert.ok(adminPage.includes('validerObjectifPhase('));
});

/* ─── 7) Badge Vision 360 ─── */

test('Vision 360 : badge de phase à côté du badge Autonomie', () => {
	assert.ok(adminPage.includes('const phaseClient = $derived(phaseEffective('), 'phase dérivée');
	assert.ok(adminPage.includes('{phaseClientLibelle}'), 'badge affiché');
	assert.ok(adminPage.includes('{phaseClientCls}'), 'style des badges existants');
	const badgeAutonomie = adminPage.lastIndexOf('>Autonomie</span>');
	const zone = adminPage.slice(badgeAutonomie, badgeAutonomie + 700);
	assert.ok(zone.includes('{phaseClientLibelle}'), 'badge juste après Autonomie');
});

/* ─── 8) Surplus 0 à 20 %, alerte au-delà de 15 % ─── */

test('surplus : bornes 0 à 20, avertissement au-delà de 15 %', () => {
	assert.equal(cal.BORNES.surplusPct.min, 0);
	assert.equal(cal.BORNES.surplusPct.max, 20);
	assert.equal(cal.BORNES.surplusPct.label, '0 à 20 %');
	assert.equal(cal.SURPLUS_PCT_ATTENTION, 15);
	assert.equal(
		cal.SURPLUS_AVERTISSEMENT,
		'Surplus élevé : prise de gras probable, à réserver à un cas précis.'
	);
	// 15 % : aucun message ; au-delà : message ; au-delà de 20 % : refus module.
	assert.equal(cal.bilanObjectifSemaine({ budgetSemaineKcal: 10_000, mode: 'surplus', surplusPct: 15 }).avertissementSurplusEleve, null);
	assert.equal(
		cal.bilanObjectifSemaine({ budgetSemaineKcal: 10_000, mode: 'surplus', surplusPct: 18 }).avertissementSurplusEleve,
		cal.SURPLUS_AVERTISSEMENT
	);
	assert.equal(cal.objectifSemaineKcal({ budgetSemaineKcal: 10_000, mode: 'surplus', surplusPct: 20 }), 12_000);
	assert.throws(
		() => cal.objectifSemaineKcal({ budgetSemaineKcal: 10_000, mode: 'surplus', surplusPct: 21 }),
		/0 à 20 %/
	);
	// Écran : borne UI et message alignés sur le module.
	assert.ok(adminPage.includes('max="20"'), 'champ surplus borné à 20 %');
	assert.ok(adminPage.includes("'Maximum 20 %'"), 'erreur UI au-delà de 20 %');
	assert.ok(adminPage.includes('calSurplusPct > 15'), 'alerte au-delà de 15 %');
	assert.ok(
		adminPage.includes('Surplus élevé : prise de gras probable, à réserver à un cas précis.'),
		'message d’alerte affiché'
	);
	assert.ok(adminPage.includes('max="30"'), 'déficit inchangé');
});

/* ─── 9) Lectures ─── */

test('lectures existantes : la phase est exposée sans changer l’affichage', () => {
	const zoneJournal = convexJournal.slice(
		convexJournal.indexOf('kcalGoalsByDate') - 900,
		convexJournal.indexOf('kcalGoalsByDate')
	);
	assert.ok(zoneJournal.includes('phase: phaseEffective(g)'), 'résumé hebdo du journal');
	assert.match(convexDashboard, /const phase = phaseEffective\(goalsRow\)/);
	assert.match(convexDashboard, /tracking: \{ kcal, kcalGoal, maintenanceKcal, phase \}/);
});
