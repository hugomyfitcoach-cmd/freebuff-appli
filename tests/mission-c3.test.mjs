/**
 * Tests MISSION C3 — Calibrage : phases maintenance et surplus.
 *
 * 1. Le mode déficit (défaut) donne EXACTEMENT les mêmes résultats qu'avant ;
 * 2. Maintenance → objectif = maintenance totale, « Poids stable » ;
 * 3. Surplus 5 % → objectif = maintenance totale × 1,05, macros cohérentes
 *    (4G + 4P + 9L) et prise estimée = surplus hebdomadaire ÷ 7 700 ;
 * 4. Surplus 16 % refusé côté serveur (bornes du module + validateur strict) ;
 * 5. Aucune perte de graisse ni plafond Alpert/Macdonald en surplus ;
 * 6. Un instantané antérieur (sans mode) est lu comme « déficit ».
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as cal from '../src/lib/calibrage.ts';
import { resultatsFiche, impactObjectifApplique, DEFICIT_PCT_DEFAUT } from '../src/lib/calibrageFiche.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const adminPage = read('src/routes/admin/+page.svelte');
const convexSource = read('src/convex/calibrage.ts');

const ENTREES = {
	poidsKg: 60,
	mgPct: 26,
	pasMoyen: 0,
	heuresTravail: 0,
	adaptationPct: 0,
	deficitPct: 12,
	seances: [],
	apportsSemaine: [null, null, null, null, null, null, null]
};

/** Budget de la semaine du profil de référence (sans sport). */
const BUDGET = cal.budgetSemaineKcal({
	maintenanceSansExercice: cal.profilCalibrage({
		poidsKg: ENTREES.poidsKg,
		mgPct: ENTREES.mgPct,
		coefficient: cal.coefficientTotal({ pas: ENTREES.pasMoyen, heuresTravail: ENTREES.heuresTravail })
	}).maintenanceKcal,
	sportSemaineKcal: 0
});

/* ─── 1) Mode déficit inchangé ─── */

test('déficit (défaut) : mêmes résultats qu’avant, aucune régression', () => {
	const sans = resultatsFiche(ENTREES);
	const explicite = resultatsFiche({ ...ENTREES, mode: 'deficit' });
	for (const champ of [
		'budgetSemaineKcal',
		'deficitPct',
		'deficitSemaineKcal',
		'objectifSemaineKcal',
		'objectifJournalierKcal',
		'perteGraisseKg'
	]) {
		assert.equal(explicite[champ], sans[champ], `déficit explicite = défaut (${champ})`);
	}
	assert.equal(sans.mode, 'deficit', 'mode par défaut');
	assert.equal(sans.surplusPct, 0);
	assert.equal(sans.priseGraisseKg, 0);
	// Repères historiques du module (aucune formule modifiée).
	assert.equal(cal.objectifSemaineKcal({ budgetSemaineKcal: 11_487, deficitPct: 20 }), 9_190);
	assert.equal(cal.objectifSemaineKcal({ budgetSemaineKcal: 11_487, deficitPct: 30 }), 8_041);
	assert.equal(sans.objectifSemaineKcal, Math.round(BUDGET * (1 - DEFICIT_PCT_DEFAUT / 100)));
	assert.ok(sans.alertePlafonds === null || typeof sans.alertePlafonds === 'string');
});

/* ─── 2) Maintenance ─── */

test('maintenance : objectif = maintenance totale, poids stable', () => {
	const r = resultatsFiche({ ...ENTREES, mode: 'maintenance' });
	assert.equal(r.mode, 'maintenance');
	assert.equal(r.deficitPct, 0, 'aucun déficit en maintenance');
	assert.equal(r.objectifSemaineKcal, Math.round(BUDGET), 'objectif = budget de la semaine');
	assert.equal(Math.round(r.objectifSemaineKcal / cal.JOURS_SEMAINE), Math.round(BUDGET / cal.JOURS_SEMAINE), 'objectif/jour = maintenance totale');
	assert.equal(r.deficitSemaineKcal, 0);
	assert.equal(r.perteGraisseKg, 0);
	assert.equal(r.priseGraisseKg, 0);
	assert.equal(r.alertePlafonds, null, 'plafonds masqués');
	// Bilan unitaire : maintenance sans pourcentage.
	const bilan = cal.bilanObjectifSemaine({ budgetSemaineKcal: 12_327, mode: 'maintenance' });
	assert.equal(bilan.objectifSemaineKcal, 12_327);
	assert.equal(bilan.avertissementDeficitEleve, null);
	assert.equal(bilan.avertissementSurplusEleve, null);
});

