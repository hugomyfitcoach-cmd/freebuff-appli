/**
 * Tests MISSION R5d — carte « Fibres / jour » côté coach (Vision 360 + fiche
 * bilan).
 *
 * 1) Journée exploitable pour les fibres = journée déjà exploitable selon la
 *    règle des cartes Calories / Protéines (`isExploitableDay`) ET couverture
 *    fibres ≥ 80 % des kcal — 7 jours dont 2 à 60 % de couverture → moyenne
 *    sur 5 jours.
 * 2) Moins de 3 jours exploitables → aucune valeur (« Pas assez de données »).
 * 3) Objectif qui change dans la fenêtre → repère moyen calculé sur les
 *    repères de CHAQUE jour (`repereFibres(objectif du jour)`).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
	FIBRES_MIN_JOURS_EXPLOITABLES,
	jourExploitableFibres,
	moyenneFibres,
	repereFibres,
} from '../src/lib/bilanJour.ts';

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** Journée complète : kcal réelles + fibres connues + couverture. */
const jour = (date, kcal, fibres, couverture = 100) => ({ date, kcal, fibres, couverture });

test('7 jours dont 2 non exploitables (couverture 60 %) → moyenne sur 5 jours', () => {
	const jours = [
		jour('2026-10-01', 2000, 20),
		jour('2026-10-02', 2000, 25),
		// Couverture 60 % : le total de fibres est un minimum → exclu.
		jour('2026-10-03', 2000, 40, 60),
		jour('2026-10-04', 2000, 30),
		jour('2026-10-05', 2000, 35),
		// Deuxième jour incomplet.
		jour('2026-10-06', 2000, 38, 60),
		jour('2026-10-07', 2000, 20),
	];
	const r = moyenneFibres(jours, 2000);
	// (20 + 25 + 30 + 35 + 20) / 5 = 26 — les deux jours à 60 % ne comptent pas.
	assert.equal(r.trackedDays, 5);
	assert.equal(r.avg, 26);
	// Repère : max(25, arrondi(2000 × 0,015)) = 30 pour ces 5 jours.
	assert.equal(r.repere, 30);
	assert.equal(r.atteint, false);
});

test('2 jours exploitables seulement → « Pas assez de données » (aucune valeur)', () => {
	const jours = [
		jour('2026-10-01', 2000, 30),
		jour('2026-10-02', 2000, 32),
		jour('2026-10-03', 2000, 45, 60),
		jour('2026-10-04', null, null, 0),
	];
	const r = moyenneFibres(jours, 2000);
	assert.equal(r.trackedDays, 2);
	assert.equal(r.avg, null);
	assert.equal(r.repere, null);
	assert.equal(r.atteint, false);
	assert.equal(FIBRES_MIN_JOURS_EXPLOITABLES, 3);
});

test("changement d'objectif dans la fenêtre → repère moyen des mêmes jours", () => {
	// Objectif historisé : 2 000 kcal jusqu'au 04/10, 1 600 kcal ensuite.
	const goalForDay = (date) => (date <= '2026-10-04' ? 2000 : 1600);
	const jours = [
		jour('2026-10-03', 2000, 30),
		jour('2026-10-04', 2000, 30),
		jour('2026-10-05', 1600, 25),
		jour('2026-10-06', 1600, 25),
	];
	assert.equal(repereFibres(2000), 30);
	assert.equal(repereFibres(1600), 25); // 24 → plancher 25 g
	const r = moyenneFibres(jours, goalForDay);
	assert.equal(r.trackedDays, 4);
	assert.equal(r.avg, 27.5);
	// (30 + 30 + 25 + 25) / 4 = 27,5 : jamais le repère de la dernière journée.
	assert.equal(r.repere, 27.5);
	assert.equal(r.atteint, true); // moyenne ≥ repère → pastille
});

test('règle de journée exploitable : celle des cartes Calories / Protéines', () => {
	// 1 000 kcal sur un objectif de 2 000 → sous le seuil max(800, 60 %) = 1 200.
	assert.equal(jourExploitableFibres(jour('2026-10-01', 1000, 30), 2000), false);
	// Couverture exactement 80 % → exploitable (seuil inclus).
	assert.equal(jourExploitableFibres(jour('2026-10-01', 2000, 30, 80), 2000), true);
	// 79 % → exclu.
	assert.equal(jourExploitableFibres(jour('2026-10-01', 2000, 30, 79), 2000), false);
	// Aucune fibre connue → exclu, aucun 0 inventé.
	assert.equal(jourExploitableFibres(jour('2026-10-01', 2000, null), 2000), false);
	// Aucune donnée → exclu.
	assert.equal(jourExploitableFibres(jour('2026-10-01', null, null, 0), 2000), false);
});

test('câblage coach : Vision 360 après Hydratation + fiche bilan à côté de Protéines', () => {
	const admin = source('src/routes/admin/+page.svelte');
	// La carte existe une seule fois dans chaque emplacement.
	assert.equal((admin.match(/> Fibres \/ jour<\/div>/g) ?? []).length, 1, 'carte « Fibres / jour » de la Vision 360');
	assert.equal((admin.match(/cardHead\('leaf', 'Fibres'/g) ?? []).length, 1, 'carte Fibres de la fiche bilan');
	// Vision 360 : la carte est placée APRÈS le bloc Hydratation.
	const hydration = admin.indexOf('<!-- HYDRATATION — mêmes enregistrements');
	const fibresVision = admin.indexOf('> Fibres / jour</div>');
	assert.ok(fibresVision > 0, 'titre de la carte « Fibres / jour » présent');
	assert.ok(hydration > 0 && fibresVision > hydration, 'carte Fibres après Hydratation');
	// Fiche bilan : la carte Fibres suit la carte Protéines.
	const proteines = admin.indexOf("cardHead('beef', 'Protéines'");
	const fibresBilan = admin.indexOf("cardHead('leaf', 'Fibres'");
	assert.ok(proteines > 0 && fibresBilan > proteines, 'carte Fibres à côté de Protéines');
	// Aucun chiffre quand les données sont insuffisantes, jamais de rouge.
	assert.match(admin, /Pas assez de données/);
	assert.match(admin, /repère atteint/);
	assert.doesNotMatch(
		admin.slice(fibresVision, fibresVision + 1200),
		/text-danger|bg-danger|text-red/,
		'jamais de rouge sur la carte Fibres'
	);
	// Calcul serveur unique, réutilisant bilanJour (aucun calcul de fibres en double).
	const coach = source('src/convex/coach.ts');
	assert.match(coach, /moyenneFibres\(/);
	assert.match(coach, /await bilanJourAliments\(/);
	assert.match(source('src/convex/journal.ts'), /export async function bilanJourAliments\(/);
	// Aucun changement côté cliente.
	for (const page of ['src/routes/espace/+page.svelte', 'src/routes/espace/journal/+page.svelte']) {
		assert.doesNotMatch(source(page), /Fibres \/ jour/, `pas de carte coach dans ${page}`);
	}
});
