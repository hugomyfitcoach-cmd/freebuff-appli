/**
 * Mission : recherche alimentaire du CRM Coach alignée sur la PWA cliente.
 *
 * Avant : le CRM (Journal fiche cliente + plans de repas) appelait un moteur
 * différent (`/api/coach/search` → `journal.searchForCoach`, 25 produits non
 * paginés) sur clic du bouton « Chercher », et le bloc Ciqual échouait
 * silencieusement : le BFF `/api/foods/ciqual` exigeait le rôle « client » et
 * `requireRole` répondait une REDIRECTION 303 vers `/admin` — avalée par le
 * `.catch(() => {})` du CRM. La coach ne voyait donc que des produits OFF.
 *
 * Après : le CRM utilise le MÊME moteur que la PWA (`foodSearch.svelte.ts`,
 * mêmes endpoints `/api/foods/search` + `/api/foods/ciqual`, mêmes repères
 * Ciqual), en recherche réactive (debounce 300 ms, seuil 2 caractères,
 * anti-course), Ciqual en tête puis produits Open Food Facts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const adminPage = read('src/routes/admin/+page.svelte');
const plansPage = read('src/routes/admin/plans/+page.svelte');
const journalPage = read('src/routes/espace/journal/+page.svelte');
const ciqualBff = read('src/routes/api/foods/ciqual/+server.ts');
const searchBff = read('src/routes/api/foods/search/+server.ts');
const foodSearch = read('src/lib/foodSearch.svelte.ts');

test('BFF Ciqual : accessible à la cliente ET au coach (le redirect 303 vers /admin cassait le CRM)', () => {
	assert.ok(/requireRole\(event, \['client', 'coach'\]\)/.test(ciqualBff), 'rôles client + coach acceptés');
	assert.ok(!/requireRole\(event, 'client'/.test(ciqualBff), 'plus de restriction au seul rôle client');
});

test('BFF recherche produits : INCHANGÉ — la doctrine du 13/09 interdit de toucher au backend pour une évolution CRM', () => {
	assert.ok(/requireRole\(event, 'client'/.test(searchBff), 'le BFF produits reste client-only (contrat PWA intact)');
});

test('CRM : un seul appel réseau produits, centralisé dans le module partagé', () => {
	assert.ok(!/api\/coach\/search/.test(adminPage), 'fiche cliente : aucun fetch produits direct (module partagé)');
	assert.ok(!/api\/coach\/search/.test(plansPage), 'plans : aucun fetch produits direct (module partagé)');
});

test('CRM : recherche RÉACTIVE pendant la frappe (plus de clic « Chercher »)', () => {
	assert.ok(!/>Chercher<\/button>/.test(adminPage), 'bouton « Chercher » supprimé (fiche cliente)');
	assert.ok(!/>Chercher<\/button>/.test(plansPage), 'bouton « Chercher » supprimé (plans)');
	for (const [label, page] of [['fiche cliente', adminPage], ['plans', plansPage]]) {
		assert.ok(/bind:value=\{foodSearch\.state\.q\}/.test(page), `${label} : champ lié au moteur partagé`);
		assert.ok(/oninput=\{\(\) => foodSearch\.setQuery/.test(page), `${label} : recherche déclenchée à la frappe`);
		assert.ok(/e\.key === 'Enter' && foodSearch\.runNow\(\)/.test(page), `${label} : Enter = accéléateur, jamais obligatoire`);
	}
});

test('CRM : mêmes constantes PWA — debounce 300 ms, seuil 2 caractères', () => {
	assert.ok(/FOOD_SEARCH_DEBOUNCE_MS = 300/.test(foodSearch), 'debounce 300 ms comme la PWA');
	assert.ok(/FOOD_SEARCH_MIN_CHARS = 2/.test(foodSearch), 'seuil 2 caractères comme la PWA');
});

test('Moteur partagé : anti-course — une réponse ancienne ne remplace jamais une recherche plus récente', () => {
	assert.ok(/const req = \+\+seq;/.test(foodSearch), 'compteur incrémenté à chaque requête');
	assert.ok(/if \(req !== seq\) return;/.test(foodSearch), 'réponse périmée jetée avant écriture de l’état');
	// Trop court : toute réponse en vol est invalidée immédiatement.
	assert.ok(/seq\+\+;\s*\n\s*resetResults\(\)/.test(foodSearch), 'frappe trop courte : réponses en vol invalidées');
	// PWA : les trois recherches clientes ont le même garde-fou.
	assert.ok(/let searchSeq = 0;/.test(journalPage), 'PWA recherche principale : compteur anti-course');
	assert.ok(/guard !== searchSeq\) return;/.test(journalPage), 'PWA recherche principale : réponse périmée jetée');
	assert.ok(/guard !== mealSearchSeq\) return;/.test(journalPage), 'PWA recherche ingrédient : réponse périmée jetée');
	assert.ok(/guard !== mealAddSeq\) return;/.test(journalPage), 'PWA ajout ingrédient repas photo : réponse périmée jetée');
});

test('Moteur partagé : endpoints coach pour les produits, garde de contrat identique à la PWA', () => {
	assert.ok(/\/api\/coach\/search\?q=/.test(foodSearch), 'produits via /api/coach/search (même ranking foodRanking que la PWA, backend intact)');
	assert.ok(/\/api\/foods\/ciqual\?q=/.test(foodSearch), 'Ciqual via le BFF de la cliente (moteur searchCiqual partagé)');
	assert.ok(/AbortSignal\.timeout\(15_000\)/.test(foodSearch), 'timeout réseau identique à la PWA');
	assert.ok(/!Array\.isArray\(j\)/.test(foodSearch), 'payload inattendu = erreur affichée (jamais liste vide silencieuse)');
});

test('Moteur partagé : échec Ciqual silencieux — jamais de section vide, produits OFF conservés', () => {
	assert.ok(/\.catch\(\(\) => \[\] as SearchFood\[\]\)/.test(foodSearch), 'échec Ciqual → bloc absent, pas d’erreur');
});

test('CRM : hiérarchie visuelle — CIQUAL en tête, produits Open Food Facts ensuite', () => {
	for (const [label, page] of [['fiche cliente', adminPage], ['plans', plansPage]]) {
		const ciq = page.indexOf('Aliments de référence');
		const off = page.indexOf('Produits · Open Food Facts');
		assert.ok(ciq !== -1, `${label} : bloc Ciqual présent`);
		assert.ok(off !== -1, `${label} : bloc produits présent`);
		assert.ok(ciq < off, `${label} : CIQUAL affiché AVANT les produits`);
	}
});

test('CRM : les repères Ciqual et le ranking OFF de la PWA sont réutilisés (aucune deuxième implémentation)', () => {
	// Ordre officiel « oeuf » : cru → dur → au plat (déjà testé côté PWA sur
	// searchCiqualLocal — le CRM passe par le MÊME moteur via /api/foods/ciqual
	// → convex.searchCiqual → searchCiqualLocal : aucun nouveau code de ranking).
	assert.ok(/api\.ciqual\.searchCiqual/.test(ciqualBff), 'BFF → fonction Convex Ciqual existante (moteur unique)');
	assert.ok(!/searchForCoach/.test(adminPage), 'la page n’appelle plus la fonction Convex coach directement (elle passe par le module partagé)');
	assert.ok(!/fetch\(\/api\/foods\/search/.test(foodSearch), 'le module partagé n’appelle PAS l’endpoint client-only de la PWA (aucun changement backend)');
	assert.ok(!/FRONTEND_API_VERSION/.test(foodSearch), 'aucune télémétrie de contrat client sur les endpoints coach');
});

test('CRM : le chargement du panneau reset la recherche (aucun résidu de la cliente précédente)', () => {
	assert.ok(/foodSearch\.clear\(\); \/\/ panneau propre à chaque ouverture/.test(adminPage), 'reset à l’ouverture du panneau Journal');
	assert.ok(/foodSearch\.clear\(\)/.test(plansPage), 'reset dans les ouvertures de l’éditeur de plans');
});

test('Résultats conservés pendant une nouvelle frappe (pas de clignotement)', () => {
	assert.ok(/transition-opacity \{foodSearch\.state\.searching \? 'opacity-50' : ''\}/.test(adminPage), 'atténuation discrète pendant la recherche (fiche cliente)');
	assert.ok(!/searching = true;\s*\n\s*results = \[\]/.test(journalPage), 'PWA : pas de vidage des résultats au début d’une recherche');
});
