/**
 * Mission CONFIDENTIALITÉ DU CACHE (PWA) — photos privées et pages hors-ligne.
 *
 * Problèmes verrouillés ici :
 * 1. Les photos de progression et de profil (storage Convex, même forme d'URL
 *    `/api/storage/<id>` que les vignettes alimentaires) étaient mises en
 *    cache par le service worker. Seules les vignettes ALIMENTAIRES (OFF +
 *    copies Convex marquées `gflux-food`) le restent ;
 * 2. À la déconnexion (et à la connexion, pour couvrir une session expirée
 *    suivie d'une autre utilisatrice), les caches du worker (CACHE + IMG_CACHE)
 *    sont vidés AVANT la redirection ;
 * 3. Le repli HTML hors-ligne n'est servi que s'il correspond au build
 *    courant (empreinte app-build) ; sinon page d'erreur propre « Réessayer ».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const sw = read('src/service-worker.ts');
const tag = read('src/lib/foodImgTag.ts');
const appCaches = read('src/lib/appCaches.ts');
const rootLayout = read('src/routes/+layout.svelte');
const foodImages = read('src/convex/foodImages.ts');
const customFoods = read('src/convex/customFoods.ts');
const journal = read('src/convex/journal.ts');
const photos = read('src/convex/photos.ts');
const users = read('src/convex/users.ts');
const coach = read('src/convex/coach.ts');

test('Marqueur : module partagé gflux-food (tag + détection URL storage Convex)', () => {
	assert.match(tag, /export const FOOD_IMG_TAG = 'gflux-food'/);
	assert.match(tag, /export function tagFoodImgUrl/);
	assert.match(tag, /export function isFoodImgTagged/);
	assert.match(tag, /export function isConvexStorageUrl/);
	assert.match(tag, /\/api\/storage\//, 'la forme d’URL commune est identifiée dans le module');
});

test('SW : IMG_CACHE ne capte que les vignettes alimentaires (miroir marqué + OFF)', () => {
	assert.match(sw, /function isMirrorImage\(url: URL\): boolean \{[\s\S]{0,200}?isConvexStorageUrl\(url\) && isFoodImgTagged\(url\)/, 'le miroir Convex exige le marqueur alimentaire');
	assert.match(sw, /function isFoodImage/, 'les images OFF restent cachées');
	assert.ok(!/CONVEX_HOST_RE\.test/.test(sw), 'plus aucune acceptation générale de /api/storage/');
});

test('SW : les photos privées déjà en cache (anciens builds) sont purgées à l’activation', () => {
	assert.match(sw, /purgePrivateImages/);
	const purge = sw.slice(sw.indexOf('async function purgePrivateImages'));
	assert.match(purge, /isConvexStorageUrl\(url\) && !isFoodImgTagged\(url\)/, 'toute entrée /api/storage/ non marquée est retirée');
	assert.ok(!sw.includes('caches.delete(IMG_CACHE)'), 'le cache d’images n’est jamais supprimé en bloc (les vignettes OFF/miroir survivent)');
});

test('Convex : toutes les URLs de vignettes alimentaires sont marquées', () => {
	assert.match(foodImages, /tagFoodImgUrl\(await ctx\.storage\.getUrl\(row\.storageId\)\)/, 'miroir G-FLUX (thumbUrl)');
	assert.match(customFoods, /tagFoodImgUrl\(await ctx\.storage\.getUrl\(f\.photoStorageId\)\)/, 'photos des aliments « Créés par moi »');
	assert.match(customFoods, /photoUrl: own\.photoStorageId \? \(tagFoodImgUrl/, 'photo exposée par la recherche (byBarcodeGlobal)');
	assert.match(journal, /photoUrl: f\.photoStorageId \? \(tagFoodImgUrl/, 'photo des fiches personnelles listées');
	assert.match(journal, /const url = tagFoodImgUrl\(await ctx\.storage\.getUrl\(f\.photoStorageId\)\)/, 'photos rattachées aux entrées');
	assert.equal((journal.match(/imageUrl = food\.photoStorageId \? \(tagFoodImgUrl/g) ?? []).length, 2, 'les snapshots d’entrées (addEntry + planned) sont marqués');
	assert.match(journal, /const url = cf\?\.photoStorageId \? \(tagFoodImgUrl/, 'rafraîchissement photo à la validation d’un item planifié');
});

test('Convex : les URLs de photos PRIVÉES ne portent jamais le marqueur', () => {
	for (const [name, src] of [['photos.ts', photos], ['users.ts', users], ['coach.ts', coach]]) {
		assert.ok(!src.includes('tagFoodImgUrl'), `${name} ne marque aucune URL (photos de progression / profil)`);
	}
	assert.match(photos, /url: await ctx\.storage\.getUrl\(p\.storageId\)/, 'les photos de progression gardent l’URL nue');
	assert.match(users, /ctx\.storage\.getUrl\(user\.profilePhotoStorageId\)/, 'la photo de profil garde l’URL nue');
});

test('Connexion/déconnexion : les caches sont vidés AVANT la soumission (donc la redirection)', () => {
	assert.match(appCaches, /export async function clearAppCaches/);
	assert.match(appCaches, /keys\.filter\(\(k\) => k\.startsWith\(CACHE_PREFIX\)\)/, 'CACHE et IMG_CACHE visés par le préfixe gflux');
	assert.match(rootLayout, /clearAppCaches\(\)/, 'le hook central appelle le vidage');
	const hook = rootLayout.slice(rootLayout.indexOf('function onSubmit'));
	assert.match(hook, /\\?\\\/\(login\|logout\)/, 'les formulaires ?/login et ?/logout sont interceptés');
	assert.match(hook, /e\.preventDefault\(\)/, 'la soumission est bloquée le temps du vidage');
	assert.match(hook, /clearAppCaches\(\)\.finally\(\(\) => \{[\s\S]{0,120}?form\.submit\(\)/, 'la soumission ne repart qu’après le vidage');
	assert.match(rootLayout, /document\.addEventListener\('submit', onSubmit, true\)/, 'hook central unique (phase de capture)');
});

test('Repli HTML : servi uniquement si la page correspond au build courant', () => {
	assert.match(rootLayout, /<meta name="app-build" content=\{BUILD_VERSION\} \/>/, 'l’empreinte du build est dans chaque page');
	assert.match(sw, /async function htmlMatchesBuild/);
	assert.match(sw, /name="app-build"[\s\S]{0,80}?m\[1\] === version/, 'comparaison avec la version de CE worker');
	const nav = sw.slice(sw.indexOf("event.request.mode === 'navigate'"));
	assert.match(nav, /htmlMatchesBuild/, 'le repli de navigation passe par le contrôle de build');
});

test('Repli HTML refusé : échec propre vers la page d’erreur « Réessayer »', () => {
	assert.match(sw, /const ERROR_PAGE_HTML/);
	assert.match(sw, /Impossible de charger cette page/);
	assert.match(sw, /Réessayer/);
	assert.match(sw, /onclick="location\.reload\(\)"/, 'le bouton relance le chargement');
	assert.match(sw, /function appErrorResponse/);
	const nav = sw.slice(sw.indexOf("event.request.mode === 'navigate'"));
	assert.match(nav, /return appErrorResponse\(\)/, 'jamais de shell périmé ni d’écran blanc');
});
