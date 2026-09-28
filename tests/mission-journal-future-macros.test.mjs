/**
 * Tests MISSION — Journal FUTUR : macros PRÉVUES + compaction UX des blocs repas.
 *
 * 1) Jour futur — macros prévues : les 3 anneaux (Glucides / Protéines /
 *    Lipides) reflètent les aliments planifiés, en rendu atténué, SANS
 *    jamais être interprétés comme consommés ;
 * 2) Cohérence single source : mêmes aliments planifiés pour kcal prévues
 *    ET macros prévues (aucun double comptage) — audit du flux backend ;
 * 3) Jours actuel / passé : comportement inchangé (anneaux = consommé,
 *    validation existante intacte) ;
 * 4) Compaction UX : kcal prévues alignées sur le titre du repas, carte
 *    d'aliments rapprochée, coach (Vision 360) non touché.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const journalDay = readFileSync(join(root, 'src/lib/components/JournalDay.svelte'), 'utf8');
const journalPage = readFileSync(join(root, 'src/routes/espace/journal/+page.svelte'), 'utf8');
const journalApi = readFileSync(join(root, 'src/routes/api/journal/+server.ts'), 'utf8');
const journalConvex = readFileSync(join(root, 'src/convex/journal.ts'), 'utf8');
const coachApi = readFileSync(join(root, 'src/routes/api/coach/journal/+server.ts'), 'utf8');

/* ─── 1) Jour futur : anneaux = macros PRÉVUES, rendu atténué ─── */

