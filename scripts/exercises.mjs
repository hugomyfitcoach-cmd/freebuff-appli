#!/usr/bin/env node
/**
 * scripts/exercises.mjs — Registre / Exercise DB G-FLUX
 *
 * Scanne les dossiers static/exercises/&lt;slug&gt;/ (leur exercise.json), valide
 * chaque dossier contre le standard docs/exercise-db-standard.md et génère
 * static/exercises/index.json.
 *
 * Le registre est GÉNÉRÉ : ne jamais l'éditer à la main. Règle du projet :
 * chaque nouvel exercice est enregistré en relançant ce script.
 *
 * Usage :
 *   node scripts/exercises.mjs            # valide + (ré)écrit index.json
 *   node scripts/exercises.mjs --check    # validation seule (exit 1 si non conforme)
 *   node scripts/exercises.mjs --report   # diagnostic détaillé de chaque dossier
 *
 * Fichier temporaire détecté ? Fichier livrable manquant ? status "validated"
 * sans livrables ? slug ≠ dossier ? → exit 1, index.json non réécrit.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = process.cwd();
const DIR = join(ROOT, 'static', 'exercises');
const INDEX = join(DIR, 'index.json');

// Fichiers interdits dans le livrable final (temporaires de contrôle/test,
// variantes vidéo multiples) — standard G-FLUX, jamais dans un dossier validé.
const FORBIDDEN = [
	'_check.html',
	/check\.(html|png|jpg|jpeg)$/i,
	/-check\.(html|png|jpg|jpeg)$/i,
	/^animation-.*\.mp4$/i,
	/^animation\.webm$/i,
	/\.tmp$/i,
	/^scratch\./i,
];

// Livrables obligatoires au niveau du dossier.
// RÈGLE G-FLUX : `animation.mp4` est le média principal et canonique — il est
// affiché directement dans la recherche, la bibliothèque et la fiche détail.
// `poster.webp` est un asset OPTIONNEL / legacy : jamais requis pour valider
// un exercice (l'application ne doit pas en dépendre).
const REQUIRED_FILES = ['animation.mp4', 'exercise.json', 'README.md'];
const OPTIONAL_FILES = ['poster.webp'];

/** @param {string} s */
const slugify = (s) =>
	s
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

/** @param {string} msg */
const fail = (msg) => {
	console.error(`❌ ${msg}`);
	process.exitCode = 1;
};

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const REPORT = args.includes('--report');

if (!existsSync(DIR)) fail(`Dossier introuvable : ${DIR}`);

const rows = [];
/** Identités normalisées du registre (nameFr + nameEn) pour l'anti-doublon. */
const registryIdentities = [];

