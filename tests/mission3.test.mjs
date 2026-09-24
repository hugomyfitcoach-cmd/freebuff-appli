/**
 * Tests ciblés — MISSION 3 :
 *  1. Scanner : constantes du cadre élargi + bordures vert/blanc cohérentes ;
 *  2. Repas IA « état cuit par défaut » :
 *     - non-régression : « Riz basmati cuit » (vrai scoring + bonus, fiches
 *       CIQUAL réelles) doit battre « Riz basmati, cru » ;
 *     - règle neutralisée quand l'ingrédient est explicitement cru/sec ;
 *  3. Avatar profil : le BFF refuse un fichier non image / trop lourd, et le
 *     schéma users porte bien le champ photo (code source).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const cooked = await import(new URL('../src/lib/cookedState.ts', import.meta.url).href);
const { nameMatchScore } = await import(new URL('../src/lib/foodText.ts', import.meta.url).href);

/* ─── 1) Scanner ─── */

test('Scanner : cadre élargi (≈ pleine largeur, centre au-dessus du milieu)', async () => {
	const src = readFileSync(join(root, 'src/lib/barcodeScanner.ts'), 'utf8');
	const left = src.match(/FRAME_LEFT_RIGHT_PCT = (\d+)/);
	const top = src.match(/FRAME_TOP_PCT = (\d+)/);
	const height = src.match(/FRAME_HEIGHT_PCT = (\d+)/);
	assert.ok(left && top && height, 'constantes du cadre présentes');
	const l = Number(left[1]);
	assert.ok(l <= 5, `cadre quasi pleine largeur (left/right ${l}% ≤ 5%)`);
	assert.ok(Number(top[1]) >= 20 && Number(top[1]) <= 32, 'bande centrale légèrement au-dessus du milieu');
	assert.ok(Number(height[1]) >= 38, 'hauteur du cadre ≥ 38 % (esprit capture Food)');
});

test('Scanner : flash vert à la détection + vibration conservée', () => {
	const src = readFileSync(join(root, 'src/lib/barcodeScanner.ts'), 'utf8');
	assert.ok(src.includes('flashGreen()'), 'flash vert appelé à la détection');
	assert.ok(/vibrateOk\(\);\s*\n\s*flashGreen\(\);/.test(src), 'vibration toujours déclenchée avec le flash');
	assert.ok(src.includes('74,222,128'), 'bordures vertes (vert clair) présentes');
	assert.ok(src.includes('focusMode'), 'focus continu (iPhone) tenté best-effort');
	assert.ok(src.includes('TRY_HARDER, true'), 'seconde passe ZXing TRY_HARDER');
});

/* ─── 2) Repas IA — état cuit par défaut ─── */

/** Vraies fiches Ciqual embarquées (nom, kcal) — source de vérité du matcher. */
function ciqualRows() {
	const src = readFileSync(join(root, 'src/convex/ciqualNutrients.ts'), 'utf8');
	const out = [];
	const re = /name: "([^"]+)", kcal: ([\d.]+)/g;
	let m;
	while ((m = re.exec(src)) !== null) out.push({ name: m[1], kcal: Number(m[2]) });
	return out;
}

/** Simule findBestMatch côté Ciqual : recherche « <nom> cuit » + bonus/pénalité. */
function matchCiqual(ingredient, { wantCooked }) {
	const search = wantCooked ? (cooked.preferCookedForMeal(ingredient) ?? ingredient) : ingredient;
	const hits = ciqualRows().filter((r) => r.name.toLowerCase().includes('riz'));
	let best = null;
	for (const r of hits) {
		const s = nameMatchScore(ingredient, r.name) + 0.05 + cooked.cookedBonusFor(r.name, wantCooked);
		if (!best || s > best.score) best = { ...r, score: s };
	}
	return { best, search };
}

test('NON-RÉGRESSION : photo repas avec riz → JAMAIS « Riz cru »', () => {
	// Ce que l'IA écrit pour du riz blanc photographié dans une assiette (prompt mis à jour).
	for (const ingredient of ['Riz', 'Riz basmati cuit', 'Riz blanc cuit']) {
		const { best, search } = matchCiqual(ingredient, { wantCooked: true });
		assert.ok(best, 'un match Ciqual existe');
		assert.ok(
			!/cru/i.test(best.name),
			`« ${ingredient} » ne doit PAS matcher une fiche crue — obtenu : « ${best.name} » (recherche « ${search} »)`
		);
		assert.match(best.name, /cuit/i, `le match est la variante cuite : « ${best.name} »`);
	}
});