test('Journal futur : les anneaux macros affichent les macros PRÉVUES (plannedTotals)', () => {
	// Source unique : macroShowned dérive de plannedTotals (kcal prévues) sur jour futur.
	assert.ok(journalDay.includes('isFutureDay && day.plannedTotals'), 'jour futur + plannedTotals présent → macros prévues');
	assert.match(
		journalDay,
		/const macrosShown = \$derived\.by\(\(\) => \{[\s\S]*?day\.plannedTotals[\s\S]*?carbs[\s\S]*?protein[\s\S]*?fat[\s\S]*?return \{ carbs: totals\.carbs/,
		'fallback : consommé (totaux Journal) sur aujourd’hui / passé'
	);
	// Les 3 anneaux lisent la source unique (jamais directement totals.*) :
	assert.match(journalDay, /eaten: macrosShown\.carbs/);
	assert.match(journalDay, /eaten: macrosShown\.protein/);
	assert.match(journalDay, /eaten: macrosShown\.fat/);
});

test('Journal futur : rendu atténué des anneaux (désaturé + gris), jamais « consommé »', () => {
	// Carte atténuée (cohérent avec les lignes planifiées opacity-60 saturate-50).
	assert.ok(journalDay.includes("{macrosPlanned ? 'opacity-60 saturate-50' : ''}"), 'carte macro désaturée/atténuée en mode prévu');
	// Gris neutre partagé (const) : toute identité rose/bleu/orange retirée en mode prévu.
	assert.match(journalDay, /const PLANNED_GRAY = '#9aa19a';/);
	// Arc gris neutre.
	assert.ok(journalDay.includes('stroke={macrosPlanned ? PLANNED_GRAY : ring.color}'), 'arc gris neutre en mode prévu, couleur d’identité sinon');
	// §1 phase 2 : TITRE et ICÔNE grisés (plus aucune couleur d’identité).
	assert.ok(journalDay.includes("{macrosPlanned ? 'text-mist' : 'text-ink'}\">{ring.label}"), 'titre de carte gris en mode prévu');
	assert.match(journalDay, /style=\{macrosPlanned \? `color:\$\{PLANNED_GRAY\}` : `color:\$\{ring\.color\}`\}/, 'icône grisée en mode prévu');
	// Pourcentage + valeur en gris au centre.
	assert.ok(journalDay.includes('style:color={macrosPlanned ? PLANNED_GRAY : ring.color}'), 'pourcentage gris en mode prévu');
	assert.ok(journalDay.includes("{macrosPlanned ? 'text-mist' : 'text-ink'}"), 'grammage neutre en mode prévu');
	// Le style prévu est lié à plannedTotals (données API cliente) → coach jamais affecté.
	// $derived (jamais lu à l’init du module) : réactivité + warning svelte éteint.
	assert.match(journalDay, /const macrosPlanned = \$derived\(isFutureDay && !!day\.plannedTotals\);/);
});

test('Journal futur : modale détail macro entièrement au gris « prévu » (cohérence anneaux)', () => {
	assert.match(journalPage, /const PLANNED_GRAY = '#9aa19a';/, 'même gris que les anneaux du JournalDay');
	assert.match(journalPage, /const macroMetaTint = \$derived\(isFuture \? PLANNED_GRAY : macroMeta\.color\);/, 'teinte unique : gris en futur, couleur macro sinon');
	const modalStart = journalPage.indexOf('VUE DÉTAIL MACRO');
	const modal = journalPage.slice(modalStart, journalPage.indexOf('{:else}', modalStart));
	assert.match(modal, /stroke=\{macroMetaTint\}/, 'arc de la modale gris en futur');
	assert.match(modal, /style:color=\{macroMetaTint\}/, '% + totaux grisés en futur');
	assert.match(modal, /isFuture \? `color:\$\{PLANNED_GRAY\}` : `color:\$\{macroMeta\.color\}`/, 'icône grisée en futur');
	assert.ok(modal.includes('macroMetaTint'), 'détail par aliment (g par item) via la même teinte');
});

test('Journal futur : kcal prévues et macros prévues partagent la MÊME source (aucun double comptage)', () => {
	// Le kcal prévues affiché vient de day.plannedTotals.kcal (convex getDay).
	assert.match(journalDay, /const plannedKcalTotal = \$derived\(Math\.round\(day\.plannedTotals\?\.kcal \?\? 0\)\);/);
	// Les macros prévues affichées viennent du MÊME objet plannedTotals.
	assert.match(journalDay, /if \(isFutureDay && day\.plannedTotals\) \{\s*return \{ carbs: day\.plannedTotals\.carbs, protein: day\.plannedTotals\.protein, fat: day\.plannedTotals\.fat \}/);
	// plannedTotals est calculé UNE seule fois côté Convex, depuis plannedRows.
	assert.match(journalConvex, /const plannedTotals = plannedRows\.reduce\(/);
	// addEntry sur jour futur → plannedEntries (jamais diaryEntries).
	assert.match(journalConvex, /JOUR FUTUR → PLANNED \(client_planned\) : jamais compté comme consommé\./);
	assert.match(journalConvex, /ctx\.db\.insert\("plannedEntries", \{[\s\S]*?source: "client_planned"/);
});

test('Frontend-only : aucun changement de schéma/mutation Convex nécessaire (audit)', () => {
	// getDay renvoie déjà plannedTotals avec les 3 macros (plannedRows = plannedEntries).
	assert.match(journalConvex, /`planned`\/`plannedTotals`[\s\S]{0,40}: propositions \(plan coach \+ préparation cliente\)/);
	// L'endpoint journal ne fait que relayer la query existante (aucune nouvelle mutation).
	assert.ok(!/plannedTotals/.test(journalApi), 'l’endpoint /api/journal ne recalcule rien — il relaie getDay');
});

/* ─── 2) Jours actuel / passé : comportement inchangé ─── */

test('Aujourd’hui / passé : anneaux = CONSOMMÉ uniquement (comportement actuel inchangé)', () => {
	// Fallback de la source unique : totaux consommés du Journal.
	assert.match(journalDay, /return \{ carbs: totals\.carbs, protein: totals\.protein, fat: totals\.fat \};/);
	// Le garde « typeof window » protège le SSR et le rendu coach.
	assert.match(journalDay, /typeof window !== 'undefined' && day\.date > currentLocalDay\(\)/);
	// Validation « Mangé » toujours interdite sur une date future (backend ET front).
	assert.match(journalConvex, /Impossible de valider « Mangé » sur une date future\./);
	assert.match(journalPage, /const isFuture = \$derived\(date > todayISO\);/);
	assert.match(journalPage, /const canEat = \$derived\(!isFuture\);/);
});

test('Basculé le jour venu : prévu → consommé via la validation existante (aucun double comptage)', () => {
	// eatPlanned : INSERT diaryEntries + DELETE plannedEntries (une seule écriture réelle).
	assert.match(
		journalConvex,
		/export const eatPlanned = mutation\(\{[\s\S]*?ctx\.db\.insert\("diaryEntries", \{[\s\S]*?source: "planned_eaten"[\s\S]*?\}\);\s*await ctx\.db\.delete\(plannedId\);/,
		'validation = transfert planned → consommé, sans résidu planifié'
	);
});

test('Jour J : consommé repart de 0, les planifiés restent visibles non validés (phase 2)', () => {
	// Les anneaux/calories du composant dérivent UNIQUEMENT de day.entries
	// (diaryEntries = consommé) — planned ne remplit JAMAIS le consommé ;
	// au passage planned → jour J, rien n’est transféré automatiquement.
	assert.match(journalDay, /for \(const e of day\.entries\) \{/, 'totaux consommés = entries uniquement');
	// planned et plannedTotals restent servis séparément (visibles non validés).
	assert.match(journalConvex, /const plannedTotals = plannedRows\.reduce\(/, 'plannedTotals servis à part (aucune fusion dans le consommé)');
	// Dévalidation : retour planifié PROPRE (INSERT plannedEntries + DELETE entry).
	assert.match(
		journalConvex,
		/export const uneatEntry = mutation\(\{[\s\S]*?ctx\.db\.insert\("plannedEntries", \{[\s\S]*?source: "client_planned"[\s\S]*?\}\);\s*await ctx\.db\.delete\(entryId\);/,
		'dé-validation = retrait du consommé + remise en prévu (réversible)'
	);
	// Garde-fous : validation interdite sur futur ; dé-validation interdite sur passé.
	assert.match(journalConvex, /p\.date > today[\s\S]{0,80}Impossible de valider « Mangé » sur une date future\./);
	assert.match(journalConvex, /entry\.date < today[\s\S]{0,120}Impossible de dé-valider un jour passé\./);
});

/* ─── 3) Vue détail macro (clic carte) — cohérente sur jour futur ─── */

test('Vue détail macro : jour futur = prévus (plannedTotals), jour réel = consommés', () => {
	// Source unique de la page, alignée sur les anneaux du JournalDay.
	assert.match(
		journalPage,
		/const macroShown = \$derived\(\s*isFuture\s*\? \{ carbs: day\.plannedTotals\?\.carbs \?\? 0, protein: day\.plannedTotals\?\.protein \?\? 0, fat: day\.plannedTotals\?\.fat \?\? 0 \}\s*: totals\s*\);/
	);
	// Les aliments listés = items planifiés sur jour futur, consommés sinon.
	assert.match(journalPage, /isFuture\s*\? plannedItems\.filter\(\(p\) => p\.meal === m\.id\)\s*: day\.entries\.filter\(\(e\) => e\.meal === m\.id\)/);
	// Libellés « prévus / à planifier » sur jour futur.
	assert.ok(journalPage.includes("{isFuture ? 'g restants à planifier' : 'g restants'}"), 'restant libellé « à planifier » en futur');
	assert.ok(journalPage.includes("{fmtG(macroEaten)}/{fmtG(macroGoal)} g {isFuture ? 'prévus' : 'consommés'}"), 'total libellé « prévus » en futur');
	assert.ok(journalPage.includes("{isFuture ? 'Rien de prévu sur cette journée.' : 'Rien de consommé sur cette journée.'}"), 'état vide adapté au futur');
});

/* ─── 4) Compaction UX des blocs repas (mode cliente) ─── */

test('Compaction : kcal prévues alignées sur la baseline du titre (zéro padding parasite)', () => {
	assert.ok(journalDay.includes('inline-block font-normal text-mist'), 'kcal prévues remontées sur la ligne du titre');
});

test('Compaction : carte d’aliments rapprochée du titre du repas (mt-1.5 → mt-0)', () => {
	// Une seule carte d'aliments compacte par repas (branches cliente), rapprochée.
	const compact = [...journalDay.matchAll(/mt-0 overflow-hidden rounded-2xl border border-line bg-card/g)].length;
	assert.equal(compact, 1, 'carte d’aliments immédiatement sous la ligne kcal (client)');
	assert.ok(!journalDay.includes('mt-1.5 overflow-hidden rounded-2xl border border-line bg-card'), 'ancien espacement supprimé');
	// Le bloc coach (Vision 360) garde son espacement d'origine.
	assert.ok(journalDay.includes("mt-1.5 px-1 pb-1"), 'rendu coach inchangé (structure historique)');
});

test('Compaction phase 2 : en-têtes de repas resserrés SANS toucher polices ni boutons', () => {
	// Section : mb-1 (au lieu de mb-2) — moins de vide entre deux repas.
	assert.ok(journalDay.includes('<section class="mb-1">'), 'section repas compacte (mb-1)');
	// Ligne kcal/%) : collée au titre (mt-0) avec interligne resserré (1,35).
	assert.ok(journalDay.includes('mt-0 leading-[1.35] text-[13px] font-semibold tabular-nums text-brand'), 'ligne kcal collée au titre, interligne 1,35');
	// NON-RÉGRESSION : polices inchangées (titre 18 px, kcal 13 px)…
	assert.ok(journalDay.includes("text-[18px] font-bold tracking-tight text-ink"), 'titre repas toujours 18 px');
	assert.ok(journalDay.includes('text-[13px] font-semibold tabular-nums text-brand'), 'ligne kcal toujours 13 px');
	// …et boutons caméra / + intacts (h-11 w-10 / h-11 w-11).
	assert.ok(journalDay.includes('h-11 w-10 place-items-center text-brand'), 'bouton caméra intact');
	assert.ok(journalDay.includes('h-11 w-11 place-items-center text-brand'), 'bouton + intact');
});

test('Compaction appliquée aux 4 repas (composant partagé, aucune exception)', () => {
	// Les 4 repas passent par la même boucle MEAL_DEFS → le gabarit compact est unique.
	assert.match(journalDay, /for \(const m of MEAL_DEFS\)/);
	for (const label of ['Petit-déjeuner', 'Déjeuner', 'Dîner', 'Collations']) {
		assert.ok(journalDay.includes(`'${label}'`), `repas couvert : ${label}`);
	}
});

test('Sécurité : aucun rendu coach / Vision 360 affecté par la mission', () => {
	// L'API coach ne renvoie PAS plannedTotals → macrosPlanned reste false côté coach.
	assert.ok(!/plannedTotals/.test(coachApi), 'getDayForCoach sans plannedTotals (rendu coach intact)');
	// La compaction est conditionnée au mode cliente (compact = client), pattern existant.
	assert.match(journalDay, /const compact = \$derived\(mode === 'client'\);/);
	// Les snapshots consommés (Vision 360) lisent day.entries — jamais plannedTotals.
	assert.match(journalConvex, /export const getDayForCoach = query\(\{[\s\S]*?entries: await attachThumbsForFoodIds\(ctx, entries\),[\s\S]*?totals,/);
});
