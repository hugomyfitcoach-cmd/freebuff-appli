/**
 * Mission C2c-1 — CALIBRAGE : impact en direct de l'objectif APPLIQUÉ.
 *
 * Vérifié :
 *  1. IMPACT : « Impact de l'objectif appliqué » est recalculé pour l'objectif
 *     réellement saisi — 1 550 au lieu de 1 531 → déficit réel (% de la
 *     maintenance totale), perte de graisse (7 700 kcal/kg), disponibilité en
 *     énergie et comparaison aux plafonds Alpert / Macdonald changent ;
 *  2. COHÉRENCE : objectif non modifié (celui des résultats) → mêmes valeurs
 *     que les résultats (déficit, perte, disponibilité, niveau) et MÊMES
 *     avertissements (déficit, plafonds, disponibilité) ;
 *  3. SEMAINE TYPE : elle suit l'objectif du bloc « Appliquer à la fiche » —
 *     les jours non modifiés à la main (`null`) se mettent à jour, les jours
 *     saisis ne sont jamais écrasés ;
 *  4. BOUTON « Tous à l'objectif » : il repart de jours « type », qui suivent
 *     l'objectif du bloc d'application (et non un objectif figé) ;
 *  5. DÉFICIT CHOISI : « ≈ X kg de graisse par semaine » affiché en direct sous
 *     le champ, arrondi au 0,05 kg près (ex. 0,35 kg).
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

/* Profil de référence : poids 56,6 kg · MG 26 % · 2 séances de musculation
   modérée · déficit choisi 12 % — l'objectif calculé n'est PAS 1 531 : le
   scénario « 1 550 au lieu de 1 531 » se joue sur l'objectif appliqué. */
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
const impact = (objectifKcal) => fiche.impactObjectifApplique({ entrees: ENTREES, resultats: R, objectifKcal });

/* ═══════════ 1 · Impact recalculé pour un objectif modifié (1 550 ≠ 1 531) ═══════════ */

