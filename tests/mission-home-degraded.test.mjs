/**
 * Mission ACCUEIL DÉGRADÉ — tableau de bord indisponible (dash === null).
 *
 * Règle produit : quand le dashboard ne peut pas être chargé (réseau dégradé,
 * Convex injoignable), l'Accueil n'affiche JAMAIS de valeurs à zéro. La zone
 * « Aujourd'hui » devient un état « Données momentanément indisponibles » avec
 * un bouton « Réessayer » qui relance les loaders, et les compteurs qui
 * dépendent du dashboard (pesées de la semaine) disparaissent au lieu de
 * tomber à 0.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const home = readFileSync(join(root, 'src/routes/espace/+page.svelte'), 'utf8');

test('dash indisponible → « Données momentanément indisponibles » à la place des cartes du jour', () => {
	const block = home.slice(home.indexOf('{#if dash}'), home.indexOf('<!-- Feuille de saisie rapide du poids'));
	assert.match(block, /\{:else\}/, 'le bloc {#if dash} a un état dégradé');
	assert.match(block, /Données momentanément indisponibles/);
	// La branche dégradée est le DERNIER {:else} du bloc (les cartes du jour
	// en contiennent déjà dans leurs propres conditions).
	const degraded = block.slice(block.lastIndexOf('{:else}'));
	assert.ok(!/CountUp/.test(degraded), 'aucune valeur chiffrée dans l’état dégradé (jamais un zéro)');
	assert.ok(!/kcal/.test(degraded), 'aucun compteur de calories dans l’état dégradé');
});

test('Le bouton « Réessayer » relance le chargement sans recharger toute la page', () => {
	const block = home.slice(home.indexOf('{#if dash}'), home.indexOf('<!-- Feuille de saisie rapide du poids'));
	assert.match(block, /Réessayer/);
	assert.match(block, /onclick=\{retryDash\}/, 'le bouton appelle la relance');
	assert.match(block, /disabled=\{dashRetrying\}/, 'anti-doublon pendant la relance');
	const fn = home.slice(home.indexOf('async function retryDash'), home.indexOf('async function retryDash') + 400);
	assert.match(fn, /await invalidateAll\(\)/, 'les loaders (dont le dashboard) sont relancés');
});

test('Les compteurs « pesées » dépendants du dashboard ne tombent jamais à zéro', () => {
	assert.match(home, /\{#if dash && !autonomy\}/, 'badge Pesées de la carte Poids conditionné à dash');
	assert.match(home, /\{:else if dash && !autonomy\}/, 'ligne « Pesées cette semaine » de Ma progression conditionnée à dash');
	assert.match(home, /const peseesLabel = \$derived\(dash \?/, 'le libellé est vide sans dashboard');
});
