/**
 * Mission HOTFIX-SPORT — formulaire « Dépense sportive » : saisies numériques.
 *
 * Bug de prod : les champs numériques (FC moyenne, durée libre) sont liés à
 * <input type="number"> — Svelte renvoie un NOMBRE et le code appelait
 * .trim() / .replace() comme sur du texte (« n(q).trim is not a function »),
 * puis envoyait une valeur mal typée à Convex.
 *
 * Vérifié :
 *  1. NORMALISATION UNIQUE : toute saisie numérique (texte OU nombre) devient
 *     un nombre fini, ou une valeur absente si vide (`nombreSaisi`) ;
 *  2. FC saisie comme NOMBRE ou comme TEXTE → enregistrement OK ;
 *  3. durée libre 50 → OK ; durée libre vide → bouton désactivé + message ;
 *  4. FC vide → OK (aucune FC transmise) ;
 *  5. FC 300 → message clair en français ;
 *  6. plus aucun message technique à l'écran (« n(q).trim is not a function »).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const saisie = await import(new URL('../src/lib/sportSaisie.ts', import.meta.url).href);
const page = readFileSync(join(root, 'src/routes/espace/depense-sportive/+page.svelte'), 'utf8');

/* ── 1 · Normalisation unique (texte OU nombre → nombre fini ou absent) ── */

test('NORMALISATION : texte OU nombre → nombre fini ; vide ou illisible → valeur absente', () => {
	assert.equal(saisie.nombreSaisi(140), 140, 'nombre transmis tel quel');
	assert.equal(saisie.nombreSaisi('140'), 140, 'texte numérique converti');
	assert.equal(saisie.nombreSaisi(' 140 '), 140, 'espaces ignorés');
	assert.equal(saisie.nombreSaisi('50,5'), 50.5, 'virgule décimale acceptée');
	assert.equal(saisie.nombreSaisi(0), 0);
	assert.equal(saisie.nombreSaisi(''), null, 'vide → absent');
	assert.equal(saisie.nombreSaisi('   '), null, 'espaces seuls → absent');
	assert.equal(saisie.nombreSaisi(null), null);
	assert.equal(saisie.nombreSaisi(undefined), null);
	assert.equal(saisie.nombreSaisi(Number.NaN), null, 'nombre illisible → absent');
	assert.equal(saisie.nombreSaisi('abc'), null, 'texte illisible → absent');
});

/* ── 2 · FC saisie comme NOMBRE ou comme TEXTE → enregistrement OK ── */

test('FC saisie comme nombre ou comme texte : enregistrement OK, valeur normalisée en nombre', () => {
	for (const brut of [140, '140', ' 140 ']) {
		const res = saisie.validerSaisieSport({ dureeMinutes: 50, bpmMoyen: brut });
		assert.equal(res.ok, true, `FC ${JSON.stringify(brut)} acceptée`);
		assert.equal(res.saisie.bpmMoyen, 140);
		assert.equal(typeof res.saisie.bpmMoyen, 'number', 'toujours un NOMBRE envoyé à Convex');
		assert.equal(res.saisie.dureeMinutes, 50);
	}
	/* Le payload envoyé utilise les valeurs normalisées. */
	assert.ok(page.includes('...(v.saisie.bpmMoyen !== null ? { bpmMoyen: v.saisie.bpmMoyen } : {})'));
	assert.ok(page.includes('durationMinutes: v.saisie.dureeMinutes'));
});

/* ── 3 · Durée libre : 50 → OK · vide → bouton désactivé + message ── */

