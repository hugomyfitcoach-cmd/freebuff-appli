/**
 * MISSION — ASSISTANT G-FLUX · LOT 2B (stabilisation).
 *
 * Bugs traités :
 *  1. L'agent « ne trouve pas » des aliments présents dans G-FLUX — en réalité
 *     (a) le modèle ne de mandait pas l'outil et récitait des valeurs de
 *     mémoire, et (b) le classement Ciqual écartait le leader (« beurre » →
 *     « Haricot beurre », « pain de mie complet » → « Sandwich … »).
 *  2. Un SEUL moteur de classement pour le journal ET l'assistant.
 *  3. Mémoire de la demande en cours (ne pas redemander les infos données).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const ciqual = await import(new URL('../src/convex/ciqual.ts', import.meta.url).href);
const tools = await import(new URL('../src/convex/assistantTools.ts', import.meta.url).href);
const { searchCiqualLocal, genericCiqualFirst } = { ...ciqual, genericCiqualFirst: tools.genericCiqualFirst };
const { nameCovers } = tools;

const assistantSrc = read('src/convex/assistant.ts');
const toolsSrc = read('src/convex/assistantTools.ts');
const policySrc = read('src/lib/assistant/policy.ts');

/* ═══ 1. Les 6 cas de validation — trouvés par le MÊME moteur que le journal ═══ */

const VALIDATION_CASES = [
	['pain de mie complet', 'Pain de mie complet, préemballé', 257],
	['œuf au plat', 'Oeuf au plat, sans matière grasse', 157],
	['riz basmati cuit', 'Riz basmati, cuit, sans sel ajouté', 148],
	['flocons d\'avoine', 'Flocons d\'avoine', 369],
	['pomme de terre cuite', 'Pomme de terre, cuite', 94.9],
];

test('Cas de validation : le 1er résultat Ciqual EST l\'aliment demandé', () => {
	for (const [q, expectedPrefix, kcal] of VALIDATION_CASES) {
		const hits = searchCiqualLocal(q);
		assert.ok(hits.length > 0, `« ${q} » : au moins un résultat`);
		assert.ok(
			hits[0].label.startsWith(expectedPrefix),
			`« ${q} » → 1er = ${expectedPrefix} (obtenu : ${hits[0].label})`,
		);
		assert.equal(hits[0].kcal, kcal, `« ${q} » : kcal Ciqual officielles`);
		assert.ok(nameCovers(hits[0].label, undefined, q), `« ${q} » : la fiche couvre la demande`);
	}
});

test('« beurre » : les 3 résultats sont des BEURRES réels (jamais Haricot beurre ni Pâte brisée)', () => {
	const hits = searchCiqualLocal('beurre');
	assert.equal(hits.length, 3);
	for (const h of hits) {
		assert.ok(h.label.startsWith('Beurre'), `fiche beurre (obtenu : ${h.label})`);
		assert.ok(h.kcal > 350, `kcal beurre plausibles (obtenu : ${h.kcal})`);
	}
});

test('« pain de mie complet » : aucun Sandwich dans les résultats', () => {
	for (const h of searchCiqualLocal('pain de mie complet')) {
		assert.ok(!/sandwich/i.test(h.label), `pas de sandwich (obtenu : ${h.label})`);
	}
});

test('Diversification préservée : « riz » → cru puis cuit, toujours des RIZ', () => {
	const labels = searchCiqualLocal('riz').map((h) => h.label);
	assert.equal(labels.length, 3);
	for (const l of labels) assert.ok(l.startsWith('Riz'), `fiche riz (obtenu : ${l})`);
	assert.ok(labels[0].includes('cru'), '1er = cru');
	assert.ok(labels.slice(1).some((l) => /cuit|bouilli/.test(l)), 'au moins un cuit ensuite');
});

test('Ordre pédagogique œuf préservé (cru → dur → au plat) et requête spécifique pure', () => {
	const labels = searchCiqualLocal('oeuf').map((h) => h.label);
	assert.match(labels[0], /^Oeuf cru$/);
	assert.match(labels[1], /^Oeuf dur$/);
	assert.match(labels[2], /^Oeuf au plat/);
	assert.deepEqual(searchCiqualLocal('oeuf dur').map((h) => h.label), ['Oeuf dur']);
});

test('genericCiqualFirst : le générique retenu EST l\'aliment demandé (pain, beurre)', () => {
	const pain = genericCiqualFirst('pain de mie complet');
	assert.ok(pain, 'référence trouvée');
	assert.equal(pain.name, 'Pain de mie complet, préemballé');
	assert.equal(pain.kcal100, 257);
	const beurre = genericCiqualFirst('beurre');
	assert.ok(beurre, 'référence trouvée');
	assert.ok(beurre.name.startsWith('Beurre'), `beurre réel (obtenu : ${beurre.name})`);
	assert.ok(beurre.kcal100 > 600, 'kcal beurre correctes (~730-750), pas un haricot');
});

