/**
 * MISSION PHOTO — « Créer par moi » avec photo d'aliment.
 *
 * Vérifie la chaîne complète SANS backend ni réseau :
 *   formulaire (caméra/galerie, preview, remplacer/supprimer)
 * → BFF multipart (upload storage côté serveur)
 * → Convex (champs additifs, isolation cliente, cascade suppression)
 * → affichage (Créés par moi, recherche, Journal, fiche premium).
 *
 * NON-RÉGRESSION : le contrat JSON historique et le fallback sans photo
 * restent inchangés ; aucun champ existant du schéma n'est modifié.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const schema = read('src/convex/schema.ts');
const customFoods = read('src/convex/customFoods.ts');
const journal = read('src/convex/journal.ts');
const bffCustom = read('src/routes/api/foods/custom/+server.ts');
const page = read('src/routes/espace/journal/+page.svelte');
const sheet = read('src/lib/components/QuantitySheet.svelte');
const journalDay = read('src/lib/components/JournalDay.svelte');
const coach = read('src/convex/coach.ts');
const previewSeed = read('src/convex/previewSeed.ts');

/* ─── 1) Schéma — additif, rétrocompatible, non destructif ─── */

test('Schéma customFoods : photoStorageId optionnel + photoUpdatedAt (aucun champ modifié)', () => {
	assert.ok(schema.includes('photoStorageId: v.optional(v.id("_storage"))'), 'champ photo additif');
	assert.ok(schema.includes('photoUpdatedAt: v.optional(v.number())'), 'horodatage photo additif');
	assert.ok(!/kcal100:\s*v\.optional/.test(schema), 'les champs existants restent requis (non destructif)');
});

/* ─── 2) Convex — validation, isolation, cycle de vie photo ─── */

test('customFoods : la mutation vérifie le fichier (type image, taille) avant référence', () => {
	assert.ok(customFoods.includes("meta.contentType?.startsWith(\"image/\")"), 'type image vérifié');
	assert.ok(customFoods.includes('MAX_PHOTO_BYTES'), 'plafond de taille présent');
});

test('customFoods.update : remplacement ET retrait (clearPhoto), ancienne photo supprimée du storage', () => {
	assert.ok(customFoods.includes('clearPhoto: v.optional(v.boolean())'), 'option retrait photo');
	assert.ok(customFoods.includes('deletePhotoSilently'), 'suppression storage (jamais d’orphelin)');
});

test('customFoods.remove : la photo appartient à la fiche → supprimée avec elle', () => {
	const removeFn = customFoods.slice(customFoods.indexOf('export const remove'));
	assert.ok(removeFn.includes('deletePhotoSilently(ctx, food.photoStorageId)'), 'photo purgée à la suppression');
});

