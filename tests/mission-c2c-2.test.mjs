/**
 * Mission C2c-2 — CALIBRAGE : lisibilité et cohérence visuelle (affichage seul).
 *
 * Vérifié :
 *  1. ORDRE : Entrées → Profil sportif → Résultats du calibrage → Semaine type
 *     → Appliquer à la fiche → Historique ;
 *  2. BANDEAU : bandeau de synthèse collant en haut de l'onglet (desktop et
 *     mobile), alimenté par l'objectif du bloc « Appliquer à la fiche » et par
 *     les valeurs déjà calculées par C2c-1 (déficit réel, perte estimée,
 *     disponibilité) — aucun nouveau calcul ; absent du mode présentation ;
 *  3. COULEURS MACROS : protéines bleu, lipides orange, glucides rose — MÊMES
 *     valeurs que le Journal alimentaire cliente ($lib/macros, source unique) ;
 *  4. VIOLET : perte de graisse estimée en violet partout (bandeau, encadré
 *     d'impact, sous le déficit, résultats, présentation) ; objectif en vert ;
 *     la disponibilité garde les couleurs de ses seuils ;
 *  5. SUPPLÉMENT TRAVAIL : « +0,05 · travail de bureau » + la phrase
 *     « Chaque heure en mouvement ajoute 0,05, jusqu'à 0,60 au maximum. »,
 *     valeurs du barème et heures saisies dynamiques — aucun calcul modifié.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const adminPage = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');
const ficheSource = readFileSync(join(root, 'src/lib/calibrageFiche.ts'), 'utf8');
const journalPage = readFileSync(join(root, 'src/routes/espace/journal/+page.svelte'), 'utf8');
const layoutCss = readFileSync(join(root, 'src/routes/layout.css'), 'utf8');

const cal = await import(new URL('../src/lib/calibrage.ts', import.meta.url).href);
const fiche = await import(new URL('../src/lib/calibrageFiche.ts', import.meta.url).href);
const { MACRO_DEFS } = await import(new URL('../src/lib/macros.ts', import.meta.url).href);

const sansCommentaires = (texte) => texte.replace(/<!--[\s\S]*?-->/g, '');

/* Profil de référence — mêmes entrées que les missions C2b/C2c. */
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

/* ═══════════ 1 · Ordre des blocs de l'onglet Calibrage ═══════════ */

test('ORDRE : Entrées → Profil sportif → Résultats → Semaine type → Appliquer → Historique', () => {
	const blocs = [
		['Entrées', '<!-- ENTRÉES : pré-remplies'],
		['Profil sportif', '<!-- PROFIL SPORTIF HABITUEL'],
		['Résultats du calibrage', '<!-- RÉSULTATS : sortie du module'],
		['Semaine type', '<!-- SEMAINE TYPE : un apport par jour'],
		['Appliquer à la fiche', '<!-- APPLIQUER À LA FICHE'],
		['Historique', '<!-- HISTORIQUE DES OBJECTIFS']
	];
	const positions = blocs.map(([nom, marqueur]) => {
		const index = adminPage.indexOf(marqueur);
		assert.ok(index > 0, `bloc présent : ${nom}`);
		return index;
	});
	for (let i = 1; i < positions.length; i++) {
		assert.ok(
			positions[i - 1] < positions[i],
			`${blocs[i - 1][0]} avant ${blocs[i][0]} (${positions[i - 1]} vs ${positions[i]})`
		);
	}

	/* Ce que le coach voit réellement : les titres des cartes, dans cet ordre. */
	const titres = [
		'Entrées</h3>',
		'Profil sportif habituel</h3>',
		'Résultats du calibrage</h3>',
		'Semaine type</h3>',
		'Appliquer à la fiche</h3>',
		'Historique des objectifs</h3>'
	];
	const positionsTitres = titres.map((titre) => {
		const index = adminPage.indexOf(titre);
		assert.ok(index > 0, `titre affiché : ${titre}`);
		return index;
	});
	for (let i = 1; i < positionsTitres.length; i++) {
		assert.ok(positionsTitres[i - 1] < positionsTitres[i], `titre ${titres[i - 1]} avant ${titres[i]}`);
	}

	/* Le bandeau de synthèse coiffe l'onglet, avant les Entrées. */
	const bandeau = adminPage.indexOf('<!-- BANDEAU DE SYNTHÈSE');
	assert.ok(bandeau > 0 && bandeau < positions[0], 'bandeau de synthèse en haut de l’onglet');
});

