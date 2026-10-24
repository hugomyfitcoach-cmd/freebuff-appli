/**
 * Mission C2c-3 — CALIBRAGE : saisie libre, « la dernière action gagne »,
 * avertissements simplifiés, format unique de la perte.
 *
 * Vérifié :
 *  1. VALEUR 2 309 : toute valeur entière est acceptée dans le bloc
 *     « Appliquer à la fiche » (aucune contrainte min/max/step → jamais de
 *     message de validation du navigateur) et le bouton « Appliquer » n'est
 *     JAMAIS bloqué par un nombre non rond ;
 *  2. FLÈCHES : +10 / −10 kcal par clic (+1 / −1 g pour les macros) et chaque
 *     clic met à jour immédiatement l'encadré d'impact, le bandeau et la
 *     semaine type (dérivés réactifs de l'objectif saisi) ;
 *  3. DERNIÈRE ACTION GAGNE : une nouvelle entrée du calibrage recalcule les
 *     champs du bloc et efface les badges « modifié » ; l'avertissement
 *     « Les résultats ont changé — tes champs modifiés sont conservés » est
 *     supprimé ; les jours de la semaine type saisis à la main restent protégés ;
 *  4. AVERTISSEMENT 15 % : « Déficit supérieur à la règle de 10 à 15 % »
 *     supprimé partout ; conservé : le message au-delà de 25 %, les plafonds
 *     Alpert / Macdonald et les seuils de disponibilité en énergie ;
 *  5. PERTE DE GRAISSE : un seul format partout (sous le déficit, encadré
 *     d'impact, bandeau, semaine type) — arrondi au 0,05 kg, TOUJOURS deux
 *     décimales (0,20 ; 0,30 ; 0,40) — via une SEULE fonction de formatage ;
 *  6. AJUSTEMENT DU COACH : champ « Ajustement du coach (0 à +0,05) » supprimé,
 *     module de calcul inchangé (ajustement transmis à 0 pour les nouveaux
 *     calibrages), historique des anciens calibrages intact.
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
const calibrageSource = readFileSync(join(root, 'src/lib/calibrage.ts'), 'utf8');
const ficheSource = readFileSync(join(root, 'src/lib/calibrageFiche.ts'), 'utf8');

const cal = await import(new URL('../src/lib/calibrage.ts', import.meta.url).href);
const fiche = await import(new URL('../src/lib/calibrageFiche.ts', import.meta.url).href);
const gm = await import(new URL('../src/lib/goalMacros.ts', import.meta.url).href);

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

/** Balise <input …/> du champ de saisie `bind:value={champ}` du bloc Appliquer. */
function baliseInput(champ) {
	const index = adminPage.indexOf(`bind:value={${champ}}`);
	assert.ok(index > 0, `champ ${champ} présent dans le bloc « Appliquer à la fiche »`);
	const debut = adminPage.lastIndexOf('<input', index);
	const fin = adminPage.indexOf('/>', index) + 2;
	return adminPage.slice(debut, fin);
}

/* ═══════════ 1 · Valeur 2 309 acceptée, sans validation du navigateur ═══════════ */

test('VALEUR 2 309 : toute valeur entière est acceptée — aucune contrainte, aucun message navigateur', () => {
	/* Module : 2 309 kcal est une valeur entière comme une autre — acceptée,
	   conservée comme référence de recalcul, application non bloquée. */
	const r = gm.recalculerObjectif({ kcal: 2309, glucidesG: 352, proteinesG: 90, lipidesG: 60 }, 'kcal');
	assert.equal(r.kcalReference, 2309, 'valeur 2 309 acceptée comme référence');
	assert.equal(r.messageBlocage, null, 'aucun blocage pour un nombre non rond');
	assert.equal(gm.messageBlocageGlucides(352), null);
	const res = fiche.resultatsFiche(ENTREES);
	assert.ok(Number.isFinite(res.objectifJournalierKcal), 'calcul complet avec des valeurs non rondes');

	/* Saisie : les quatre champs kcal / macros portent `step="any"` et AUCUNE
	   contrainte min / max / required → jamais de message de validation du
	   navigateur, quels que soient les chiffres tapés. */
	for (const champ of ['applyKcal', 'applyCarbs', 'applyProtein', 'applyFat']) {
		const balise = baliseInput(champ);
		assert.ok(balise.includes('type="number"'), `${champ} : champ numérique`);
		assert.ok(balise.includes('step="any"'), `${champ} : aucune contrainte de pas`);
		assert.ok(!balise.includes('min='), `${champ} : pas de minimum navigateur`);
		assert.ok(!balise.includes('max='), `${champ} : pas de maximum navigateur`);
		assert.ok(!balise.includes('required'), `${champ} : jamais requis`);
		assert.ok(balise.includes('no-spinner'), `${champ} : flèches natives remplacées par les boutons du CRM`);
	}

	/* Bouton « Appliquer » : jamais bloqué par un nombre non rond — seulement
	   par l'absence de résultats ou par des glucides calculés négatifs. */
	assert.ok(adminPage.includes('disabled={!calR}'), 'seule garde du bouton : résultats disponibles');
	const demarrage = adminPage.slice(
		adminPage.indexOf('function demarrerApplication'),
		adminPage.indexOf('async function appliquerCalibrage')
	);
	assert.ok(demarrage.includes('if (applyBlocageGlucides)'), 'seul blocage : glucides négatifs');
	assert.ok(!/Math\.round|arrondi|multiple/.test(demarrage), 'aucune vérification d’arrondi');
});

