#!/usr/bin/env node
/**
 * GÉNÉRATION DE LA COPIE SERVEUR DE LA MÉTHODE G-FLUX.
 *
 * La source unique est éditoriale : `docs/methode-gflux.md` (déposé par Hugo).
 * Une action Convex ne peut pas lire le disque : ce script fabrique donc le
 * module TypeScript `src/convex/ai/methodeGflux.ts` qui embarque le contenu
 * du .md, octet pour octet.
 *
 *  - lancé automatiquement avant chaque build (`npm run build`) ;
 *  - `npm test` refuse de passer si le fichier diffère de ce générateur
 *    (tests/mission-coach-draft-m2) — jamais l'inverse : on n'édite que le .md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Chemins relatifs : la source éditoriale et la copie serveur générée. */
export const METHOD_MD = 'docs/methode-gflux.md';
export const METHOD_MODULE = 'src/convex/ai/methodeGflux.ts';

/** En-tête du module généré — avertissements conservés dans le fichier produit. */
const HEADER = `/**
 * RÉFÉRENTIEL DE MÉTHODE G-FLUX — FICHIER GÉNÉRÉ, NE PAS ÉDITER.
 *
 * Source de vérité unique : "docs/methode-gflux.md" (déposé par Hugo).
 * Régénéré par "scripts/gen-methode-gflux.mjs", exécuté automatiquement avant
 * chaque build. Toute modification se fait dans le .md uniquement ; un test
 * (mission-coach-draft-m2) échoue si ce fichier diffère du générateur ou du .md.
 *
 * Copie serveur embarquée exacte du .md (une action Convex ne lit pas le
 * disque). JAMAIS envoyée au navigateur : seul "coachDraft.generate" (action
 * Convex) l'injecte dans le prompt — un test de garde le vérifie aussi.
 */
`;

/**
 * Contenu complet du module TypeScript pour un .md donné — déterministe :
 * même entrée, même sortie, octet pour octet (exporté pour le test de garde).
 */
export function renderMethodModule(markdown) {
	if (!markdown.includes('# Référentiel méthode G-Flux')) {
		throw new Error('Refus : le contenu ne ressemble pas au référentiel méthode G-Flux.');
	}
	return `${HEADER}export const COACH_DRAFT_METHOD_REFERENCE = ${JSON.stringify(markdown)};\n`;
}

function main() {
	const markdown = readFileSync(join(root, METHOD_MD), 'utf8');
	const expected = renderMethodModule(markdown);
	const current = readFileSync(join(root, METHOD_MODULE), 'utf8');
	if (current === expected) {
		console.log(`✓ ${METHOD_MODULE} déjà à jour avec ${METHOD_MD}.`);
		return;
	}
	writeFileSync(join(root, METHOD_MODULE), expected, 'utf8');
	console.log(`→ ${METHOD_MODULE} régénéré depuis ${METHOD_MD}.`);
}

if (process.argv[1] && decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
	try {
		main();
	} catch (error) {
		console.error(`⛔ ${error.message}`);
		process.exitCode = 1;
	}
}