test('IMPACT : recalculé à partir de l’objectif saisi — 1 550 au lieu de 1 531', () => {
	const a = impact(1531);
	const b = impact(1550);

	assert.equal(a.objectifKcal, 1531, 'objectif 1 531 pris en compte');
	assert.equal(b.objectifKcal, 1550, 'objectif 1 550 pris en compte');

	/* Déficit réel = budget de la semaine − 7 × objectif, en % de la
	   maintenance totale (budget ÷ 7, sport habituel inclus). */
	assert.equal(a.deficitSemaineKcal, R.budgetSemaineKcal - 7 * 1531);
	assert.equal(b.deficitSemaineKcal, R.budgetSemaineKcal - 7 * 1550);
	assert.equal(a.deficitPct, 5.6, 'déficit réel de 1 531 kcal/jour');
	assert.equal(b.deficitPct, 4.4, 'déficit réel de 1 550 kcal/jour');
	assert.equal(b.maintenanceTotaleKcal, R.maintenanceFiletKcal, 'même maintenance totale que les résultats');
	assert.ok(a.deficitPct > b.deficitPct, 'objectif plus haut → déficit plus faible');

	/* Perte de graisse = déficit ÷ 7 700 kcal par kg. */
	assert.equal(a.perteGraisseKg, 0.08);
	assert.equal(b.perteGraisseKg, 0.07);
	assert.equal(b.perteGraisseKg, Math.round((b.deficitSemaineKcal / cal.KCAL_PAR_KG_GRAISSE) * 100) / 100);

	/* Disponibilité en énergie = (objectif − exercice)/MM — même module. */
	const masseMaigre = cal.masseMaigreBrute(ENTREES.poidsKg, ENTREES.mgPct);
	for (const [objectif, valeur] of [
		[1531, a.disponibiliteKcal],
		[1550, b.disponibiliteKcal]
	]) {
		assert.equal(
			valeur,
			cal.disponibiliteEnergieKcal({
				apportKcal: objectif,
				exerciceKcal: R.exerciceJournalierKcal,
				masseMaigreKg: masseMaigre
			}),
			`disponibilité recalculée pour ${objectif} kcal`
		);
	}
	assert.notEqual(a.disponibiliteKcal, b.disponibiliteKcal, 'la disponibilité suit l’objectif');
	assert.equal(a.niveauDisponibilite, fiche.niveauDisponibilite(a.disponibiliteKcal), 'niveau = seuils du référentiel');
	assert.equal(b.niveauDisponibilite, fiche.niveauDisponibilite(b.disponibiliteKcal));

	/* Plafonds Alpert / Macdonald : comparaison explicite, chiffres FR. */
	assert.equal(a.vitesseMaxAlpertKgSemaine, R.vitesseMaxAlpertKgSemaine);
	assert.equal(a.vitesseMaxMacdonaldKgSemaine, R.vitesseMaxMacdonaldKgSemaine);
	assert.ok(a.comparaisonPlafonds.includes('Sous les plafonds Alpert'));
	assert.ok(a.comparaisonPlafonds.includes(cal.decimalFr(R.vitesseMaxAlpertKgSemaine)));
	assert.equal(a.depasseAlpert, false);
	assert.equal(a.depasseMacdonald, false);
	assert.equal(a.alertePlafonds, null, 'aucun dépassement → aucun message de rythme');

	/* Un objectif bas fait basculer les plafonds et la disponibilité. */
	const bas = impact(800);
	assert.equal(bas.niveauDisponibilite, 'basse');
	assert.equal(bas.depasseAlpert, true);
	assert.ok(bas.alertePlafonds?.includes('dépasse le rythme conseillé'), 'avertissement de rythme repris du module');
	assert.ok(bas.comparaisonPlafonds.includes('Au-dessus'));

	/* Le CRM affiche cet impact, calculé sur `applyKcal` (objectif du bloc). */
	assert.ok(adminPage.includes("Impact de l'objectif appliqué"), 'encadré présent sous les champs');
	assert.ok(adminPage.includes('objectifKcal: applyKcal'), 'recalculé depuis l’objectif saisi');
	assert.ok(adminPage.includes('{decimalFr(calImpact.deficitPct)}'), 'déficit réel affiché');
	assert.ok(adminPage.includes('{formatPerteGraisse(calImpact.perteGraisseKg)}'), 'perte estimée affichée (format unique C2c-3)');
	assert.ok(adminPage.includes('{decimalFr(calImpact.disponibiliteKcal)}'), 'disponibilité affichée');
	assert.ok(adminPage.includes('{calImpact.comparaisonPlafonds}'), 'plafonds comparés');
	assert.ok(adminPage.includes('{calImpact.avertissementDeficitEleve}') && adminPage.includes('{calImpact.alertePlafonds}'), 'mêmes avertissements que les résultats (15 % supprimé, > 25 % conservé)');
});

/* ═══════════ 2 · Cohérence avec les résultats quand l'objectif n'est pas modifié ═══════════ */

test('COHÉRENCE : objectif non modifié → mêmes valeurs et mêmes avertissements que les résultats', () => {
	const i = impact(R.objectifJournalierKcal);
	assert.equal(i.objectifKcal, R.objectifJournalierKcal);
	assert.equal(i.maintenanceTotaleKcal, R.maintenanceFiletKcal);
	assert.equal(i.disponibiliteKcal, R.disponibiliteKcal, 'disponibilité identique');
	assert.equal(i.niveauDisponibilite, R.niveauDisponibilite, 'même niveau (couleurs)');
	assert.deepEqual(i.seuilsDisponibiliteKcal, R.seuilsDisponibiliteKcal, 'mêmes seuils');
	/* Déficit et perte : mêmes valeurs à l'arrondi près (l'objectif appliqué est
	   la somme exacte 4G + 4P + 9L, à ±2 kcal de l'objectif visé). */
	assert.ok(Math.abs(i.deficitPct - R.deficitPct) <= 0.2, `déficit cohérent (${i.deficitPct} vs ${R.deficitPct})`);
	assert.ok(Math.abs(i.perteGraisseKg - R.perteGraisseKg) <= 0.01, 'perte cohérente');
	assert.equal(i.alertePlafonds, R.alertePlafonds);
	assert.equal(i.avertissementDeficit, R.avertissementDeficit);
	assert.equal(i.avertissementDeficitEleve, R.avertissementDeficitEleve);
	assert.deepEqual(i.avertissementDisponibilite, R.avertissementDisponibilite);

	/* Profil sous les seuils : les avertissements suivent, comme les résultats. */
	const entreesBas = { ...ENTREES, mgPct: 8, deficitPct: 20 };
	const rBas = fiche.resultatsFiche(entreesBas);
	const iBas = fiche.impactObjectifApplique({
		entrees: entreesBas,
		resultats: rBas,
		objectifKcal: rBas.objectifJournalierKcal
	});
	assert.ok(rBas.alertePlafonds, 'résultats : plafonds dépassés');
	assert.equal(iBas.alertePlafonds, rBas.alertePlafonds, 'impact : MÊME message de plafonds');
	assert.equal(iBas.avertissementDeficit, rBas.avertissementDeficit);
	assert.deepEqual(iBas.avertissementDisponibilite, rBas.avertissementDisponibilite);
});

