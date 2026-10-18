/**
 * Mission RÉDUCTION DES FRÉQUENCES DE POLLING (coûts Netlify).
 *
 * Contexte : ~700 000 requêtes en 17 jours pour une soixantaine de clientes,
 * essentiellement du polling. Objectif : espacer les filets périodiques SANS
 * changer l'expérience perçue — les vérifications immédiates (focus,
 * visibilité, pageshow, après navigation) restent inchangées.
 *
 * Valeurs verrouillées ici :
 * 1. notificationPoll : filet périodique 5 s → 30 s ;
 * 2. swUpdate (startCompatWatch) : filet périodique 60 s → 5 min ;
 * 3. bilans : invalidateAll périodique 30 s → 90 s + garde document.hidden ;
 * 4. admin layout : invalidateAll (journalVersion) limité à 1 / 30 s max.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const poll = read('src/lib/notificationPoll.ts');
const swUpdate = read('src/lib/swUpdate.ts');
const bilans = read('src/routes/admin/bilans/+page.svelte');
const adminLayout = read('src/routes/admin/+layout.svelte');
const appShell = read('src/lib/components/AppShell.svelte');

/* ── 1. notificationPoll : 5 s → 30 s ── */

test('notificationPoll : filet périodique à 30 s (et non plus 5 s)', () => {
	assert.match(poll, /const POLL_MS = 30_000;/, 'POLL_MS = 30 s');
	assert.ok(!/POLL_MS = 5_000/.test(poll), 'plus aucune trace du 5 s');
	assert.match(poll, /setInterval\(\(\) => tick\(\), POLL_MS\)/, 'le filet utilise POLL_MS');
});

test('notificationPoll : checks immédiats conservés (focus, visibilité, pageshow)', () => {
	assert.match(poll, /document\.addEventListener\('visibilitychange', onVisibility\)/);
	assert.match(poll, /window\.addEventListener\('focus', onFocus\)/);
	assert.match(poll, /window\.addEventListener\('pageshow', onPageShow\)/);
	assert.match(poll, /function onVisibility\(\)[^\0]*?if \(!document\.hidden\) tick\(\)/);
	assert.match(poll, /function onFocus\(\)[^\0]*?tick\(\);/);
	assert.match(poll, /function onPageShow\(e: PageTransitionEvent\)[^\0]*?tick\(e\.persisted\)/);
});

test('notificationPoll : check immédiat après chaque navigation conservé', () => {
	assert.match(appShell, /afterNavigate\(\(\) => \{/, 'AppShell revalide après navigation');
	assert.match(appShell, /refreshNotificationsNow\(\);/, 'badge recalculé sans attendre le poll');
});

test('notificationPoll : garde anti-tempête et arrière-plan inchangées', () => {
	assert.match(poll, /const MIN_INTERVAL_MS = 3_000;/, 'garde anti-doublon conservée');
	assert.match(poll, /if \(document\.hidden\) return; \/\/ arrière-plan/);
});

/* ── 2. swUpdate (startCompatWatch) : 60 s → 5 min ── */

test('swUpdate : filet périodique à 5 min (et non plus 60 s)', () => {
	assert.match(swUpdate, /const PERIODIC_CHECK_MS = 300_000;/, 'PERIODIC_CHECK_MS = 5 min');
	assert.ok(!/PERIODIC_CHECK_MS = 60_000/.test(swUpdate), 'plus aucune trace du 60 s');
	assert.match(swUpdate, /setInterval\(\(\) => checkAppVersion\(\), PERIODIC_CHECK_MS\)/);
});

test('swUpdate : checks au focus et à la visibilité conservés', () => {
	const watch = swUpdate.slice(swUpdate.indexOf('export function startCompatWatch'));
	assert.match(watch, /document\.addEventListener\('visibilitychange', \(\) => checkAppVersion\(\)\)/);
	assert.match(watch, /window\.addEventListener\('focus', \(\) => checkAppVersion\(\)\)/);
	assert.match(watch, /window\.addEventListener\('pageshow'/);
});

test('swUpdate : anti-doublon et garde arrière-plan conservés', () => {
	assert.match(swUpdate, /const MIN_CHECK_INTERVAL_MS = 60_000;/, 'garde anti-doublon conservée');
	assert.match(swUpdate, /if \(document\.hidden\) return; \/\/ inutile en arrière-plan/);
});

/* ── 3. bilans : invalidateAll périodique 30 s → 90 s + garde document.hidden ── */

test('bilans : revalidation périodique à 90 s', () => {
	assert.match(bilans, /\}, 90000\);/, 'intervalle de 90 s');
	assert.ok(!/30000\)/.test(bilans), 'plus aucune trace du 30 s');
});

test('bilans : la revalidation périodique saute l\u2019arrière-plan (document.hidden)', () => {
	const timer = bilans.slice(bilans.indexOf('missingTimer = setInterval'));
	assert.match(
		timer,
		/setInterval\(\(\) => \{\s*if \(document\.hidden\) return;/,
		'garde document.hidden AVANT invalidateAll'
	);
	assert.match(timer, /if \(document\.hidden\) return;[^\0]*?void invalidateAll\(\);/);
});

/* ── 4. admin layout : invalidateAll (journalVersion) limité à 1 / 30 s ── */

test('admin layout : throttle de 30 s sur l\u2019invalidateAll de journalVersion', () => {
	assert.match(adminLayout, /const JOURNAL_INVALIDATE_MIN_MS = 30_000;/, 'fenêtre de 30 s');
	assert.match(adminLayout, /Date\.now\(\) - lastInvalidateAt/, 'mesure du temps depuis la dernière revalidation');
	assert.match(adminLayout, /if \(since >= JOURNAL_INVALIDATE_MIN_MS\)/, 'gate : au plus un appel par fenêtre');
});

test('admin layout : invalidateAll n\u2019est appelé QUE via le throttle', () => {
	const calls = adminLayout.match(/invalidateAll\(\)/g) ?? [];
	assert.equal(calls.length, 1, 'un unique point d\u2019appel (dans runInvalidate)');
	assert.match(adminLayout, /const runInvalidate = \(\) => \{[^\0]*?void invalidateAll\(\)\.catch\(\(\) => \{\}\);/);
});

test('admin layout : le dernier événement de la rafale reste appliqué (fin de fenêtre)', () => {
	assert.match(adminLayout, /trailingTimer = setTimeout\(/, 'revalidation différée en fin de fenêtre');
	assert.match(adminLayout, /if \(trailingTimer !== null\) clearTimeout\(trailingTimer\)/, 'nettoyage au démontage');
});
