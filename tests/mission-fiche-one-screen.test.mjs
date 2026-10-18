/**
 * Mission : FICHES ALIMENTS — LA FICHE COMPLÈTE TIEN SUR UN ÉCRAN.
 *
 * Objectif UX : sur un écran de 390×844 (et plus), chaque fiche aliment —
 * ajout, édition d'une entrée, recette, aliment personnel, ingrédient de
 * repas, item planifié — affiche en-tête, quantité, raccourcis, valeurs
 * nutritionnelles, choix du repas et boutons d'action SANS défilement
 * (avant : la fiche d'édition coupait le choix du repas sous le footer).
 *
 * Leviers (layout SEULEMENT) : bloc pictogramme haut COMPACT quand
 * l'aliment n'a pas de photo (88 px au lieu de 180) + espacements verticaux
 * resserrés. Design, couleurs, composants et logique de calcul/sauvegarde
 * inchangés ; cibles tactiles ≥ 44 px partout.
 *
 * Petits écrans (375×667) et clavier ouvert : un défilement est toléré,
 * mais les boutons d'action restent TOUJOURS visibles en bas (footer frère
 * flex, jamais masqué). Safe area iPhone respectée (haut et bas).
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
const journalPage = read('src/routes/espace/journal/+page.svelte');
const plansPage = read('src/routes/admin/plans/+page.svelte');

/* ─── 1. Recensement : toutes les fiches passent par QuantitySheet ─── */

test('Recensement : ajout, édition entrée, planifié, recette, ingrédient et plans coach = 6 appels, 1 composant', () => {
	assert.equal((journalPage.match(/<QuantitySheet/g) || []).length, 5, 'journal : ajout, recette, édition entrée, item planifié, ingrédient');
	assert.equal((plansPage.match(/<QuantitySheet/g) || []).length, 1, 'plans coach : même fiche partagée');
	assert.ok(journalPage.includes('mode="planned"'), 'fiche item planifié (Mangé / Remplacer / Supprimer)');
	assert.ok(journalPage.includes('mode="edit"'), "fiche édition d'une entrée (Supprimer / Enregistrer / Remettre en planifié)");
	assert.ok(journalPage.includes('gramShortcuts={[50, 100, 150, 200, 300]}'), 'fiche recette : raccourcis étendus');
	assert.ok(journalPage.includes('mealDefs={[]}'), "fiche ingrédient de repas : sans choix de repas");
	assert.ok(journalPage.includes('showFav={!qtyFood.custom && !qtyFood.ciqual}'), 'fiche ajout aliment (perso, OFF, Ciqual)');
});

/* ─── 2. Pictogramme haut compact sans photo ─── */

test('Sans photo : bloc pictogramme COMPACT (88 px) — la fiche tient sur un écran', () => {
	assert.ok(sheet.includes('h-[88px] place-items-center sm:h-[180px]'), 'bande pictogramme 88 px en mobile (180 px conservées en desktop)');
	assert.ok(sheet.includes('rounded-2xl bg-brand-light sm:h-20 sm:w-20 sm:rounded-3xl'), 'tuile G-FLUX conservée (design, couleur, composant)');
	assert.ok(sheet.includes('<Icon name="utensils" size={34} class="text-brand" />'), 'icône placeholder inchangée');
	// Le compact ne s'applique JAMAIS à une fiche avec photo.
	assert.ok(sheet.includes('h-[min(24dvh,180px)] sm:h-[180px]'), 'hero photo inchangé (adaptatif)');
	assert.ok(/heroSrc[\s\S]{0,400}h-\[min\(24dvh,180px\)\]/.test(sheet), 'hero photo = branche dédiée de heroSrc');
	assert.ok(/!heroSrc|{:else}[\s\S]{0,200}h-\[88px\]/.test(sheet), 'compact = branche SANS photo uniquement');
});

/* ─── 3. Footer d'actions : toujours visible ─── */

