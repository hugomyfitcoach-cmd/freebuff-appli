/**
 * Mission CORRECTION FALLBACK NOM OFF BARCODE.
 *
 * Constat (audit + re-vérification live via relais jina.ai le 04/10/2026) :
 * Italpizza Margherita, EAN-13 8015673029861 — l'API OFF v2 renvoie
 * status:1, macros complètes (212 kcal, C26 / P10 / F7,2 / fibres 1,4) MAIS
 * `product_name` = "" et le nom uniquement dans des clés localisées
 * (product_name_de « La Numero Uno Margherita », product_name_it). Ancien
 * code : `if (!p.code || !p.product_name) continue;` → produit droppé
 * silencieusement → « introuvable » en live.
 *
 * Correctif : `resolveProductName` — ordre de préférence strict
 * product_name_fr → product_name → product_name_en → premier
 * `product_name_*` localisé non vide → rejet. On n'invente JAMAIS de nom.
 * Barcode obligatoire, filtre kcal, garde-fou kcal↔macros, cacheFoods
 * (upsert idempotent par offId) et HIT local avant appel OFF : intacts.
 *
 * Méthode : les fonctions pures de off.ts (resolveProductName,
 * parseProducts) sont EXTRAITES du vrai fichier source puis exécutées
 * réellement (module .mts temporaire, strip-types de node) ; le pipeline
 * Convex (HIT local avant OFF, cache, garde-fou à la relecture) est vérifié
 * par assertions de contenu — une query/action ne tourne pas hors Convex.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const off = read('src/convex/off.ts');
const journal = read('src/convex/journal.ts');
const guard = read('src/lib/nutritionGuard.ts');
const schema = read('src/convex/schema.ts');

/* ─── Extraction du VRAI code de off.ts (blocs purs) ─── */

/** Extrait un bloc délimité par accolades appariées à partir d'un marqueur. */
function extractBlock(src, marker) {
	const start = src.indexOf(marker);
	assert.ok(start >= 0, `marqueur introuvable dans off.ts : ${marker}`);
	let depth = 0;
	for (let i = src.indexOf('{', start); i < src.length; i++) {
		if (src[i] === '{') depth++;
		else if (src[i] === '}') {
			depth--;
			if (depth === 0) return src.slice(start, i + 1);
		}
	}
	assert.fail(`accolades non appariées : ${marker}`);
}

const tmpPath = join(__dirname, '.off-name-fallback-tmp.mts');
try { unlinkSync(tmpPath); } catch {}
writeFileSync(
	tmpPath,
	[
		extractBlock(off, 'type OffProduct') + ';',
		extractBlock(off, 'function resolveProductName'),
		extractBlock(off, 'function parseProducts'),
		'export { resolveProductName, parseProducts };',
	].join('\n\n'),
	'utf8'
);
after(() => { try { unlinkSync(tmpPath); } catch {} });

const { resolveProductName, parseProducts } = await import(pathToFileURL(tmpPath).href);

/* ─── Cas réel : Italpizza Margherita, EAN 8015673029861 ─── */

// Réponse OFF v2 RÉELLE (api/v2/product/8015673029861.json — vérifiée en
// live le 04/10/2026) : product_name = "", product_name_fr/en/sk = "" aussi,
// nom uniquement en _de/_it. Le JSON complet contient en outre deux clés
// product_name_* NON chaînes (product_name_all_languages et
// product_name_languages, objets) que le fallback doit ignorer.
const ITALPIZZA_8015673029861 = {
	code: '8015673029861',
	brands: 'Italpizza',
	product_name: '',
	product_name_all_languages: {},
	product_name_de: 'La Numero Uno Margherita',
	product_name_en: '',
	product_name_fr: '',
	product_name_it: 'La numero uno Margherita',
	product_name_languages: { de: 'La Numero Uno Margherita', fr: '', it: 'La numero uno Margherita', sk: '' },
	product_name_sk: '',
	image_front_small_url:
		'https://images.openfoodfacts.org/images/products/801/567/302/9861/front_sk.38.200.jpg',
	nutriments: {
		'energy-kcal_100g': 212,
		'carbohydrates_100g': 26,
		'proteins_100g': 10,
		'fat_100g': 7.2,
		'fiber_100g': 1.4,
	},
};

