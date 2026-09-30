/**
 * Mission : FICHE ALIMENT = VRAIE VUE PLEIN ÉCRAN OPAQUE + CLAVIER CODE-BARRES.
 *
 * Parcours : clic sur un aliment depuis la recherche, le Journal, l'éditeur
 * de repas, « Mes repas » ou les plans coach → la fiche s'ouvre comme une
 * VRAIE page interne G-FLUX : fond opaque plein viewport, le Journal n'est
 * JAMAIS visible derrière (comme l'écran « Ajouter un aliment », c5b1fce).
 *
 * Garde-fous testés :
 *  - fond opaque plein viewport, le contenu suit le visualViewport
 *    (clavier iOS/Android) ; desktop = panneau centré arrondi inchangé ;
 *  - densité RÉAHONNABLE : hero adaptatif, paddings respirés — jamais de
 *    sur-compaction : quantité, macros, repas et CTA ne sont jamais sacrifiés ;
 *  - hero image adaptatif (confortable → réduit sur petit écran), contain,
 *    placeholder G-FLUX ; vignettes cover inchangées ;
 *  - footer d'actions : FRÈRE flex de la zone scrollable (espace réservé,
 *    jamais recouvert), opaque, safe area iOS ;
 *  - champ code-barres manuel branché sur le repositionnement clavier validé
 *    (visualViewport → scrollFocusedIntoView) — sans blur() ni polling ;
 *  - correctif Android clavier INTACT (touchActive, programmaticScrollUntil) ;
 *  - logique métier INTACTE : grammes/portions/repères, bornes, conversions,
 *    modes add/edit/planned, Mangé/Remplacer/Supprimer, favori ;
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
	assert.ok(plansPage.includes('<QuantitySheet'), 'plans coach : même composant partagé (appel inchangé)');
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

/* ─── 2. Fiche = VRAIE VUE PLEIN ÉCRAN OPAQUE ─── */

test('Fiche plein écran : fond opaque plein viewport — le Journal n\u2019est JAMAIS visible derrière', () => {
	// Même principe que l'écran « Ajouter un aliment » (fond opaque plein
	// viewport) : la fiche devient une sous-page interne G-FLUX. Le fond ne
	// rétrécit JAMAIS (même clavier ouvert) ; seule la page de contenu suit
	// le visualViewport (top/height en px réels via sheetTop/sheetHeight).
	assert.ok(sheet.includes('class="fixed inset-0 z-[60] bg-white'), 'racine = fond opaque plein viewport (plus de backdrop translucide)');
	assert.ok(!sheet.includes('bg-ink/40'), 'plus aucun fond translucide (le Journal ne transparaît plus)');
	assert.ok(!sheet.includes('backdrop-blur-sm'), 'plus de flou du Journal derrière la fiche');
	assert.ok(/absolute inset-x-0 top-0/.test(sheet), 'page de contenu positionnée (suit le clavier via sheetTop/sheetHeight)');
	assert.ok(sheet.includes('w-full max-w-lg flex-col overflow-hidden bg-white'), 'colonne flex pleine hauteur (scroll interne + footer frère)');
	assert.ok(sheet.includes('sm:relative'), 'desktop : même contenu en panneau centré (pattern écran recherche)');
	assert.ok(sheet.includes('rounded-[2rem] sm:shadow-2xl'), 'desktop : panneau arrondi premium conservé');
	assert.ok(sheet.includes('style:top={mobileSheet'), 'mobile : page positionnée sur le visualViewport (clavier)');
	assert.ok(sheet.includes('style:height={mobileSheet'), 'mobile : hauteur = viewport visible réel');
	// Comportements conservés : Échap, fermeture par la croix (le fond n'est
	// plus cliquable : c'est un vrai écran, comme la recherche).
	assert.ok(sheet.includes("e.key === 'Escape'"), 'Échap ferme la fiche (desktop)');
	assert.ok(sheet.includes('aria-label="Fermer"'), 'fermeture explicite en haut de fiche');
});

