/**
 * Tests — SEED PREVIEW de la bibliothèque officielle G-FLUX.
 *
 * Garde-fous :
 * 1. Module embarqué généré à jour avec le registre static/exercises/ ;
 * 2. previewSeed.ts : upsert idempotent (source+slug), ID portable identique
 *    à l'import prod (sha256 source:slug → ex_+20hex), réactivation douce,
 *    verrou anti-prod, aucun ID Storage Convex copié ;
 * 3. Données de référence UNIQUEMENT : aucun client, aucun compte réel,
 *    aucun programme assigné réel, aucun historique ;
 * 4. Médias sûrs : URLs relatives au dépôt servies par chaque Netlify,
 *    jamais un Storage ID spécifique à un déploiement ;
 * 5. Programme + assignation de test seedés (parcours complet testable).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seed = readFileSync(join(root, 'src/convex/previewSeed.ts'), 'utf8');
const seedDataPath = join(root, 'src/convex/exercisesSeedData.ts');

/* ─── 1) Le module embarqué est à jour avec le registre ─── */

test('exercisesSeedData.ts est à jour avec static/exercises (générateur --check)', () => {
	const out = execFileSync('node', [join(root, 'scripts/generate-exercises-seed.mjs'), '--check'], {
		cwd: root,
		encoding: 'utf8',
	});
	assert.match(out, /à jour/);
});

test('module embarqué : ≥ 30 exercices validés, champs obligatoires présents', async () => {
	const { GFLUX_OFFICIAL_EXERCISES } = await import(seedDataPath);
	assert.ok(GFLUX_OFFICIAL_EXERCISES.length >= 30, `34 attendus, reçu ${GFLUX_OFFICIAL_EXERCISES.length}`);
	const slugs = new Set();
	for (const e of GFLUX_OFFICIAL_EXERCISES) {
		assert.ok(e.sourceExerciseId, 'slug requis');
		assert.ok(e.name.length >= 2, 'nom requis');
		assert.ok(e.muscleGroup, 'groupe musculaire requis (filtre coach)');
		assert.ok(e.equipment, 'équipement requis (filtre coach)');
		assert.ok(e.posterUrl?.startsWith('/exercises/'), 'poster = URL relative dépôt');
		assert.ok(e.animationUrl?.startsWith('/exercises/'), 'animation = URL relative dépôt');
		assert.ok(Array.isArray(e.instructions) && e.instructions.length > 0, 'pédagogie embarquée');
		slugs.add(e.sourceExerciseId);
	}
	assert.equal(slugs.size, GFLUX_OFFICIAL_EXERCISES.length, 'aucun slug dupliqué (idempotence)');
});

/* ─── 2) previewSeed : mécanique d'upsert idempotent ─── */

