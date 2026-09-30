/**
 * Mission : FICHE ALIMENT PREMIUM (référence UX Food, identité G-FLUX conservée).
 *
 * Parcours : clic sur un aliment depuis la recherche, le Journal, l'éditeur
 * de repas, « Mes repas » ou les plans coach → UNE MÊME fiche grande et
 * visuelle : hero image immersive, nom complet sans troncature, marque,
 * badge source (Ciqual / Estimation IA / personnalisé), 4 cartes macros
 * compactes au code couleur du Journal, CTA collant accessible au pouce.
 *
 * Garde-fous testés :
 *  - UNE seule source de vérité : QuantitySheet reste LA fiche partagée
 *    (aucune fiche parallèle, aucun CTA dupliqué) ;
 *  - logique métier INTACTE : grammes/portions/repères, bornes, conversions,
 *    modes add/edit/planned, Mangé/Remplacer/Supprimer, favori ;
 *  - image JAMAIS étirée ni recadrée (object-contain sur le hero, cover
 *    inchangé pour les vignettes) + placeholder G-FLUX si aucune image ;
 *  - identité G-FLUX : tokens existants (brand/cream/line/mist, radius,
 *    safe areas iOS) — aucun design parallèle ;
 *  - zéro changement backend / Convex (frontend-only).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const sheet = read('src/lib/components/QuantitySheet.svelte');
const foodImg = read('src/lib/components/FoodImg.svelte');
const journalPage = read('src/routes/espace/journal/+page.svelte');
const plansPage = read('src/routes/admin/plans/+page.svelte');

/* ─── 1. Source de vérité unique ─── */

test('Une seule source de vérité : QuantitySheet reste LA fiche de tous les points d\u2019entrée', () => {
	const uses = (journalPage.match(/<QuantitySheet/g) || []).length;
	assert.equal(uses, 4, '4 usages dans le journal : ajout, édition entrée, item planifié, ingrédient de repas');
	assert.ok(plansPage.includes('<QuantitySheet'), 'plans coach : même composant partagé');
	// Aucune fiche parallèle : le CTA « Ajouter au journal » n'existe QUE dans le composant.
	assert.ok(sheet.includes('Ajouter au journal'), 'CTA par défaut du composant');
	assert.equal((journalPage.match(/Ajouter au journal/g) || []).length, 0, 'aucun CTA dupliqué dans la page journal');
});

test('API du composant inchangée : zéro modification requise côté appelants (journal + plans)', () => {
	for (const prop of [
		'mealDefs', 'initialQtyGrams', 'initialMeal', 'mode', 'saving', 'saveLabel', 'source',
		'showFav', 'favActive', 'favFoodId', 'onToggleFav', 'sheetTop', 'sheetHeight',
		'onSave', 'onEat', 'onReplace', 'onUnEat', 'onDelete', 'onClose',
	]) {
		assert.ok(sheet.includes(prop), `prop conservée : ${prop}`);
	}
	assert.ok(plansPage.includes('saveLabel={editKey'), 'plans coach : appel inchangé');
});

/* ─── 2. Hero image (référence UX Food) ─── */

test('Hero image : grande zone visuelle, jamais étirée ni recadrée, repli propre', () => {
	assert.ok(sheet.includes('h-[240px]'), 'grande image d\u2019en-tête (240 px)');
	assert.ok(sheet.includes('max-h-[42dvh]'), 'plafond viewport mobile (petits iPhone)');
	assert.ok(sheet.includes('fit="contain"'), 'image ENTIÈRE visible — jamais étirée/pixellisée');
	assert.ok(sheet.includes('food.imageUrl ?? food.thumbUrl'), 'priorité à l\u2019image OFF d\u2019origine (meilleure résolution que la miniature)');
	assert.ok(sheet.includes('bg-brand-light'), 'placeholder G-FLUX si aucune image (jamais d\u2019icône cassée)');
	assert.ok(/fit = 'cover'/.test(foodImg), 'vignettes existantes INCHANGÉES (défaut cover)');
	assert.ok(foodImg.includes("'object-contain'"), 'FoodImg : contain disponible pour le grand visuel');
	assert.ok(foodImg.includes('offThumb100'), 'chaîne de repli miroir/OFF conservée');
});

