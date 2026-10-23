/**
 * Mission C2c-5b — CALIBRAGE : la semaine type devient un simulateur
 * INDÉPENDANT du bloc « Appliquer à la fiche » (annule C2c-1 point 2).
 *
 * Vérifié :
 *  1. un jour saisi à +200 kcal reste à +200 quand l'objectif calculé change ;
 *  2. « Tous à l'objectif » remet les écarts à 0 (tous les jours à l'objectif) ;
 *  3. le déficit de la semaine est calculé sur les valeurs AFFICHÉES ;
 *  4. `semaineAvecEcarts` avec des écarts nuls = semaine à l'objectif calculé ;
 *  5. la page n'utilise plus `applyKcal` pour la semaine type.
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
const adminPage = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');

/* Profil de référence, jours « type » (tous à l'objectif calculé). */
const ENTREES = {
	poidsKg: 56.6,
	mgPct: 26,
	pasMoyen: 8000,
	heuresTravail: 2,
	ajustementTravail: 0,
	adaptationPct: 0,
	deficitPct: 12,
	proteinesParKgMasseMaigre: 2.3,
	seances: [{ activiteId: 'musculation', seancesParSemaine: 2, dureeMinutes: 45, choix: 'moderee' }],
	apportsSemaine: [null, null, null, null, null, null, null]
};
const R = fiche.resultatsFiche(ENTREES);
/* Second scénario : le déficit choisi change → l'objectif CALCULÉ change. */
const ENTREES_AUTRE = { ...ENTREES, deficitPct: 20 };
const R_AUTRE = fiche.resultatsFiche(ENTREES_AUTRE);

const ECARTS_NULS = [0, 0, 0, 0, 0, 0, 0];

/* ═══════════ 1 · Un écart saisi est indépendant de l'objectif calculé ═══════════ */

test('JOUR À +200 : l’écart reste +200 quand l’objectif calculé change', () => {
	assert.notEqual(
		R_AUTRE.objectifJournalierKcal,
		R.objectifJournalierKcal,
		'les deux scénarios ont bien des objectifs calculés différents'
	);
	const ecarts = [200, 0, 0, 0, 0, 0, -150];
	const semaineA = fiche.semaineAvecEcarts(ENTREES, R, ecarts);
	const semaineB = fiche.semaineAvecEcarts(ENTREES_AUTRE, R_AUTRE, ecarts);

	assert.equal(semaineA.apportsKcal[0], R.objectifJournalierKcal + 200);
	assert.equal(semaineB.apportsKcal[0], R_AUTRE.objectifJournalierKcal + 200);
	assert.equal(semaineA.apportsKcal[0] - R.objectifJournalierKcal, 200, 'écart inchangé, scénario 1');
	assert.equal(semaineB.apportsKcal[0] - R_AUTRE.objectifJournalierKcal, 200, 'écart inchangé, scénario 2');
	assert.equal(semaineA.apportsKcal[6] - R.objectifJournalierKcal, -150, 'écart négatif conservé');
	/* Les jours sans écart restent, eux, à l'objectif calculé du scénario. */
	assert.equal(semaineB.apportsKcal[3], R_AUTRE.objectifJournalierKcal);
});

/* ═══════════ 2 · « Tous à l'objectif » remet les écarts à 0 ═══════════ */

test('BOUTON « Tous à l’objectif » : écarts remis à 0, tous les jours à l’objectif', () => {
	const handler = adminPage.slice(
		adminPage.indexOf('function semaineVersObjectif'),
		adminPage.indexOf("/* ── « Appliquer à la fiche »")
	);
	assert.ok(handler.includes('ecartsSemaine = [0, 0, 0, 0, 0, 0, 0];'), 'écarts remis à 0');
	assert.ok(!handler.includes('apportsSemaine'), 'le bouton ne réécrit plus directement les entrées');
	assert.ok(adminPage.includes('onclick={semaineVersObjectif}'), 'bouton câblé');

	const semaine = fiche.semaineAvecEcarts(ENTREES, R, ECARTS_NULS);
	assert.deepEqual(semaine.apportsKcal, Array(7).fill(R.objectifJournalierKcal));
});