for (const entry of readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.'))) {
	const slug = entry.name;
	const dir = join(DIR, slug);
	const problems = [];
	const notes = [];
	const files = readdirSync(dir);

	// ── 1. Aucun fichier interdit (temporaires de contrôle, variantes vidéo)
	const forbidden = files.filter((f) => FORBIDDEN.some((rule) => (rule instanceof RegExp ? rule.test(f) : rule === f)));
	if (forbidden.length) problems.push(`fichiers interdits dans le livrable : ${forbidden.join(', ')} (à supprimer avant validation finale)`);

	// ── 2. Livrables obligatoires présents (+ poster optionnel noté)
	const missing = REQUIRED_FILES.filter((f) => !files.includes(f));
	if (missing.length) problems.push(`livrables manquants : ${missing.join(', ')}`);
	if (!existsSync(join(dir, 'animation.mp4')) || !statSync(join(dir, 'animation.mp4')).size) {
		if (files.includes('animation.mp4')) problems.push('animation.mp4 vide');
	}
	for (const opt of OPTIONAL_FILES) {
		if (!files.includes(opt)) notes.push(`${opt} absent — asset optionnel (l'animation.mp4 est le média canonique affiché partout)`);
	}

	// ── 3. exercise.json valide et complet
	let ex = null;
	const jsonPath = join(dir, 'exercise.json');
	if (!files.includes('exercise.json')) {
		problems.push('exercise.json absent (impossible de valider le contenu)');
	} else {
		try {
			ex = JSON.parse(readFileSync(jsonPath, 'utf8'));
			if (ex.slug !== slug) problems.push(`slug "${ex.slug}" ≠ nom du dossier "${slug}"`);
			for (const key of ['nameFr', 'category', 'primaryMuscleGroup', 'description']) {
				if (!ex[key] || !String(ex[key]).trim()) problems.push(`exercise.json : champ requis manquant « ${key} »`);
			}
			for (const key of ['execution', 'cues', 'mistakes']) {
				if (!Array.isArray(ex[key]) || ex[key].length === 0) problems.push(`exercise.json : « ${key} » doit être une liste non vide`);
			}
			if (!ex.breathing?.eccentric || !ex.breathing?.concentric) problems.push('exercise.json : « breathing.eccentric / breathing.concentric » requis');
			const status = ex.status ?? 'draft';
			if (!['draft', 'in-review', 'validated'].includes(status)) {
				problems.push(`exercise.json : status "${status}" inconnu (draft | in-review | validated)`);
			} else if (status === 'validated') {
				// Un dossier « validated » n'a pas le droit à l'approximation.
				if (missing.length) problems.push('status "validated" mais livrables manquants');
				if (forbidden.length) problems.push('status "validated" mais fichiers interdits présents');
				if (ex.version === undefined) notes.push('version absente — conseil : poser "version": 1');
			}
			// Chemins du bloc assets cohérents avec les fichiers réellement présents
			if (ex.assets) {
				for (const k of ['poster', 'animation']) {
					const v = ex.assets[k];
					if (v && !files.includes(v)) problems.push(`exercise.json : assets.${k} = "${v}" introuvable dans le dossier`);
				}
			}
		} catch (e) {
			problems.push(`exercise.json : JSON invalide (${e.message})`);
		}
	}

	// ── 4. README.md non vide
	if (files.includes('README.md')) {
		const readme = readFileSync(join(dir, 'README.md'), 'utf8');
		if (!readme.trim()) problems.push('README.md vide');
	}

	// ── 5. Identités collectées — les contrôles anti-doublon s'exécutent en
	// fin de passe, une fois le registre entier connu (voir bloc ci-dessous).
	if (ex?.nameFr) registryIdentities.push({ slug, field: 'nameFr', value: ex.nameFr });
	if (ex?.nameEn && ex.nameEn !== ex.nameFr) registryIdentities.push({ slug, field: 'nameEn', value: ex.nameEn });

	rows.push({ slug, ex, problems, notes, files });
}

/* ── Contrôle anti-doublon à l'échelle du registre ──
 *
 * POLITIQUE (sept. 2026) : le contrôle SIGNALE, il ne supprime jamais.
 *   - BLOQUANT (doublon technique uniquement) : même slug ou même identité
 *     normalisée — deux nameFr identiques ou deux nameEn identiques ;
 *   - WARNING informatif (validation humaine conseillée, JAMAIS bloquant) :
 *     identités FR↔EN croisées, noms « proches » une fois le vocabulaire
 *     matériel retiré (mini band, bande, dumbbell…) ;
 *   - une variante de prise, d'angle, de position, d'amplitude, de matériel
 *     ou d'exécution est AUTORISÉE ;
 *   - ce contrôle porte sur le registre local G-FLUX uniquement : il ne
 *     touche JAMAIS l'ExerciseDB historique (aucune suppression, fusion ou
 *     remplacement automatique d'une entrée existante).
 */
