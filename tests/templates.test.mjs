/**
 * Tests ciblés — MISSION TEMPLATES COACH :
 *  - Close & Bienvenue : 3 situations, champs, contenus exigés ;
 *  - Récap démarrage : champs + bloc TRACKING G-FLUX (zéro Virtuagym) ;
 *  - Relance bilan : message court exact ;
 *  - Préremplissage meetingUrl : « Démarrage » → Meet par défaut, « Suivi » → rien ;
 *  - Garde-fou global : AUCUNE référence Virtuagym / deuxième appli / badge bleu.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const templates = await import(new URL('../src/lib/coachTemplates.ts', import.meta.url).href);
const appointments = await import(new URL('../src/lib/appointments.ts', import.meta.url).href);

/* Garde-fou global mission §7 : aucune référence obsolète dans AUCUN template. */
const FORBIDDEN = [
	/Virtuagym/i,
	/Tracking KCAL/i,
	/badge bleu/i,
	/au hasard/i,
	/bym2026/, // ancien mot de passe (l'actuel est bypm2026)
	/seconde appli|deuxième application/i,
];

function assertNoLegacyRefs(msg, label) {
	for (const re of FORBIDDEN) {
		assert.ok(!re.test(msg), `${label} : référence obsolète interdite détectée (${re})`);
	}
}

/* ═══════════ CLOSE & BIENVENUE — 3 situations ═══════════ */

test('Situation 1 (pendant) : accès G-FLUX, mot de passe bypm2026, étapes, visio', () => {
	const msg = templates.genererClose('pendant', { prenom: 'Sophie', visio: 'lundi 28 avril à 14h15' });
	assert.ok(msg.includes('Bienvenue dans G-FLUX Sophie 👋'));
	assert.ok(msg.includes('https://app.myfit-coach.fr/'));
	assert.ok(msg.includes('bypm2026'));
	assert.ok(msg.includes("installer G-FLUX sur l'écran d'accueil"));
	assert.ok(msg.includes('ÉTAPE 1'));
	assert.ok(msg.includes('formulaire de démarrage'));
	assert.ok(msg.includes('mensurations et ajoute tes photos'));
	assert.ok(msg.includes('lundi 28 avril à 14h15'));
	assert.ok(msg.includes('https://meet.google.com/ajz-hoxy-tkz'));
	assert.ok(msg.includes("Let's go 🚀"));
	assertNoLegacyRefs(msg, 'close/pendant');
});

test('Situation 2 (retour) : 3 étapes, jour idéal, AUCUNE explication onboarding', () => {
	const msg = templates.genererClose('retour', { prenom: 'Léa', jourRdv: 'mardi' });
	assert.ok(msg.startsWith("Let's go Léa 🚀"));
	assert.ok(msg.includes('adresse mail pour créer ton accès et la facturation'));
	assert.ok(msg.includes(`je t'enverrai directement ta mission de démarrage`));
	assert.ok(msg.includes('idéalement mardi'));
	assert.ok(msg.includes('Hâte de commencer avec toi 🚀'));
	// Pas de friction : aucune instruction d'onboarding à ce stade.
	assert.ok(!msg.includes('ÉTAPE'));
	assert.ok(!msg.toLowerCase().includes('onboarding'));
	assert.ok(!msg.includes('mensurations'));
	assertNoLegacyRefs(msg, 'close/retour');
});

test('Situation 3 (paiement) : connexion G-FLUX, onboarding, visio + tour de l outil', () => {
	const msg = templates.genererClose('paiement', { prenom: 'Marie', visio: 'jeudi 2 mai à 10h' });
	assert.ok(msg.startsWith(`C'est parti Marie 🚀`));
	assert.ok(msg.includes('Connecte-toi à G-FLUX'));
	assert.ok(msg.includes('https://app.myfit-coach.fr/'));
	assert.ok(msg.includes('bypm2026'));
	assert.ok(msg.includes('formulaire de démarrage'));
	assert.ok(msg.includes('mensurations + photos'));
	assert.ok(msg.includes('jeudi 2 mai à 10h'));
	assert.ok(msg.includes('https://meet.google.com/ajz-hoxy-tkz'));
	assert.ok(msg.includes(`tour complet de l'outil`));
	assertNoLegacyRefs(msg, 'close/paiement');
});

test('Champs vides : replis [Prénom] / [jour et heure] — jamais undefined', () => {
	const msg = templates.genererClose('pendant', {});
	assert.ok(msg.includes('[Prénom]'));
	assert.ok(msg.includes('[jour et heure]'));
	const r = templates.genererClose('retour', {});
	assert.ok(r.includes('[jour idéal]'));
});