/* ─── 3. Identité : nom, marque, source ─── */

test('Identité : nom complet SANS troncature, marque, badges source', () => {
	assert.ok(sheet.includes('break-words'), 'nom long lisible — pas de troncature agressive');
	assert.ok(sheet.includes("food.brand !== 'null'"), 'marque affichée (valeur « null » héritée d\u2019OFF filtrée)');
	assert.ok(sheet.includes('Référence Ciqual – ANSES'), 'badge Ciqual conservé');
	assert.ok(sheet.includes('Estimation IA'), 'badge Estimation IA (prêt pour la branche IA)');
	assert.ok(sheet.includes('Aliment personnalisé'), 'badge aliment personnalisé');
	assert.ok(sheet.includes('Valeur recalculée'), 'garde-fou kcal↔macros toujours visible');
	assert.ok(sheet.includes("'ciqual' | 'ai'"), 'source accepte ciqual + ai');
});

/* ─── 4. Macros en cartes ─── */

test('Macros : 4 cartes compactes au code couleur du Journal', () => {
	assert.ok(sheet.includes('grid grid-cols-4 gap-2'), '4 cartes compactes');
	assert.ok(sheet.includes('#ec4899'), 'glucides rose');
	assert.ok(sheet.includes('#3b82f6'), 'protéines bleu');
	assert.ok(sheet.includes('#f97316'), 'lipides orange');
	assert.ok(sheet.includes('Calories') && sheet.includes('Glucides') && sheet.includes('Protéines') && sheet.includes('Lipides'), 'libellés des 4 cartes');
	assert.ok(/text-brand/.test(sheet), 'calories en vert identité G-FLUX (token brand)');
	assert.ok(sheet.includes('bg-cream'), 'fond des cartes = token existant (aucune couleur inventée)');
});

/* ─── 5. Logique métier INTACTE ─── */

test('Logique métier INTACTE : quantités, portions, repères, modes et actions', () => {
	assert.ok(sheet.includes("'g' | 'portion' | 'repere'"), 'trois unités de saisie');
	assert.ok(sheet.includes('Repères G-FLUX'), 'onglet repères conservé');
	assert.ok(sheet.includes('[50, 100, 150, 200]'), 'raccourcis grammes');
	assert.ok(sheet.includes('[0.5, 1, 1.5, 2]'), 'raccourcis portions');
	assert.ok(sheet.includes('gramsNum <= 5000'), 'borne haute 5000 g conservée');
	assert.ok(sheet.includes('Math.round((gramsNum ?? 0) * 100) / 100'), 'arrondi 2 décimales conservé');
	assert.ok(sheet.includes('switchMode'), 'conversion entre onglets (quantité conservée) conservée');
	assert.ok(sheet.includes('Enregistrer la quantité'), 'planned : enregistrer sans consommer');
	assert.ok(sheet.includes('Mangé'), 'action Mangé (planned)');
	assert.ok(sheet.includes('Remplacer'), 'action Remplacer (planned)');
	assert.ok(sheet.includes('Remettre en planifié'), 'décocher Mangé (edit)');
	assert.ok(sheet.includes('aria-label="Moins"') && sheet.includes('aria-label="Plus"'), 'boutons − / + conservés');
});

/* ─── 6. UX mobile / accessibilité ─── */

test('Footer d\'actions : barre SOLIDE hors flux — aucun recouvrement possible', () => {
	// Régression iPhone (capture 11:34) : sticky + dégradé transparent →
	// Supprimer/Enregistrer passaient VISUELLEMENT par-dessus les boutons
	// Petit-déjeuner/Déjeuner. Désormais : zone de scroll (hero → quantité →
	// cartes → repas) et footer d'actions sont des FRÈRES flex — la barre
	// blanche opaque ne peut jamais recouvrir le contenu.
	assert.ok(sheet.includes('min-h-0 flex-1 overflow-y-auto'), 'zone de contenu scrollable (frère du footer)');
	assert.ok(sheet.includes("border-t border-line bg-white px-5"), 'footer opaque avec séparateur — rien ne passe derrière');
	assert.ok(!sheet.includes('bg-gradient-to-t from-white'), 'plus de dégradé transparent sous les actions');
	assert.ok(!sheet.includes('sticky bottom-0'), 'plus de footer sticky (cause du chevauchement)');
	assert.ok(sheet.includes('pb-[max(env(safe-area-inset-bottom),14px)]'), 'safe area iOS conservée dans le footer');
	// Ordre voulu : quantité → cartes → choix du repas → actions (le footer reste en dernier).
	const scrollZone = sheet.slice(sheet.indexOf('min-h-0 flex-1'));
	assert.ok(scrollZone.indexOf('Choix du repas') < scrollZone.indexOf("Footer d'actions"), 'choix du repas DANS la zone scrollable, avant le footer');
});