test('Densité : plus de sur-compaction — quantité, macros, repas et CTA toujours accessibles', () => {
	// Fin de la course aux pixels (59c5120) : les paddings/gaps respirent
	// de nouveau ; sur très petit écran, un léger scroll interne est
	// acceptable mais RIEN n'est jamais masqué.
	assert.ok(sheet.includes('min-h-0 flex-1 overflow-y-auto'), 'scroll interne de secours (très petits écrans)');
	assert.ok(sheet.includes("qtyFocused ? 'pt-14' : 'pt-4'"), 'bloc identité respiré (fin du compactage) + espacé sous la croix en mode focus');
	assert.ok(sheet.includes('mt-4 flex items-center justify-center'), 'onglets unités respirés');
	assert.ok(sheet.includes('mt-3 flex items-center justify-between'), 'quantité centrale avec vraie marge');
	assert.ok(sheet.includes('rounded-full border-2 border-line px-3.5 py-2'), 'raccourcis 50/100/150/200 g touchables (44 px)');
	assert.ok(sheet.includes('mt-4 px-5 pb-4'), 'bloc macros respiré');
	assert.ok(sheet.includes('grid grid-cols-4 gap-2'), 'macros et repas espacés (fin des gap-1.5 serrés)');
	assert.ok(sheet.includes('px-2 py-2.5 text-[12px]'), 'boutons repas confortables (fin du py-1.5 text-[11px])');
	assert.ok(sheet.includes('grid h-11 w-11 place-items-center'), 'boutons − / + 44 px (cible tactile)');
	assert.ok(!sheet.includes('py-1.5 text-[11px]'), 'plus de compactage extrême des boutons repas');
	assert.ok(!sheet.includes('h-[150px] max-h-[26dvh]'), 'fin du hero forcé à 150 px (hauteur adaptative désormais)');
});

/* ─── 3. Hero image adaptatif ─── */

test('Fiche FIXE : croix toujours visible, aucun scroll parasite, vignettes intactes', () => {
	// Croix + favori HORS de la zone scrollable : aucun mini-scroll résiduel
	// (après validation de la quantité) ne peut plus les faire disparaître.
	assert.ok(sheet.includes('absolute right-3 top-3 z-10 flex items-center gap-2'), 'contrôles flottants hors de la zone scrollable');
	const scrollerStart = sheet.indexOf('bind:this={scrollerEl}');
	assert.ok(scrollerStart > sheet.indexOf('aria-label="Fermer"'), 'croix déclarée AVANT la zone scrollable (hors flux)');
	// Re-ancrage en haut à chaque transition du mode focus (fin du décalage). 
	assert.ok(sheet.includes('scrollerEl.scrollTop = 0'), 're-ancrage scrollTop = 0 au retour de fiche complète');
	// Hero resserré : la fiche tient SANS scroll sur téléphone standard.
	assert.ok(sheet.includes('h-[min(26dvh,200px)] sm:h-[200px]'), 'hero adaptatif avec marge (fiche fixe sans scroll)');
	assert.ok(!sheet.includes('h-[min(28dvh,220px)]'), 'ancien hero trop haut supprimé');
});

test('Hero image : hauteur adaptative, jamais étiré ni recadré, repli propre', () => {
	assert.ok(sheet.includes('h-[min(26dvh,200px)] sm:h-[200px]'), 'hauteur adaptative : confortable en standard, réduite sur petit écran');
	assert.ok(sheet.includes('fit="contain"'), 'image ENTIÈRE visible — jamais étirée/pixellisée');
	assert.ok(sheet.includes('food.imageUrl ?? food.thumbUrl'), 'priorité à l\u2019image OFF d\u2019origine (meilleure résolution que la miniature)');
	assert.ok(sheet.includes('bg-brand-light'), 'placeholder G-FLUX si aucune image (jamais d\u2019icône cassée)');
	assert.ok(/fit = 'cover'/.test(foodImg), 'vignettes existantes INCHANGÉES (défaut cover)');
	assert.ok(foodImg.includes("'object-contain'"), 'FoodImg : contain disponible pour le grand visuel');
	assert.ok(foodImg.includes('offThumb100'), 'chaîne de repli miroir/OFF conservée');
});

/* ─── 4. Identité : nom, marque, source ─── */

test('Identité : nom complet SANS troncature, marque, badges source', () => {
	assert.ok(sheet.includes('break-words'), 'nom long lisible — pas de troncature agressive');
	assert.ok(sheet.includes("food.brand !== 'null'"), 'marque affichée (valeur « null » héritée d\u2019OFF filtrée)');
	assert.ok(sheet.includes('Référence Ciqual – ANSES'), 'badge Ciqual conservé');
	assert.ok(sheet.includes('Estimation IA'), 'badge Estimation IA (prêt pour la branche IA)');
	assert.ok(sheet.includes('Aliment personnalisé'), 'badge aliment personnalisé');
	assert.ok(sheet.includes('Valeur recalculée'), 'garde-fou kcal↔macros toujours visible');
	assert.ok(sheet.includes("'ciqual' | 'ai'"), 'source accepte ciqual + ai');
});

