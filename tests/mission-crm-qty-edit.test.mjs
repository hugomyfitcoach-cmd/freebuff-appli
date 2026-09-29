/**
 * Mission UX : CRM coach — modification DIRECTE des quantités.
 *
 * Avant : [-] 185 g [+] — impossible de saisir 120 directement, il faut
 * cliquer 6 fois sur − pour passer de 185 à 120 (−10 g par clic).
 *
 * Après : la valeur centrale devient un input discret au clic (valeur
 * présélectionnée), Enter / blur valident, Échap annule. Les boutons − / +
 * restent inchangés. Garde-fous identiques à l'endpoint
 * (updateEntryQtyForCoach : 1–5000 g) : vide / 0 / négatif / invalide /
 * > 5000 → édition refermée SANS appel réseau, valeur conservée.
 *
 * Périmètre : frontend-only. Le Journal cliente (mode="client") ne change
 * pas ; aucun endpoint, aucune mutation Convex, aucun schema modifié.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const journalDay = read('src/lib/components/JournalDay.svelte');
const admin = read('src/routes/admin/+page.svelte');
const journalTs = read('src/convex/journal.ts');

/* ————— 1. La valeur centrale devient éditable ————— */

test('Quantité centrale cliquable : bouton d\u2019affichage → input discret au clic', () => {
	assert.ok(journalDay.includes('function openQtyEdit'), 'ouverture de l\u2019\u00e9dition au clic');
	assert.ok(journalDay.includes('bind:this={qtyEditInput}'), 'input num\u00e9rique rendu dans la ligne');
	assert.ok(journalDay.includes('inputmode="decimal"'), 'clavier adapt\u00e9 (mobile/tablette, virgule support\u00e9e)');
	assert.ok(journalDay.includes('qtyDraft.replace(\',\', \'.\')'), 'virgule d\u00e9cimale accept\u00e9e (12,5)');
	assert.ok(journalDay.includes('qtyDraft = String(e.qtyGrams).replace(\'.\', \',\')'), 'valeur actuelle affich\u00e9e au format FR');
});

test('S\u00e9lection compl\u00e8te de la valeur \u00e0 l\u2019ouverture (on tape par-dessus)', () => {
	assert.ok(journalDay.includes('qtyEditInput?.select()'), 'select() de la valeur existante');
	assert.ok(journalDay.includes('qtyEditInput?.focus()'), 'focus automatique de l\u2019input');
});

test('Validation : Enter, blur (clic ailleurs), annulation : \u00c9chap', () => {
	assert.ok(/Enter'\)\s*applyQtyEdit\(e\)|Enter'[^;]*applyQtyEdit\(e\)/.test(journalDay), 'Enter valide');
	assert.ok(journalDay.includes("onblur={() => applyQtyEdit(e)}"), 'blur (clic ailleurs) valide');
	assert.ok(journalDay.includes("Escape') closeQtyEdit()"), '\u00c9chap annule sans rien \u00e9crire');
	assert.ok(journalDay.includes('function closeQtyEdit'), 'fermeture explicite (retour \u00e0 l\u2019affichage normal)');
});

/* ————— 2. Garde-fous (m\u00eames bornes que l\u2019endpoint serveur) ————— */

test('Garde-fous identiques \u00e0 updateEntryQtyForCoach : 1 \u2013 5000 g, jamais de NaN', () => {
	assert.ok(journalTs.includes('qtyGrams <= 0 || qtyGrams > 5000'), 'r\u00e9f\u00e9rence serveur : bornes 1\u20135000 g (inchang\u00e9es)');
	const apply = journalDay.slice(journalDay.indexOf('function applyQtyEdit'), journalDay.indexOf('function applyQtyEdit') + 600);
	assert.ok(apply.includes('isFinite(v)'), 'valeur invalide / NaN refus\u00e9e');
	assert.ok(apply.includes('v >= 1 && v <= 5000'), 'bornes 1\u20135000 g appliqu\u00e9es c\u00f4t\u00e9 client');
	assert.ok(apply.includes('closeQtyEdit()'), 'invalide \u2192 \u00e9dition referm\u00e9e, valeur conserv\u00e9e');
	// Aucun r\u00e9seau dans le composant : invalide = z\u00e9ro appel, la valeur de la ligne ne bouge pas.
	assert.ok(!journalDay.includes('fetch('), 'JournalDay ne fait AUCUN appel r\u00e9seau (l\u2019invalidit\u00e9 ne peut rien casser)');
});

test('Double d\u00e9clenchement impossible : Enter puis blur ne valident pas deux fois', () => {
	const apply = journalDay.slice(journalDay.indexOf('function applyQtyEdit'), journalDay.indexOf('function applyQtyEdit') + 600);
	assert.ok(apply.includes("qtyEditId !== e._id"), 'garde : \u00e9dition d\u00e9j\u00e0 referm\u00e9e \u2192 no-op');
});

/* ————— 3. − / + conserv\u00e9s et coh\u00e9rents avec la saisie ————— */

test('Boutons \u2212 / + conserv\u00e9s (petits ajustements), comportement inchang\u00e9', () => {
	assert.ok(journalDay.includes('aria-label="R\u00e9duire la quantit\u00e9"'), 'bouton \u2212 pr\u00e9sent');
	assert.ok(journalDay.includes('aria-label="Augmenter la quantit\u00e9"'), 'bouton + pr\u00e9sent');
	assert.ok(journalDay.includes('bumpQty(e, -10)'), '\u2212 appelle le relais (pas de changement de s\u00e9mantique)');
	assert.ok(journalDay.includes('bumpQty(e, 10)'), '+ appelle le relais');
});

test('Clic sur \u2212 / + juste apr\u00e8s une saisie : incr\u00e9ment bas\u00e9 sur la valeur VALID\u00c9E', () => {
	const bump = journalDay.slice(journalDay.indexOf('function bumpQty'), journalDay.indexOf('function bumpQty') + 500);
	assert.ok(bump.includes('qtyCommitted'), 'relais : valeur tout juste valid\u00e9e (blur avant clic)');
	assert.ok(bump.includes('Math.max(1, base + delta)'), 'plancher 1 g conserv\u00e9 sur \u2212');
});

/* ————— 4. P\u00e9rim\u00e8tre : CRM uniquement, client intouch\u00e9, frontend-only ————— */

test('Saisie directe limit\u00e9e au bloc mode="coach" (Journal cliente inchang\u00e9)', () => {
	const coachGuard = journalDay.indexOf("{#if mode === 'coach' && onQty && onRemove}");
	const firstInput = journalDay.indexOf('bind:this={qtyEditInput}');
	assert.ok(coachGuard > -1, 'bloc coach existant');
	assert.ok(firstInput > coachGuard, 'l\u2019input de saisie vit APR\u00c8S la garde coach (jamais rendu en mode client)');
	assert.ok(firstInput < journalDay.indexOf('{/snippet}', coachGuard), 'et toujours DANS le snippet de ligne');
});

test('Frontend-only : m\u00eame endpoint, aucune nouvelle route, aucune mutation Convex ajout\u00e9e', () => {
	assert.ok(admin.includes('onQty={setQty}'), 'le CRM passe toujours son setQty existant');
	assert.ok(admin.includes('/api/coach/journal/${entry._id}'), 'PATCH existant r\u00e9utilis\u00e9 tel quel');
	assert.ok(admin.includes('userId: selectedId, qtyGrams'), 'payload inchang\u00e9');
	assert.ok(journalTs.includes('export const updateEntryQtyForCoach'), 'mutation serveur existante, non modifi\u00e9e');
});