test('Durée libre 50 : enregistrement OK (saisie nombre OU texte)', () => {
	for (const brut of [50, '50']) {
		const res = saisie.validerSaisieSport({ dureeMinutes: brut, bpmMoyen: '' });
		assert.equal(res.ok, true, `durée ${JSON.stringify(brut)} acceptée`);
		assert.equal(res.saisie.dureeMinutes, 50);
	}
	/* Le champ Libre normalise bien la saisie (plus de .replace() sur un nombre). */
	assert.ok(page.includes('const n = nombreSaisi(formCustomDuration);'), 'durée libre normalisée');
	assert.ok(!/formCustomDuration\s*\.\s*(trim|replace)\s*\(/.test(page), 'plus de .trim()/.replace() sur un champ numérique');
});

test('Durée libre vide : bouton désactivé avec message clair', () => {
	for (const vide of ['', '   ', null, undefined, Number.NaN]) {
		const res = saisie.validerSaisieSport({ dureeMinutes: vide, bpmMoyen: '' });
		assert.equal(res.ok, false, `durée ${JSON.stringify(vide)} refusée`);
		assert.equal(res.erreur, saisie.ERREUR_DUREE);
	}
	assert.match(saisie.ERREUR_DUREE, /durée/i, 'message en français');
	assert.match(saisie.ERREUR_DUREE, /600/, 'bornes indiquées');
	/* Bouton « Enregistrer » désactivé et message affiché dans la feuille. */
	assert.ok(page.includes('disabled={saving || !saisieValide || !choixValide}'), 'bouton désactivé sans durée valide');
	assert.ok(page.includes('{#if !dureeValide}'), 'message affiché dès la durée manquante');
	assert.ok(page.includes('{ERREUR_DUREE}'));
});

/* ── 4 · FC vide → OK (aucune FC transmise) ── */

test('FC vide : enregistrement OK, aucune FC transmise', () => {
	for (const vide of ['', '   ', null, undefined]) {
		const res = saisie.validerSaisieSport({ dureeMinutes: 45, bpmMoyen: vide });
		assert.equal(res.ok, true, `FC ${JSON.stringify(vide)} acceptée (optionnelle)`);
		assert.equal(res.saisie.bpmMoyen, null, 'FC absente du payload');
	}
});

/* ── 5 · FC 300 → message clair ── */

test('FC 300 (hors 40–240 BPM) : refus avec un message clair en français', () => {
	for (const brut of [300, '300', 39, 241]) {
		const res = saisie.validerSaisieSport({ dureeMinutes: 45, bpmMoyen: brut });
		assert.equal(res.ok, false, `FC ${JSON.stringify(brut)} refusée`);
		assert.equal(res.erreur, saisie.ERREUR_BPM);
		assert.match(res.erreur, /fréquence cardiaque/i);
		assert.match(res.erreur, /240/);
		assert.ok(!/is not a function|undefined|TypeError/.test(res.erreur), 'aucun jargon technique');
	}
	/* Le message s'affiche sous le champ FC dans la feuille. */
	assert.ok(page.includes('{#if bpmErreur}'), 'message affiché dans la feuille');
	assert.ok(page.includes('{bpmErreur}'));
	assert.ok(!/formBpm\s*\.\s*trim\s*\(/.test(page), 'plus de .trim() sur la FC');
});

/* ── 6 · Jamais de message technique à l'écran ── */

test('Erreur technique (« n(q).trim is not a function ») : remplacée par un message clair en français', () => {
	const crash = new TypeError("n(q).trim is not a function. (In 'n(q).trim()', 'n(q).trim' is undefined)");
	const msg = saisie.messageErreurSport(crash, "Impossible d'enregistrer l'activité. Réessaie dans un instant.");
	assert.ok(!/trim|is not a function|undefined|TypeError/i.test(msg), 'aucune fuite technique');
	assert.match(msg, /enregistrer/, 'message clair en français');
	assert.match(saisie.messageErreurSport(new Error('')), /erreur/i, 'message générique en français');
	/* Les messages serveur déjà lisibles restent affichés tels quels. */
	assert.equal(
		saisie.messageErreurSport(new Error('Fréquence cardiaque invalide : 40 à 240 BPM attendu (reçu 300).')),
		'Fréquence cardiaque invalide : 40 à 240 BPM attendu (reçu 300).'
	);
	/* La page n'affiche plus jamais e.message / String(e) en clair. */
	assert.ok(!page.includes('err = e instanceof Error ? e.message : String(e)'), 'plus d’affectation brute de e.message');
	assert.ok(!/err = String\(e\)/.test(page));
	assert.ok(page.includes('messageErreurSport(e'), 'sanitisation systématique des erreurs');
});
