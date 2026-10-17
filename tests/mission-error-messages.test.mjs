/**
 * Mission MESSAGES D'ERREUR — « Internal Error » ne doit jamais atteindre la cliente.
 *
 * Correction verrouillée ici :
 * 1. la page d'erreur (+error.svelte) n'affiche JAMAIS de message technique :
 *    trois textes français selon le cas — hors ligne, service indisponible
 *    (503), autre — avec le design, le bouton « Réessayer » et le lien
 *    « Retour à l'accueil » conservés ;
 * 2. la page d'erreur servie par le service worker hors ligne suit la même
 *    règle (message du cas hors ligne).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const errorPage = read('src/routes/+error.svelte');
const sw = read('src/service-worker.ts');

const MSG_OFFLINE = 'Pas de connexion internet. Vérifie ton réseau puis réessaie.';
const MSG_UNAVAILABLE = 'Le service est momentanément indisponible. Réessaie dans quelques instants.';
const MSG_GENERIC = 'Une erreur est survenue. Réessaie dans quelques instants.';

test('Page d\u2019erreur : les trois messages français sont définis, à la virgule près', () => {
	assert.ok(errorPage.includes(`'${MSG_OFFLINE}'`), 'message hors ligne');
	assert.ok(errorPage.includes(`'${MSG_UNAVAILABLE}'`), 'message service indisponible');
	assert.ok(errorPage.includes(`'${MSG_GENERIC}'`), 'message générique');
});

test('Page d\u2019erreur : AUCUN message technique n\u2019est jamais affiché', () => {
	assert.ok(!errorPage.includes('page.error?.message'), 'plus de message d\u2019erreur brut affiché');
	assert.ok(!errorPage.includes('Internal Error'), 'jamais « Internal Error »');
	assert.match(errorPage, /\{message\}/, 'le texte affiché vient uniquement de la sélection par cas');
});

test('Page d\u2019erreur : sélection du cas — hors ligne, 503, autre', () => {
	assert.match(
		errorPage,
		/offline \? MESSAGES\.offline : page\.status === 503 \? MESSAGES\.unavailable : MESSAGES\.generic/,
		'ordre des cas : hors ligne → 503 → générique'
	);
	assert.match(errorPage, /offline = !navigator\.onLine/, 'détection hors ligne côté client');
	assert.match(errorPage, /window\.addEventListener\('online', sync\)/, 'suit le retour réseau');
	assert.match(errorPage, /window\.addEventListener\('offline', sync\)/, 'suit la coupure réseau');
});

test('Page d\u2019erreur : design, « Réessayer » et « Retour à l\u2019accueil » conservés', () => {
	assert.match(errorPage, /Impossible de charger cette page/);
	assert.match(errorPage, /Réessayer/);
	assert.match(errorPage, /onclick=\{retry\}/);
	assert.match(errorPage, /function retry\(\)[^}]*location\.reload\(\)/, 'le bouton relance le chargement');
	assert.match(errorPage, /href="\/espace"[^>]*>\s*\n?\s*Retour à l'accueil/, 'lien d\u2019accueil conservé');
});

test('Page d\u2019erreur du SW hors ligne : même règle (message hors ligne, pas de technique)', () => {
	assert.ok(sw.includes(`<p>${MSG_OFFLINE}</p>`), 'le SW affiche le message hors ligne');
	assert.ok(!sw.includes('Internal Error'), 'jamais « Internal Error » côté SW');
	assert.ok(!sw.includes('Vérifie ta connexion puis réessaie'), 'l\u2019ancien texte générique a disparu');
	// Le reste de la page SW est conservé (design + bouton fonctionnel).
	assert.match(sw, /Impossible de charger cette page/);
	assert.match(sw, /onclick="location\.reload\(\)"/, 'le bouton relance le chargement');
});