/* ─── 5. Macros en cartes ─── */

test('Macros : 4 cartes au code couleur du Journal', () => {
	assert.ok(sheet.includes('grid grid-cols-4 gap-2'), '4 cartes espacées');
	assert.ok(sheet.includes('#ec4899'), 'glucides rose');
	assert.ok(sheet.includes('#3b82f6'), 'protéines bleu');
	assert.ok(sheet.includes('#f97316'), 'lipides orange');
	assert.ok(sheet.includes('Calories') && sheet.includes('Glucides') && sheet.includes('Protéines') && sheet.includes('Lipides'), 'libellés des 4 cartes');
	assert.ok(/text-brand/.test(sheet), 'calories en vert identité G-FLUX (token brand)');
	assert.ok(sheet.includes('bg-cream'), 'fond des cartes = token existant (aucune couleur inventée)');
});

/* ─── 6 bis. Mode focus quantité ─── */

test('Mode focus quantité : clavier ouvert → identité+quantité+macros visibles, reste masqué', () => {
	// Pendant la saisie (quantité centrale focalisée) : hero, badges secondaires,
	// choix du repas et footer d'actions disparaissent ; il reste au-dessus du
	// clavier : nom, onglets Grammes/Portions/Repères, quantité − / +,
	// raccourcis 50/100/150/200 g et cartes macros.
	assert.ok(sheet.includes('qtyFocused'), 'état de focus quantité présent');
	assert.ok(sheet.includes('{#if !qtyFocused}'), 'hero, choix du repas et footer conditionnés au mode focus');
	// Done / ✓ / Enter valident la SAISIE (blur), jamais l'aliment :
	assert.ok(sheet.includes('onkeydown={qtyKeydown}'), 'Enter = valider la saisie (blur, aucune sauvegarde)');
	assert.ok(sheet.includes('enterkeyhint="done"'), 'touche Done/✓ native (iOS + Android)');
	assert.ok(sheet.includes('sheetPointerDown'), 'tap ailleurs = valider la saisie (iOS Safari)');
	assert.ok(sheet.includes("closest('[data-qty-zone]')"), '− / + / raccourcis restent interactifs sans fermer le clavier');
	assert.ok(sheet.includes('data-qty-zone'), 'zone de saisie protégée du tap-ailleurs');
	// Aucune sauvegarde automatique : le CTA reste le seul geste d'enregistrement.
	assert.ok(!/onblur=\{[^}]*save/.test(sheet), 'blur ne déclenche JAMAIS la sauvegarde');
	assert.ok(sheet.includes('onSave(Math.round'), 'sauvegarde uniquement via save()/CTA (inchangé)');
});

/* ─── 6. Logique métier INTACTE ─── */

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

/* ─── 7. Footer d'actions : intégré à la fiche, espace réservé ─── */

test('Footer d\'actions : barre SOLIDE hors flux — espace réservé, aucun recouvrement', () => {
	// Le CTA fait visuellement partie de la fiche : barre blanche opaque avec
	// séparateur, FRÈRE flex de la zone de scroll — espace réservé, jamais de
	// contenu derrière ni de bouton recouvrant le contenu (régression iPhone
	// sticky + dégradé corrigée en c5b1fce, toujours verrouillée).
	assert.ok(sheet.includes('min-h-0 flex-1 overflow-y-auto'), 'zone de contenu scrollable (frère du footer)');
	assert.ok(sheet.includes("border-t border-line bg-white px-5"), 'footer opaque avec séparateur — rien ne passe derrière');
	assert.ok(!sheet.includes('bg-gradient-to-t from-white'), 'plus de dégradé transparent sous les actions');
	assert.ok(!sheet.includes('sticky bottom-0'), 'plus de footer sticky (cause du chevauchement)');
	assert.ok(sheet.includes('pb-[max(env(safe-area-inset-bottom),12px)]'), 'safe area iOS conservée dans le footer');
	// Ordre voulu : quantité → cartes → choix du repas → actions (le footer reste en dernier).
	const scrollZone = sheet.slice(sheet.indexOf('min-h-0 flex-1'));
	assert.ok(scrollZone.indexOf('Choix du repas') < scrollZone.indexOf("Footer d'actions"), 'choix du repas DANS la zone scrollable, avant le footer');
});

