/**
 * Mission STABILITÉ PWA — navigation figée / écran blanc après coupure réseau.
 *
 * Symptômes : Journal → réseau instable → retour Accueil bloqué ; réouverture
 * de la PWA = écran blanc pendant 4-5 minutes.
 *
 * Causes verrouillées ici :
 * 1. Le service worker lançait `fetch(event.request)` SANS limite de temps :
 *    une socket bloquée (reprise iOS, réseau coupé puis rétabli) laissait la
 *    navigation pendre plusieurs minutes avant tout repli ;
 * 2. Les requêtes Convex côté serveur n'étaient pas bornées : un loader qui
 *    attend un `convex.query` qui ne revient jamais fige toute navigation ;
 * 3. L'opération NON ESSENTIELLE `users.touch` pouvait retarder l'affichage ;
 * 4. Le cache d'images (IMG_CACHE) était supprimé à chaque activation alors
 *    que sa vocation documentée est de survivre aux builds.
 *
 * Garanties : aucune déconnexion pour une panne réseau (503 récupérable,
 * cookie intact), /api/ jamais mis en cache (données privées), aucun reload
 * en boucle, aucune purge générale des caches.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const sw = read('src/service-worker.ts');
const convexServer = read('src/lib/server/convex.ts');
const session = read('src/lib/server/session.ts');
const espaceLayout = read('src/routes/espace/+layout.server.ts');
const errorPage = read('src/routes/+error.svelte');

test('SW : toute requête interceptée est BORNÉE (jamais un fetch qui pend)', () => {
	assert.match(sw, /const FETCH_TIMEOUT_MS = \d+/, 'constante de délai');
	assert.match(sw, /Promise\.race\(\[\s*fetch\(request\),/, 'course réseau / minuteur');
	assert.ok(!/respondWith\(\s*fetch\(event\.request\)/.test(sw), 'plus aucun fetch nu dans respondWith');
});

test('SW navigation : repli cache servi si le réseau est lent ou coupé', () => {
	const nav = sw.slice(sw.indexOf("event.request.mode === 'navigate'"));
	assert.match(nav, /fetchBounded\(event\.request\)/, 'navigation bornée');
	// Repli lu dans le cache du build COURANT uniquement : le cache du build
	// précédent (conservé pour ses fichiers _app/immutable) ne doit jamais
	// fournir un HTML d'une autre version.
	assert.match(nav, /caches\.open\(CACHE\)/, 'repli lu dans le cache du build courant');
	assert.match(nav, /cache\.match\(event\.request\)/, 'copie de repli de la page');
	assert.match(nav, /cache\.match\('\/'\)/, "dernier filet = shell de l'app");
});

test('SW navigation : la copie de repli reste rafraîchie par chaque HTML frais', () => {
	const nav = sw.slice(sw.indexOf("event.request.mode === 'navigate'"));
	assert.match(nav, /if \(res\.ok\)[\s\S]{0,160}caches\.open\(CACHE\)/);
});

test('SW ressources : échec réseau rapide et propre (Response.error)', () => {
	const fn = sw.slice(sw.indexOf('caches.match(event.request).then((cached)'));
	assert.match(fn, /fetchBounded\(event\.request\)/);
	assert.match(fn, /\.catch\(\(\) => Response\.error\(\)\)/);
});

test('SW vie privée : /api/ jamais caché — ni sessions ni réponses privées', () => {
	assert.match(sw, /if \(event\.request\.url\.includes\('\/api\/'\)\) return;/);
});

test('SW images : IMG_CACHE survit aux déploiements (volontaire, cf. doc)', () => {
	assert.match(sw, /k !== CACHE && k !== IMG_CACHE/);
});

test('SW activation : le cache du build PRÉCÉDENT est conservé (bascule sans casse)', () => {
	// Incident du 28/10/2026 : page SANS CSS après déploiement. Une page encore
	// ouverte réclamait ses fichiers _app/immutable, absents du cache (purgé à
	// l'activation) et du serveur (Netlify ne sert que le dernier déploiement).
	const activate = sw.slice(sw.indexOf('async function activateBuild'), sw.indexOf('async function purgePrivateImages'));
	// La version précédente est désignée par le TÉMOIN (build mémorisé), pas
	// par sa position dans `caches.keys()` : cet ordre n'est pas garanti.
	assert.match(activate, /readBuildPointer\(\)/, 'précédent désigné explicitement');
	assert.ok(!/\.slice\(-1\)|\.pop\(\)/.test(activate), 'aucun choix dépendant de l’ordre des clés');
	assert.match(activate, /!previous\.includes\(k\)/, 'la version précédente échappe à la purge');
	assert.match(activate, /isLegacyBuildCache/, 'ancien format « gflux-<hash> » conservé une activation');
	assert.ok(!/keys\.map\(\(k\) => caches\.delete\(k\)\)/.test(activate), 'aucune purge générale');
});

test('Convex serveur : avec échéance — un appel qui ne revient pas ne fige rien', () => {
	assert.match(convexServer, /export function withDeadline/);
	assert.match(convexServer, /setTimeout\(\(\) => reject/);
});

test('Session : une panne réseau ne déconnecte JAMAIS — 503 récupérable', () => {
	const resolveFn = session.slice(
		session.indexOf('async function resolve'),
		session.indexOf('export async function currentUser')
	);
	assert.match(resolveFn, /withDeadline\(/, 'vérification de session bornée');
	assert.match(resolveFn, /throw error\(503/, 'état récupérable avec Réessayer');
	assert.ok(!resolveFn.includes('clearSessionCookie'), 'jamais de destruction de session sur panne');
	assert.ok(!resolveFn.includes('redirect'), 'jamais de redirection login sur panne');
});

test('Layout /espace : opération non essentielle bornée + lectures en parallèle', () => {
	assert.match(espaceLayout, /withDeadline\(convex\.mutation\(api\.users\.touch/, 'trace last-seen bornée');
	assert.match(espaceLayout, /const \[dashboard, profilePhotoUrl\] = await Promise\.all\(/, 'lectures indépendantes parallélisées');
	assert.equal((espaceLayout.match(/\.catch\(\(\) => null\)/g) ?? []).length, 2, 'dégradation propre des deux lectures');
	assert.match(espaceLayout, /await touchP;/, 'la trace est bien émise (pas abandonnée)');
});

test("Page d'erreur : message clair + action « Réessayer »", () => {
	assert.match(errorPage, /Réessayer/);
	assert.match(errorPage, /location\.reload\(\)/);
});
