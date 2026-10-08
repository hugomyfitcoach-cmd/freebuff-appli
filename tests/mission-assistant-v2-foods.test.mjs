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

/* ════════ 2. Verrous serveur présents dans prepareJournalEntry ════════ */

test('prepareJournalEntry : identité vérifiée — rejet si la fiche ne correspond pas au nom', () => {
	assert.ok(/Référence incohérente/.test(tools), 'message de rejet incohérence référence↔nom');
	assert.ok(tools.includes('nameCovers(ref.name, ref.brand, declared)'), 'contrôle ref↔demande');
	assert.ok(tools.includes('nameCovers(resolved.name, resolved.brand, declared)'), 'contrôle aussi après recherche serveur');
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
	assert.ok(/insertPending\([\s\S]{0,900}\{ date, meal, components \}/.test(tools), 'payload preview == payload écrit');
});

test('searchFood reste la porte d’entrée décrite au modèle (pas d’accès générique Convex)', () => {
	const ai = read('src/lib/server/assistantAi.ts');
	assert.ok(ai.includes("'searchFood'"), 'outil searchFood toujours exposé');
	assert.ok(!ai.includes('ctx.db'), 'le modèle n’a jamais accès direct à la base');
});