test('UX mobile premium : CTA toujours accessible, safe areas, fermeture accessible', () => {
	assert.ok(sheet.includes("border-t border-line bg-white px-5"), 'CTA dans un footer solide toujours visible (accessible au pouce)');
	assert.ok(sheet.includes('env(safe-area-inset-bottom)'), 'safe area iOS respectée');
	assert.ok(sheet.includes('aria-label="Fermer"'), 'fermeture explicite en haut de fiche');
	assert.ok(sheet.includes("e.key === 'Escape'"), 'Échap ferme la fiche (desktop)');
	assert.ok(sheet.includes('e.target === e.currentTarget'), 'tap sur le fond = fermeture');
	assert.ok(sheet.includes('M2 9.5a5.5 5.5 0 0 1 9.591'), 'cœur favori (même SVG, même logique) conservé');
	assert.ok(sheet.includes('overscroll-contain'), 'scroll contenu dans la feuille (pas de rebond de page)');
	assert.ok(sheet.includes('disabled:opacity-60'), 'états disabled conservés (double-clic impossible)');
});

/* ─── 7. Points d'entrée du journal ─── */

test('Points d\u2019entrée journal : marque / source / personnalisé propagés vers la fiche', () => {
	assert.ok(journalPage.includes('brand: editEntry.brand'), 'édition entrée Journal : marque affichée');
	assert.ok(journalPage.includes('brand: editPlanned.brand'), 'item planifié : marque affichée');
	assert.ok(journalPage.includes('custom: !editEntry.foodId'), 'édition : badge personnalisé dérivé (snapshot sans foodId)');
	assert.ok(journalPage.includes('custom: !editPlanned.foodId'), 'planifié : badge personnalisé dérivé');
	assert.ok(journalPage.includes("(mealPickedFood ?? ingEdit?.food)?.ciqual ? 'ciqual'"), 'ingrédient de repas : badge Ciqual en édition comme en ajout');
});

/* ─── 8. Écran « Ajouter un aliment » : fond OPAQUE plein viewport ─── */

test('Recherche aliment : le Journal n\'est JAMAIS visible derrière (mobile)', () => {
	// Régression iPhone (capture 11:34) : l'overlay était dimensionné sur le
	// visualViewport → clavier ouvert, le fond rétrécissait et les cartes du
	// Journal fuyaient dans la bande au-dessus du clavier. Désormais : le FOND
	// reste plein viewport opaque (bg-soft) ; seul le PANNEAU de contenu se
	// positionne au-dessus du clavier (top/height = visualViewport).
	const logScreen = journalPage.slice(journalPage.indexOf('{#if logOpen}'), journalPage.indexOf('{#if logOpen}') + 1400);
	assert.ok(/class="fixed inset-0 z-50 bg-soft/.test(logScreen), 'fond plein viewport opaque (aucun style:top/height sur le fond)');
	assert.ok(!/style:top=\{mobile/.test(logScreen.split('<div')[1] ?? ''), 'le fond ne rétrécit plus avec le clavier');
	assert.ok(/absolute inset-x-0 top-0/.test(logScreen), 'panneau de contenu positionné (au-dessus du clavier via vvTop/vvH)');
	assert.ok(/sm:relative/.test(logScreen), 'desktop inchangé : panneau centré arrondi');
	assert.ok(journalPage.includes('Même principe que « Ajouter un aliment » : fond OPAQUE'), 'fenêtre produit de l\'éditeur : même correctif');
	// Comportements conservés : fermeture par fond/Échap, clavier, tabs.
	assert.ok(logScreen.includes('closeLog()'), 'fermeture conservée');
	assert.ok(logScreen.includes("e.key === 'Escape'"), 'Échap conservé');
});
