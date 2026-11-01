/**
 * Mission COACH-AJOUT — fiche quantité à l'ajout d'un aliment côté coach.
 *
 * Avant : un clic sur un résultat de « Ajouter un aliment » (CRM) ajoutait
 * immédiatement l'aliment avec le champ « Quantité (g) » ; le coach devait
 * corriger la quantité dans le journal.
 *
 * Après : la LIGNE du résultat ouvre la fiche de quantité partagée (quantité
 * modifiable, macros en direct, fiche nutritionnelle, repas modifiable) et
 * « Ajouter au journal de [prénom] » écrit la quantité/le repas CHOISIS via la
 * même mutation coach que l'ajout existant. Le « ＋ » garde l'ajout rapide
 * (champ « Quantité (g) »). La consultation (readOnly) de COACH-JOURNAL ne
 * change pas ; l'espace cliente non plus.
 *
 * Ces tests verrouillent le CÂBLAGE (projet sans DOM de test) : les mêmes
 * assertions de source que les autres missions UI du dépôt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const admin = read('src/routes/admin/+page.svelte');
const sheet = read('src/lib/components/QuantitySheet.svelte');
const journalPage = read('src/routes/espace/journal/+page.svelte');

/** Bloc de code d'une fonction (jusqu'au marqueur suivant fourni). */
function sliceBetween(startMarker, endMarker, source = admin) {
	const start = source.indexOf(startMarker);
	assert.ok(start > -1, `bloc présent : ${startMarker}`);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.ok(end > start, `fin de bloc trouvée : ${endMarker}`);
	return source.slice(start, end);
}

/* ─── 1. Le clic sur la ligne ouvre la fiche ; le ＋ ajoute vite ─── */

test('Clic sur un résultat : ouvre la fiche quantité (Ciqual ET produits)', () => {
	assert.equal(
		(admin.match(/onclick=\{\(\) => openAddSheet\(hit\)\}/g) || []).length,
		2,
		'les deux listes de résultats (Ciqual + OFF) ouvrent la fiche'
	);
	assert.equal(
		(admin.match(/onclick=\{\(\) => addFood\(hit\)\}/g) || []).length,
		2,
		'les deux boutons ＋ gardent l ajout rapide'
	);
	// Les deux boutons sont FRÈRES : aucune ligne n'est un bouton géant qui
	// déclencherait l'ajout au clic (pas de bouton imbriqué non plus).
	const ciqualStart = admin.indexOf('{#each (foodSearch.state.ciqualExpanded');
	assert.ok(ciqualStart > -1, 'bloc de résultats Ciqual présent');
	const ciqualRow = admin.slice(ciqualStart, admin.indexOf('{/each}', ciqualStart));
	assert.ok(ciqualRow.includes('openAddSheet(hit)'), 'ligne Ciqual → fiche');
	assert.ok(ciqualRow.includes('addFood(hit)'), '＋ Ciqual → ajout rapide');
	assert.ok(
		ciqualRow.indexOf('</button>') < ciqualRow.indexOf('addFood(hit)'),
		'le ＋ est un bouton FRÈRE de la ligne, jamais imbriqué'
	);
});

/* ─── 2. Valeur initiale : champ « Quantité (g) » + repas du volet ─── */

test('Fiche ouverte avec la quantité du champ et le repas du volet', () => {
	const open = sliceBetween('function openAddSheet', 'const addSheetFood');
	assert.ok(open.includes('addSheetQty = isFinite(q) && q >= 1 && q <= 5000 ? q : 100'), 'quantité initiale = champ Quantité (g), bornée 1–5000 g');
	assert.ok(open.includes('addSheetMeal = addMeal'), 'repas présélectionné = repas du volet');
	assert.ok(admin.includes('initialQtyGrams={addSheetQty}'), 'la fiche reçoit cette quantité');
	assert.ok(admin.includes('initialMeal={addSheetMeal}'), 'la fiche reçoit ce repas');
});

/* ─── 3. 35 g saisis dans la fiche → 35 g envoyés, dans le bon repas ─── */