/* ═══════════ 2 · Bandeau de synthèse collant, synchronisé avec l'objectif appliqué ═══════════ */

test('BANDEAU : collant, alimenté par l’objectif appliqué et les valeurs de C2c-1, sans nouveau calcul', () => {
	const debut = adminPage.indexOf('<!-- BANDEAU DE SYNTHÈSE');
	const fin = adminPage.indexOf('<!-- ENTRÉES : pré-remplies');
	assert.ok(debut > 0 && fin > debut, 'bandeau délimité avant les Entrées');
	const bandeau = sansCommentaires(adminPage.slice(debut, fin));

	/* Visible pendant le défilement, desktop et mobile (aucune requête média). */
	assert.ok(/class="[^"]*\bsticky\b/.test(bandeau), 'bandeau en position collante');
	assert.ok(/class="[^"]*\btop-0\b/.test(bandeau), 'collé en haut de l’onglet');
	assert.ok(bandeau.includes('-mx-5'), 'bandeau pleine largeur (bords du panneau)');
	assert.ok(!bandeau.includes('hidden sm:'), 'aucune restriction desktop/mobile');
	assert.ok(!bandeau.includes('overflow-x'), 'aucun débordement horizontal ajouté');

	/* Source unique : l'impact C2c-1 de l'objectif du bloc « Appliquer à la fiche ». */
	for (const champ of [
		'calImpact.objectifKcal',
		'calImpact.deficitPct',
		'calImpact.perteGraisseKg',
		'calImpact.disponibiliteKcal',
		'calImpact.niveauDisponibilite'
	]) {
		assert.ok(bandeau.includes(champ), `bandeau alimenté par ${champ}`);
	}
	assert.ok(adminPage.includes('objectifKcal: applyKcal'), 'impact recalculé depuis l’objectif du bloc d’application');
	assert.ok(
		bandeau.includes('DISPONIBILITE_NIVEAUX[calImpact.niveauDisponibilite].couleur'),
		'disponibilité = couleur de son seuil'
	);

	/* Aucun calcul dans le bandeau : uniquement du formatage. */
	for (const calcul of ['KCAL_PAR_KG', '7700', '7 700', '* 4', '/ 7', 'Math.round']) {
		assert.ok(!bandeau.includes(calcul), `aucun nouveau calcul dans le bandeau (${calcul})`);
	}

	/* Synchronisé : un objectif modifié change les trois repères. */
	const i1 = impact(1531);
	const i2 = impact(1550);
	assert.notEqual(i1.deficitPct, i2.deficitPct);
	assert.notEqual(i1.perteGraisseKg, i2.perteGraisseKg);
	assert.notEqual(i1.disponibiliteKcal, i2.disponibiliteKcal);
	assert.equal(i2.objectifKcal, 1550, 'objectif affiché = objectif appliqué');

	/* Absent du mode présentation : la vue épurée tient sur un écran et
	   affiche déjà ces repères (aucun doublon). */
	const debutPresentation = adminPage.indexOf('{#if calPresentation}');
	const finPresentation = adminPage.indexOf('{:else}', debutPresentation);
	assert.ok(debutPresentation > 0 && finPresentation > debutPresentation, 'branche présentation trouvée');
	const branchePresentation = adminPage.slice(debutPresentation, finPresentation);
	assert.ok(!branchePresentation.includes('Synthèse du calibrage'), 'bandeau masqué en mode présentation');
	assert.ok(adminPage.includes('aria-label="Synthèse du calibrage"'), 'bandeau présent en mode normal');
});

/* ═══════════ 3 · Couleurs des macros = Journal alimentaire cliente ═══════════ */

