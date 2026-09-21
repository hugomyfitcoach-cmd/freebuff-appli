#!/usr/bin/env node
/**
 * Vérifications — Miroir G-FLUX des miniatures alimentaires.
 *
 * Deux niveaux :
 *   A. Tests unitaires de la logique pure (`src/lib/foodImage.ts`) —
 *      dérivation de la miniature OFF 100 px (la règle centrale).
 *   B. Contrats d'architecture — les invariants exigés (déduplication,
 *      plafond de taille, reprise des créneaux, cache SW stable, BFF
 *      non bloquant) vérifiés statiquement dans le code livré.
 *
 * Aucun déploiement, aucun appel réseau, aucun état modifié :
 * `node scripts/verify-food-images.mjs` — sort non-zéro au premier échec.
 */
import { readFileSync, existsSync } from 'node:fs';

let n = 0;
const ok = (m) => console.log(`  ✔ [${++n}] ${m}`);
const section = (m) => console.log(`\n— ${m} —`);
function expect(cond, msg) {
	if (!cond) {
		console.error(`  ✘ ${msg}`);
		process.exit(1);
	}
	ok(msg);
}

const read = (p) => readFileSync(p, 'utf8');
const src = (p) => {
	const c = read(p);
	if (!c) throw new Error(`fichier introuvable : ${p}`);
	return c;
};

// ── A. Logique pure : dérivation de la miniature OFF 100 px ────────────────
section('Dérivation de la miniature OFF 100 px (src/lib/foodImage.ts)');