test('previewSeed : upsert par (source, sourceExerciseId) — jamais de doublon', () => {
	assert.ok(seed.includes('by_source_id'), 'recherche par index (source, slug)');
	assert.ok(seed.includes('GFLUX_OFFICIAL_SOURCE').valueOf && seed.match(/withIndex\("by_source_id"/), 'index utilisé');
	assert.ok(seed.includes('unchanged++'), '3 états : importé / maj / inchangé (idempotent)');
	assert.ok(!/insert\("exercises"[\s\S]{0,400}insert\("exercises"/.test(seed), 'pas de double insertion par item');
});

test('previewSeed : ID portable = MÊME algorithme que exercises.ts (sha256 source:slug)', () => {
	assert.ok(seed.includes('stableSeedGfluxId'), 'fonction dédiée');
	assert.match(seed, /sha-256|SHA-256/, 'sha256');
	assert.match(seed, /ex_\$\{hex\.slice\(0, 20\)\}/, 'format ex_ + 20 hex identique à stableGfluxId');
	const prodEx = readFileSync(join(root, 'src/convex/exercises.ts'), 'utf8');
	assert.ok(prodEx.includes('return `ex_${hex.slice(0, 20)}`;'), 'le format prod est bien celui-là');
});

test('previewSeed : verrou anti-prod actif sur les deux variantes de seed', () => {
	assert.match(seed, /assertNotProd\(\)/);
	assert.ok(seed.includes('PROD_URL_MARK = "calm-jaguar-475"'), 'marqueur prod verrouillé');
	const calls = (seed.match(/assertNotProd\(\)/g) ?? []).length;
	assert.ok(calls >= 3, 'appelé dans seedPreviewData + seedPreviewDataInternal + httpAction');
});

test('previewSeed : réactivation douce (active) sans toucher hidden coach', () => {
	assert.match(seed, /if \(!existing\.active\) patch\.active = true/, 'réactivation si inactive');
	assert.ok(!/hidden: (true|false)/.test(seed), 'hidden coach jamais écrit par le seed');
});

/* ─── 3) Données de référence uniquement ─── */

test('previewSeed : AUCUNE donnée personnelle copiée (tables interdites absentes)', () => {
	for (const forbidden of [
		'bodyMetrics', 'progressPhotos', 'checkins', 'coachMessages',
		'coachResources', 'intakes', 'appointments', 'pushSubscriptions', 'foodPortions',
		'favorites', 'meals', 'trainingSetLogs', 'sportActivities', 'coachNotifications',
	]) {
		assert.ok(!seed.includes(`"${forbidden}"`), `table interdite : ${forbidden}`);
	}
	// Tables autorisées : users (comptes FICTIFS), exercises, training* (programme test).
	assert.ok(seed.includes('"exercises"'), 'bibliothèque seedée');
	// diaryEntries : uniquement le journal FICTIF du compte de test (comportement
	// préexistant du seed — 2 lignes Ciqual pour la cliente bêta), jamais une copie.
	assert.match(seed, /db\.insert\("diaryEntries"/);
	assert.ok(!/calm-jaguar-475[^"]*"\s*,\s*\{?[\s\S]{0,80}diaryEntries/.test(seed), 'aucune provenance prod');
});

test('previewSeed : comptes de test fictifs uniquement (@example.com / allowlist)', () => {
	assert.ok(seed.includes('preview-test-coach@example.com'), 'coach fictif');
	assert.ok(seed.includes('contact@myfit-coach.fr'), 'cliente bêta allowlist IA (compte de test documenté)');
	assert.ok(!seed.includes('passwordHash: "'), 'aucun hash codé en dur (hashage à la volée)');
});

/* ─── 4) Médias sûrs ─── */

test('médias : URLs relatives au dépôt — aucun Storage ID Convex copié', () => {
	assert.ok(!/v\.id\("_storage"\)|storageId/.test(seed), 'aucun storageId dans le seed');
	const data = readFileSync(seedDataPath, 'utf8');
	assert.ok(!data.includes('storage'), 'aucune référence storage dans les données embarquées');
	assert.match(data, /"posterUrl": "\/exercises\//, 'posters = chemins dépôt');
	assert.match(data, /"animationUrl": "\/exercises\//, 'animations = chemins dépôt');
});

/* ─── 5) Programme de test + assignation (parcours complet) ─── */

test('previewSeed : programme de test + séance + exercices + séries + assignation', () => {
	assert.ok(seed.includes('seedTestProgram'), 'fonction seed programme de test');
	assert.ok(seed.includes('trainingPrograms'), 'programme modèle créé');
	assert.ok(seed.includes('trainingSessions'), 'séance créée');
	assert.ok(seed.includes('trainingSessionExercises'), 'exercices de séance');
	assert.ok(seed.includes('trainingSets'), 'séries prescrites');
	assert.ok(seed.includes('trainingAssignments'), 'assignation vers la cliente bêta');
	assert.ok(seed.includes('trainingScheduledSessions'), 'occurrences planifiées');
	assert.ok(seed.includes('alreadyAssigned'), 'idempotent : pas de doublon d\u2019assignation au re-run');
});

test('script de secours : annonce la bibliothèque + programme de test', () => {
	const script = readFileSync(join(root, 'scripts/seed-preview.mjs'), 'utf8');
	assert.ok(script.includes('Bibliothèque officielle'), 'compte rendu exercices');
	assert.ok(script.includes('Haut du corps'), 'compte rendu programme de test');
});