/* ═══════════ 3 · Déficit calculé sur les valeurs affichées ═══════════ */

test('DÉFICIT : calculé sur les valeurs affichées, pas sur l’objectif seul', () => {
	const ecarts = [200, -100, 0, 300, 0, -200, 50];
	const semaine = fiche.semaineAvecEcarts(ENTREES, R, ecarts);
	const attendu = cal.bilanSemaine({
		jours: semaine.apportsKcal.map((apportKcal) => ({
			apportKcal,
			exerciceKcal: R.exerciceJournalierKcal
		})),
		maintenance: R.maintenanceKcal,
		masseMaigreKg: cal.masseMaigreBrute(ENTREES.poidsKg, ENTREES.mgPct)
	});
	assert.deepEqual(semaine.apportsKcal, [
		R.objectifJournalierKcal + 200,
		R.objectifJournalierKcal - 100,
		R.objectifJournalierKcal,
		R.objectifJournalierKcal + 300,
		R.objectifJournalierKcal,
		R.objectifJournalierKcal - 200,
		R.objectifJournalierKcal + 50
	]);
	assert.equal(semaine.deficitSemaineKcal, attendu.deficitSemaineKcal, 'déficit = bilan des jours affichés');
	assert.equal(semaine.graisseKg, attendu.graisseKg);
	/* Somme des écarts = 250 kcal : le déficit se déplace d'autant. */
	const totalEcarts = ecarts.reduce((somme, ecart) => somme + ecart, 0);
	assert.equal(
		semaine.deficitSemaineKcal,
		R.semaine.deficitSemaineKcal + totalEcarts,
		'le déficit suit la somme des écarts affichés'
	);
});

/* ═══════════ 4 · Écarts nuls = semaine à l'objectif calculé ═══════════ */

test('ÉCARTS NULS : semaineAvecEcarts = semaine à l’objectif calculé', () => {
	const semaine = fiche.semaineAvecEcarts(ENTREES, R, ECARTS_NULS);
	assert.deepEqual(semaine.apportsKcal, R.semaine.apportsKcal);
	assert.deepEqual(semaine.disponibilitesKcal, R.semaine.disponibilitesKcal);
	assert.deepEqual(semaine.niveauxDisponibilite, R.semaine.niveauxDisponibilite);
	assert.equal(semaine.deficitSemaineKcal, R.semaine.deficitSemaineKcal);
	assert.equal(semaine.graisseKg, R.semaine.graisseKg);
	assert.equal(semaine.exerciceKcal, R.exerciceJournalierKcal);
	assert.ok(semaine.apportsKcal.every((apport) => apport === R.objectifJournalierKcal));
});

/* ═══════════ 5 · La page n'utilise plus applyKcal pour la semaine type ═══════════ */

test('PAGE : la semaine type n’utilise plus applyKcal et lit semaineAvecEcarts', () => {
	const bloc = adminPage.slice(
		adminPage.indexOf('Semaine type</h3>'),
		adminPage.indexOf('<!-- APPLIQUER À LA FICHE')
	);
	assert.ok(bloc.length > 0, 'bloc « Semaine type » trouvé');
	assert.ok(!bloc.includes('applyKcal'), 'plus aucune référence à l’objectif du bloc d’application');
	assert.ok(
		bloc.includes("value={calSemaine ? calSemaine.apportsKcal[i] : ''}"),
		'valeur affichée = semaine simulée'
	);
	assert.ok(
		adminPage.includes('semaineAvecEcarts(calibrageInputs, calR, ecartsSemaine)'),
		'semaine calculée depuis les écarts et l’objectif calculé'
	);
	/* « La dernière action gagne » ne surveille que les résultats HORS semaine
	   type : modifier un jour ne peut pas réinitialiser le bloc d'application. */
	const sigStart = adminPage.indexOf('const calSignatureResultats');
	const signature = adminPage.slice(sigStart, adminPage.indexOf('$effect(() => {', sigStart));
	assert.ok(signature.includes('calR.objectifJournalierKcal'));
	assert.ok(!signature.includes('apportsSemaine') && !signature.includes('ecartsSemaine'), 'semaine type hors signature');
});