test('MACROS : protéines bleu, lipides orange, glucides rose — identiques au Journal', () => {
	/* Couleurs publiées par le Journal alimentaire de l'app cliente. */
	const journal = {};
	for (const match of journalPage.matchAll(
		/\{\s*key:\s*'(carbs|protein|fat)',\s*label:\s*'([^']+)',\s*icon:\s*'[^']+',\s*color:\s*'(#[0-9a-fA-F]{6})'/g
	)) {
		journal[match[1]] = { label: match[2], color: match[3].toLowerCase() };
	}
	assert.equal(Object.keys(journal).length, 3, 'les 3 macros du Journal sont lues');
	assert.equal(journal.carbs.color, '#ec4899', 'glucides = rose du Journal');
	assert.equal(journal.protein.color, '#3b82f6', 'protéines = bleu du Journal');
	assert.equal(journal.fat.color, '#f97316', 'lipides = orange du Journal');

	/* Source unique partagée : $lib/macros (Accueil, Performance, CRM). */
	for (const macro of MACRO_DEFS) {
		assert.equal(macro.color.toLowerCase(), journal[macro.key].color, `${macro.label} : même couleur que le Journal`);
		assert.equal(macro.label, journal[macro.key].label);
	}

	/* Le CRM lit ces couleurs, il ne les recopie pas. */
	assert.ok(adminPage.includes("import { MACRO_DEFS } from '$lib/macros';"), 'MACRO_DEFS importé');
	for (const key of ['carbs', 'protein', 'fat']) {
		assert.ok(adminPage.includes(`macroColor('${key}')`), `couleur ${key} tirée de MACRO_DEFS`);
	}

	/* Ligne « Macros du jour type » des résultats. */
	const debutResultats = adminPage.indexOf('<!-- RÉSULTATS : sortie du module');
	const finResultats = adminPage.indexOf('<!-- SEMAINE TYPE : un apport par jour');
	const resultats = adminPage.slice(debutResultats, finResultats);
	const ligneMacros = resultats.slice(resultats.indexOf('Macros du jour type'));
	assert.ok(ligneMacros.includes("macroColor('protein')"), 'protéines en bleu dans les résultats');
	assert.ok(ligneMacros.includes("macroColor('fat')"), 'lipides en orange dans les résultats');
	assert.ok(ligneMacros.includes("macroColor('carbs')"), 'glucides en rose dans les résultats');

	/* Mode présentation : mêmes couleurs, lisibles par la cliente. */
	const debutPresentation = adminPage.indexOf('{#if calPresentation}');
	const finPresentation = adminPage.indexOf('{:else}', debutPresentation);
	const presentation = adminPage.slice(debutPresentation, finPresentation);
	assert.ok(presentation.includes("macroColor('protein')") && presentation.includes("macroColor('carbs')"), 'macros colorées en présentation');
});

/* ═══════════ 4 · Perte de graisse en violet, objectif en vert ═══════════ */