const byIdentity = new Map();
for (const it of registryIdentities) {
	const key = `${it.field}:${slugify(it.value)}`;
	const prev = byIdentity.get(key);
	const row = rows.find((r) => r.slug === it.slug);
	if (prev && prev.slug !== it.slug) {
		row?.problems.push(`${it.field} « ${it.value} » déjà utilisé par « ${prev.slug} » (doublon technique)`);
	} else {
		byIdentity.set(key, { slug: it.slug, value: it.value });
	}
}

/** Nom « cœur » : vocabulaire générique de matériel retiré (détection souple). */
const FILLER = new Set(['band', 'bande', 'mini', 'with', 'avec', 'resistance', 'dumbbell', 'halteres']);
const coreOf = (value) => slugify(value).split('-').filter((t) => t && !FILLER.has(t)).join('-');
const byCore = new Map();
for (const it of registryIdentities) {
	const core = coreOf(it.value);
	if (!core) continue;
	const prev = byCore.get(core);
	const row = rows.find((r) => r.slug === it.slug);
	if (prev && prev.slug !== it.slug) {
		row?.notes.push(
			`« ${it.value} » proche de « ${prev.value} » (${prev.slug}) — variante autorisée, validation humaine conseillée (jamais bloquante)`
		);
	} else {
		byCore.set(core, { slug: it.slug, value: it.value });
	}
}

if (REPORT) {
	for (const { slug, ex, problems, notes, files } of rows) {
		console.log(`\n${slug}`);
		console.log(`  statut       : ${ex?.status ?? 'draft (implicite)'}`);
		console.log(`  version      : ${ex?.version ?? '—'}`);
		console.log(`  fichiers     : ${files.join(', ')}`);
		if (problems.length) for (const p of problems) console.log(`  ❌ ${p}`);
		if (notes.length) for (const n of notes) console.log(`  ⚠️  ${n}`);
		if (!problems.length && !notes.length) console.log('  ✅ conforme au standard');
	}
}

// ── Résultat global + écriture du registre
const ok = rows.filter((r) => !r.problems.length);
const ko = rows.filter((r) => r.problems.length);
console.log(`\n${ok.length} exercice(s) conforme(s), ${ko.length} en erreur.`);

if (ko.length) {
	if (!REPORT) for (const { slug, problems } of ko) for (const p of problems) fail(`${slug} : ${p}`);
	console.error('\nCorrige les erreurs ci-dessus puis relance. index.json non réécrit.');
	process.exit(1);
}

if (CHECK_ONLY) {
	console.log('✔ Registre conforme (--check : aucune écriture).');
	process.exit(0);
}

const index = {
	generatedAt: new Date().toISOString(),
	standard: 'docs/exercise-db-standard.md',
	count: rows.length,
	exercises: rows.map(({ ex }) => ({
		slug: ex.slug,
		nameFr: ex.nameFr,
		nameEn: ex.nameEn ?? ex.nameFr,
		category: ex.category,
		primaryMuscleGroup: ex.primaryMuscleGroup,
		primaryMuscles: ex.primaryMuscles ?? [],
		secondaryMuscles: ex.secondaryMuscles ?? [],
		equipment: ex.equipment ?? [],
		level: ex.level ?? [],
		status: ex.status ?? 'draft',
		version: ex.version ?? 1,
		assets: {
			animation: ex.assets?.animation ?? 'animation.mp4',
			// Poster listé UNIQUEMENT s'il existe réellement (asset optionnel).
			...(ex.assets?.poster ? { poster: ex.assets.poster } : {}),
		},
		posterUrl: ex.assets?.poster ? `/exercises/${ex.slug}/${ex.assets.poster}` : undefined,
		animationUrl: `/exercises/${ex.slug}/${ex.assets?.animation ?? 'animation.mp4'}`,
		isNew: ex.status === 'validated' && ex.integratedAt == null,
	})),
};

writeFileSync(INDEX, JSON.stringify(index, null, 2) + '\n');
console.log(`✔ Registre écrit : ${INDEX} (${index.count} exercice(s)) — ${index.exercises.filter((e) => e.isNew).length} nouveau(x).`);