test('UX mobile : CTA toujours accessible, safe areas, fermeture accessible', () => {
	assert.ok(sheet.includes("border-t border-line bg-white px-5"), 'CTA dans un footer solide toujours visible (accessible au pouce)');
	assert.ok(sheet.includes('env(safe-area-inset-bottom)'), 'safe area iOS respectée');
	assert.ok(sheet.includes("e.key === 'Escape'"), 'Échap ferme la fiche (desktop)');
	assert.ok(sheet.includes('M2 9.5a5.5 5.5 0 0 1 9.591'), 'cœur favori (même SVG, même logique) conservé');
	assert.ok(sheet.includes('overscroll-contain'), 'scroll contenu dans la fiche (pas de rebond de page)');
	assert.ok(sheet.includes('disabled:opacity-60'), 'états disabled conservés (double-clic impossible)');
});

/* ─── 8. Points d'entrée du journal ─── */

test('Points d\u2019entrée journal : marque / source / personnalisé propagés vers la fiche', () => {
	assert.ok(journalPage.includes('brand: editEntry.brand'), 'édition entrée Journal : marque affichée');
	assert.ok(journalPage.includes('brand: editPlanned.brand'), 'item planifié : marque affichée');
	assert.ok(journalPage.includes('custom: !editEntry.foodId'), 'édition : badge personnalisé dérivé (snapshot sans foodId)');
	assert.ok(journalPage.includes('custom: !editPlanned.foodId'), 'planifié : badge personnalisé dérivé');
	assert.ok(journalPage.includes("(mealPickedFood ?? ingEdit?.food)?.ciqual ? 'ciqual'"), 'ingrédient de repas : badge Ciqual en édition comme en ajout');
});

/* ─── 9. Écran « Ajouter un aliment » : fond opaque (régression verrouillée) ─── */

test('Recherche aliment : le Journal n\'est JAMAIS visible derrière (mobile)', () => {
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

/* ─── 10. Champ code-barres manuel : toujours visible au-dessus du clavier ─── */

test('Code-barres : champ manuel repositionné au-dessus du clavier (iOS + Android)', () => {
	// iPhone : au focus de « Ou saisis le code… », le clavier poussait le champ
	// hors zone visible. Correctif : brancher le champ sur le mécanisme VALIDÉ
	// de l'app (focusScroll → scrollFocusedIntoView déclenché par le resize du
	// visualViewport) — le champ (et le bouton « Rechercher le code » qui suit
	// dans le flux) remontent dans la zone visible. Aucun blur() agressif,
	// aucun polling de focus, aucune logique « scroll récent ».
	const manualInputs = journalPage.match(/<input[^>]*placeholder="Ou saisis le code/g) || [];
	assert.equal(manualInputs.length, 2, '2 champs manuels (Ajouter un aliment + fenêtre produit)');
	assert.equal((journalPage.match(/onfocusin=\{\(e\) => focusScroll\(e\.currentTarget, e\.target\)\}/g) || []).length, 3, '3 champs branchés : formulaire custom + 2 champs code-barres');
	// Le mécanisme validé est bien celui déclenché par le clavier :
	assert.ok(journalPage.includes("vv.addEventListener('resize', setVh)"), 'resize visualViewport → repositionnement (clavier)');
	assert.ok(journalPage.includes('focusedFieldEl?.isConnected') && journalPage.includes('scrollFocusedIntoView(focusedFieldEl)'), 'champ focalisé replacé ~200 ms après l\'ouverture du clavier');
	// La caméra est DANS la zone scrollable au-dessus du champ : le
	// repositionnement scrolle la liste pour amener le champ au-dessus du
	// clavier (la caméra défile, elle n'est jamais recouverte).
	assert.ok(journalPage.includes('bcListEl') && journalPage.includes('mealBcListEl'), 'listes code-barres surveillées (scroll-dismiss inchangé)');
	// Non-régression Android (mission clavier VALIDÉE, verrouillée ailleurs) :
	assert.ok(journalPage.includes('programmaticScrollUntil'), 'drapeau de protection des scrolls programmatiques intact');
	assert.ok(!journalPage.includes('barcodeInput.blur') && !journalPage.includes('setTimeout(() => barcode'), 'aucun blur() ni polling ajouté sur le champ code-barres');
});