test('La fiche enregistre la quantité SAISIE et le repas CHOISI', () => {
	// Le composant transmet bien la quantité validée (et non la valeur initiale).
	assert.ok(
		sheet.includes('onSave(Math.round((gramsNum ?? 0) * 100) / 100, meal)'),
		'QuantitySheet envoie la quantité courante + le repas sélectionné'
	);
	const save = sliceBetween('async function addFoodFromSheet', 'async function setQty');
	assert.ok(save.includes("fetch('/api/coach/journal'"), 'même endpoint coach que l ajout existant');
	assert.ok(save.includes('userId: selectedId'), 'même client (aucun nouveau droit)');
	assert.ok(save.includes('date: journalDate'), 'même date affichée');
	assert.ok(save.includes('\t\t\t\t\tmeal,'), 'repas transmis tel quel (donc 35 g dans le bon repas)');
	assert.ok(save.includes('\t\t\t\t\tqtyGrams,'), 'quantité transmise telle quelle (35 g → 35 g)');
	assert.ok(save.includes("referenceSource: 'gflux' as const, referenceFoodId: hit._id"), 'identité G-Flux inchangée');
	assert.ok(save.includes('? { ciqualLabel: hit._id }'), 'identité Ciqual inchangée');
	assert.ok(save.includes(': { foodId: hit._id }'), 'identité produit OFF inchangée');
	assert.ok(save.includes("if (!res.ok) throw new Error(data.error ?? 'Ajout impossible.')"), 'erreur serveur remontée dans la fiche');
});

test('Bouton principal libellé pour la cliente du dossier', () => {
	assert.ok(
		admin.includes("saveLabel={`Ajouter au journal de ${selected?.user.prenom ?? 'la cliente'}`}"),
		'« Ajouter au journal de [prénom] »'
	);
});

/* ─── 4. Après ajout : fiche fermée, journal à jour, recherche ouverte ─── */

test('Après ajout : fiche fermée, journal rechargé, volet de recherche intact', () => {
	const save = sliceBetween('async function addFoodFromSheet', 'async function setQty');
	assert.ok(save.includes('addSheetHit = null;'), 'fiche fermée');
	assert.ok(save.includes('await loadDay();'), 'journal à jour sans rechargement de page');
	const after = save.slice(save.indexOf('addSheetHit = null;'));
	assert.ok(!after.includes('searchOpen = false'), 'le volet de recherche reste ouvert');
	assert.ok(!after.includes('foodSearch.clear()'), 'la recherche reste affichée pour enchaîner');
});

/* ─── 5. Le ＋ garde l'ajout rapide (champ Quantité) ─── */

test('＋ : ajout rapide inchangé avec la quantité du champ', () => {
	const quick = sliceBetween('async function addFood', 'async function addFoodFromSheet');
	assert.ok(quick.includes('qtyGrams: Number(addQty) || 100'), 'quantité du champ « Quantité (g) »');
	assert.ok(quick.includes('meal: addMeal'), 'repas du volet');
	assert.ok(quick.includes('searchOpen = false'), 'comportement historique conservé (volet refermé)');
});

/* ─── 6. Consultation readOnly : toujours sans bouton d'ajout ─── */

test('Mode consultation : aucune action d écriture, aucun bouton d ajout', () => {
	assert.ok(
		sheet.includes('if (readOnly || !valid || gramsNum == null || saving) return;'),
		'save() neutralisé en consultation'
	);
	const footer = sheet.slice(sheet.indexOf("Footer d'actions"), sheet.indexOf('{/if}', sheet.indexOf("Footer d'actions")));
	assert.ok(footer.includes('{#if !readOnly}'), 'le footer d actions (dont « Ajouter au journal ») est absent en consultation');
	assert.ok(admin.includes('mode="edit"\n\t\t\t\t\t\t\t\treadOnly'), 'la fiche COACH-JOURNAL reste en lecture seule');
});

/* ─── 7. Espace cliente intouché ─── */

test('Côté cliente : aucun changement (pas de fiche d ajout coach)', () => {
	assert.ok(!journalPage.includes('openAddSheet'), 'aucune fonction de la mission dans le Journal cliente');
	assert.ok(!journalPage.includes('addFoodFromSheet'), 'aucun handler de la mission dans le Journal cliente');
});
