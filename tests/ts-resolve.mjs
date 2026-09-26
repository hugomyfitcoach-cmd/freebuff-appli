/**
 * Hook de résolution TS pour node --test : retente `./mod` → `./mod.ts`
 * quand la résolution brute échoue (les modules internes du projet importent
 * leurs voisins SANS extension — résolus par Vite, pas par Node).
 *
 * Branché via `--import ./tests/ts-resolve.mjs` dans le script `npm test`.
 * Aucun effet sur les imports qui résolvent déjà (JS, node_modules…).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./ts-resolve-loader.mjs', import.meta.url);
