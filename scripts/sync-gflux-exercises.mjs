#!/usr/bin/env node
/**
 * Synchronisation de la bibliothèque officielle G-FLUX → Exercise DB.
 *
 * Lit le registre généré `static/exercises/index.json` (produit par
 * `npm run exercises`) et pousse chaque exercice propriétaire validé vers
 * la table Convex `exercises` — LA bibliothèque unique consommée partout
 * dans l'application (CRM, éditeur de programmes, picker). Aucune
 * bibliothèque parallèle : le modèle, l'upsert idempotent et le frontend
 * existants sont réutilisés tels quels.
 *
 * Principes (identiques à scripts/import-exercises.mjs) :
 *   - reconnaissance par (source, sourceExerciseId) — ici
 *     source = "gflux-official" et sourceExerciseId = slug du dossier ;
 *   - idempotent : un ré-sync MET À JOUR au lieu de dupliquer ;
 *   - ne supprime JAMAIS : retirer un exercice du registre (ou le repasser
 *     en draft) le masque des résultats (active=false) — les programmes qui
 *     le référencent restent intacts ;
 *   - les médias vivent dans le DÉPÔT (poster.webp / animation.mp4 servis
 *     par /exercises/<slug>/…) : aucun binaire en base, seules les URLs
 *     internes sont enregistrées ;
 *   - la coach garde la main : un masquage manuel (hidden) n'est jamais
 *     écrasé, un renommage (`name` édité) est signalé puis RESPECTÉ
 *     (l'officialName conserve la référence du registre).
 *
 * Usage :
 *   npm run exercises:sync              # valide + synchronise (auth coach)
 *   npm run exercises:sync -- --check   # vérification sans écriture (exit 1 si écart)
 *   npm run exercises:sync -- --dry-run # aperçu de la conversion, aucun envoi
 *
 * Requiert .env.local : PUBLIC_CONVEX_URL + COACH_EMAIL / COACH_PASSWORD.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = join(ROOT, 'static', 'exercises', 'index.json');
const SOURCE_ID = 'gflux-official';
const LICENSE_NOTE = 'Bibliothèque officielle G-FLUX — média propriétaire (dépôt), art direction femme athlétique';
const BATCH_SIZE = 100;

const CHECK = process.argv.includes('--check');
const DRY_RUN = process.argv.includes('--dry-run');

/* ── Registre (généré) ── */

if (!existsSync(INDEX_PATH)) {
	console.error('❌ Registre introuvable : static/exercises/index.json — lance d\'abord `npm run exercises`.');
	process.exit(1);
}

const registry = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
const entries = (registry.exercises ?? []).filter((e) => e.status === 'validated');
const drafts = (registry.exercises ?? []).filter((e) => e.status !== 'validated');

if (entries.length === 0) {
	console.log('ℹ️  Aucun exercice validé dans le registre — rien à synchroniser.');
}
if (drafts.length) {
	console.log(`ℹ️  ${drafts.length} exercice(s) non validé(s) ignoré(s) : ${drafts.map((d) => d.slug).join(', ')}.`);
}

/** Convertit une entrée du registre vers le modèle G-FLUX de la table `exercises`. */
function toGfluxOfficial(entry) {
	return {
		sourceExerciseId: entry.slug,
		// Nom d'affichage G-FLUX : le nom français du registre (le nom EN est
		// conservé dans sourceName — même convention que les autres imports).
		name: entry.nameFr,
		sourceName: entry.nameEn ?? entry.nameFr,
		muscleGroup: entry.primaryMuscleGroup,
		secondaryMuscles: entry.secondaryMuscles ?? [],
		bodyPart: entry.category,
		equipment: entry.equipment?.[0],
		// `instructions` est le champ que le frontend affiche (« Exécution ») ;
		// les étapes du registre le portent. Cues/mistakes/respiration sont
		// des champs dédiés du modèle (bloc pédagogique officiel).
		instructions: undefined, // rempli ci-dessous depuis exercise.json
		posterUrl: entry.posterUrl,
		animationUrl: entry.animationUrl,
	};
}

/* ── Env + auth (même mécanique que les autres scripts) ── */

function loadEnvLocal() {
	const file = join(ROOT, '.env.local');
	if (!existsSync(file)) return {};
	const env = {};
	for (const line of readFileSync(file, 'utf8').split('\n')) {
		const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line.trim());
		if (!m) continue;
		let value = m[2].trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		env[m[1]] = value;
	}
	return env;
}

const env = loadEnvLocal();
const CONVEX_URL = env.PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL;
const EMAIL = env.COACH_EMAIL ?? process.env.COACH_EMAIL;
const PASSWORD = env.COACH_PASSWORD ?? process.env.COACH_PASSWORD;

if (!CONVEX_URL || !EMAIL || !PASSWORD) {
	console.error('❌ PUBLIC_CONVEX_URL + COACH_EMAIL / COACH_PASSWORD requis dans .env.local.');
	process.exit(1);
}