/* ═══════════ 2 · Flèches +10 / −10 kcal · +1 / −1 g, recalcul immédiat ═══════════ */

test('FLÈCHES : +10 / −10 kcal par clic, +1 / −1 g pour les macros, mise à jour immédiate', () => {
	/* Pas par champ : 10 kcal, 1 g. */
	assert.ok(
		adminPage.includes('kcal: 10, glucides: 1, proteines: 1, lipides: 1'),
		'pas des flèches : 10 kcal, 1 g'
	);
	/* Chaque champ porte ses deux flèches, branchées sur `flecheSaisie`. */
	for (const [champ, sens] of [
		['kcal', 1], ['kcal', -1],
		['glucides', 1], ['glucides', -1],
		['proteines', 1], ['proteines', -1],
		['lipides', 1], ['lipides', -1]
	]) {
		assert.ok(
			adminPage.includes(`onclick={() => flecheSaisie('${champ}', ${sens})}`),
			`flèche ${sens > 0 ? '+' : '−'} pour ${champ} branchée`
		);
	}
	/* Chaque clic recalcule immédiatement : la fonction finit par le recalcul
	   du bloc (objectif = 4G + 4P + 9L) et les affichages en dérivent. */
	const fn = adminPage.slice(adminPage.indexOf('function flecheSaisie'), adminPage.indexOf('function flecheSaisie') + 900);
	assert.ok(fn.includes('recalculerApresSaisie(champ)'), 'recalcul immédiat au clic');
	assert.ok(fn.includes('base + sens * PAS_FLECHES[champ]'), 'le pas s’ajoute à la valeur courante');
	/* Impact, bandeau et semaine type sont dérivés de l’objectif saisi : le clic
	   les met à jour dans le même rendu. */
	assert.ok(adminPage.includes('objectifKcal: applyKcal'), 'encadré d’impact recalculé depuis l’objectif saisi');
	assert.ok(adminPage.includes('semaineAvecEcarts(calibrageInputs, calR, ecartsSemaine)'), 'semaine type recalculée');
	const bandeau = adminPage.slice(adminPage.indexOf('BANDEAU DE SYNTHÈSE'), adminPage.indexOf('ENTRÉES : pré-remplies'));
	assert.ok(bandeau.includes('calImpact.objectifKcal') && bandeau.includes('calImpact.perteGraisseKg'), 'bandeau alimenté par l’impact');

	/* Comportement module : +10 depuis 2 309 → 2 319, nouvelle référence. */
	const base = gm.recalculerObjectif({ kcal: 2309, glucidesG: 352, proteinesG: 90, lipidesG: 60 }, 'kcal');
	const apres = gm.recalculerObjectif(
		{ kcal: base.kcalReference + 10, glucidesG: base.valeurs.glucidesG, proteinesG: 90, lipidesG: 60 },
		'kcal'
	);
	assert.equal(apres.kcalReference, 2319, 'un clic de flèche vaut exactement +10 kcal');
});

/* ═══════════ 3 · « La dernière action gagne » ═══════════ */

