/**
 * Mission C2a-ter — CALIBRAGE : suivi en direct, musculation modérée,
 * maintenance totale, adaptation guidée, arrondis exacts, décimales françaises
 * (retours coach sur la Preview après C2a-bis).
 *
 * Vérifié :
 *  1. SUIVI EN DIRECT : les champs de « Appliquer à la fiche » suivent les
 *     résultats en temps réel (un champ non modifié est resynchronisé à chaque
 *     changement de résultats), un champ modifié n'est jamais écrasé (badge
 *     « modifié »), bandeau « Les résultats ont changé » + bouton « Reprendre
 *     les valeurs calculées », et la fenêtre de confirmation affiche les
 *     valeurs réellement envoyées ;
 *  2. MUSCULATION « Modérée · 3,3 kcal/kg/h » entre Récréative (2,2) et
 *     Intensive (4,4), dans le calibrage ET l'outil Dépense sportive, via la
 *     constante partagée `COUT_SPORT.musculationModeree` — ajout uniquement,
 *     anciennes lignes (v1) inchangées ;
 *  3. CARTE « Maintenance totale (sport habituel inclus) » = budget ÷ 7, avec
 *     « dont sans exercice X kcal · sport Y kcal/jour » — même valeur que le
 *     champ Maintenance pré-rempli ;
 *  4. ADAPTATION : libellé « Adaptation (% du métabolisme de base) », aide et
 *     repères 0 / 10 / 13 %, bornes 0 à 20, avertissement au-delà de 13 %,
 *     effet en kcal « −X kcal/jour » — le calcul de la maintenance ne change
 *     pas ;
 *  5. ARRONDIS : macros en grammes entiers (protéines et lipides arrondis,
 *     glucides = reste arrondi) et objectif kcal appliqué = somme exacte
 *     4G + 4P + 9L — aucun écart entre calibrage, application, confirmation,
 *     Vision 360 et journal (3 profils, dont 60,6 kg) ;
 *  6. DÉCIMALES FRANÇAISES dans l'onglet Calibrage, les avertissements et la
 *     fenêtre de confirmation (0,46 et non 0.46).
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
const sport = await import(new URL('../src/convex/sportCatalog.ts', import.meta.url).href);

const adminPage = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');
const depensePage = readFileSync(join(root, 'src/routes/espace/depense-sportive/+page.svelte'), 'utf8');

/* ── Profils de référence (dont 60,6 kg, demandé par le coach) ── */

const PROFILS = [
	{
		nom: '60 kg / MG 26 %',
		entrees: {
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
		}
	},
	{
		nom: '60,6 kg / MG 22,5 %',
		entrees: {
			poidsKg: 60.6,
			mgPct: 22.5,
			pasMoyen: 8_000,
			heuresTravail: 4,
			ajustementTravail: 0.02,
			adaptationPct: 10,
			deficitPct: 15,
			proteinesParKgMasseMaigre: 2.1,
			seances: [
				{ activiteId: 'musculation', seancesParSemaine: 2, dureeMinutes: 45, choix: 'moderee' },
				{ activiteId: 'course-tapis', seancesParSemaine: 2, dureeMinutes: 30, choix: '130-150' }
			],
			apportsSemaine: [null, 1500, null, 1650, null, null, null]
		}
	},
	{
		nom: '78,4 kg / MG 31 %',
		entrees: {
			poidsKg: 78.4,
			mgPct: 31,
			pasMoyen: 14_000,
			heuresTravail: 0,
			ajustementTravail: 0,
			adaptationPct: 13,
			deficitPct: 20,
			proteinesParKgMasseMaigre: 2.6,
			seances: [{ activiteId: 'yoga', seancesParSemaine: 2, dureeMinutes: 60, choix: 'elevee' }],
			apportsSemaine: [null, null, null, null, null, null, null]
		}
	}
];

