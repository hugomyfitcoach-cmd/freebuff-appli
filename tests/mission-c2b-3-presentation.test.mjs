/**
 * Mission C2b-3 — MODE PRÉSENTATION : messages cliente rassurants, info
 * glucides discrète, recalcul des glucides ancré, formulations « le coach ».
 *
 * Vérifié :
 *  1. Messages du mode présentation pour CHAQUE cas, dans les deux modes :
 *     - disponibilité ≥ 30 → « Ton énergie disponible : X. …fonctionner. » ;
 *     - disponibilité de 24 à 30 → « Zone à surveiller… » ;
 *     - déficit de 15 à 30 % → « Rythme soutenu… » ;
 *     - disponibilité sous 24 OU perte au-dessus des plafonds → AUCUN message
 *       côté cliente + mention coach « À ajuster avant de présenter » (mode
 *       normal uniquement) ; mode normal inchangé (mêmes avertissements) ;
 *     - jamais les mots alerte, risque, dépasse, exceptionnelle, ni les noms
 *       des plafonds nommés d'après les références de perte, en présentation ;
 *  2. Glucides < 100 g : information grise neutre (jamais une alerte orange),
 *     absente du mode présentation ;
 *  3. 10 modifications successives des lipides → écart entre l'objectif de
 *     référence et 4G + 4P + 9L JAMAIS supérieur à 2 kcal (pas de cumul) ;
 *  4. Plus aucune occurrence genrée « article féminin + coach » ou
 *     « possessif ta + coach » dans le code de l'interface (src + tests +
 *     docs + scripts + README).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const presentation = await import(new URL('../src/lib/calibragePresentation.ts', import.meta.url).href);
const goalMacros = await import(new URL('../src/lib/goalMacros.ts', import.meta.url).href);
const calibrageLib = await import(new URL('../src/lib/calibrage.ts', import.meta.url).href);
const { messagesPresentation, mentionAjusterAvantDePresenter, MENTION_AJUSTER_AVANT_DE_PRESENTER } =
	presentation;
const { recalculerObjectif, kcalDepuisMacros } = goalMacros;
const adminPage = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');

/* Découpage des deux modes dans le CRM : branche présentation ↔ branche normal. */
const debutPresentation = adminPage.indexOf('{#if calPresentation}');
const finPresentation = adminPage.indexOf('{:else}', debutPresentation);
assert.ok(debutPresentation > 0 && finPresentation > debutPresentation, 'blocs présentation / normal présents');
const branchePresentation = adminPage.slice(debutPresentation, finPresentation);
const brancheNormal = adminPage.slice(finPresentation);
/* Les commentaires Svelte ne s'affichent jamais : on les retire avant de
   scanner les textes réellement rendus à l'écran. */
const sansCommentaires = (t) => t.replace(/<!--[\s\S]*?-->/g, '');
const textePresentation = sansCommentaires(branchePresentation);

/** Mots JAMAIS affichables en mode présentation. */
const MOTS_INTERDITS = ['alerte', 'risque', 'dépasse', 'exceptionnelle', 'alpert', 'macdonald'];
function assertSansMotInterdit(texte, label) {
	const bas = texte.toLowerCase();
	for (const mot of MOTS_INTERDITS) {
		assert.ok(!bas.includes(mot), `${label} : le mot « ${mot} » ne doit jamais s'afficher`);
	}
}

/* Profil d'entrée des messages (valeurs quelconques dans chaque zone). */
const base = {
	disponibiliteKcal: 31.2,
	deficitPct: 10,
	perteGraisseKg: 0.3,
	vitesseMaxAlpertKgSemaine: 0.74
};

/* ═══ 1 · Messages du mode présentation — chaque cas, les deux modes ═══ */