/* ═══════════ 3 · Semaine type : suit l'objectif appliqué, jours saisis préservés ═══════════ */

test('SEMAINE TYPE : les jours non modifiés suivent l’objectif, les jours saisis ne sont jamais écrasés', () => {
	const entrees = { ...ENTREES, apportsSemaine: [null, 1400, null, null, null, null, 1300] };
	const r = fiche.resultatsFiche(entrees);

	const avant = fiche.semaineAvecObjectif(entrees, r, r.objectifJournalierKcal);
	const apres = fiche.semaineAvecObjectif(entrees, r, 1550);

	/* Les jours « type » (null) suivent l'objectif du bloc d'application. */
	assert.deepEqual(apres.apportsKcal, [1550, 1400, 1550, 1550, 1550, 1550, 1300]);
	assert.deepEqual(avant.apportsKcal, [r.objectifJournalierKcal, 1400, r.objectifJournalierKcal, r.objectifJournalierKcal, r.objectifJournalierKcal, r.objectifJournalierKcal, 1300]);
	for (const i of [0, 2, 3, 4, 5]) {
		assert.equal(apres.apportsKcal[i], 1550, `jour ${i} mis à jour`);
	}
	/* Jours saisis à la main : valeur ET disponibilité inchangées. */
	assert.equal(apres.apportsKcal[1], 1400, 'mardi saisi : jamais écrasé');
	assert.equal(apres.apportsKcal[6], 1300, 'dimanche saisi : jamais écrasé');
	assert.equal(apres.disponibilitesKcal[1], avant.disponibilitesKcal[1], 'disponibilité du jour saisi inchangée');
	assert.equal(apres.disponibilitesKcal[6], avant.disponibilitesKcal[6], 'disponibilité du jour saisi inchangée');
	assert.notEqual(apres.disponibilitesKcal[0], avant.disponibilitesKcal[0], 'disponibilité des jours « type » recalculée');

	/* Les disponibilités viennent bien du module (mêmes fonctions que les résultats). */
	assert.equal(
		apres.disponibilitesKcal[0],
		cal.disponibiliteEnergieKcal({
			apportKcal: 1550,
			exerciceKcal: r.exerciceJournalierKcal,
			masseMaigreKg: cal.masseMaigreBrute(entrees.poidsKg, entrees.mgPct)
		})
	);
	assert.equal(apres.niveauxDisponibilite.length, 7);
	assert.equal(apres.exerciceKcal, r.exerciceJournalierKcal);

	/* Aucune mutation des saisies : la fonction est pure. */
	assert.deepEqual(entrees.apportsSemaine, [null, 1400, null, null, null, null, 1300]);

	/* Sans jour saisi, la semaine recalculée = celle des résultats. */
	const entreesType = { ...ENTREES };
	const rType = fiche.resultatsFiche(entreesType);
	const semaineType = fiche.semaineAvecObjectif(entreesType, rType, rType.objectifJournalierKcal);
	assert.deepEqual(semaineType.apportsKcal, rType.semaine.apportsKcal);
	assert.deepEqual(semaineType.disponibilitesKcal, rType.semaine.disponibilitesKcal);
	assert.equal(semaineType.deficitSemaineKcal, rType.semaine.deficitSemaineKcal);

	/* CRM : depuis C2c-5b, la semaine type est un simulateur INDÉPENDANT bâti
	   sur l'objectif CALCULÉ + les écarts saisis — plus aucune lecture de
	   l'objectif du bloc d'application dans ce bloc. */
	assert.ok(adminPage.includes('semaineAvecEcarts(calibrageInputs, calR, ecartsSemaine)'), 'semaine simulée depuis l’objectif calculé et les écarts');
	assert.ok(!adminPage.slice(adminPage.indexOf('Semaine type</h3>'), adminPage.indexOf('<!-- APPLIQUER À LA FICHE')).includes('applyKcal'), 'la semaine type ne lit plus l’objectif appliqué');
	assert.ok(adminPage.includes('calSemaine.disponibilitesKcal[i]'), 'disponibilités de la semaine appliquée');
	assert.ok(!adminPage.slice(adminPage.indexOf('Semaine type</h3>'), adminPage.indexOf("<!-- APPLIQUER À LA FICHE")).includes('calR.semaine'), 'la semaine type ne lit plus l’ancien objectif calculé');
});

