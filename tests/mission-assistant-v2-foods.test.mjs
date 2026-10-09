/**
 * MISSION — ASSISTANT G-FLUX V2 · CHANTIER A (fidélité des aliments).
 *
 * Le bug constaté en preview : des aliments NON DEMANDÉS (jus d'orange,
 * laits) se retrouvaient dans la prévisualisation. Cause racine : la chaîne
 * d'écriture acceptait les items du modèle SANS vérifier que la fiche
 * résolue représente bien l'aliment demandé.
 *
 * Ces tests verrouillent la correction serveur (aucune substitution
 * silencieuse possible) et la préservation du parcours preview→clic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const tools = read('src/convex/assistantTools.ts');
const assistant = read('src/convex/assistant.ts');

/* ════════ 1. nameCovers — recouvrement fiable (test fonctionnel) ════════ */

const t = await import(new URL('../src/convex/assistantTools.ts', import.meta.url).href);
const covers = (ref, brand, ask) => t.nameCovers(ref, brand, ask);

test('nameCovers : l’aliment demandé est couvert par sa fiche (singulier/pluriel, ordre libre)', () => {
	assert.equal(covers('Lait demi-écrémé', 'Lactel', 'lait demi-écrémé'), true);
	assert.equal(covers('Flocons d’avoine', undefined, 'avoine'), true, 'demande plus courte que la fiche');
	assert.equal(covers('Œuf, cru', undefined, '2 œufs'), true, 'la quantité n’empêche pas la couverture');
	assert.equal(covers('Tomate, rouge, crue', undefined, 'tomates'), true);
	assert.equal(covers('Pomme, chair et peau, crue', undefined, 'pomme'), true);
});

test('nameCovers : SUBSTITUTION interdite entre familles différentes', () => {
	assert.equal(covers('Pur jus de pomme', 'Tropicana', "jus d'orange"), false, 'pomme ≠ orange');
	assert.equal(covers('Pur jus d’orange sans pulpe', 'Tropicana', 'pommes'), false);
	assert.equal(covers('Lait entier', 'Lactel', 'lait demi-écrémé'), false, 'entier ≠ demi-écrémé');
	assert.equal(covers('Riz complet', 'Marque Repère', 'riz basmati'), false, 'variante ≠ variante');
});

test('nameCovers : la marque seule ne suffit jamais', () => {
	assert.equal(covers('Pur jus de pomme', 'Tropicana', 'Tropicana'), false, 'une marque n’est pas un aliment');
	assert.equal(covers('Coca-Cola Zero', 'Coca-Cola', 'cocacola'), false);
});

test('nameCovers : noms vides ou dégénérés → false (rejet par défaut)', () => {
	assert.equal(covers('', undefined, 'pomme'), false);
	assert.equal(covers('Pomme', undefined, ''), false);
});

test('Recherche : générique Ciqual prioritaire quand aucun produit OFF ne matche directement', () => {
	// « pommes » : « Pur jus de pomme » ne COMMENCE pas par la requête → la
	// référence Ciqual brute (« Pomme… ») doit sortir avant le produit transformé.
	assert.ok(tools.includes('function genericCiqualFirst'), 'helper générique Ciqual présent');
	assert.ok(tools.includes('const offTopDirect = ranked[0] ? norm(ranked[0].name).startsWith(norm(term)) : false;'), 'produit OFF direct gardé en priorité (marque comprise)');
	// Les DEUX chemins de recherche utilisent le même garde (outil public + interne).
	const occurrences = (tools.match(/const offTopDirect = ranked\[0\]/g) ?? []).length;
	assert.ok(occurrences >= 2, `garde appliquée aux deux recherches (${occurrences}×)`);
});

/* ════════ 2. Verrous serveur présents dans prepareJournalEntry ════════ */

test('prepareJournalEntry : identité vérifiée — fiche incohérente jetée, re-résolution par nom', () => {
	// Lot 2B : la référence incohérente n'est plus un throw sec (le modèle
	// reformulait un texte sans action) — elle est JETÉE et searchFoodInternal
	// re-résout le nom déclaré. La couverture reste obligatoire : la fiche
	// retenue DOIT toujours couvrir le nom (refMismamed → throw fiable).
	assert.ok(tools.includes('refMisnamed'), 'flag de référence jetée');
	assert.ok(tools.includes('nameCovers(ref.name, ref.brand, declared)'), 'contrôle ref↔demande');
	assert.ok(tools.includes('nameCovers(resolved.name, resolved.brand, declared)'), 'contrôle aussi après recherche serveur');
	assert.ok(/Aucune fiche fiable/.test(tools), 'recherche re-cadrée : jamais de fiche hors demande');
});

