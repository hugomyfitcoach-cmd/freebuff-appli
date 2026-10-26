#!/usr/bin/env node
/**
 * GÉNÉRATION DE LA COPIE SERVEUR DU GUIDE DE STYLE DES RETOURS.
 *
 * La source unique est éditoriale : `docs/guide-style-retours.md` (déposé par
 * Hugo). Une action Convex ne peut pas lire le disque : ce script fabrique donc
 * le module TypeScript `src/lib/data/coachDraftStyleGuide.ts` qui embarque le
 * contenu du .md, octet pour octet.
 *
 * MÊME MÉCANISME QUE LA MÉTHODE (`scripts/gen-methode-gflux.mjs`) :
 *  - lancé automatiquement avant chaque build (`npm run build`) ;
 *  - `npm test` refuse de passer si le fichier diffère de ce générateur
 *    (tests/mission-coach-draft-m3) — jamais l'inverse : on n'édite que le .md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Chemins relatifs : la source éditoriale et la copie serveur générée. */
export const GUIDE_MD = 'docs/guide-style-retours.md';
export const GUIDE_MODULE = 'src/lib/data/coachDraftStyleGuide.ts';

/** En-tête du module généré — avertissements conservés dans le fichier produit. */
const HEADER = `/**
 * GUIDE DE STYLE DES RETOURS DE BILAN — FICHIER GÉNÉRÉ, NE PAS ÉDITER.
 *
 * Source de vérité unique : "docs/guide-style-retours.md" (déposé par Hugo).
 * Régénéré par "scripts/gen-guide-style.mjs", exécuté automatiquement avant
 * chaque build. Toute modification se fait dans le .md uniquement ; un test
 * (mission-coach-draft-m3) échoue si ce fichier diffère du générateur ou du .md.
 *
 * Copie serveur embarquée exacte du .md (une action Convex ne lit pas le
 * disque). JAMAIS envoyée au navigateur : seul "coachDraft.generate" (action
 * Convex) l'injecte dans le prompt, en tête d'appel et identique à chaque
 * appel pour profiter du cache de prompt.
 */
`;

/**
 * Contenu complet du module TypeScript pour un .md donné — déterministe :
 * même entrée, même sortie, octet pour octet (exporté pour le test de garde).
 */
export function renderGuideModule(markdown) {
	if (!markdown.includes('# Guide de style des retours G-Flux')) {
		throw new Error('Refus : le contenu ne ressemble pas au guide de style des retours G-Flux.');
	}
	return `${HEADER}export const COACH_DRAFT_STYLE_GUIDE = ${JSON.stringify(markdown)};\n`;
}

function main() {
	const markdown = readFileSync(join(root, GUIDE_MD), 'utf8');
	const expected = renderGuideModule(markdown);
	const current = readFileSync(join(root, GUIDE_MODULE), 'utf8');
	if (current === expected) {
		console.log(`✓ ${GUIDE_MODULE} déjà à jour avec ${GUIDE_MD}.`);
		return;
	}
	writeFileSync(join(root, GUIDE_MODULE), expected, 'utf8');
	console.log(`→ ${GUIDE_MODULE} régénéré depuis ${GUIDE_MD}.`);
}

if (process.argv[1] && decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
	try {
		main();
	} catch (error) {
		console.error(`⛔ ${error.message}`);
		process.exitCode = 1;
	}
}