/* ═══════════ RÉCAP DÉMARRAGE ═══════════ */

test('Récap démarrage : tous les champs interpolés, note perso incluse si présente', () => {
	const base = {
		prenom: 'Sophie',
		calMin: '1700',
		calMax: '1900',
		maintenance: '2100',
		vitesse: '0,27',
		pas: '8000',
		proteines: '140',
		j7: 'lundi 28 avril à 10h',
	};
	const sansNote = templates.genererDemarrage(base);
	assert.ok(sansNote.includes('Hey Sophie 👋'));
	assert.ok(sansNote.includes('1700 – 1900 kcal / jour'));
	assert.ok(sansNote.includes('Maintenance : *2100 kcal*'));
	assert.ok(sansNote.includes('~0,27 kg de gras / semaine'));
	assert.ok(sansNote.includes('*140 g / jour minimum*'));
	assert.ok(sansNote.includes('*8000 pas / jour'));
	assert.ok(sansNote.includes('repères G-FLUX'));
	assert.ok(sansNote.includes('code-barres'));
	assert.ok(sansNote.includes('Repas IA'));
	assert.ok(sansNote.includes('favoris'));
	assert.ok(sansNote.includes('Mensurations tous les 15 jours'));
	assert.ok(sansNote.includes('Vitamine D3'));
	assert.ok(sansNote.includes('Oméga-3'));
	assert.ok(sansNote.includes('Magnésium bisglycinate'));
	assert.ok(sansNote.includes('lundi 28 avril à 10h'));
	// Sans note → pas de bloc NOTE PERSO.
	assert.ok(!sansNote.includes('NOTE PERSO'));

	const avecNote = templates.genererDemarrage({ ...base, note: 'Travaille le petit-déjeuner.' });
	assert.ok(avecNote.includes('📝 *NOTE PERSO*'));
	assert.ok(avecNote.includes('Travaille le petit-déjeuner.'));
});

test('Récap démarrage : le bloc tracking parle de G-FLUX, jamais de Virtuagym', () => {
	const msg = templates.genererDemarrage({
		prenom: 'X', calMin: '1', calMax: '2', maintenance: '3', vitesse: '4', pas: '5', proteines: '6', j7: 'J+7',
	});
	assert.ok(msg.includes('TON TRACKING DANS G-FLUX'));
	assert.ok(!msg.includes('TRACKING VIRTUAGYM'));
	assert.ok(!msg.includes('badge bleu'));
	assert.ok(!msg.includes('crée ta propre recette'));
	assertNoLegacyRefs(msg, 'demarrage');
});

/* ═══════════ RELANCE BILAN ═══════════ */

test('Relance bilan : message court exact', () => {
	const msg = templates.genererRelance('Sophie');
	const attendu = `Hello Sophie 👋 tout va bien ? Je n'ai pas vu ton bilan passer cette semaine — si RAS on continue comme ça ✅`;
	assert.equal(msg, attendu);
	assertNoLegacyRefs(msg, 'relance');
});

/* ═══════════ MEETING URL — préremplissage planning ═══════════ */

test('« Démarrage » préremplit le Meet par défaut ; « Suivi » jamais', () => {
	assert.equal(appointments.defaultMeetingUrlFor('Démarrage'), 'https://meet.google.com/ajz-hoxy-tkz');
	assert.equal(appointments.defaultMeetingUrlFor('Suivi'), null);
	assert.equal(appointments.defaultMeetingUrlFor('TypeInconnu'), null);
});

test('Le lien par défaut du module templates est cohérent avec le planning', () => {
	assert.equal(templates.DEFAULT_MEET_URL, appointments.defaultMeetingUrlFor('Démarrage'));
});

test('Le préremplissage est une PROPOSITION : pas de lien codé en dur dans les vues', () => {
	// Garde-fou structurel : la chaîne Meet n'apparaît PAS dans les pages de
	// planning/rendez-vous (elle vit dans les modules de données).
	for (const f of ['src/routes/admin/rendez-vous/+page.svelte', 'src/routes/espace/rendez-vous/+page.svelte']) {
		const src = readFileSync(join(root, f), 'utf8');
		assert.ok(!src.includes('meet.google.com'), `${f} ne doit pas coder le lien de visio en dur`);
		const passeParChamp =
			src.includes('meetingUrl') || src.includes('reservingUrl') || src.includes('defaultMeetingUrlFor');
		assert.ok(passeParChamp, `${f} doit passer par le champ meetingUrl`);
	}
});