test('Boutons d’action TOUJOURS visibles en bas : petits écrans et clavier ouvert', () => {
	assert.ok(
		sheet.includes('shrink-0 border-t border-line bg-white px-5 pb-[max(env(safe-area-inset-bottom),12px)] pt-2.5'),
		'footer frère flex, opaque, safe area bas — jamais dans le flux de scroll'
	);
	assert.equal((sheet.match(/\{#if !qtyFocused\}/g) || []).length, 2, 'seuls hero et choix du repas sont masqués au clavier — pas le footer');
	assert.ok(sheet.includes('min-h-0 flex-1 overflow-y-auto'), 'seul le contenu défile (filet de secours 375×667)');
	// Les actions des trois modes restent rendues.
	assert.ok(sheet.includes('Enregistrer la quantité') && sheet.includes('Mangé') && sheet.includes('Remplacer') && sheet.includes('Supprimer'), 'actions planned conservées');
	assert.ok(sheet.includes('Remettre en planifié'), 'action edit conservée');
	assert.ok(sheet.includes('saveLabel ?? (mode === \'edit\' ? \'Enregistrer\' : \'Ajouter au journal\')'), 'CTA add/edit conservé');
});

/* ─── 4. Cibles tactiles ≥ 44 px ─── */

test('Cibles tactiles ≥ 44 px partout (raccourcis, − / +, onglets, actions)', () => {
	assert.equal((sheet.match(/min-h-11/g) || []).length, 5, 'raccourcis (4 variantes) + Remettre en planifié portés à 44 px mini');
	assert.ok(sheet.includes('grid h-11 w-11 place-items-center'), 'boutons − / + à 44 px');
	assert.ok(sheet.includes('relative h-11 flex-1 px-2'), 'onglets unités à 44 px');
	assert.ok(sheet.includes('grid h-11 w-11 place-items-center rounded-[22px]'), 'croix / favori à 44 px');
	assert.ok(sheet.includes('py-3 text-sm font-bold'), 'boutons d’action à 44 px (py-3)');
	assert.ok(sheet.includes('px-2 py-2.5 text-[12px]'), 'boutons repas confortables conservés (≥ 44 px)');
});

/* ─── 5. Safe area iPhone (haut + bas) ─── */

test('Safe area iPhone respectée en haut et en bas', () => {
	assert.ok(sheet.includes('top-[max(env(safe-area-inset-top),12px)]'), 'contrôles flottants décalés de la safe area haute');
	assert.ok(sheet.includes('pt-[calc(max(env(safe-area-inset-top),12px)+44px)]'), 'dégagement identité sous les contrôles en mode focus');
	assert.ok(sheet.includes('pb-[max(env(safe-area-inset-bottom),12px)]'), 'footer dégagé de la safe area basse');
});

/* ─── 6. Espacements verticaux resserrés ─── */

test('Espacements verticaux resserrés : plus de bloc haut de 180 px sans photo, marges réduites', () => {
	assert.ok(!sheet.includes("qtyFocused ? 'pt-14' : 'pt-4'"), 'ancien dégagement identité remplacé');
	assert.ok(!sheet.includes('mt-3.5 px-5 pb-3'), 'ancien bloc macros sur-espacé remplacé');
	assert.ok(!sheet.includes('mt-3.5 flex items-stretch'), 'anciens onglets sur-espacés remplacés');
	assert.ok(sheet.includes('mt-2.5 flex items-stretch justify-around'), 'onglets resserrés');
	assert.ok(sheet.includes('mt-2.5 flex items-center justify-between'), 'quantité resserrée');
	assert.ok(sheet.includes('mt-2 flex flex-wrap justify-center gap-2'), 'raccourcis resserrés');
	assert.ok(sheet.includes('mt-2 grid grid-cols-4 gap-2'), 'choix du repas resserré');
	assert.ok(sheet.includes('mt-1.5 flex flex-wrap items-center gap-1.5'), 'badges resserrés');
});

/* ─── 7. Logique de calcul / sauvegarde INTACTE ─── */

test('Logique métier intacte : calculs, conversions et enregistrement inchangés', () => {
	assert.ok(sheet.includes('gramsNum <= 5000'), 'borne haute 5000 g');
	assert.ok(sheet.includes('Math.round((gramsNum ?? 0) * 100) / 100'), 'arrondi 2 décimales');
	assert.ok(sheet.includes('onSave(Math.round((gramsNum ?? 0) * 100) / 100, meal)'), 'sauvegarde via save() inchangée');
	assert.ok(sheet.includes('switchMode'), 'conversion g / portions / repères conservée');
	assert.ok(journalPage.includes('onSave={(g, meal) => saveEdit(g, meal)}'), 'édition entrée : même callback');
	assert.ok(journalPage.includes('onSave={(g, meal) => savePlannedQty(g, meal)}'), 'planifié : même callback');
	assert.ok(journalPage.includes('void confirmAddPortion(g, meal)'), 'recette : même callback');
});