test('SCÉNARIO 1 — 8015673029861 : product_name vide mais nom localisé → ACCEPTÉ', () => {
	const parsed = parseProducts([ITALPIZZA_8015673029861]);
	assert.equal(parsed.length, 1, 'le produit n’est plus rejeté');
	assert.equal(parsed[0].offId, '8015673029861', 'EAN conservé comme offId');
	assert.equal(parsed[0].name, 'La Numero Uno Margherita', 'nom localisé RÉEL (jamais inventé)');
	assert.equal(parsed[0].brand, 'Italpizza');
	assert.equal(parsed[0].kcal100, 212, 'kcal conservées');
	assert.equal(parsed[0].carbs100, 26);
	assert.equal(parsed[0].protein100, 10);
	assert.equal(parsed[0].fat100, 7.2);
	assert.equal(parsed[0].fiber100, 1.4, 'fibres gardées pour le garde-fou kcal↔macros');
	assert.equal(parsed[0].imageUrl, ITALPIZZA_8015673029861.image_front_small_url, 'image OFF conservée');
	// Les clés product_name_* non chaînes (objets du JSON v2 complet) sont ignorées :
	// le nom retenu reste la première chaîne localisée non vide (product_name_de).
	assert.equal(
		resolveProductName(ITALPIZZA_8015673029861),
		'La Numero Uno Margherita',
		'product_name_all_languages / _languages (objets) ne perturbent pas le fallback'
	);
});

test('SCÉNARIO 2 — produit avec product_name classique : comportement INCHANGÉ', () => {
	const p = {
		code: '3017620422003',
		product_name: 'Pâte à tartiner aux noisettes',
		brands: 'Ferrero',
		nutriments: { 'energy-kcal_100g': 539, 'carbohydrates_100g': 57.5, 'proteins_100g': 6.3, 'fat_100g': 30.9 },
	};
	assert.equal(resolveProductName(p), 'Pâte à tartiner aux noisettes');
	const parsed = parseProducts([p]);
	assert.equal(parsed.length, 1);
	assert.equal(parsed[0].name, 'Pâte à tartiner aux noisettes');
	assert.equal(parsed[0].kcal100, 539);
	assert.equal(parsed[0].brand, 'Ferrero');
});

test('SCÉNARIO 3 — product_name_fr NON VIDE : prioritaire sur product_name et product_name_en', () => {
	const p = {
		code: '1234567890123',
		product_name: 'Pizza Margherita',
		product_name_fr: 'Pizza margherita surgelée',
		product_name_en: 'Frozen margherita pizza',
		product_name_it: 'Pizza margherita',
		nutriments: { 'energy-kcal_100g': 212 },
	};
	assert.equal(resolveProductName(p), 'Pizza margherita surgelée', 'FR gagne sur le nom standard');
	assert.equal(parseProducts([p])[0].name, 'Pizza margherita surgelée');
	// Même quand product_name_fr est déclaré APRÈS les autres clés.
	const pDesordre = {
		code: '1234567890123',
		product_name_en: 'Frozen margherita pizza',
		product_name: 'Pizza Margherita',
		product_name_fr: 'Pizza margherita surgelée',
		nutriments: { 'energy-kcal_100g': 212 },
	};
	assert.equal(resolveProductName(pDesordre), 'Pizza margherita surgelée', 'priorité = ordre du code, pas du JSON');
});

test('SCÉNARIO 4 — AUCUN nom exploitable (tous vides ou absents) → REJET PROPRE', () => {
	const sansNom = { code: '1', product_name: '', product_name_fr: '', product_name_en: '' };
	assert.equal(resolveProductName(sansNom), undefined, 'aucun nom trouvé');
	assert.deepEqual(parseProducts([sansNom]), [], 'rejeté malgré un code valide');
	// Macros complètes mais aucun nom → toujours rejeté (jamais de nom inventé).
	assert.deepEqual(
		parseProducts([{ code: '1', product_name: '', product_name_fr: '', nutriments: { 'energy-kcal_100g': 200 } }]),
		[],
		'kcal valides ne rattrapent pas l’absence de nom'
	);
	assert.deepEqual(parseProducts([{ code: '1', nutriments: { 'energy-kcal_100g': 200 } }]), [], 'aucune clé product_name du tout');
});

test('SCÉNARIO 5 — sans kcal valide → toujours REJETÉ (filtre kcal inchangé)', () => {
	const base = { code: '8015673029861', product_name_de: 'La Numero Uno Margherita' };
	assert.deepEqual(parseProducts([{ ...base }]), [], 'kcal absente');
	assert.deepEqual(parseProducts([{ ...base, nutriments: { 'energy-kcal_100g': 0 } }]), [], 'kcal = 0');
	assert.deepEqual(parseProducts([{ ...base, nutriments: { 'energy-kcal_100g': -12 } }]), [], 'kcal négative');
	assert.deepEqual(parseProducts([{ ...base, nutriments: { 'energy-kcal_100g': Number.NaN } }]), [], 'kcal NaN');
	// Le nom passe, c’est bien le filtre kcal qui rejette.
	assert.equal(resolveProductName({ ...base }), 'La Numero Uno Margherita');
});

/* ─── Pipeline : HIT local avant OFF, cache, garde-fou (assertions de contenu) ─── */

