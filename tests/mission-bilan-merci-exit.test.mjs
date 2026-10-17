/**
 * Mission ÉCRAN DE CONFIRMATION DU BILAN (cul-de-sac sur iPhone).
 *
 * Corrections verrouillées ici :
 * 1. bouton principal « Retour à l'accueil » → /espace sur les écrans de
 *    remerciement, en navigation qui REMPLACE l'historique (le geste retour
 *    ne ramène pas dans le formulaire) ;
 * 2. cas « appel » : le texte « Choisis directement ton créneau dans
 *    l'agenda » n'est promis QUE si le bouton « Choisir mon créneau »
 *    (→ /espace/rendez-vous) existe ; sinon « Retour à l'accueil » devient
 *    le bouton principal. Quand le bouton de réservation est là, « Retour à
 *    l'accueil » est un lien secondaire SOUS ce bouton ;
 * 3. titre « Merci [prénom] ! » en Lato (Oswald n'est jamais chargée) ;
 * 4. confettis : les points sont retirés À LA FIN DE L'ANIMATION (plus de
 *    carrés colorés résiduels), et leur style s'applique réellement
 *    (sélecteur global — ils sont créés hors de l'arbre Svelte).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const bilan = read('src/routes/bilan/+page.svelte');

/* ── 1. Sortie principale « Retour à l'accueil » ── */

test('Confirmation : bouton principal « Retour à l\u2019accueil » sur les 3 écrans de remerciement', () => {
	const homeBtns = bilan.match(/<a href="\/espace" class="btn-cta" data-sveltekit-replacestate>/g) ?? [];
	assert.equal(homeBtns.length, 3, 'un bouton principal par écran (rien / érit / appel-autonomie)');
	assert.ok(bilan.includes(`<Icon name="home" size={17} class="btn-cta-icon" /> Retour à l'accueil`), 'libellé du bouton');
});

test('Confirmation : la navigation remplace l\u2019historique (jamais de retour vers le formulaire)', () => {
	const exits = bilan.match(/<a href="\/espace" (?:class="btn-cta"|class="ty-home-link") data-sveltekit-replacestate>/g) ?? [];
	assert.equal(exits.length, 4, '3 boutons principaux + 1 lien secondaire, tous en replace');
	assert.ok(bilan.includes('<a href="/espace/rendez-vous" class="btn-cta" data-sveltekit-replacestate>'), 'la réservation aussi');
});

/* ── 2. Cas « appel » : promesse = bouton, jamais de promesse vide ── */

test('Appel : « Choisir mon créneau » → /espace/rendez-vous (page existante)', () => {
	assert.match(
		bilan,
		/<a href="\/espace\/rendez-vous" class="btn-cta" data-sveltekit-replacestate>\s*<Icon name="calendarCheck"[^>]*\/> Choisir mon créneau\s*<\/a>/
	);
	assert.ok(!bilan.includes("Réserver mon créneau dans l'agenda"), 'ancien libellé retiré');
});

test('Appel : la promesse « Choisis directement ton créneau » est conditionnée au bouton', () => {
	assert.match(
		bilan,
		/Tu as demandé un rendez-vous\.\{#if allowRendezVous\} Choisis directement ton créneau dans l'agenda\.\{\/if\}/,
		'pas de promesse d\u2019agenda sans bouton'
	);
});

test('Appel : sous le bouton, « Retour à l\u2019accueil » devient un lien secondaire', () => {
	assert.match(
		bilan,
		/Choisir mon créneau\s*<\/a>\s*<p class="ty-hint">[^<]*<\/p>\s*<a href="\/espace" class="ty-home-link" data-sveltekit-replacestate>Retour à l'accueil<\/a>/,
		'lien secondaire SOUS le bouton (bouton → hint → lien)'
	);
	assert.match(bilan, /\.ty-home-link\s*\{[^}]*font-weight: 700;[^}]*\}/, 'style de lien secondaire');
	assert.match(bilan, /\{:else\}\s*<a href="\/espace" class="btn-cta" data-sveltekit-replacestate>/, 'sans réservation possible → bouton principal');
});

/* ── 3. Titre en Lato ── */

test('Titre « Merci [prénom] ! » : Lato comme le reste de l\u2019app', () => {
	const h2 = bilan.slice(bilan.indexOf('.thank-you h2 {'), bilan.indexOf('.thank-you p'));
	assert.match(h2, /font-family: 'Lato'/, 'titre des 3 écrans de remerciement en Lato');
	assert.ok(!h2.includes('Oswald'), 'plus d\u2019Oswald (jamais chargée) sur le titre');
	assert.match(bilan, /<h2>Merci \{user\.prenom\} !<\/h2>/, 'titre inchangé');
});

/* ── 4. Confettis : nettoyage à la fin de l\u2019animation ── */

test('Confettis : disparaissent à la fin de l\u2019animation', () => {
	assert.match(bilan, /anim\.onfinish = \(\) => \{[\s\S]*?dot\.remove\(\);/, 'retrait au finish de l\u2019animation');
	assert.match(bilan, /const safety = window\.setTimeout\(\(\) => dot\.remove\(\), 1200\);[\s\S]*?dot\.animate\(/, 'filet de sécurité posé AVANT l\u2019animation');
	assert.match(bilan, /window\.clearTimeout\(safety\)/, 'pas de double retrait inutile');
	assert.match(bilan, /catch \{[\s\S]*?moteur sans Web Animations/, 'moteur sans animate() : filet de sécurité seul');
});

test('Confettis : le style s\u2019applique aux points créés en JS (fin des carrés à gauche)', () => {
	assert.match(bilan, /:global\(\.confetti-dot\) \{[\s\S]*?position: fixed;/, 'sélecteur global → position fixe réelle');
	assert.match(bilan, /:global\(\.confetti-dot\) \{[\s\S]*?border-radius: 50%;/, 'points ronds, pas des carrés');
});

/* ── Régressions verrouillées : formulaire et écrans voisins inchangés ── */

test('Formulaire et écrans voisins : aucune modification', () => {
	assert.match(bilan, /<form method="POST" action="\?\/submit" onsubmit=\{guardSubmit\}/, 'soumission inchangée');
	assert.match(bilan, /const payloadJSON = \$derived\.by\(\(\) => \{/, 'payload inchangé');
	assert.match(bilan, /\{:else if merci\}\s*<div class="closed-page-back"><BackToHome label="Bilans" \/><\/div>/, 'bandeau haut merci verrouillé');
	assert.match(bilan, /<a href="\/espace\/historique" class="closed-bilan-back-link"/, 'écran bilan fermé inchangé');
	// Mode autonomie : la règle de gating d\u2019origine est conservée telle quelle.
	assert.match(bilan, /\(data\?\.user\?\.coachingMode \?\? 'coaching'\) !== 'autonomy'/);
	assert.match(bilan, /\{#if allowRendezVous\}/);
});