test('prepareJournalEntry : création « estimation IA » directe SUPPRIMÉE', () => {
	// Avant : un item avec aiKcal100 créait l’aliment sans aucune fiche.
	// Après : recherche serveur obligatoire — la branche IA directe n’existe plus.
	assert.ok(!/components\.push\(\{\s*\n\s*name,\s*\n\s*qtyGrams: qty,\s*\n\s*aiKcal100: it\.aiKcal100/.test(tools), 'plus de création sur la seule estimation IA');
	assert.ok(tools.includes('searchFoodInternal'), 'recherche par nom faite par le SERVEUR');
});

test('prepareJournalEntry : fusion anti-doublon interne (mêmes références)', () => {
	assert.ok(tools.includes('const merged = new Map'), 'fusion des doublons');
	assert.ok(/prev\.qtyGrams = \(prev\.qtyGrams \?\? 0\) \+ \(it\.qtyGrams \?\? 0\)/.test(tools), 'quantités additionnées, jamais dupliquées');
});

test('prepareJournalEntry : bornes conservées (12 max, quantité clampée, repas valide)', () => {
	assert.ok(tools.includes('Maximum 12 aliments par repas.'));
	assert.ok(tools.includes('Math.min(5000, Math.max(1, Math.round(it.qtyGrams)))'), 'clamp quantité');
	assert.ok(tools.includes('"petit-dej", "dejeuner", "diner", "collation"'), 'repas contrôlés');
});

/* ════════ 3. Le parcours d’écriture V1 reste INTACT ════════ */

test('Écritures : preview → insertPending → resolveAction inchangés', () => {
	assert.ok(tools.includes('insertPending('), 'l’action reste créée en attente');
	assert.ok(assistant.includes('export const resolveAction = mutation('), 'seul chemin d’écriture conservé');
	for (const d of ['"confirm"', '"cancel"', '"undo"']) {
		assert.ok(assistant.includes(`v.literal(${d})`), `décision ${d} conservée`);
	}
	assert.ok(assistant.includes('doc.userId !== user._id'), 'isolation propriétaire conservée');
	assert.ok(assistant.includes('requestId: `assistant:${action._id}`'), 'anti-doublon à l’écriture conservé');
});

test('Écriture = exactement la prévisualisation (même payload sérialisé)', () => {
	// Le payload écrit est celui POSÉ à la préparation (client n’envoie que l’id).
	// Lot 2B : le pipeline est partagé (buildJournalEntryPreview) — prepareJournalEntry
	// insère le retour { preview, payload }, updatePendingJournalEntry patche le même
	// objet recalculé côté serveur. Un seul pipeline = preview toujours == payload.
	assert.ok(/return \{ preview, payload: \{ date, meal, components \} \}/.test(tools), 'pipeline unique : la preview insérée == le payload écrit');
	assert.ok(/insertPending\([\s\S]{0,400}"journal_add",[\s\S]{0,200}preview,[\s\S]{0,100}payload\)/.test(tools), 'prepareJournalEntry insère preview+payload du pipeline');
	assert.ok(/buildJournalEntryPreview\(ctx, user\._id, payload\.date, payload\.meal, current/.test(tools), 'updatePending recalcule par le MÊME pipeline serveur');
});

test('Chaque fiche résolue pousse AUSSI son composant (régression confirm “Aucun composant”)', () => {
	// Régression du 08/10 : le push du composant avait disparu du chemin
	// résolu → preview correcte mais confirm « Aucun composant à ajouter ».
	assert.ok(/components\.push\(\{[\s\S]{0,400}resolved!\.foodId/.test(tools), 'le composant résolu est bien poussé dans le payload écrit');
	assert.ok((tools.match(/components\.push/g) ?? []).length >= 1, 'au moins un push de composant');
});

test('searchFood reste la porte d’entrée décrite au modèle (pas d’accès générique Convex)', () => {
	const registry = read('src/convex/assistantRegistry.ts');
	assert.ok(registry.includes('name: "searchFood"'), 'outil searchFood toujours exposé (registre)');
	assert.ok(!registry.includes('ctx.db'), 'le modèle n’a jamais accès direct à la base : le registre passe par ctx.runQuery');
});

/* ════════ 4. Injection du contexte serveur et filet « annonce sans outil » ════════ */

test('runAssistantTurn reçoit le system AVEC le bloc contexte Lot 2 (régression du 08/10)', () => {
	// Régression : le `system` enrichi (buildContextBlock) était construit puis
	// remplacé par un rappel d’assistantSystemPrompt — contexte jamais injecté.
	assert.ok(assistant.includes('const block = buildContextBlock(ctxData);'), 'bloc contexte construit');
	assert.ok(/\bsystem,/.test(assistant), 'runAssistantTurn reçoit bien la variable system enrichie');
	assert.ok(
		!/runAssistantTurn\(\{[\s\S]{0,200}system: assistantSystemPrompt/.test(assistant),
		'plus de system recalculé sans contexte à l’appel IA',
	);
});

test('Filet « annonce sans outil » : relance bornée si preview annoncée sans action', () => {
	assert.ok(assistant.includes('ANNOUNCE_WITHOUT_TOOL_RE'), 'garde défini');
	assert.ok(
		/!holder\.pending && \(announce \|\| \(addIntent && noQuestion\)\)/.test(assistant),
		'déclenché seulement si AUCUNE action préparée',
	);
	assert.ok(/maxRounds: 1,/.test(assistant), 'relance limitée à UN tour d’outil');
	assert.ok(/Appelle MAINTENANT l'outil prepare\*/.test(assistant), 'relance exige l’appel d’outil');
});