test('Sanity : sans la règle, « Riz basmati » tombait sur la fiche crue (le bug est bien couvert)', () => {
	const { best } = matchCiqual('Riz basmati', { wantCooked: false });
	assert.match(best.name, /basmati, cru/i, 'sans règle : l’ancien comportement matchait « cru »');
});

test('Aliment explicitement cru/sec → règle neutralisée (recherche non réécrite)', () => {
	assert.equal(cooked.preferCookedForMeal('Riz cru'), null);
	assert.equal(cooked.preferCookedForMeal('Pâtes sèches'), null);
	assert.equal(cooked.preferCookedForMeal('Tomates cerises'), null, 'non-féculent : règle non applicable');
	assert.equal(cooked.preferCookedForMeal('Riz basmati cuit'), 'Riz basmati cuit cuit', 'déjà « cuit » : terme inchangé côté recherche');
});

test('Bonus cuit / pénalité cru uniquement quand la règle est active', () => {
	assert.equal(cooked.cookedBonusFor('Riz blanc, cru', false), 0);
	assert.ok(cooked.cookedBonusFor('Riz blanc, cru', true) < 0, 'fiche crue pénalisée');
	assert.ok(cooked.cookedBonusFor('Riz blanc, cuit, sans sel ajouté', true) > 0, 'fiche cuite bonifiée');
	assert.equal(cooked.cookedBonusFor('Courgettes', true), 0, 'candidat neutre ni cru ni cuit');
});

test('MEAL_PROMPT : consigne « servi cuit » + exemple « riz basmati cuit »', () => {
	const src = readFileSync(join(root, 'src/lib/server/openai.ts'), 'utf8');
	assert.ok(src.includes("« riz basmati cuit »"), 'le prompt nomme la variante cuite en exemple');
	assert.ok(/riz, pâtes, semoule, quinoa/.test(src), 'le prompt couvre les féculents');
});

test('Le matching repas applique la règle, PAS la recherche générale', () => {
	const mm = readFileSync(join(root, 'src/convex/mealMatch.ts'), 'utf8');
	assert.ok(mm.includes('preferCookedForMeal'), 'mealMatch utilise la règle cuit par défaut');
	const journal = readFileSync(join(root, 'src/convex/journal.ts'), 'utf8');
	assert.ok(!journal.includes('cookedState'), 'la recherche générale (Journal) reste inchangée');
});

/* ─── 3) Avatar profil ─── */

test('BFF /api/profile/photo : refuse non-image et > 10 Mo, mutation client-only', () => {
	const src = readFileSync(join(root, 'src/routes/api/profile/photo/+server.ts'), 'utf8');
	assert.ok(src.includes("requireRole(event, 'client'"), 'réservé aux clientes (session obligatoire)');
	assert.ok(src.includes("startsWith('image/')"), 'refuse les non-images');
	assert.ok(src.includes('MAX_FILE_BYTES'), 'limite de taille présente');
	assert.ok(src.includes('optimizeImageFile'), 'réutilise l’optimisation image existante');
	assert.ok(src.includes('photos.generateUploadUrl'), 'réutilise le stockage Convex existant');
});

test('Schema users : champ profilePhotoStorageId optionnel', () => {
	const src = readFileSync(join(root, 'src/convex/schema.ts'), 'utf8');
	assert.ok(src.includes('profilePhotoStorageId'), 'chang de schéma présent');
});

test('AppShell : avatar rond (photo ou initiale + « + ») remplace la roue côté cliente', () => {
	const src = readFileSync(join(root, 'src/lib/components/AppShell.svelte'), 'utf8');
	assert.ok(src.includes('profilePhotoUrl'), 'prop reçue du layout');
	assert.ok(src.includes("Menu profil"), 'bouton avatar accessible');
	assert.ok(src.includes("Modifier ma photo"), 'modification photo dans le menu');
	assert.ok(src.includes('/onboarding/install'), 'réglages (tutoriel install) conservés');
	assert.ok(src.includes('/connexion?/logout'), 'déconnexion conservée');
	// Côté coach : la roue reste (branche else).
	assert.ok(src.includes('name="settings"'), 'roue conservée pour le coach');
});