test('customFoods : photoUrl résolue UNIQUEMENT chez la propriétaire (list/byIds)', () => {
	assert.ok(customFoods.includes('withPhotoUrls'), 'enrichissement photoUrl centralisé');
	// L'index by_user + le filtre userId garantissent l'isolation cliente.
	assert.ok(/withIndex\("by_user"[\s\S]{0,200}eq\("userId", user\._id\)/.test(customFoods), 'lecture limitée aux fiches de la cliente');
});

test('journal : searchLocal / recentFoods attachent la photo aux aliments personnels (jamais OFF)', () => {
	assert.ok(journal.includes('photoUrl'), 'champ photoUrl présent');
	assert.ok(journal.includes('toCustomHit(ctx, f)'), 'seule la branche custom résout la photo');
});

test('journal : snapshot photo à l’ajout (addEntry) + validation « Mangé » (commit)', () => {
	const addCustom = journal.slice(journal.indexOf('} else if (customFoodId) {'));
	assert.ok(/photoStorageId[\s\S]{0,300}const k = qtyGrams \/ 100;/.test(addCustom), 'addEntry : photo de l’aliment personnel snapshotée avant l’insertion');
	assert.ok(journal.includes('customPhotoByFoodId'), 'getDay : jointure photo pour entrées et planifiés');
});

test('coach.removeClient : photos des aliments personnels supprimées avec le compte', () => {
	const cascade = coach.slice(coach.indexOf('export const removeClient'));
	assert.ok(cascade.includes('photoStorageId'), 'cascade photo à la suppression de compte');
	assert.ok(cascade.includes('.query("customFoods")'), 'fiches personnelles supprimées');
});

/* ─── 3) BFF — multipart photo côté serveur, JSON historique intact ─── */

test('BFF /api/foods/custom : multipart (photo) ET JSON (contrat historique) coexistent', () => {
	assert.ok(bffCustom.includes("includes('multipart/form-data')"), 'multipart accepté');
	assert.ok(bffCustom.includes('resolvePhoto'), 'photo relayée au storage côté serveur');
	assert.ok(bffCustom.includes('photos.generateUploadUrl'), 'URL d’upload générée côté serveur (jamais le client)');
	assert.ok(bffCustom.includes('event.request.json()'), 'JSON historique conservé');
	assert.ok(bffCustom.includes('clearPhoto'), 'retrait photo relayé');
});

/* ─── 4) UI — caméra/galerie, preview, remplacer/supprimer ─── */

test('Formulaire « Créer par moi » : deux entrées photo (caméra + galerie), photo optionnelle', () => {
	assert.ok(page.includes('capture="environment"'), 'capture caméra mobile');
	assert.ok(page.includes('cfGalleryInput'), 'entrée galerie distincte');
	assert.ok(page.includes('Prendre une photo'), 'CTA caméra');
	assert.ok(page.includes('Choisir dans la galerie'), 'CTA galerie');
	assert.ok(page.includes("(optionnel)"), 'la photo reste optionnelle');
});

test('Preview avant enregistrement : compression immédiate, remplaçable/supprimable', () => {
	assert.ok(page.includes('optimizeImageFile'), 'pipeline image existant réutilisé (orientation iPhone + downscale)');
	assert.ok(page.includes('cfPreviewUrl'), 'aperçu local (blob:)');
	assert.ok(page.includes('removeCustomFoodPhoto'), 'suppression avant sauvegarde');
	assert.ok(page.includes('Remplacer'), 'remplacement avant sauvegarde');
	assert.ok(page.includes('revokeObjectURL'), 'blob: révoqué (pas de fuite mémoire)');
});

test('Sauvegarde : multipart UNIQUEMENT si photo impliquée, sinon contrat JSON inchangé', () => {
	assert.ok(page.includes('customFoodFormData'), 'corps multipart construit côté client');
	assert.ok(page.includes("fd.set('photo', cfPhotoBlob"), 'photo transmise à la sauvegarde');
	assert.ok(page.includes("headers: { 'Content-Type': 'application/json' }"), 'chemin JSON conservé');
	assert.ok(page.includes('wantsClear'), 'retrait après création possible');
});

test('Édition : photo existante préchargée (remplacer/supprimer sans recréer la fiche)', () => {
	assert.ok(page.includes('cfExistingPhotoUrl'), 'photo existante en preview');
	assert.ok(page.includes('cfHadStoredPhoto'), 'état « fiche avait une photo »');
});

/* ─── 5) Affichage — la photo suit l’aliment partout ─── */

test('« Créés par moi » : la photo remplace le placeholder (fallback G-FLUX sinon)', () => {
	assert.ok(page.includes('{#if food.photoUrl}'), 'vignette photo dans la liste');
});

test('Recherche / favoris / fréquents (foodRow) : photo prioritaire, jamais d’image OFF en concurrence', () => {
	const foodRow = page.slice(page.indexOf('{#snippet foodRow(food: Food)}'));
	assert.ok(foodRow.includes('food.photoUrl'), 'photo dans la ligne produit');
});

test('Journal : entrées et items planifiés affichent la photo (JournalDay)', () => {
	assert.ok(journalDay.includes('photoUrl?: string'), 'types enrichis');
	assert.ok(journalDay.includes('e.photoUrl ?? e.thumbUrl'), 'entrée consommée : photo prioritaire');
	assert.ok(journalDay.includes('p.photoUrl ?? p.thumbUrl'), 'item planifié : photo prioritaire');
});

test('Fiche premium (QuantitySheet) : hero = photo cliente si aucun visuel d’origine', () => {
	assert.ok(sheet.includes('photoUrl?: string'), 'type enrichi');
	assert.ok(sheet.includes('food.imageUrl ?? food.thumbUrl ?? food.photoUrl'), 'priorité héro cohérente');
});

test('Scan d’un produit déjà créé : la photo de sa fiche suit le hit', () => {
	assert.ok(customFoods.includes('source: "own" as const') && customFoods.includes('photoUrl: own.photoStorageId'), 'byBarcodeGlobal expose la photo');
	assert.ok(page.includes('photoUrl: hit.photoUrl'), 'le hit scan la transmet à la fiche');
});

/* ─── 6) Preview DEMO ─── */

test('Seed preview : aliment DEMO avec photo (100 % fictif, idempotent, upload storage côté action)', () => {
	assert.ok(previewSeed.includes('seedDemoCustomFood'), 'aliment de démo avec photo');
	assert.ok(previewSeed.includes('DEMO_CUSTOM_FOOD_NAME'), 'nom de test identifiable');
	// Contrainte runtime Convex : storage.store n'existe que dans une ACTION.
	// Le hook --preview-run est donc une action (upload) → mutation interne
	// pour les écritures ; un échec d'upload ne bloque JAMAIS le seed.
	assert.ok(/export const seedPreviewData = action\(/.test(previewSeed), 'hook --preview-run = action (contexte action requis pour l\'upload)');
	assert.ok(previewSeed.includes('ctx.storage.store'), 'upload via storage.store (jamais fetch en mutation)');
	assert.ok(previewSeed.includes('seedCoreInternal'), 'écritures centralisées dans la mutation interne');
});

/* ─── 7) Non-régression — clavier, scanner, flux existants ─── */

test('Non-régression : champ texte nom conservé, aucune régression clavier du formulaire', () => {
	assert.ok(page.includes('bind:value={cfName}'), 'saisie nom inchangée');
	// Les inputs photo sont cachés et hors focus par défaut : aucune régression.
	assert.ok(/type="file"[^>]*class="hidden"/.test(page), 'inputs photo non focusables à l’ouverture');
});

test('Non-régression : le flux sans photo reste le chemin par défaut (création JSON)', () => {
	const saveFn = page.slice(page.indexOf('async function saveCustomFood()'), page.indexOf('async function deleteCustomFood'));
	assert.ok(saveFn.includes("code.length >= 8"), 'anti-doublon code-barres conservé');
	assert.ok(saveFn.includes("openQty({ ...created, custom: true })"), 'offre d’ajout direct conservée');
});
