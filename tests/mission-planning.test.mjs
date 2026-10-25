/**
 * Mission PLANNING — lisibilité des rendez-vous courts dans /admin/rendez-vous
 * (vue semaine).
 *
 * - créneau de 30 min ou moins : une seule ligne « 09:00 · Prénom Nom »,
 *   police légèrement plus petite, texte tronqué avec « … » ;
 * - créneau plus long : affichage historique (heure de début–fin, nom, type) ;
 * - survol (desktop) : attribut `title` natif avec début, fin, nom complet et
 *   type de rendez-vous ;
 * - aucun texte ne déborde du bloc vert (troncature + overflow-hidden).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/routes/admin/rendez-vous/+page.svelte', import.meta.url), 'utf8');

/** Bloc « RDV posés » de la grille semaine (entre la couche RDV et la couche réservation). */
const start = page.indexOf('<!-- RDV posés (blocs)');
const end = page.indexOf('<!-- Couche réservation');
assert.ok(start > 0 && end > start, 'bloc des rendez-vous présent dans le calendrier');
const block = page.slice(start, end);

/** Branche compacte (créneau ≤ 30 min) et branche longue (créneau > 30 min). */
const compact = block.slice(block.indexOf('{#if rdvDuration(r) <= 30}'), block.indexOf('{:else}'));
const long = block.slice(block.indexOf('{:else}'), block.indexOf('{/if}', block.indexOf('{:else}')));

test('PLANNING : créneau de 15 min → une seule ligne « 09:00 · Prénom Nom », tronquée', () => {
	// 15 min passe dans la branche compacte (≤ 30).
	assert.match(compact, /rdvDuration\(r\) <= 30/, 'créneau court détecté par sa durée');
	// Une seule ligne : un seul <span>, heure de début · nom complet.
	assert.equal((compact.match(/<span/g) ?? []).length, 1, 'une seule ligne de texte dans le bloc');
	assert.ok(compact.includes('{r.time} · {clientNameOf(r)}'), 'heure de début · nom complet sur la même ligne');
	assert.ok(!compact.includes('{r.endTime}'), 'pas d’heure de fin sur la ligne compacte');
	assert.ok(!compact.includes('{r.kind}'), 'pas de type sur la ligne compacte');
	// Police légèrement plus petite + troncature.
	assert.ok(compact.includes('truncate'), 'texte coupé avec « … » si la place manque');
	assert.ok(/text-\[10\.5px\]/.test(compact), 'police légèrement plus petite');
	assert.ok(compact.includes('block'), 'ligne pleine largeur (troncature effective)');
});

test('PLANNING : créneau de 60 min → affichage complet (horaire, nom, type)', () => {
	assert.match(block, /rdvDuration\(r\) <= 30/, 'seuls les créneaux ≤ 30 min sont compactés');
	assert.ok(long.includes('{r.time}–{r.endTime}'), 'horaire début–fin conservé');
	assert.ok(long.includes('{clientNameOf(r)}'), 'nom affiché');
	assert.ok(long.includes('{r.kind}'), 'type de rendez-vous affiché');
	assert.ok(!/rdvDuration\(r\) >= 30/.test(block), 'ancienne règle « type dès 30 min » remplacée');
});

test('PLANNING : attribut title avec début, fin, nom complet et type', () => {
	const title = block.match(/title=\{`([^`]+)`\}/);
	assert.ok(title, 'attribut title natif présent');
	const valeur = title[1];
	assert.ok(valeur.includes('${r.time}–${r.endTime}'), 'heure de début et de fin');
	assert.ok(valeur.includes('${clientNameOf(r)}'), 'nom complet de la cliente');
	assert.ok(valeur.includes('${r.kind}'), 'type de rendez-vous');
});

test('PLANNING : aucun texte ne déborde du bloc vert, calendrier à défilement contenu', () => {
	assert.ok(block.includes('overflow-hidden'), 'contenu du bloc vert rogné');
	assert.ok(block.includes('py-0.5'), 'créneau court : padding réduit pour tenir sur une ligne');
	// La grille large reste dans son conteneur à défilement horizontal (320 px).
	const scroller = page.slice(page.indexOf('<div class="overflow-x-auto pb-1">'), page.indexOf('<!-- Légende -->'));
	assert.ok(scroller.includes('overflow-x-auto'), 'grille contenue dans son conteneur');
});