/* ═══════════ 1 · Suivi en direct des champs « Appliquer à la fiche » ═══════════ */

test('SUIVI : un champ non modifié suit les résultats en temps réel (valeurs recalculées à chaque entrée)', () => {
	/* Les valeurs proposées = résultats affichés, recalculees à CHAQUE changement
	   d'entrées (poids, MG%, déficit, sport) : deux jeux d'entrées → deux jeux de
	   valeurs, dérivés des résultats (jamais figés au premier pré-remplissage). */
	const a = fiche.resultatsFiche(PROFILS[0].entrees);
	const b = fiche.resultatsFiche(PROFILS[1].entrees);
	assert.notEqual(a.objectifJournalierKcal, b.objectifJournalierKcal, 'objectif suit les résultats');
	assert.notEqual(a.maintenanceFiletKcal, b.maintenanceFiletKcal, 'maintenance suit les résultats');
	assert.notEqual(a.macros.glucidesG, b.macros.glucidesG, 'glucides suivent les résultats');
	/* Le mécanisme du CRM : chaque champ non modifié (applyX === refX) reprend la
	   nouvelle valeur calculée à chaque exécution du suivi. */
	assert.ok(adminPage.includes('if (!applyInitialise || applyKcal === refKcal)'), 'objectif resynchronisé');
	assert.ok(adminPage.includes('if (!applyInitialise || applyMaintenance === refMaintenance)'), 'maintenance resynchronisée');
	assert.ok(adminPage.includes('if (!applyInitialise || applyCarbs === refCarbs)'), 'glucides resynchronisés');
	assert.ok(adminPage.includes('if (!applyInitialise || applyProtein === refProtein)'), 'protéines resynchronisées');
	assert.ok(adminPage.includes('if (!applyInitialise || applyFat === refFat)'), 'lipides resynchronisés');
	assert.ok(
		adminPage.includes('applyKcal = r.objectifJournalierKcal;') &&
			adminPage.includes('applyMaintenance = String(Math.round(r.maintenanceFiletKcal));') &&
			adminPage.includes('applyCarbs = r.macros.glucidesG;') &&
			adminPage.includes('applyProtein = r.macros.proteinesG;') &&
			adminPage.includes('applyFat = r.macros.lipidesG;'),
		'les valeurs suivent EXACTEMENT les résultats affichés'
	);
});