// Transpile à la volée (TS → JS : retrait des annotations et exports).
const foodImageTs = src('src/lib/foodImage.ts');
const js = foodImageTs
	.replace(/export const OFF_THUMB_SIZE[^;]+;/, 'const OFF_THUMB_SIZE_LOCAL = 100;')
	.replace(/export function/g, 'function')
	.replace(/\(imageUrl: string \| undefined \| null\)/, '(imageUrl)')
	.replace(/: string \| undefined(?= \{)/g, '')
	.replace(/OFF_THUMB_SIZE(?![a-zA-Z_])/g, 'OFF_THUMB_SIZE_LOCAL');
const OFF_THUMB_SIZE = 100;
const offThumb100 = new Function(`${js}\nreturn offThumb100;`)();

// 1. URL 200 px (dump `image_small_url`) → 100 px
expect(
	offThumb100('https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.879.200.jpg') ===
		'https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.879.100.jpg',
	'URL .200.jpg (dump) → .100.jpg'
);
// 2. URL déjà 100 px → inchangée
expect(
	offThumb100('https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.879.100.jpg') ===
		'https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.879.100.jpg',
	'URL déjà .100.jpg → inchangée'
);
// 3. URL 400 px (API live) → 100 px
expect(
	offThumb100('https://images.openfoodfacts.org/images/products/123/front_fr.45.400.jpg') ===
		'https://images.openfoodfacts.org/images/products/123/front_fr.45.100.jpg',
	'URL .400.jpg (API live) → .100.jpg'
);
// 4. Hôte world.openfoodfacts.org → dérivation aussi
expect(
	offThumb100('https://world.openfoodfacts.org/images/products/123/front_en.879.200.jpg')?.endsWith('.100.jpg'),
	'hôte world.openfoodfacts.org → dérivation'
);
// 5. URL non-OFF (stock interne / exercices) → jamais réécrite
expect(offThumb100('https://calm-jaguar-475.eu-west-1.convex.cloud/api/storage/abc123') === undefined, 'URL non-OFF → undefined (jamais réécrite)');
// 6. URL sans variante numérotée → jamais réécrite au hasard (identité)
expect(offThumb100('https://images.openfoodfacts.org/foo.png') === 'https://images.openfoodfacts.org/foo.png', 'URL sans variante numérotée → identité (jamais réécrite au hasard)');
// 7. Entrée vide / invalide
expect(offThumb100(undefined) === undefined && offThumb100(null) === undefined && offThumb100('') === undefined, 'entrée vide/invalide → undefined');
expect(offThumb100('not-a-url') === undefined, 'URL malformée → undefined (pas d’exception)');

// ── B. Contrats d'architecture ──────────────────────────────────────────────
section('Convex — déduplication stricte & idempotence (src/convex/foodImages.ts)');
const fi = src('src/convex/foodImages.ts');
expect(fi.includes('claimMirrorSlot'), 'créneau exclusif par offId (claimMirrorSlot) avant tout téléchargement');
expect(fi.includes('PENDING_TAKEOVER_MS'), 'créneau pending stalé repris (jamais de produit bloqué après crash)');
expect(/status !== "pending"/.test(fi) && fi.includes('ctx.storage.delete(storageId)'), 'perdant d’une course → sa copie supprimée (jamais de doublon)');
expect(fi.includes('by_offId'), 'unicité appuyée sur l’index by_offId (un document par produit)');
expect(fi.includes('MAX_THUMB_BYTES'), 'plafond de taille par image défini');
expect(/MAX_THUMB_BYTES = (\d+) \* 1024/.test(fi) && Number(fi.match(/MAX_THUMB_BYTES = (\d+) \* 1024/)[1]) <= 60, 'plafond ≤ 60 Ko (vignette 100 px, anomalie jamais stockée)');
expect(fi.includes('lastUsedAt'), 'lastUsedAt tracé (purge future possible sans toucher aux aliments)');
expect(fi.includes('mirrorBatch') && /slice\(0, 12\)/.test(fi), 'préchauffage par lot borné (≤ 12 produits)');
expect(!/for\s*\(.*780|bulkImport|prefetchAll/i.test(fi), 'aucun remplissage à l’avance dans le module miroir');

section('Schéma — table foodImageCache (src/convex/schema.ts)');
const schema = src('src/convex/schema.ts');
expect(schema.includes('foodImageCache: defineTable'), 'table dédiée foodImageCache (pas de champ massif dans foods)');
expect(schema.includes('by_offId') && schema.includes('by_status'), 'index by_offId + by_status');
expect(!/foods: defineTable[\s\S]{0,4000}?thumbnailUrl/.test(schema), 'foods inchangé (pas de thumbnailUrl massif sur 780k fiches)');

section('BFF — préchauffage non bloquant (src/routes/api/food-image/warm)');
const warm = src('src/routes/api/food-image/warm/+server.ts');
expect(warm.includes("slice(0, 12)"), 'lot borné côté BFF (≤ 12 images par appel)');
expect(warm.includes('offThumb100'), 'dérivation 100 px côté BFF (jamais les 200/400 px)');
expect(warm.includes("status: 200") && warm.includes('console.warn'), 'échec silencieux (HTTP 200 + log) — jamais une erreur UX');

section('Préchauffage client (src/lib/foodImageWarm.ts)');
const warmCli = src('src/lib/foodImageWarm.ts');
expect(warmCli.includes('void fetch') || warmCli.includes('.catch(() => {})'), 'fire-and-forget : aucune erreur remontée à l’UI');
expect(warmCli.includes('warmInFlight'), 'anti-doublon en vol (un seul POST par produit)');
expect(warmCli.includes('keepalive: true'), 'requête survivant à un changement de page');
expect(!/(?<!aucun )await/.test(warmCli.replace(/\*\*[\s\S]*?\*/g, '')), 'aucun await dans le chemin appelant (l’ajout n’attend jamais la photo)');

section('FoodImg — chaîne de sources & priorités (src/lib/components/FoodImg.svelte)');
const foodImg = src('src/lib/components/FoodImg.svelte');
expect(foodImg.includes("eager ? 'eager' : 'lazy'"), 'lazy par défaut, eager opt-in');
expect(foodImg.includes("fetchpriority={eager ? 'high' : 'auto'}"), 'fetchpriority=high uniquement en eager (jamais tout en prioritaire)');
expect(foodImg.includes('decoding="async"'), 'decoding=async');
expect(foodImg.includes('offThumb100'), 'repli miniature OFF 100 px dérivée (jamais 200/400 px)');
expect(/failed = true/.test(foodImg) && !/retry|while/.test(foodImg), 'échec → placeholder, aucune boucle de retry');

section('Call sites — Journal & Recherche centralisés');
const jd = src('src/lib/components/JournalDay.svelte');
expect(jd.includes('src={e.thumbUrl} fallbackSrc={e.imageUrl}'), 'Journal : miroir prioritaire + OFF en repli');
expect(jd.includes('entries.slice(0, 4)'), 'Journal : seules les 4 premières lignes visibles sont prioritaires');
const page = src('src/routes/espace/journal/+page.svelte');
expect(page.includes('src={food.thumbUrl} fallbackSrc={food.imageUrl}'), 'Recherche : miroir prioritaire + OFF en repli');
expect(page.includes('warmFoodImages([food])'), 'préchauffage déclenché à la sélection d’un aliment');
expect(page.includes('warmFoodImages(mealItems.map'), 'préchauffage déclenché à l’enregistrement d’un repas');

section('Service Worker — cache stable des vignettes (src/service-worker.ts)');
const sw = src('src/service-worker.ts');
expect(sw.includes("const IMG_CACHE = 'gflux-img-v1';"), 'cache d’images à nom STABLE (survit aux builds — les vignettes déjà vues restent instantanées)');
expect(sw.includes('isMirrorImage'), 'copies miroir Convex (/api/storage/) mises en cache');
expect(sw.includes('IMG_CACHE_MAX'), 'plafond d’entrées du cache (pas de croissance illimitée)');
expect(!sw.includes("caches.delete(IMG_CACHE)"), 'le cache d’images n’est jamais purgé à l’activation');

section('Données nutritionnelles — aucune régression');
const off = src('src/convex/off.ts');
expect(off.includes('rankFoods') && off.includes('applyKcalGuard'), 'recherche OFF : ranking + garde-fou kcal intacts');
expect(src('src/convex/journal.ts').includes('guardedKcal100'), 'garde-fou kcal↔macros conservé');
const jday = src('src/convex/journal.ts');
expect(jday.includes('thumbUrl') && !/imageUrl:.*thumbUrl/.test(jday), 'imageUrl OFF jamais réécrite en base (thumbUrl ajouté à la volée)');

section('Fichiers livrés');
for (const f of [
	'src/lib/foodImage.ts',
	'src/lib/foodImageWarm.ts',
	'src/convex/foodImages.ts',
	'src/routes/api/food-image/warm/+server.ts',
	'src/lib/components/FoodImg.svelte',
]) {
	expect(existsSync(f), `${f} présent`);
}

console.log(`\n✅ ${n} vérifications passées — logique pure + contrats d'architecture OK.`);