test('DERNIÈRE ACTION GAGNE : nouvelle entrée → champs recalculés, badges « modifié » effacés', () => {
	/* Le suivi recalcule TOUJOURS les cinq champs et réaligne les références :
	   dès qu'une entrée du calibrage change, les badges « modifié » disparaissent. */
	const suivi = adminPage.slice(adminPage.indexOf('$effect(() => {'), adminPage.indexOf('function recalculerApresSaisie'));
	assert.ok(!suivi.includes('applyKcal === refKcal'), 'plus jamais de champ figé sur une modification');
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
		'refFat = applyFat;'
	]) {
		assert.ok(suivi.includes(ligne), `recalcul + réalignement : ${ligne}`);
	}
	/* Les badges « modifié » restent pour la saisie manuelle (comparaison aux
	   références) — ils s'effacent donc seuls après le recalcul ci-dessus. */
	for (const badge of [
		'{#if applyKcal !== refKcal}',
		'{#if applyMaintenance !== refMaintenance}',
		'{#if applyCarbs !== refCarbs}',
		'{#if applyProtein !== refProtein}',
		'{#if applyFat !== refFat}'
	]) {
		assert.ok(adminPage.includes(badge), `badge conservé : ${badge}`);
	}
	/* L'avertissement « Les résultats ont changé — tes champs modifiés sont
	   conservés » et son bouton de reprise sont SUPPRIMÉS. */
	assert.ok(!adminPage.includes('Les résultats ont changé'), 'avertissement de conservation supprimé');
	assert.ok(!adminPage.includes('Reprendre les valeurs calculées'), 'bouton de reprise supprimé');
	assert.ok(!adminPage.includes('applyResultatsChanges') && !adminPage.includes('calcPrecedent'), 'logique de conservation supprimée');

	/* Les jours de la semaine type modifiés à la main restent protégés. */
	const entrees = { ...ENTREES, apportsSemaine: [null, 1400, null, null, null, null, 1300] };
	const r = fiche.resultatsFiche(entrees);
	const sem = fiche.semaineAvecObjectif(entrees, r, 1550);
	assert.equal(sem.apportsKcal[1], 1400, 'jour saisi à la main préservé');
	assert.equal(sem.apportsKcal[6], 1300, 'jour saisi à la main préservé');
	assert.equal(sem.apportsKcal[0], 1550, 'les jours « type » suivent l’objectif appliqué');
});

/* ═══════════ 4 · Avertissement « règle de 10 à 15 % » supprimé ═══════════ */

test('AVERTISSEMENT 15 % absent : message supprimé partout, > 25 % / plafonds / seuils conservés', () => {
	/* Module : plus aucune trace du message ni de son seuil. */
	assert.equal('avertissement' in cal.bilanObjectifSemaine({ budgetSemaineKcal: 12_327, deficitPct: 22 }), false);
	assert.equal('avertissementDeficit' in fiche.resultatsFiche({ ...ENTREES, deficitPct: 22 }), false);
	assert.equal('avertissementDeficit' in fiche.impactObjectifApplique({
		entrees: ENTREES,
		resultats: fiche.resultatsFiche(ENTREES),
		objectifKcal: 1550
	}), false);
	assert.ok(!calibrageSource.includes('règle de 10 à 15'), 'message absent du module');
	assert.ok(!ficheSource.includes('règle de 10 à 15'), 'message absent du module fiche');
	assert.ok(!adminPage.includes('règle de 10 à 15'), 'message absent du CRM');
	assert.ok(!adminPage.includes('avertissementDeficit}'), 'aucun rendu du champ supprimé');

	/* Conservés : attention > 25 %, plafonds Alpert / Macdonald, disponibilité. */
	const dur = cal.bilanObjectifSemaine({ budgetSemaineKcal: 12_327, deficitPct: 26 });
	assert.equal(dur.avertissementDeficitEleve, 'Déficit au-delà de 25 % à prendre en compte.');
	const r = fiche.resultatsFiche({ ...ENTREES, mgPct: 5, deficitPct: 20, seances: [] });
	assert.ok(r.alertePlafonds, 'plafonds Alpert / Macdonald conservés');
	assert.ok(r.avertissementDisponibilite, 'seuils de disponibilité conservés');
	assert.ok(adminPage.includes('{calR.avertissementDeficitEleve}'), 'message > 25 % affiché');
	assert.ok(adminPage.includes('{calR.alertePlafonds}'), 'plafonds affichés');
	assert.ok(adminPage.includes('calR.avertissementDisponibilite'), 'disponibilité affichée');
});

/* ═══════════ 5 · Perte de graisse : un seul format partout ═══════════ */

