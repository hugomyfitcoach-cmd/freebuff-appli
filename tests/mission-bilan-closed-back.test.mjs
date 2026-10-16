import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bilan = readFileSync(join(root, 'src/routes/bilan/+page.svelte'), 'utf8');
const history = readFileSync(join(root, 'src/routes/espace/historique/+page.svelte'), 'utf8');

test('écran bilan fermé : retour direct vers Mes bilans et logo d’en-tête absent uniquement dans cet état', () => {
  assert.match(bilan, /\{#if !formOpen\}[\s\S]*?<a href="\/espace\/historique" aria-label="Retour à Mes bilans">[\s\S]*?<span>Mes bilans<\/span>[\s\S]*?\{\/if\}/);
  assert.match(bilan, /\{#if formOpen\}\s*<div class="form-header">[\s\S]*?logo-header\.png/);
  assert.match(bilan, /<h2>Bilan fermé<\/h2>/);
  assert.match(bilan, /Le formulaire est fermé jusqu'à vendredi\./);
  assert.match(bilan, /Rendez-vous vendredi pour ton prochain bilan\./);
  assert.match(bilan, /\.closed-container\s*\{\s*padding-top: max\(56px, calc\(env\(safe-area-inset-top, 0px\) \+ 12px\)\);/);
});

test('la route cible est la page existante « Mes bilans »', () => {
  assert.match(history, /<svelte:head><title>Mes bilans — G-Flux<\/title><\/svelte:head>/);
});

test('la règle d’ouverture du bilan reste inchangée', () => {
  assert.match(bilan, /import \{ isFormOpen \} from '\$lib\/week\.js';/);
  assert.match(bilan, /const formOpen = \$state\(isFormOpen\(\)\);/);
});
