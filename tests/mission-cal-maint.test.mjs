/**
 * Mission CAL-maint — la maintenance SAISIE dans le bloc « Appliquer à la
 * fiche » pilote l'encadré « Impact de l'objectif appliqué » et le bandeau de
 * synthèse (maintenance totale, déficit, perte de graisse).
 *
 * - maintenance saisie valide (ex. 3 100) → déficit réel et perte calculés sur
 *   cette maintenance, maintenance du bandeau = 3 100 ;
 * - champ vidé ou invalide → retour à la maintenance calculée (budget ÷ 7) ;
 * - disponibilité en énergie et plafonds Alpert/Macdonald inchangés : mêmes
 *   fonctions du module, aucune formule nouvelle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { impactObjectifApplique, resultatsFiche } from '../src/lib/calibrageFiche.ts';

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

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

const R = resultatsFiche(ENTREES);
const impact = (objectifKcal, maintenanceTotaleKcal) =>
	impactObjectifApplique({ entrees: ENTREES, resultats: R, objectifKcal, maintenanceTotaleKcal });

/* ─── 1 · Maintenance saisie : elle pilote déficit, perte et bandeau ─── */

test('IMPACT : maintenance saisie 3 100 + objectif 2 458 → déficit réel ≈ 20,7 % et maintenance du bandeau = 3 100', () => {
	const i = impact(2458, 3100);
	assert.equal(i.objectifKcal, 2458, 'objectif appliqué conservé');
	assert.equal(i.maintenanceTotaleKcal, 3100, 'bandeau : maintenance saisie (sport inclus)');
	assert.equal(i.budgetSemaineKcal, 3100 * 7, 'budget de la semaine = maintenance × 7');
	// (3 100 − 2 458) × 7 = 4 494 kcal de déficit hebdomadaire.
	assert.equal(i.deficitSemaineKcal, 4494, 'déficit hebdomadaire sur la maintenance saisie');
	assert.equal(i.deficitPct, 20.7, 'déficit réel en % de la maintenance saisie');
	assert.equal(i.perteGraisseKg, 0.58, 'perte de graisse = déficit ÷ 7 700 kcal/kg');
});

/* ─── 2 · Champ vidé ou invalide : maintenance calculée ─── */

test('IMPACT : sans maintenance saisie, la maintenance calculée (budget ÷ 7) reprend — aucune régression', () => {
	const calculee = impact(2458);
	assert.equal(calculee.maintenanceTotaleKcal, R.maintenanceFiletKcal, 'maintenance du bandeau = budget ÷ 7');
	assert.equal(calculee.budgetSemaineKcal, R.budgetSemaineKcal, 'budget inchangé');
	// Déficit de la semaine type = budget − 7 × objectif (formule existante).
	assert.ok(
		Math.abs(calculee.deficitSemaineKcal - (R.budgetSemaineKcal - 2458 * 7)) < 0.5,
		'déficit de la semaine type (formule existante)'
	);
	assert.equal(
		calculee.deficitPct,
		Math.round((calculee.deficitSemaineKcal / R.budgetSemaineKcal) * 100 * 10) / 10,
		'déficit en % de la maintenance calculée'
	);
	assert.notEqual(calculee.maintenanceTotaleKcal, 3100, 'la saisie 3 100 ne fuit pas hors de l’encadré');
	// Champ vidé / valeur invalide (NaN, 0, négative) : même résultat que l'absence.
	for (const invalide of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
		const i = impact(2458, invalide);
		assert.equal(i.maintenanceTotaleKcal, calculee.maintenanceTotaleKcal, `valeur ${invalide} ignorée`);
		assert.equal(i.deficitPct, calculee.deficitPct, `déficit inchangé pour ${invalide}`);
		assert.equal(i.perteGraisseKg, calculee.perteGraisseKg, `perte inchangée pour ${invalide}`);
	}
});

/* ─── 3 · Disponibilité en énergie et plafonds : identiques ─── */

test('IMPACT : disponibilité en énergie et plafonds Alpert/Macdonald identiques avec ou sans maintenance saisie', () => {
	const avec = impact(2458, 3100);
	const sans = impact(2458);
	assert.equal(avec.disponibiliteKcal, sans.disponibiliteKcal, 'disponibilité inchangée');
	assert.equal(avec.niveauDisponibilite, sans.niveauDisponibilite, 'niveau inchangé');
	assert.deepEqual(avec.seuilsDisponibiliteKcal, sans.seuilsDisponibiliteKcal, 'seuils inchangés');
	assert.equal(avec.vitesseMaxAlpertKgSemaine, sans.vitesseMaxAlpertKgSemaine, 'plafond Alpert inchangé');
	assert.equal(avec.vitesseMaxMacdonaldKgSemaine, sans.vitesseMaxMacdonaldKgSemaine, 'plafond Macdonald inchangé');
});

/* ─── 4 · Câblage UI : le bloc « Appliquer » transmet la maintenance saisie ─── */

test('UI : l’encadré d’impact et le bandeau reçoivent la maintenance saisie, vide/invalide → calculée', () => {
	const adminPage = source('src/routes/admin/+page.svelte');
	assert.ok(adminPage.includes('const applyMaintenanceKcal = $derived.by'), 'maintenance saisie dérivée');
	assert.ok(adminPage.includes("if (brut === '') return undefined;"), 'champ vidé → maintenance calculée');
	assert.ok(adminPage.includes('return Number.isFinite(valeur) && valeur > 0 ? valeur : undefined;'), 'valeur invalide → calculée');
	assert.ok(adminPage.includes('maintenanceTotaleKcal: applyMaintenanceKcal'), 'impact alimenté par la maintenance saisie');
	assert.ok(
		adminPage.includes("{calImpact.maintenanceTotaleKcal.toLocaleString('fr-FR')}"),
		'bandeau : maintenance totale = valeur de l’impact'
	);
	assert.ok(
		adminPage.includes('{decimalFr(calImpact.deficitPct)} %'),
		'bandeau : déficit = valeur de l’impact'
	);
});