test('PERTE DE GRAISSE : format unique partout — 0,05 kg, deux décimales, une seule fonction', () => {
	/* La SEULE fonction de formatage : arrondi au 0,05 kg, deux décimales FR. */
	assert.equal(fiche.formatPerteGraisse(0.2), '0,20');
	assert.equal(fiche.formatPerteGraisse(0.3), '0,30');
	assert.equal(fiche.formatPerteGraisse(0.4), '0,40');
	assert.equal(fiche.formatPerteGraisse(0.32), '0,30', 'arrondi au 0,05 kg le plus proche');
	assert.equal(fiche.formatPerteGraisse(0.274), '0,25');
	assert.equal(fiche.formatPerteGraisse(0.25), '0,25', 'deux décimales toujours');
	assert.equal(fiche.formatPerteGraisse(-0.02), '0,00', 'jamais de −0,00');
	for (const valeur of [0.2, 0.32, 0.274, 1.15]) {
		assert.ok(!/[0-9]\.[0-9]/.test(fiche.formatPerteGraisse(valeur)), 'décimales françaises');
	}
	/* Sources différentes → MÊME rendu. */
	assert.equal(
		fiche.formatPerteGraisse(fiche.perteGraisseKgSemaine(2465)),
		fiche.formatPerteGraisse(0.32),
		'format identique quelle que soit la source de la perte'
	);

	/* Les QUATRE emplacements utilisent cette fonction : sous le déficit,
	   encadré d'impact, bandeau et semaine type. */
	assert.ok(adminPage.includes('formatPerteGraisse(calPerteDeficit)'), 'sous le déficit');
	assert.ok(adminPage.includes('formatPerteGraisse(Math.abs(calSemaine.graisseKg))'), 'semaine type');
	const impact = (adminPage.match(/formatPerteGraisse\(calImpact\.perteGraisseKg\)/g) ?? []).length;
	assert.equal(impact, 2, 'encadré d’impact + bandeau');
	/* Une seule fonction de formatage : aucune autre formule de format de la
	   perte dans les quatre emplacements. */
	assert.ok(!adminPage.includes('decimalFr(calPerteDeficit)'), 'sous le déficit : plus de format ad hoc');
	assert.ok(!adminPage.includes('String(Math.abs(calSemaine.graisseKg))'), 'semaine type : plus de format ad hoc');
	assert.ok(!adminPage.includes('decimalFr(calImpact.perteGraisseKg)'), 'impact / bandeau : plus de format ad hoc');
});

/* ═══════════ 6 · Champ « Ajustement du coach » supprimé ═══════════ */

test('AJUSTEMENT DU COACH : champ supprimé, module inchangé (ajustement transmis à 0), historique intact', () => {
	/* Le champ et sa saisie ont disparu de l'onglet. */
	assert.ok(!adminPage.includes('Ajustement du coach'), 'libellé du champ supprimé');
	assert.ok(!adminPage.includes('bind:value={calibrageInputs.ajustementTravail}'), 'saisie supprimée');
	/* Les nouveaux calibrages transmettent TOUJOURS l'ajustement à 0. */
	const transmissions = (adminPage.match(/ajustementTravail: 0,/g) ?? []).length;
	assert.equal(transmissions, 2, 'initialisation + rechargement : ajustement transmis à 0');
	assert.ok(!adminPage.includes('ajustementTravail: 0.0'), 'aucun ajustement non nul transmis');
	/* Le module de calcul reste INCHANGÉ : l'ajustement du coach existe
	   toujours côté calcul (transmis à 0 depuis l'onglet). */
	assert.equal(cal.supplementTravail({ heures: 2 }), 0.15, 'repère du barème inchangé');
	assert.equal(cal.supplementTravail({ heures: 2, ajustementCoach: 0 }), 0.15, 'ajustement transmis à 0');
	assert.equal(cal.supplementTravail({ heures: 12, ajustementCoach: 0.05 }), 0.65, 'capacité du module inchangée');
	const r = fiche.resultatsFiche(ENTREES);
	assert.equal(r.supplementTravail, cal.supplementTravail({ heures: ENTREES.heuresTravail }), 'ajustement 0 côté fiche');
	/* L'historique des anciens calibrages continue d'afficher l'ajustement
	   stocké, sans erreur. */
	assert.ok(adminPage.includes('d.ajustementTravail'), 'anciennes lignes : ajustement affiché tel quel');
	/* Le supplément travail affiche le total et son détail (C2c-5a), puis la
	   phrase d'aide — valeurs du barème et heures dynamiques. */
	assert.ok(adminPage.includes('supplementTravailTextes(calibrageInputs.heuresTravail)'), 'total + détail depuis les heures');
	assert.ok(adminPage.includes('{supplementTextes.total}'), 'ligne 1 : total');
	assert.ok(adminPage.includes('{phraseSupplementTravail()}'), 'phrase d’aide');
	assert.equal(fiche.phraseSupplementTravail(), "Chaque heure en mouvement ajoute 0,05, jusqu'à 0,60 au maximum.");
});