/* ═══════════ 4 · Bouton « Tous à l'objectif » ═══════════ */

test('BOUTON « Tous à l’objectif » : repart de jours « type » qui suivent l’objectif du bloc d’application', () => {
	const handler = adminPage.slice(
		adminPage.indexOf('function semaineVersObjectif'),
		adminPage.indexOf("/* ── « Appliquer à la fiche »")
	);
	assert.ok(handler.includes('ecartsSemaine = [0, 0, 0, 0, 0, 0, 0];'));

	/* Tous les jours « type » prennent l'objectif appliqué — même quand il
	   diffère de l'objectif calculé par les résultats. */
	const entrees = { ...ENTREES, apportsSemaine: [null, null, null, null, null, null, null] };
	const r = fiche.resultatsFiche(entrees);
	const semaine = fiche.semaineAvecObjectif(entrees, r, 1550);
	assert.deepEqual(semaine.apportsKcal, [1550, 1550, 1550, 1550, 1550, 1550, 1550]);
	assert.notEqual(1550, r.objectifJournalierKcal, 'l’objectif du bloc d’application diffère ici des résultats');
	assert.ok(semaine.apportsKcal.every((a) => a !== r.objectifJournalierKcal), 'aucun jour figé sur l’ancien objectif');

	/* Le bouton reste branché sur ce handler. */
	assert.ok(adminPage.includes('onclick={semaineVersObjectif}'), 'bouton « Tous à l’objectif » câblé');
});

/* ═══════════ 5 · Perte estimée sous le déficit choisi, arrondie au 0,05 kg ═══════════ */

test('DÉFICIT CHOISI : « ≈ X kg de graisse par semaine » sous le champ, arrondi au 0,05 kg', () => {
	assert.equal(fiche.perteGraisseKgSemaine(2695), 0.35, '2 695 kcal/semaine → 0,35 kg');
	assert.equal(fiche.perteGraisseKgSemaine(2520), 0.35, 'arrondi au plus proche (0,327 → 0,35)');
	assert.equal(fiche.perteGraisseKgSemaine(770), 0.1, '0,1 kg = 2 pas de 0,05');
	assert.equal(fiche.perteGraisseKgSemaine(0), 0);
	for (const deficit of [500, 1200, 2695, 4000]) {
		const perte = fiche.perteGraisseKgSemaine(deficit);
		assert.ok(Math.abs(perte * 20 - Math.round(perte * 20)) < 1e-9, `${perte} kg sur la grille de 0,05`);
	}

	/* Valeur affichée pour le déficit choisi : celle du module, sur la grille. */
	const perte = fiche.perteGraisseKgSemaine(R.deficitSemaineKcal);
	assert.equal(perte, 0.2, '12 % du budget → 0,2 kg/semaine');
	assert.equal(cal.decimalFr(perte), '0,2', 'décimales françaises');

	/* L'affichage est sous le champ « Déficit choisi (% du budget) ». */
	const bloc = adminPage.slice(
		adminPage.indexOf('Déficit choisi (% du budget)'),
		adminPage.indexOf('Protéines (g/kg de masse maigre)')
	);
	assert.ok(bloc.includes('kg de graisse par semaine'), 'mention affichée sous le champ');
	assert.ok(bloc.includes('≈ ${formatPerteGraisse(calPerteDeficit)} kg de graisse par semaine'), 'valeur du module, format unique C2c-3 (0,05 kg, deux décimales)');
	assert.ok(bloc.includes('perteGraisseKgSemaine(calR.deficitSemaineKcal)') || adminPage.includes('perteGraisseKgSemaine(calR.deficitSemaineKcal)'), 'calcul depuis le déficit choisi');
});
