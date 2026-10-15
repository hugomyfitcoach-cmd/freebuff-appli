/**
 * Tests MISSION — Position de scroll à l'ouverture d'un onglet principal.
 *
 * 1) Une tape sur Accueil / Journal / Progression remet la mémoire de scroll
 *    de cet onglet à 0 (page de destination toujours en haut) ;
 * 2) La correction est centralisée dans la barre principale (AppShell) ;
 * 3) Les pages d'onglet ne restaurent que la position mémorisée (0 après
 *    reset) et les sous-pages / fiches gardent leur restauration.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetScroll, restoreScroll } from '../src/lib/navMemory.ts';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const shell = read('../src/lib/components/AppShell.svelte');
const navMemory = read('../src/lib/navMemory.ts');

test('navMemory : resetScroll ramène la position mémorisée à 0', () => {
	resetScroll('/espace/journal');
	assert.equal(restoreScroll('/espace/journal'), 0);
	assert.equal(restoreScroll('/espace/jamais-visite'), 0, 'route inconnue : 0 inchangé');
});

test('AppShell : chaque lien de la barre principale remet son onglet à 0', () => {
	const start = shell.indexOf('{#each primaryLinks as link (link.href)}');
	const end = shell.indexOf('{/each}', start);
	const bar = shell.slice(start, end);
	assert.match(bar, /onclick=\{\(\) => resetScroll\(link\.href\)\}/);
	assert.match(shell, /import \{ noteSync, resetScroll \} from '\.\.\/navMemory';/);
});

test('Sous-pages : la restauration de position reste en place (aucun reset dispersé)', () => {
	assert.doesNotMatch(shell.slice(0, shell.indexOf('primaryLinks')), /resetScroll\(/, 'reset uniquement sur la barre');
	assert.match(navMemory, /export function restoreScroll\(route: string\): number \{\s*return scrollAt\[route\] \?\? 0;/);
});
