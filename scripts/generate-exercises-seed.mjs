#!/usr/bin/env node
/**
 * Générateur du module de SEED embarqué — bibliothèque officielle G-FLUX.
 *
 * Transforme le registre du dépôt (static/exercises/index.json + exercise.json
 * de chaque dossier) en module TypeScript embarqué
 * (`src/convex/exercisesSeedData.ts`) que `previewSeed.ts` consomme pour
 * peindre la table `exercises` de chaque Convex PREVIEW.
 *
 * Données de RÉFÉRENCE uniquement : aucune cliente, aucun compte, aucun
 * programme assigné, aucun historique — la bibliothèque n'est PAS une donnée
 * personnelle (elle est aussi reconstruite chez chaque cliente par la logique
 * coach → copie).
 *
 * MÉDIAS : les URLs sont RELATIVES au dépôt (`/exercises/<slug>/poster.webp`,
 * `/exercises/<slug>/animation.mp4`) — servies par chaque déploiement Netlify
 * (vérifié : mêmes octets en prod et en preview). AUCUN Storage ID Convex
 * prod n'est copié : rien de spécifique à un déploiement ne passe ici.
 *
 * Usage : node scripts/generate-exercises-seed.mjs [--check]
 *  - sans flag   : (ré)génère le module ;
 *  - --check     : exit 1 si le module est périmé (utilisé par les tests).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = join(ROOT, 'static', 'exercises', 'index.json');
const OUT_PATH = join(ROOT, 'src', 'convex', 'exercisesSeedData.ts');

const CHECK = process.argv.includes('--check');

if (!existsSync(INDEX_PATH)) {
	console.error('❌ Registre introuvable : static/exercises/index.json — lance d\'abord `npm run exercises`.');
	process.exit(1);
}

const registry = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
const entries = (registry.exercises ?? []).filter((e) => e.status === 'validated');

const items = [];
for (const entry of entries) {
	const detailPath = join(ROOT, 'static', 'exercises', entry.slug, 'exercise.json');
	if (!existsSync(detailPath)) {
		console.error(`❌ ${entry.slug} : exercise.json introuvable.`);
		process.exit(1);
	}
	const d = JSON.parse(readFileSync(detailPath, 'utf8'));
	items.push({
		sourceExerciseId: entry.slug,
		name: entry.nameFr,
		sourceName: entry.nameEn ?? entry.nameFr,
		muscleGroup: entry.primaryMuscleGroup,
		secondaryMuscles: entry.secondaryMuscles ?? [],
		bodyPart: entry.category,
		equipment: entry.equipment?.[0],
		instructions: d.execution ?? [],
		cues: d.cues ?? [],
		mistakes: d.mistakes ?? [],
		levels: d.level ?? [],
		breathing: d.breathing ?? {},
		posterUrl: entry.posterUrl,
		animationUrl: entry.animationUrl,
	});
}

/** Sérialise un objet JS en littéral TypeScript stable (indentation 1 tab). */
function ser(v, indent = 1) {
	const pad = '\t'.repeat(indent);
	const padIn = '\t'.repeat(indent + 1);
	if (v === null) return 'null';
	if (typeof v === 'string') return JSON.stringify(v);
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	if (Array.isArray(v)) {
		if (v.length === 0) return '[]';
		return `[\n${v.map((x) => `${padIn}${ser(x, indent + 1)}`).join(',\n')},\n${pad}]`;
	}
	if (typeof v === 'object') {
		const keys = Object.keys(v).filter((k) => v[k] !== undefined);
		if (keys.length === 0) return '{}';
		return `{\n${keys.map((k) => `${padIn}${JSON.stringify(k)}: ${ser(v[k], indent + 1)}`).join(',\n')},\n${pad}}`;
	}
	throw new Error(`Type non sérialisable : ${typeof v}`);
}

const header = `/**
 * GÉNÉRÉ par scripts/generate-exercises-seed.mjs — NE PAS ÉDITER À LA MAIN.
 * Source de vérité : static/exercises/ (registre + exercise.json par slug).
 *
 * Bibliothèque officielle G-FLUX embarquée pour le SEED des Convex PREVIEW
 * (previewSeed.ts). Données de RÉFÉRENCE uniquement — aucune donnée
 * personnelle. Médias : URLs relatives au dépôt, servies par chaque
 * déploiement Netlify (aucun Storage ID Convex, rien de spécifique à la prod).
 */

export const GFLUX_OFFICIAL_SOURCE = "gflux-official";

export const GFLUX_OFFICIAL_LICENSE =
	"Bibliothèque officielle G-FLUX — média propriétaire (dépôt), art direction femme athlétique";

export type SeedExercise = {
	sourceExerciseId: string;
	name: string;
	sourceName: string;
	muscleGroup: string;
	secondaryMuscles: string[];
	bodyPart: string;
	equipment: string;
	instructions: string[];
	cues: string[];
	mistakes: string[];
	levels: string[];
	breathing: { eccentric?: string; concentric?: string };
	posterUrl: string;
	animationUrl: string;
};

/** ${items.length} exercices validés du registre. */
export const GFLUX_OFFICIAL_EXERCISES: SeedExercise[] = [`;

const footer = `\n];
`;

const body = items.map((it) => `${'\t'}${ser(it, 1)}`).join(',\n');
const out = `${header}\n${body}\n${footer}`;

if (CHECK) {
	if (!existsSync(OUT_PATH)) {
		console.error('❌ Module de seed absent — lance `node scripts/generate-exercises-seed.mjs`.');
		process.exit(1);
	}
	const current = readFileSync(OUT_PATH, 'utf8');
	if (current !== out) {
		console.error('❌ src/convex/exercisesSeedData.ts est PÉRIMÉ — relance `node scripts/generate-exercises-seed.mjs`.');
		process.exit(1);
	}
	console.log(`✔ exercisesSeedData.ts à jour (${items.length} exercices).`);
	process.exit(0);
}

writeFileSync(OUT_PATH, out);
console.log(`✅ ${OUT_PATH.replace(ROOT + '/', '')} généré : ${items.length} exercices officiels embarqués.`);
