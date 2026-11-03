/**
 * Mission : FICHE DE QUANTITÉ COMPACTE SUR FOND ASSOMBRI (côté coach).
 *
 * Constat : sur /admin/plans (desktop), cliquer un aliment ouvrait la fiche
 * sur un fond BLANC OPAQUE plein écran — plan et panneau de recherche
 * disparaissaient — avec une grande zone d'icône vide en haut.
 *
 * Attendu, UNIQUEMENT côté coach (≥ 1024 px) : voile sombre semi-transparent
 * (+ léger flou) derrière une fenêtre centrée de ~440 px, coins arrondis,
 * ombre du CRM, hauteur plafonnée avec défilement interne ; petite vignette
 * ou pictogramme de 40 px à côté du titre ; repas présélectionné = celui de
 * « Ajouter à : ». Espace cliente (journal, mobile) strictement inchangé.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const sheet = read('src/lib/components/QuantitySheet.svelte');
const plansPage = read('src/routes/admin/plans/+page.svelte');
const adminPage = read('src/routes/admin/+page.svelte');
const journalPage = read('src/routes/espace/journal/+page.svelte');

/* ─── 1. Voile sombre + flou, fenêtre centrée 440 px ─── */

test('Coach desktop : voile sombre semi-transparent + léger flou derrière la fiche', () => {
	assert.ok(
		sheet.includes('bg-[rgba(20,20,19,0.35)]'),
		'voile sombre ~0.35 (la page reste visible derrière)'
	);
	assert.ok(sheet.includes('backdrop-blur-[2px]'), 'léger flou du fond');
	assert.ok(
		sheet.includes("style:background-color={readOnly || compactModal ? 'transparent' : undefined}"),
		'fond de la racine rendu transparent en mode compact (plus de blanc opaque)'
	);
});

test('Coach desktop : fenêtre ~440 px, coins arrondis, ombre du CRM, hauteur plafonnée', () => {
	assert.ok(sheet.includes('max-w-[440px]'), 'largeur de fenêtre compacte');
	assert.ok(
		/compactModal[\s\S]{0,400}rounded-\[1\.5rem\][\s\S]{0,200}shadow-\[0_2px_6px_rgba\(17,17,16,0\.05\)/.test(
			sheet
		),
		'coins arrondis + ombre de la famille CRM'
	);
	assert.ok(
		sheet.includes('max-h-[calc(100dvh-3rem)]'),
		'hauteur limitée à l’écran (défilement interne via la zone min-h-0 flex-1 overflow-y-auto)'
	);
	assert.ok(
		sheet.includes('min-h-0 flex-1 overflow-y-auto overscroll-contain'),
		'zone de contenu défilante conservée'
	);
});

/* ─── 2. Périmètre : coach seulement, ≥ 1024 px ─── */

test('Mode compact limité au coach et aux écrans ≥ 1024 px', () => {
	assert.ok(sheet.includes("matchMedia('(min-width: 1024px)')"), 'seuil desktop 1024 px');
	assert.ok(
		sheet.includes('const compactModal = $derived(coach && wideCoach && !mobileSheet);'),
		'activation = prop coach + écran large + pas de fiche mobile'
	);
	assert.ok(
		plansPage.includes('\n\t\tcoach\n'),
		'plans de repas coach : fiche compacte demandée'
	);
	assert.ok(
		adminPage.includes('\n\t\t\t\t\t\tcoach\n'),
		'ajout au journal d’une cliente (coach) : même fiche'
	);
	const journalCalls = [...journalPage.matchAll(/<QuantitySheet[\s\S]*?\/>/g)].map((m) => m[0]);
	assert.equal(journalCalls.length, 5, 'journal cliente : 5 appels recensés');
	assert.ok(
		journalCalls.every((call) => !/\bcoach\b/.test(call)),
		'espace cliente : aucun appel en mode compact → rendu strictement inchangé'
	);
});

/* ─── 3. Fermeture par le voile et par Échap (sans ajouter) ─── */

test('Voile et Échap ferment la fiche compacte sans rien ajouter', () => {
	assert.ok(
		/compactModal\)\s*&& !saving && e\.target === e\.currentTarget\) onClose\(\)/.test(sheet),
		'clic sur le fond (voile) = fermeture sans écriture'
	);
	assert.ok(
		/if \(e\.key === 'Escape' && !saving\) onClose\(\);/.test(sheet),
		'Échap = fermeture sans écriture'
	);
	assert.ok(sheet.includes('window.addEventListener('), 'Échap écouté même sans focus dans la fiche');
});

/* ─── 4. Petite icône / vignette à côté du titre, plus de grand bloc vide ─── */

test('Sans photo : pictogramme 40 px à côté du titre ; avec photo : vignette réduite', () => {
	assert.ok(
		/compactModal[\s\S]{0,600}h-10 w-10 shrink-0[\s\S]{0,300}heroSrc[\s\S]{0,400}Icon name="utensils" size=\{18\}/.test(
			sheet
		),
		'vignette 40 px = photo si présente, sinon pictogramme discret'
	);
	assert.ok(
		sheet.includes('{#if !compactModal}\n\t\t\t<div class="relative shrink-0 bg-cream"'),
		'le grand hero est réservé au plein écran (cliente, mobile, coach étroit)'
	);
});

/* ─── 5. Repas présélectionné = « Ajouter à : » du panneau ─── */

test('Repas présélectionné = celui choisi dans « Ajouter à : » du panneau', () => {
	assert.ok(
		plansPage.includes("const sheetMeal = $derived(editKey === '' ? searchForMeal : editItem?.meal ?? 'petit-dej');"),
		'nouvel aliment → repas ciblé par le panneau'
	);
	assert.ok(
		plansPage.includes('initialMeal={sheetMeal}'),
		'la fiche reçoit ce repas à l’ouverture'
	);
	assert.ok(
		plansPage.includes('searchForMeal = meal.id; openSearch();'),
		'« Ajouter à : » définit le repas ciblé'
	);
});

/* ─── 6. Contenu et actions inchangés ─── */

test('Contenu, calculs, onglets, fiche nutritionnelle et CTA inchangés', () => {
	assert.ok(sheet.includes('Ajouter au journal'), 'CTA par défaut conservé');
	assert.ok(plansPage.includes("saveLabel={editKey === '' ? 'Ajouter au plan' : 'Enregistrer'}"), '« Ajouter au plan » inchangé');
	assert.ok(sheet.includes('Voir la fiche nutritionnelle'), 'fiche nutritionnelle conservée');
	assert.ok(sheet.includes("const kcal = $derived(Math.round((food.kcal100 * effGrams) / 100));"), 'calculs inchangés');
	assert.ok(sheet.includes("{#if tabCount > 1}"), 'onglets Grammes / Portions / Repères conservés');
	assert.ok(sheet.includes('bind:value={gramsText}'), 'saisie de quantité conservée');
});