/* ═══ 2. Un seul moteur : l'assistant réutilise la fenêtre du journal ═══ */

test('searchFood et searchFoodInternal utilisent FOOD_SEARCH_CANDIDATES (comme le journal)', () => {
	assert.ok((toolsSrc.match(/take\(FOOD_SEARCH_CANDIDATES\)/g) ?? []).length >= 2,
		'les deux chemins de recherche assistant remontent 150 candidats');
	assert.ok(!toolsSrc.includes('.take(40)'), 'ancienne fenêtre 40 supprimée');
	assert.ok(!toolsSrc.includes('.take(120)'), 'ancienne fenêtre 120 supprimée');
});

test('searchFoodInternal : l\'aliment PERSONNEL ne peut plus être retenu sans contrôle', () => {
	assert.ok(
		/customs\[0\]\.name, customs\[0\]\.brand, declared/.test(toolsSrc),
		'nameCovers exigé avant de retenir la fiche personnalisée',
	);
});

/* ═══ 3. Filet « ajout sans outil » élargi (réponse de mémoire) ═══ */

test('assistant.ts : intention d\'ajout détectée côté serveur + relance bornée', () => {
	assert.ok(assistantSrc.includes('ADD_INTENT_RE'), 'regex d\'intention définie');
	assert.ok(
		/ANNOUNCE_WITHOUT_TOOL_RE\.test\(reply\) \|\|[\s\S]{0,200}ADD_INTENT_RE\.test\(text\) && !reply\.includes\("\?"\)/.test(assistantSrc),
		'relance déclenchée par annonce sans outil OU réponse de mémoire sans question',
	);
	assert.ok(assistantSrc.includes('VALUES_WITHOUT_TOOL_RE'), 'détection de kcal récitées sans outil');
	assert.ok(
		/VALUES_WITHOUT_TOOL_RE\.test\(reply\) && !reply\.includes\("\?"\)/.test(assistantSrc),
		'les clarifications ("pain de mie complet") récitent-elles des kcal → relance outil',
	);
	assert.ok(/maxRounds: 1,/.test(assistantSrc), 'relance toujours limitée à UN tour');
});

test('prompt : demande d\'ajout = outil immédiat, jamais de valeurs de mémoire', () => {
	assert.ok(policySrc.includes("DEMANDE D'AJOUT = OUTIL IMMÉDIAT"));
	assert.ok(policySrc.includes('JAMAIS de calories/macros récitées de mémoire'));
	assert.ok(policySrc.includes('un SEUL appel prepareJournalEntry avec les'), 'multi-aliments = une action');
});

/* ═══ 4. Mise à jour déterministe de l'action en attente (Bug 2) ═══ */

test('updatePendingJournalEntry : fusion serveur sans perte d\'information', () => {
	assert.ok(toolsSrc.includes('export const updatePendingJournalEntry = mutation('), 'mutation créée');
	assert.ok(/status !== "pending"/.test(toolsSrc), 'seule une action PENDING est modifiable');
	assert.ok(/expiresAt <= Date\.now\(\)/.test(toolsSrc), 'action expirée refusée');
	assert.ok(/doc\.threadId !== tId/.test(toolsSrc), 'action d\'un autre fil refusée (isolation)');
	assert.ok(/nameCovers\(declared, undefined, c\.name\) \|\|[\s\S]{0,60}nameCovers\(c\.name, undefined, declared\)/.test(toolsSrc), 'la clarification raffine la ligne qu\'elle recouvre');
	assert.ok(/\(it\.qtyGrams !== undefined \? \{ qtyGrams: it\.qtyGrams \} : \{\}\)/.test(toolsSrc), 'quantité absente = quantité existante conservée');
});

test('updatePendingJournalEntry : recalcul par le MÊME pipeline verrouillé (jamais de valeurs du modèle)', () => {
	assert.ok(/buildJournalEntryPreview\(ctx, user\._id, payload\.date, payload\.meal, current/.test(toolsSrc), 'recalcul serveur complet');
	assert.ok(/ctx\.db\.patch\(doc\._id, \{[\s\S]{0,200}preview,/.test(toolsSrc), 'seule la preview/payload sont remplacées');
});

test('Registre : updateJournalEntry exposé avec conservation explicite', () => {
	const registry = read('src/convex/assistantRegistry.ts');
	assert.ok(registry.includes('name: "updateJournalEntry"'), 'outil exposé');
	assert.ok(registry.includes('les autres lignes et quantités déjà confirmées sont CONSERVÉES'), 'conservation documentée au modèle');
	assert.ok(registry.includes('updatePendingJournalEntry'), 'câblé sur la mutation serveur');
});

test('assistant.ts : updateJournalEntry devient la pendingAction du tour (ancienne preview remplacée)', () => {
	assert.ok(/la mise à jour REMPLACE la pendingAction du tour/.test(assistantSrc), 'une seule preview affichée');
});