test('PRÉSENTATION : disponibilité ≥ 30 → repère chiffré rassurant', () => {
	const m = messagesPresentation({ ...base, disponibiliteKcal: 31.2 });
	assert.equal(
		m.energie,
		'Ton énergie disponible : 31,2 kcal/kg de masse maigre. Au-dessus du seuil de sécurité de 30 : ton corps a de quoi bien fonctionner.'
	);
	assert.equal(m.rythme, null, 'déficit < 15 % : aucun message de rythme');
	assert.equal(mentionAjusterAvantDePresenter({ ...base, disponibiliteKcal: 31.2 }), false);
	/* Seuil exact : 30 est dans la zone haute. */
	assert.match(
		messagesPresentation({ ...base, disponibiliteKcal: 30 }).energie ?? '',
		/Au-dessus du seuil de sécurité de 30/
	);
});

test('PRÉSENTATION : disponibilité de 24 à 30 → « Zone à surveiller »', () => {
	for (const dispo of [24, 26.5, 29.9]) {
		const m = messagesPresentation({ ...base, disponibiliteKcal: dispo });
		assert.equal(
			m.energie,
			'Zone à surveiller : on suivra ton énergie et ta récupération chaque semaine.',
			`dispo ${dispo}`
		);
	}
	assert.equal(mentionAjusterAvantDePresenter({ ...base, disponibiliteKcal: 24 }), false);
});

test('PRÉSENTATION : déficit de 15 à 30 % → « Rythme soutenu »', () => {
	for (const deficit of [15, 20, 25, 30]) {
		const m = messagesPresentation({ ...base, deficitPct: deficit });
		assert.equal(m.rythme, 'Rythme soutenu, choisi pour toi, avec un suivi rapproché.', `déficit ${deficit} %`);
	}
	assert.equal(messagesPresentation({ ...base, deficitPct: 14.9 }).rythme, null);
	assert.equal(messagesPresentation({ ...base, deficitPct: 31 }).rythme, null);
});

test('PRÉSENTATION : disponibilité < 24 → aucun message côté cliente + mention coach', () => {
	const entrees = { ...base, disponibiliteKcal: 23.9 };
	assert.deepEqual(messagesPresentation(entrees), { energie: null, rythme: null }, 'aucun message côté cliente');
	assert.equal(mentionAjusterAvantDePresenter(entrees), true, 'mention coach requise');
});

test('PRÉSENTATION : perte au-dessus des plafonds → aucun message côté cliente + mention coach', () => {
	/* Perte estimée au-dessus du premier plafond (0,74 kg/sem). */
	const entrees = { ...base, perteGraisseKg: 0.75 };
	assert.deepEqual(messagesPresentation(entrees), { energie: null, rythme: null });
	assert.equal(mentionAjusterAvantDePresenter(entrees), true);
	/* Même avec un déficit de 20 % : toujours rien côté cliente. */
	assert.deepEqual(messagesPresentation({ ...entrees, deficitPct: 20 }), { energie: null, rythme: null });
	/* À l'intérieur des plafonds : pas de mention. */
	assert.equal(mentionAjusterAvantDePresenter({ ...base, perteGraisseKg: 0.74 }), false);
});

test('PRÉSENTATION : les messages produits ne contiennent AUCUN mot interdit', () => {
	for (const dispo of [15, 23.9, 24, 26, 29.9, 30, 33]) {
		for (const deficit of [0, 15, 25, 30]) {
			for (const perte of [0.2, 0.74, 1.2]) {
				const m = messagesPresentation({
					disponibiliteKcal: dispo,
					deficitPct: deficit,
					perteGraisseKg: perte,
					vitesseMaxAlpertKgSemaine: 0.74
				});
				assertSansMotInterdit(
					`${m.energie ?? ''} ${m.rythme ?? ''}`,
					`dispo ${dispo} / déficit ${deficit} / perte ${perte}`
				);
			}
		}
	}
});