/* ─── 3) Surplus 5 % ─── */

test('surplus 5 % : objectif, macros et prise estimée', () => {
	const r = resultatsFiche({ ...ENTREES, mode: 'surplus', surplusPct: 5 });
	assert.equal(r.mode, 'surplus');
	assert.equal(r.surplusPct, 5);
	assert.equal(r.deficitPct, 0, 'aucun déficit en surplus');
	assert.equal(r.objectifSemaineKcal, Math.round(BUDGET * 1.05), 'objectif = maintenance × 1,05');
	// Surplus hebdomadaire = objectif − budget ; prise = surplus ÷ 7 700.
	const surplusSemaine = r.objectifSemaineKcal - Math.round(BUDGET);
	assert.equal(r.deficitSemaineKcal, -surplusSemaine, 'déficit négatif = surplus');
	assert.equal(
		r.priseGraisseKg,
		Math.round((-r.deficitSemaineKcal / cal.KCAL_PAR_KG_GRAISSE) * 100) / 100,
		'prise estimée = surplus hebdo ÷ 7 700'
	);
	assert.ok(r.priseGraisseKg > 0);
	assert.equal(r.perteGraisseKg, -r.priseGraisseKg, 'perte négative = prise');
	// Macros cohérentes : objectif appliqué = 4G + 4P + 9L.
	assert.equal(
		r.macros.kcalApplique,
		4 * r.macros.glucidesG + 4 * r.macros.proteinesG + 9 * r.macros.lipidesG,
		'macros cohérentes'
	);
	assert.equal(r.objectifJournalierKcal, r.macros.kcalApplique);
	// Repère unitaire : 10 000 kcal de budget à +5 % → 10 500 kcal.
	assert.equal(cal.objectifSemaineKcal({ budgetSemaineKcal: 10_000, mode: 'surplus', surplusPct: 5 }), 10_500);
});

test('surplus élevé : message neutre au-delà de 15 %, refus au-delà de 20 %', () => {
	const doux = cal.bilanObjectifSemaine({ budgetSemaineKcal: 10_000, mode: 'surplus', surplusPct: 10 });
	assert.equal(doux.avertissementSurplusEleve, null, '10 % sans message');
	const haut = cal.bilanObjectifSemaine({ budgetSemaineKcal: 10_000, mode: 'surplus', surplusPct: 18 });
	assert.equal(
		haut.avertissementSurplusEleve,
		'Surplus élevé : prise de gras probable, à réserver à un cas précis.'
	);
	// Refus au-delà de 20 % (bornes du module).
	assert.throws(
		() => cal.objectifSemaineKcal({ budgetSemaineKcal: 10_000, mode: 'surplus', surplusPct: 21 }),
		/0 à 20 %/
	);
	assert.throws(() => resultatsFiche({ ...ENTREES, mode: 'surplus', surplusPct: 21 }), /0 à 20 %/);
	// Phase inconnue : refus explicite, jamais un mode deviné.
	assert.throws(() => cal.modePhase('prise'), /Phase inconnue/);
});

/* ─── 4) Serveur : validateur strict + recalcul ─── */