const { ConvexClient } = await import('convex/browser');
const client = new ConvexClient(CONVEX_URL);

let exitCode = 0;

try {
	// 1) Lecture du contenu pédagogique complet dans chaque exercise.json
	//    (le registre porte l'identité + les médias ; les données
	//    pédagogiques restent la source unique du dossier de l'exercice).
	const items = [];
	for (const entry of entries) {
		const detailPath = join(ROOT, 'static', 'exercises', entry.slug, 'exercise.json');
		if (!existsSync(detailPath)) {
			console.error(`❌ ${entry.slug} : exercise.json introuvable — relance \`npm run exercises\`.`);
			exitCode = 1;
			continue;
		}
		const detail = JSON.parse(readFileSync(detailPath, 'utf8'));
		const item = toGfluxOfficial(entry);
		item.instructions = detail.execution ?? [];
		item.cues = detail.cues ?? [];
		item.mistakes = detail.mistakes ?? [];
		item.levels = detail.level ?? [];
		item.breathing = detail.breathing ?? {};
		items.push(item);
	}
	if (!items.length) {
		await client.close();
		process.exit(exitCode || 0);
	}

	// 2) Connexion coach (l'import est une écriture coach authentifiée).
	const signIn = await client.mutation('users:signIn', { email: EMAIL, password: PASSWORD });
	const token = signIn.token;
	console.log(`🔐 Session coach OK (${EMAIL}).`);

	if (DRY_RUN) {
		console.log('🧪 DRY RUN — aperçu de la conversion :');
		for (const s of items.slice(0, 2)) console.log(JSON.stringify(s, null, 2));
		console.log(`Aucun envoi. ${items.length} exercice(s) seraient synchronisés.`);
		await client.close();
		process.exit(0);
	}

	// 3) Vérification (--check) : compare l'état de la base au registre.
	if (CHECK) {
		// Lecture seule → appelée comme query Convex (pas une mutation).
		const check = await client.query('exercises:verifyGfluxOfficialSync', { sessionToken: token, items });
		const issues = [
			...check.missing.map((s) => `absent de la Exercise DB : ${s}`),
			...check.outdated.map((s) => `données à mettre à jour : ${s}`),
			...check.inactive.map((s) => `désactivé en base : ${s}`),
		];
		if (issues.length) {
			for (const issue of issues) console.error(`  ⚠️  ${issue}`);
			console.error(`❌ ${issues.length} écart(s) entre le registre et la Exercise DB — relance \`npm run exercises:sync\`.`);
			await client.close();
			process.exit(1);
		}
		console.log(`✔ Les ${items.length} exercice(s) du registre sont synchronisés dans la Exercise DB (--check).`);
		await client.close();
		process.exit(0);
	}

	// 4) Sync par lots (mutation authentifiée, upsert idempotent).
	const batchTag = `${SOURCE_ID}@${new Date().toISOString().slice(0, 10)}`;
	let synced = 0;
	let deactivated = 0;
	const errors = [];
	for (let i = 0; i < items.length; i += BATCH_SIZE) {
		const batch = items.slice(i, i + BATCH_SIZE);
		const out = await client.mutation('exercises:importBatch', {
			sessionToken: token,
			source: SOURCE_ID,
			importBatch: batchTag,
			licenseNote: LICENSE_NOTE,
			items: batch,
		});
		synced += out.imported + out.updated + out.unchanged;
		errors.push(...out.errors);
		console.log(`   … ${Math.min(i + BATCH_SIZE, items.length)}/${items.length} (importés ${out.imported}, maj ${out.updated}, inchangés ${out.unchanged})`);
	}

	// 5) Désactivation douce des exercices officiels absents du registre
	//    (retiré du dépôt ou repassé en draft) — JAMAIS de suppression :
	//    les programmes existants qui les référencent restent intacts.
	const off = await client.mutation('exercises:deactivateMissingGfluxOfficial', {
		sessionToken: token,
		keepSlugs: items.map((i) => i.sourceExerciseId),
	});
	deactivated = off.deactivated;

	console.log('\n════════ RÉSUMÉ DE LA SYNCHRO ════════');
	console.log(`  Source        : ${SOURCE_ID}`);
	console.log(`  Synchronisés  : ${synced}/${items.length}`);
	console.log(`  Désactivés    : ${deactivated} (absents du registre — réversible)`);
	console.log(`  Erreurs       : ${errors.length}`);
	for (const err of errors.slice(0, 10)) console.log(`   - ${err.sourceExerciseId}: ${err.error}`);
	console.log('══════════════════════════════════════');
	if (errors.length) exitCode = 1;
} catch (e) {
	console.error('⛔ Synchro interrompue :', e?.message ?? e);
	exitCode = 1;
} finally {
	await client.close();
}
process.exit(exitCode);