test('MODES : messages cliente UNIQUEMENT en présentation, mention coach UNIQUEMENT en mode normal', () => {
	assert.ok(
		branchePresentation.includes('calMessagesPresentation.energie') &&
			branchePresentation.includes('calMessagesPresentation.rythme'),
		'la présentation affiche les messages cliente'
	);
	assert.ok(!brancheNormal.includes('calMessagesPresentation'), "le mode normal n'affiche JAMAIS les messages cliente");
	assert.ok(!branchePresentation.includes('MENTION_AJUSTER_AVANT_DE_PRESENTER'), 'la mention coach reste en mode normal');
	assert.ok(
		brancheNormal.includes('MENTION_AJUSTER_AVANT_DE_PRESENTER') && brancheNormal.includes('calMentionAjuster'),
		'le mode normal affiche la mention « À ajuster avant de présenter »'
	);
	assert.equal(MENTION_AJUSTER_AVANT_DE_PRESENTER, 'À ajuster avant de présenter');
});

test('MODE NORMAL INCHANGÉ : les avertissements coach existants sont toujours affichés', () => {
	for (const avertissement of [
		'calR.avertissementDeficit',
		'calR.avertissementDeficitEleve',
		'calR.alertePlafonds',
		'calR.avertissementDisponibilite',
		'calR.avertissementAdaptation'
	]) {
		assert.ok(brancheNormal.includes(avertissement), `mode normal inchangé : ${avertissement}`);
	}
	/* Les formulations coach d'origine sont intactes (formules et seuils inchangés). */
	assert.ok(calibrageLib.ADAPTATION_AVERTISSEMENT.includes('exceptionnelle'), 'message coach inchangé');
});

test('PRÉSENTATION : aucun texte rendu ne contient mot interdit ni nom de plafond', () => {
	assertSansMotInterdit(textePresentation, 'écran de présentation');
});

/* ═══ 2 · Glucides < 100 g : information discrète, masquée en présentation ═══ */

test('GLUCIDES < 100 g : texte exact, information neutre partagée', () => {
	const attendu = "Glucides sous 100 g : surveiller l'énergie à l'entraînement et la récupération.";
	assert.equal(calibrageLib.alerteGlucidesPour(99), attendu);
	assert.equal(goalMacros.alerteGlucidesPour(50), attendu, 'même message dans le bloc « Appliquer à la fiche »');
	assert.equal(calibrageLib.alerteGlucidesPour(100), null, 'à 100 g : rien');
});

test('GLUCIDES < 100 g : style gris neutre (jamais orange), masqué en présentation', () => {
	const lignes = adminPage.split('\n');
	const ligneMacros = lignes.find((l) => l.includes('{calR.macros.alerteGlucides}'));
	assert.ok(ligneMacros, 'info glucides affichée dans les résultats');
	assert.ok(ligneMacros.includes('text-mist'), 'style gris neutre');
	assert.ok(!ligneMacros.includes('text-warn') && !ligneMacros.includes('triangleAlert'), "plus d'alerte orange");
	const ligneApply = lignes.find((l) => l.includes('{applyAlerteGlucides}</p>'));
	assert.ok(ligneApply, 'info glucides affichée dans « Appliquer à la fiche »');
	assert.ok(ligneApply.includes('text-mist'), 'style gris neutre');
	assert.ok(!ligneApply.includes('text-warn') && !ligneApply.includes('triangleAlert'), "plus d'alerte orange");
	assert.ok(!branchePresentation.includes('alerteGlucides'), 'absente du mode présentation');
	assert.ok(adminPage.includes('alerteGlucidesPour(applyCarbs)'), 'message unique partagé conservé');
});

/* ═══ 3 · Recalcul des glucides : ancré sur l'objectif kcal de référence ═══ */