test('serveur : mode et surplusPct acceptés (facultatifs), recalcul depuis les entrées', () => {
	const args = convexSource.slice(
		convexSource.indexOf('const entreesValidator'),
		convexSource.indexOf('export const fiche')
	);
	assert.match(args, /mode: v\.optional\(/, 'mode facultatif accepté');
	assert.match(args, /surplusPct: v\.optional\(v\.number\(\)\)/, 'surplusPct facultatif accepté');
	assert.match(args, /v\.literal\("deficit"\), v\.literal\("maintenance"\), v\.literal\("surplus"\)/, 'phases fermées');
	assert.ok(
		convexSource.includes('resultatsFiche(entrees)'),
		'recalcul côté serveur depuis les entrées validées'
	);
	assert.equal(cal.BORNES.surplusPct.max, 20, 'borne haute partagée');
	assert.equal(cal.BORNES.surplusPct.min, 0, 'borne basse partagée');
	// 21 % refusé par le module que le serveur appelle.
	assert.throws(() => resultatsFiche({ ...ENTREES, mode: 'surplus', surplusPct: 21 }), /20/);
});

/* ─── 5) Aucune perte ni plafond en surplus ─── */

test('surplus : ni perte de graisse ni plafonds Alpert/Macdonald', () => {
	const r = resultatsFiche({ ...ENTREES, mode: 'surplus', surplusPct: 5 });
	assert.equal(r.alertePlafonds, null, 'aucun avertissement de plafond');
	assert.ok(r.priseGraisseKg > 0, 'prise affichée');
	// L'impact de l'objectif appliqué reste cohérent en surplus.
	const i = impactObjectifApplique({
		entrees: { ...ENTREES, mode: 'surplus', surplusPct: 5 },
		resultats: r,
		objectifKcal: r.objectifJournalierKcal
	});
	assert.equal(i.mode, 'surplus');
	assert.equal(i.alertePlafonds, null);
	assert.equal(i.depasseAlpert, false);
	assert.equal(i.depasseMacdonald, false);
	assert.ok(i.priseGraisseKg > 0);
});

/* ─── 6) Instantané antérieur sans mode ─── */

test('un instantané sans mode est lu comme « déficit »', () => {
	assert.equal(cal.modePhase(undefined), 'deficit');
	assert.equal(cal.modePhase(null), 'deficit');
	assert.equal(cal.modePhase(''), 'deficit');
	// Le serveur expose mode null pour ces instantanés (l'UI retombe sur « Déficit »).
	assert.ok(
		convexSource.includes('mode: typeof i.mode === "string" ? i.mode : null'),
		'instantané sans mode → null'
	);
	// Résultats identiques avec ou sans le champ.
	const legacy = resultatsFiche(ENTREES);
	assert.equal(legacy.mode, 'deficit');
	assert.equal(legacy.objectifSemaineKcal, Math.round(BUDGET * (1 - DEFICIT_PCT_DEFAUT / 100)));
});

/* ─── 7) Écran : ajustement, libellés de phase ─── */

test('Calibrage : bloc « Ajustement » et libellés de phase', () => {
	assert.ok(adminPage.includes('>Ajustement</span>'), 'bloc Ajustement');
	for (const libelle of ['Déficit', 'Maintenance', 'Surplus']) {
		assert.ok(adminPage.includes(`label: '${libelle}'`), `bouton ${libelle}`);
	}
	assert.ok(adminPage.includes('max="20"'), 'surplus borné à 20 %');
	assert.ok(adminPage.includes('max="30"'), 'déficit borné à 30 %');
	assert.ok(adminPage.includes('Poids stable'), 'maintenance : poids stable');
	assert.ok(adminPage.includes('Prise de poids estimée'), 'surplus : prise estimée');
	assert.ok(
		adminPage.includes('Estimation : une partie peut être du muscle, du glycogène'),
		'note d’estimation en surplus'
	);
	assert.ok(
		adminPage.includes('Surplus élevé : prise de gras probable, à réserver à un cas précis.'),
		'message neutre au-delà de 15 %'
	);
	assert.ok(adminPage.includes('Surplus +${decimalFr(d.surplusPct ?? 0)} %'), 'historique : « Surplus +X % »');
	assert.ok(adminPage.includes("'Maintenance'"), 'historique : « Maintenance »');
	// Les plafonds ne sont rendus que dans la branche déficit.
	assert.match(
		adminPage,
		/\{:else\}\s*<div class="text-\[10px\][^>]*>Perte de graisse estimée<\/div>[\s\S]*?plafonds Alpert/,
		'plafonds dans la seule branche déficit'
	);
});