test('VIOLET : perte de graisse estimée en violet partout ; objectif en vert ; seuils inchangés', () => {
	/* Jeton de couleur dédié (violet), aucune couleur de macro détournée. */
	assert.match(layoutCss, /--color-loss:\s*#7c3aed;/, 'jeton violet de la perte de graisse');

	const occurrences = adminPage.match(/text-loss\b/g) ?? [];
	assert.ok(occurrences.length >= 6, `perte en violet dans tous les blocs (${occurrences.length} occurrences)`);

	/* Bandeau : objectif vert, perte violette. */
	const bandeau = sansCommentaires(
		adminPage.slice(adminPage.indexOf('<!-- BANDEAU DE SYNTHÈSE'), adminPage.indexOf('<!-- ENTRÉES : pré-remplies'))
	);
	assert.ok(bandeau.includes('text-brand-dark'), 'objectif journalier en vert dans le bandeau');
	assert.ok(/text-loss[^"]*">\{formatPerteGraisse\(calImpact\.perteGraisseKg\)\}/.test(bandeau), 'perte en violet dans le bandeau (format unique C2c-3)');

	/* Encadré d'impact : perte violette, disponibilité sur la couleur de son seuil. */
	const impactBloc = adminPage.slice(adminPage.indexOf("Impact de l'objectif appliqué"), adminPage.indexOf('<!-- Cohérence 4G + 4P + 9L'));
	assert.ok(impactBloc.includes('text-loss'), 'perte en violet dans l’encadré d’impact');
	assert.ok(impactBloc.includes('DISPONIBILITE_NIVEAUX[calImpact.niveauDisponibilite].couleur'), 'disponibilité : couleur du seuil');

	/* Sous le déficit choisi : violet (et plus le vert de l'objectif).
	   Ancre sur le libellé du formulaire (`</span>`), pas sur le commentaire
	   du script qui contient les mêmes mots. */
	const blocDeficit = adminPage.slice(
		adminPage.indexOf('Déficit choisi (% du budget)</span>'),
		adminPage.indexOf('Protéines (g/kg de masse maigre)')
	);
	assert.ok(blocDeficit.length > 0, 'bloc du déficit choisi trouvé');
	assert.ok(blocDeficit.includes('text-loss'), 'perte estimée en violet sous le déficit choisi');
	assert.ok(!blocDeficit.includes('text-brand-dark'), 'plus de vert sur la perte du déficit choisi');

	/* Résultats et présentation : même violet. */
	const resultats = adminPage.slice(
		adminPage.indexOf('<!-- RÉSULTATS : sortie du module'),
		adminPage.indexOf('<!-- SEMAINE TYPE : un apport par jour')
	);
	assert.ok(resultats.includes('Perte de graisse estimée</div>'), 'carte perte des résultats');
	assert.ok(/text-loss">\{String\(calR\.perteGraisseKg\)/.test(resultats), 'perte en violet dans les résultats');

	const presentation = adminPage.slice(
		adminPage.indexOf('{#if calPresentation}'),
		adminPage.indexOf('{:else}', adminPage.indexOf('{#if calPresentation}'))
	);
	assert.ok(presentation.includes("classe: 'text-loss'"), 'perte en violet en mode présentation');
	assert.ok(presentation.includes("classe: 'text-brand-dark'"), 'objectif en vert en mode présentation');
});

/* ═══════════ 5 · Supplément travail : libellé et phrase clairs ═══════════ */

test('SUPPLÉMENT TRAVAIL : « +0,05 · travail de bureau » et la phrase d’aide, valeurs dynamiques', () => {
	/* Textes construits depuis le barème : aucune valeur figée. */
	assert.equal(fiche.LIBELLE_SUPPLEMENT_TRAVAIL, '+0,05 · travail de bureau');
	assert.equal(fiche.phraseSupplementTravail(), "Chaque heure en mouvement ajoute 0,05, jusqu'à 0,60 au maximum.");

	const sourceAide = ficheSource.slice(ficheSource.indexOf('export function phraseSupplementTravail'));
	assert.ok(sourceAide.includes('SUPPLEMENT_TRAVAIL_PAR_HEURE'), '0,05 par heure issu du barème');
	assert.ok(sourceAide.includes('SUPPLEMENT_TRAVAIL_PLAFOND'), '0,60 maximum issu du barème');

	/* Affichage : ancien texte remplacé, valeurs et heures dynamiques. */
	assert.ok(!adminPage.includes('plafonné à 0,6'), 'ancienne formule retirée');
	assert.ok(!adminPage.includes('0,05 × h'), 'ancienne formule (× h) retirée');
	const blocSupplement = adminPage.slice(
		adminPage.indexOf('Supplément travail</span>'),
		adminPage.indexOf('Déficit choisi (% du budget)</span>')
	);
	assert.ok(blocSupplement.length > 0, 'bloc « Supplément travail » trouvé');
	/* C2c-5a : le bloc affiche le total et son détail, calculés par
	   `supplementTravailTextes` depuis les heures saisies. */
	assert.ok(blocSupplement.includes('supplementTravailTextes(calibrageInputs.heuresTravail)'), 'total et détail du supplément');
	assert.ok(blocSupplement.includes('{supplementTextes.total}'), 'ligne 1 : total');
	assert.ok(blocSupplement.includes('{supplementTextes.detail}'), 'ligne 2 : détail');
	assert.ok(blocSupplement.includes('{phraseSupplementTravail()}'), 'phrase d’aide affichée en dessous');
	assert.ok(blocSupplement.includes('calibrageInputs.heuresTravail'), 'nombre d’heures dynamique');
	/* C2c-3 : le champ « Ajustement du coach » est supprimé et le supplément
	   n'affiche plus que « +0,05 · travail de bureau · X h » et la phrase d'aide. */
	assert.ok(!adminPage.includes('Ajustement du coach'), 'champ d’ajustement supprimé');
	assert.ok(!blocSupplement.includes('calR.supplementTravail'), 'plus de valeur chiffrée : le libellé et la phrase suffisent');

	/* Aucun calcul modifié : les repères du barème sont inchangés. */
	assert.equal(cal.supplementTravail({ heures: 0 }), 0.05);
	assert.equal(cal.supplementTravail({ heures: 2 }), 0.15);
	assert.equal(cal.supplementTravail({ heures: 6 }), 0.35);
	assert.equal(cal.supplementTravail({ heures: 12 }), 0.6);
	assert.equal(cal.supplementTravail({ heures: 12, ajustementCoach: 0.05 }), 0.65);
});