test('RECALCUL : 10 modifications successives des lipides → écart ≤ 2 kcal, jamais cumulé', () => {
	/* Même circuit que « Appliquer à la fiche » : la référence kcal reste
	   figée sur l'objectif de référence, seule l'affichage s'aligne. */
	const reference = 2247;
	let valeurs = { kcal: reference, glucidesG: 245, proteinesG: 148, lipidesG: 75 };
	let ancre = reference;
	for (let i = 1; i <= 10; i++) {
		const r = recalculerObjectif({ ...valeurs, lipidesG: 75 + i }, 'lipides', ancre);
		valeurs = r.valeurs;
		ancre = r.kcalReference;
		assert.equal(ancre, reference, `étape ${i} : référence kcal inchangée`);
		assert.equal(
			valeurs.kcal,
			4 * valeurs.glucidesG + 4 * valeurs.proteinesG + 9 * valeurs.lipidesG,
			`étape ${i} : objectif = 4G + 4P + 9L`
		);
		const ecart = Math.abs(valeurs.kcal - reference);
		assert.ok(ecart <= 2, `étape ${i} : écart ${ecart} kcal ≤ 2 (aucun cumul)`);
	}
});

test('RECALCUL : glucides = (objectif de référence − 4P − 9L) ÷ 4', () => {
	const r = recalculerObjectif({ kcal: 2248, glucidesG: 246, proteinesG: 148, lipidesG: 76 }, 'lipides', 2247);
	assert.equal(r.kcalReference, 2247, 'la référence transmise est conservée');
	assert.equal(
		r.valeurs.glucidesG,
		Math.round((2247 - 4 * 148 - 9 * 76) / 4),
		'glucides calculés depuis la référence (2 247), pas depuis 2 248'
	);
	/* Saisie d'objectif : la saisie devient la nouvelle référence. */
	const k = recalculerObjectif({ kcal: 2250, glucidesG: 246, proteinesG: 148, lipidesG: 76 }, 'kcal', 2247);
	assert.equal(k.kcalReference, 2250, 'objectif saisi = nouvelle référence');
	/* Saisie de glucides : la somme exacte devient la nouvelle référence. */
	const g = recalculerObjectif({ kcal: 2250, glucidesG: 240, proteinesG: 148, lipidesG: 76 }, 'glucides', 2247);
	assert.equal(g.valeurs.kcal, kcalDepuisMacros(g.valeurs));
	assert.equal(g.kcalReference, g.valeurs.kcal, 'somme exacte = nouvelle référence');
});

test('RECALCUL : le CRM transmet bien la référence et la conserve', () => {
	assert.ok(adminPage.includes('applyKcalReference'), 'le bloc « Appliquer à la fiche » tient une référence kcal');
	const zoneRecalcul = adminPage.slice(
		adminPage.indexOf('function recalculerApresSaisie'),
		adminPage.indexOf('const applyAlerteGlucides')
	);
	assert.ok(zoneRecalcul.includes('applyKcalReference'), 'la référence est passée au recalcul');
	assert.ok(zoneRecalcul.includes('applyKcalReference = r.kcalReference;'), 'la référence renvoyée est conservée');
	assert.ok(adminPage.includes('applyKcalReference = applyKcal;'), 'la référence suit les résultats et la reprise');
});

/* ═══ 4 · Formulations : plus aucune occurrence genrée « … + coach » ═══ */

test('FORMULATIONS : aucune occurrence « article féminin / possessif ta + coach » dans le code', () => {
	/* Motif construit sans littéral : ce test ne doit pas lui-même contenir
	   les tournures qu'il traque. */
	const motif = new RegExp(['la', 'ta'].map((det) => `${det} coach`).join('|'), 'i');
	const dossiers = ['src', 'tests', 'docs', 'scripts'];
	const fautifs = [];
	for (const dossier of dossiers) {
		for (const entree of readdirSync(join(root, dossier), { recursive: true, withFileTypes: true })) {
			if (!entree.isFile()) continue;
			const chemin = join(entree.parentPath, entree.name);
			if (motif.test(readFileSync(chemin, 'utf8'))) fautifs.push(`${dossier}/${entree.name}`);
		}
	}
	if (motif.test(readFileSync(join(root, 'README.md'), 'utf8'))) fautifs.push('README.md');
	assert.deepEqual(fautifs, [], `occurrences restantes : ${fautifs.join(', ')}`);
});