test('SCÉNARIO 6 — 2e lookup du même EAN : HIT Convex AVANT tout appel OFF', () => {
	// barcodeLookup (scan du Journal) : 1) foodByBarcode → retour immédiat,
	// 1bis) customFoods.byBarcode, 2) seulement ensuite l’API OFF produit.
	const lookup = off.slice(off.indexOf('export const barcodeLookup'));
	const localIdx = lookup.indexOf('api.journal.foodByBarcode');
	const customIdx = lookup.indexOf('api.customFoods.byBarcode');
	const offIdx = lookup.indexOf('api/v2/product/');
	assert.ok(localIdx > 0 && customIdx > localIdx && offIdx > customIdx, 'ordre : base locale → aliments personnels → OFF');
	assert.ok(lookup.includes('if (local) return [local];'), 'HIT base locale = retour immédiat, zéro appel OFF');
	// Même ordre dans le cœur partagé du Repas IA (resolveBarcodeCore).
	const core = off.slice(off.indexOf('async function resolveBarcodeCore'));
	assert.ok(
		core.indexOf('api.journal.foodByBarcode') < core.indexOf('api.customFoods.byBarcode') &&
			core.indexOf('api.customFoods.byBarcode') < core.indexOf('api/v2/product/'),
		'resolveBarcodeCore : même ordre de résolution'
	);
	// Upsert idempotent par offId : 2e lookup → même fiche, jamais de doublon.
	assert.ok(
		journal.includes('const id = existing ? existing._id : await ctx.db.insert("foods", p);'),
		'cacheFoods : upsert par offId (idempotent)'
	);
});

test('SCÉNARIO 7 — garde-fou kcal↔macros TOUJOURS appliqué après cache/relecture', () => {
	const byBarcode = journal.slice(journal.indexOf('export const foodByBarcode'));
	const byIds = journal.slice(journal.indexOf('export const foodsByIds'));
	assert.ok(byBarcode.includes('kcal100: guardedKcal100(food)'), 'foodByBarcode : kcal servies sous garde-fou');
	assert.ok(byIds.includes('kcal100: guardedKcal100(f)'), 'foodsByIds (relecture post-cache) : garde-fou appliqué');
	// Module pur du garde-fou intact (lecture seule pour cette mission).
	assert.ok(guard.includes('export function theoreticalKcal100'), 'theoreticalKcal100 présent');
	assert.ok(guard.includes('export function kcalNeedsRecalc'), 'kcalNeedsRecalc présent');
	assert.ok(guard.includes('export function guardedKcal100'), 'guardedKcal100 présent');
	// Le flux OFF passe bien par cacheFoods PUIS relecture foodsByIds (guardée).
	const lookup = off.slice(off.indexOf('export const barcodeLookup'));
	assert.ok(
		lookup.indexOf('api.journal.cacheFoods') < lookup.indexOf('api.journal.foodsByIds'),
		'cacheFoods puis relecture foodsByIds (sous garde-fou)'
	);
});

/* ─── Périmètre : champs OFF, invariants conservés, zéro schema ─── */

test('CHAMPS OFF : product_name_fr/en demandés aussi en recherche texte (v1) — v2 produit inchangée', () => {
	assert.ok(
		off.includes('fields=code,product_name,product_name_fr,product_name_en,brands,'),
		'noms localisés dans le fields de OFF_SEARCH_URL'
	);
	const v2 = off.match(/https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/\$\{code\}\.json/g) || [];
	assert.equal(v2.length, 2, 'URL produit v2 intacte, sans param fields (JSON complet) — barcodeLookup + resolveBarcodeCore');
});

test('INVARIANTS : barcode obligatoire, filtre kcal, rejet par nom retiré, helper branché', () => {
	assert.ok(!off.includes('!p.code || !p.product_name'), 'ancien rejet !p.product_name supprimé');
	assert.ok(off.includes('if (!p.code) continue;'), 'code-barres toujours obligatoire');
	assert.ok(
		off.includes('if (typeof kcal !== "number" || !isFinite(kcal) || kcal <= 0) continue;'),
		'filtre kcal littéralement inchangé'
	);
	assert.ok(
		off.includes('function resolveProductName(p: OffProduct): string | undefined'),
		'helper de résolution typé présent'
	);
	assert.ok(off.includes('const name = resolveProductName(p);'), 'parseProducts passe par le helper');
	assert.ok(off.includes('\t\t\tname,'), 'le nom résolu est bien celui poussé dans le résultat');
});

test('PÉRIMÈTRE : zéro changement schema Convex (tables/indexes tels quels)', () => {
	assert.ok(schema.includes('by_offId'), 'index by_offId intact');
	assert.ok(schema.includes('by_barcode'), 'index by_barcode intact');
	assert.ok(!off.includes('defineTable'), 'aucune définition de table dans off.ts');
});