test('SUIVI : badge « modifié » = règle existante, un champ modifié n’est jamais écrasé', () => {
	const badges = adminPage.match(/normal-case text-warn\">modifié<\/span>/g) ?? [];
	assert.equal(badges.length, 5, 'cinq badges « modifié », un par champ');
	for (const champ of ['applyKcal !== refKcal', 'applyMaintenance !== refMaintenance', 'applyCarbs !== refCarbs', 'applyProtein !== refProtein', 'applyFat !== refFat']) {
		assert.ok(adminPage.includes(`{#if ${champ}}`), `badge « modifié » pour ${champ}`);
	}
	/* La resynchronisation n'écrase JAMAIS un champ modifié : elle n'écrit que
	   quand la valeur affichée est encore la référence (le cas « modifié » sort
	   de la condition ci-dessus). */
	const suivi = adminPage.slice(adminPage.indexOf('$effect(() => {'), adminPage.indexOf('function reprendreValeursCalculees'));
	assert.ok(suivi.includes('applyKcal === refKcal'), 'écrasement conditionné à l’absence de modification');
	/* Maintenance : saisie en CHAÎNE (oninput) — bind:value sur input number
	   coerce en nombre (to_number) et bloquerait le badge sur « modifié ». */
	assert.ok(
		!adminPage.includes('bind:value={applyMaintenance}'),
		'plus de bind:value sur le champ maintenance (coercion numérique)'
	);
	assert.ok(
		/applyMaintenance = \(e\.currentTarget as HTMLInputElement\)\.value/.test(adminPage),
		'la maintenance reste une chaîne, comparable à sa référence'
	);
});

test('SUIVI : « Les résultats ont changé » + bouton « Reprendre les valeurs calculées »', () => {
	assert.ok(adminPage.includes('Les résultats ont changé'), 'bandeau affiché quand les résultats bougent après modification');
	assert.ok(adminPage.includes('Reprendre les valeurs calculées'), 'bouton de reprise');
	assert.ok(adminPage.includes('onclick={reprendreValeursCalculees}'), 'le bouton appelle la reprise');
	/* La reprise remet les CINQ champs (et leurs références) sur les résultats
	   courants et ferme le bandeau. */
	const fn = adminPage.slice(
		adminPage.indexOf('function reprendreValeursCalculees'),
		adminPage.indexOf('async function appliquerCalibrage')
	);
	for (const ligne of [
		'applyKcal = r.objectifJournalierKcal;',
		'applyMaintenance = String(Math.round(r.maintenanceFiletKcal));',
		'applyCarbs = r.macros.glucidesG;',
		'applyProtein = r.macros.proteinesG;',
		'applyFat = r.macros.lipidesG;',
		'refKcal = applyKcal;',
		'refMaintenance = applyMaintenance;',
		'refCarbs = applyCarbs;',
		'refProtein = applyProtein;',
		'refFat = applyFat;',
		'applyResultatsChanges = false;'
	]) {
		assert.ok(fn.includes(ligne), `reprise : ${ligne}`);
	}
	/* Le bandeau ne se déclenche QUE sur un changement de résultats avec au
	   moins un champ modifié (pas à chaque frappe). */
	const suivi = adminPage.slice(adminPage.indexOf('const calc = {'), adminPage.indexOf('function reprendreValeursCalculees'));
	assert.ok(suivi.includes('if (change && modifie) applyResultatsChanges = true;'));
	assert.ok(suivi.includes('else if (!modifie) applyResultatsChanges = false;'));
});

test('SUIVI : la fenêtre de confirmation affiche les valeurs réellement envoyées', () => {
	const dialog = adminPage.slice(adminPage.indexOf('<ConfirmDialog'), adminPage.indexOf('</ConfirmDialog>'));
	for (const champ of ['applyKcal', 'applyMaintenance', 'applyCarbs', 'applyProtein', 'applyFat']) {
		assert.ok(dialog.includes(champ), `confirmation : ${champ} affiché`);
	}
	/* Le POST envoie exactement ces mêmes valeurs. */
	const fn = adminPage.slice(
		adminPage.indexOf('async function appliquerCalibrage'),
		adminPage.indexOf('/* Onglet Plan de repas')
	);
	for (const ligne of ['kcal: applyKcal,', 'carbs: applyCarbs,', 'protein: applyProtein,', 'fat: applyFat,']) {
		assert.ok(fn.includes(ligne), `envoi : ${ligne}`);
	}
	assert.ok(/maintenanceKcal:\s*\n?\s*String\(applyMaintenance \?\? ''\)\.trim\(\) === '' \? undefined : Number\(applyMaintenance\)/.test(fn), 'maintenance envoyée = valeur affichée');
});

/* ═══════════════ 2 · Musculation « Modérée · 3,3 kcal/kg/h » ═══════════════ */

test('MUSCULATION : « Modérée » 3,3 kcal/kg/h entre Récréative 2,2 et Intensive 4,4 (constante partagée)', () => {
	assert.equal(cal.COUT_SPORT.musculationModeree, 3.3, 'constante partagée');
	assert.equal(cal.COUT_SPORT.musculationRecreative, 2.2, 'valeur existante inchangée');
	assert.equal(cal.COUT_SPORT.musculationIntensive, 4.4, 'valeur existante inchangée');
	assert.deepEqual([...cal.INTENSITES_MUSCULATION], ['recreative', 'moderee', 'intensive'], 'ordre récréative → modérée → intensive');
	assert.equal(cal.coutSportif({ sport: 'musculation', intensite: 'recreative' }).coefficientKcalKgH, 2.2);
	assert.equal(cal.coutSportif({ sport: 'musculation', intensite: 'moderee' }).coefficientKcalKgH, 3.3);
	assert.equal(cal.coutSportif({ sport: 'musculation', intensite: 'moderee' }).libelle, 'Musculation modérée (3,3 kcal/kg/h)');
	assert.equal(cal.coutSportif({ sport: 'musculation', intensite: 'intensive' }).coefficientKcalKgH, 4.4);
});

test('MUSCULATION : les DEUX outils (calibrage + Dépense sportive) partagent le même catalogue de choix', () => {
	const choix = sport.SPORT_CHOIX_MUSCULATION;
	assert.deepEqual(choix.map((c) => c.id), ['recreative', 'moderee', 'intensive']);
	assert.deepEqual(choix.map((c) => c.label), ['Récréative', 'Modérée', 'Intensive']);
	assert.deepEqual(choix.map((c) => c.hint), ['2,2 kcal/kg/h', '3,3 kcal/kg/h', '4,4 kcal/kg/h'], 'décimales françaises');
	/* Résolution par le catalogue (source unique) — même coût que le barème. */
	assert.equal(sport.resolveSportCoefficient('musculation', 'moderee').coefficientKcalKgH, 3.3);
	assert.equal(sport.resolveSportCoefficient('musculation', 'moderee').intensity, 'moderee');
	/* Côté cliente : la nouvelle saisie « moderee » donne bien 3,3 (1 h à 60 kg). */
	const est = sport.estimateSportActivity({ activityId: 'musculation', intensity: 'moderee', durationMinutes: 60, weightKg: 60 });
	assert.equal(est.coutHoraireKcalKgH, 3.3);
	assert.equal(est.estimatedCalories, 198, '3,3 × 60 kg × 1 h');
	/* Onglet Calibrage (CRM) ET outil Dépense sportive (cliente) branchés dessus. */
	assert.ok(adminPage.includes('SPORT_CHOIX_MUSCULATION'), 'calibrage : choix musculation du catalogue');
	assert.ok(adminPage.includes('${o.label} · ${o.hint}'), 'calibrage : libellé « Modérée · 3,3 kcal/kg/h »');
	assert.ok(depensePage.includes('choixMusculation'), 'Dépense sportive : choix musculation du catalogue');
});

test('MUSCULATION : anciennes lignes compatibles — v1 inchangées, conversions historiques préservées', () => {
	/* Ligne v1 (MET du Compendium) : recalcul par SON modèle, jamais par le barème. */
	const v1 = sport.depenseLegacyMet({ metValue: 8, durationMinutes: 60, weightKg: 60 });
	assert.equal(v1.metMinutes, 480, 'MET-minutes d’origine');
	assert.equal(v1.estimatedCalories, 480, 'kcal d’origine (8 × 60 × 1 h) — aucun recalcul');
	assert.equal(sport.SPORT_CATALOG_VERSION, '2');
	assert.equal(sport.SPORT_CATALOG_VERSION_LEGACY, '1', 'les lignes v1 restent en « 1 »');
	/* Conversions des anciennes valeurs (PWA en cache) : inchangées. */
	const muscu = sport.getSportEntry('musculation');
	assert.equal(sport.intensiteLegacyVersV2(muscu, 'intense'), 'intensive', 'musculation : intense → intensive');
	assert.equal(sport.intensiteLegacyVersV2(muscu, 'legere'), 'recreative', 'musculation : légère → récréative');
	assert.equal(sport.intensiteLegacyVersV2(sport.getSportEntry('yoga'), 'moderee'), 'moderee', 'douce : modérée reste modérée');
	assert.equal(sport.intensiteLegacyVersV2(sport.getSportEntry('course-tapis'), 'moderee'), '130-150', 'cardio : modérée → zone 130-150');
});

/* ═════════════ 3 · Maintenance totale (sport habituel inclus) ═════════════ */

test('MAINTENANCE TOTALE = budget de la semaine ÷ 7, avec détail « dont sans exercice · sport »', () => {
	for (const profil of PROFILS) {
		const r = fiche.resultatsFiche(profil.entrees);
		assert.equal(r.maintenanceFiletKcal, Math.round(r.budgetSemaineKcal / 7), `${profil.nom} : budget ÷ 7`);
		assert.equal(r.maintenanceDetailKcal.sansExerciceKcal, Math.round(r.maintenanceKcal), `${profil.nom} : part sans exercice`);
		assert.equal(
			r.maintenanceDetailKcal.sansExerciceKcal + r.maintenanceDetailKcal.sportJournalierKcal,
			r.maintenanceFiletKcal,
			`${profil.nom} : la somme des parts vaut le total affiché`
		);
		assert.ok(r.maintenanceFiletKcal > r.maintenanceKcal, `${profil.nom} : le sport est inclus`);
	}
});

test('MAINTENANCE TOTALE : carte remplacée, même valeur que le champ Maintenance pré-rempli', () => {
	assert.ok(adminPage.includes('Maintenance totale (sport habituel inclus)'), 'nouveau titre de carte');
	assert.ok(adminPage.includes('dont sans exercice '), 'sous-ligne de détail');
	assert.ok(adminPage.includes('kcal/jour'), 'part sport en kcal/jour');
	assert.ok(adminPage.includes('calR.maintenanceDetailKcal.sansExerciceKcal'), 'détail = module');
	assert.ok(adminPage.includes('calR.maintenanceDetailKcal.sportJournalierKcal'), 'détail = module');
	assert.ok(!adminPage.includes('Maintenance (sans exercice)'), 'ancienne carte disparue');
	/* Même valeur que le champ « Maintenance » de « Appliquer à la fiche ». */
	assert.ok(adminPage.includes('applyMaintenance = String(Math.round(r.maintenanceFiletKcal));'));
	assert.ok(adminPage.includes('{calR.maintenanceFiletKcal.toLocaleString(\'fr-FR\')}'), 'carte = maintenanceFiletKcal');
});

/* ═════════════════ 4 · Adaptation métabolique guidée ═════════════════ */

test('ADAPTATION : libellé « Adaptation (% du métabolisme de base) », aide et repères 0 / 10 / 13 %', () => {
	assert.ok(adminPage.includes('Adaptation (% du métabolisme de base)'), 'nouveau libellé du champ');
	assert.ok(adminPage.includes('{ADAPTATION_AIDE}'), 'aide affichée sous le champ');
	assert.equal(
		cal.ADAPTATION_AIDE,
		'Corrige la baisse de dépense que les pas ne mesurent pas. Estimation de départ, corrigée ensuite par la tendance réelle du poids.'
	);
	assert.deepEqual(cal.ADAPTATION_REPERES.map((r) => r.pct), [0, 10, 13], 'repères 0 / 10 / 13 %');
	assert.ok(cal.ADAPTATION_REPERES[0].texte.includes('poids stable à son poids habituel'));
	assert.ok(cal.ADAPTATION_REPERES[1].texte.includes('en déficit depuis 2 à 3 mois ou plus'));
	assert.ok(cal.ADAPTATION_REPERES[1].texte.includes('perte déjà importante'));
	assert.ok(cal.ADAPTATION_REPERES[2].texte.includes('déficit prolongé ou masse grasse basse'));
	assert.ok(adminPage.includes('{#each ADAPTATION_REPERES as repere (repere.pct)}'), 'repères rendus sous le champ');
});

test('ADAPTATION : bornes 0 à 20, avertissement au-delà de 13 %, effet en kcal — calcul de la maintenance inchangé', () => {
	/* Bornes de saisie 0 à 20 (module ET champ). */
	assert.throws(() => cal.adaptationEffetKcal({ poidsKg: 60, mgPct: 26, adaptationPct: 21 }), /0 à 20/);
	assert.throws(() => cal.maintenanceKcal({ poidsKg: 60, mgPct: 26, coefficient: 1.4, adaptationPct: 20.5 }), /0 à 20/);
	assert.ok(/min="0" max="20" step="0\.5" bind:value=\{calibrageInputs\.adaptationPct\}/.test(adminPage), 'champ borné 0 à 20');
	assert.equal(cal.maintenanceKcal({ poidsKg: 60, mgPct: 26, coefficient: 1.4, adaptationPct: 20 }) > 0, true, '20 accepté');

	/* Effet en kcal = MB × A/100 — « −X kcal/jour ». */
	const effet = cal.adaptationEffetKcal({ poidsKg: 60, mgPct: 26, adaptationPct: 10 });
	assert.equal(effet, 124.24, 'MB brut 1 242,36 × 10 %');
	assert.ok(adminPage.includes('−{decimalFr(calR.adaptationEffetKcal)} kcal/jour'), 'effet affiché en décimales françaises');

	/* Avertissement au-delà de 13 % (13 reste acceptable). */
	const r13 = fiche.resultatsFiche({ ...PROFILS[0].entrees, adaptationPct: 13 });
	assert.equal(r13.avertissementAdaptation, null, '13 % : pas d’avertissement');
	const r14 = fiche.resultatsFiche({ ...PROFILS[0].entrees, adaptationPct: 14 });
	assert.equal(r14.avertissementAdaptation, "Valeur exceptionnelle : vérifier qu'aucun facteur médical n'est en cause.");
	assert.equal(r14.avertissementAdaptation, cal.ADAPTATION_AVERTISSEMENT);
	assert.equal(cal.ADAPTATION_PCT_AVERTISSEMENT, 13);
	assert.ok(adminPage.includes('{calR.avertissementAdaptation}'), 'avertissement affiché');

	/* Le calcul existant ne change pas : maintenance = arrondi(C × MB) − MB × A/100. */
	assert.equal(cal.maintenanceKcal({ poidsKg: 56.6, mgPct: 26, coefficient: 1.4, adaptationPct: 12 }), 1500.36);
	const r = fiche.resultatsFiche({ ...PROFILS[0].entrees, adaptationPct: 10 });
	assert.equal(r.maintenanceKcal, cal.maintenanceKcal({ poidsKg: 60, mgPct: 26, coefficient: r.coefficient, adaptationPct: 10 }));
	assert.equal(r.adaptationEffetKcal, cal.adaptationEffetKcal({ poidsKg: 60, mgPct: 26, adaptationPct: 10 }));
});

/* ═══════════ 5 · Arrondis : macros entières, kcal = 4G + 4P + 9L ═══════════ */

test('ARRONDIS : 3 profils (dont 60,6 kg) — macros entières et objectif = somme exacte 4G + 4P + 9L', () => {
	for (const profil of PROFILS) {
		const r = fiche.resultatsFiche(profil.entrees);
		const { proteinesG, lipidesG, glucidesG } = r.macros;
		assert.ok(Number.isInteger(proteinesG), `${profil.nom} : protéines entières`);
		assert.ok(Number.isInteger(lipidesG), `${profil.nom} : lipides entiers (plus de demi-grammes)`);
		assert.ok(Number.isInteger(glucidesG), `${profil.nom} : glucides entiers`);
		/* Objectif appliqué = somme EXACTE — dans les résultats (r.objectifJournalierKcal). */
		const somme = 4 * glucidesG + 4 * proteinesG + 9 * lipidesG;
		assert.equal(r.macros.kcalApplique, somme, `${profil.nom} : kcalApplique = 4G + 4P + 9L`);
		assert.equal(r.objectifJournalierKcal, somme, `${profil.nom} : objectif appliqué = somme exacte`);
		/* Champs d'application + confirmation + journal = mêmes valeurs (applyKcal
		   = r.objectifJournalierKcal, macros = r.macros). Vision 360 recalcule
		   4G + 4P + 9L sur ces mêmes grammes → même somme, AUCUN écart. */
		const vision360 = 4 * r.macros.glucidesG + 4 * r.macros.proteinesG + 9 * r.macros.lipidesG;
		assert.equal(vision360, r.objectifJournalierKcal, `${profil.nom} : Vision 360 = calibrage (0 écart)`);
	}
});

test('ARRONDIS : la carte « Calories calculées » ne recalcule qu’une somme exacte, sans aucun arrondi', () => {
	const values = adminPage.slice(adminPage.indexOf('const goalsValues = $derived.by'), adminPage.indexOf('const pctSum = $derived'));
	const grams = values.slice(values.indexOf('/* Mode macros (g)'));
	assert.ok(grams.includes('kcal: 4 * carbs + 4 * protein + 9 * fat'), 'somme exacte 4G + 4P + 9L');
	assert.ok(!/Math\.round\(g(Carbs|Protein|Fat)\)/.test(grams), 'aucun arrondi qui créerait un écart');
	/* Les grammes affichés = les grammes comptés = les grammes stockés. */
	assert.ok(grams.includes('const carbs = Math.max(0, gCarbs || 0);'));
	assert.ok(adminPage.includes("applyKcal = r.objectifJournalierKcal;"), 'champ d’application = objectif exact');
});

/* ═════════════════ 6 · Décimales françaises partout ═════════════════ */

test('DÉCIMALES : avertissements et confirmation en décimales françaises (0,46 et non 0.46)', () => {
	assert.equal(cal.decimalFr(0.46), '0,46');
	assert.equal(cal.decimalFr(124.24), '124,24');
	assert.equal(cal.decimalFr(1725), '1725');
	/* Avertissement « rythme conseillé » : valeurs en virgule, jamais en point. */
	const rapide = fiche.resultatsFiche({ ...PROFILS[0].entrees, mgPct: 5, deficitPct: 20, seances: [] });
	assert.ok(rapide.alertePlafonds, 'avertissement de rythme déclenché');
	assert.ok(!/[0-9]\.[0-9]/.test(rapide.alertePlafonds), 'aucun point décimal dans l’avertissement');
	assert.ok(rapide.alertePlafonds.includes(`${cal.decimalFr(rapide.perteGraisseKg)} kg/semaine`), 'perte en décimales françaises');
	/* Fenêtre de confirmation : maintenance et macros en décimales françaises. */
	const dialog = adminPage.slice(adminPage.indexOf('<ConfirmDialog'), adminPage.indexOf('</ConfirmDialog>'));
	assert.ok(dialog.includes("decimalFr(Number(applyMaintenance))"), 'maintenance en décimales françaises');
	assert.ok(dialog.includes('decimalFr(applyCarbs)') && dialog.includes('decimalFr(applyProtein)') && dialog.includes('decimalFr(applyFat)'), 'macros en décimales françaises');
	/* Onglet Calibrage : l'effet d'adaptation et les séances en décimales françaises. */
	assert.ok(adminPage.includes('decimalFr(calR.adaptationEffetKcal)'), 'effet d’adaptation en décimales françaises');
	/* Outils sportifs : les coûts du barème s’affichent en décimales françaises. */
	for (const c of [...sport.SPORT_CHOIX_MUSCULATION, ...sport.SPORT_CHOIX_DOUCES, ...sport.SPORT_ZONES_CARDIO]) {
		assert.ok(!/[0-9]\.[0-9]/.test(c.hint), `hint sans point décimal (${c.hint})`);
	}
});
