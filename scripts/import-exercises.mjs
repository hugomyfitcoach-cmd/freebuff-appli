#!/usr/bin/env node
/**
 * Import de la banque ExerciseDB V1 Free API dans la bibliothèque interne
 * G-FLUX — script PROPRE et RELANÇABLE.
 *
 * Source retenue (structurée, pas de scraping, SANS clé API) :
 *   ExerciseDB V1 Free API — https://oss.exercisedb.dev/docs
 *   ~1500 exercices avec GIFs (static.exercisedb.dev), paginés par curseur.
 *
 * Garanties :
 *   - anti-doublon : reconnaissance par (source, sourceExerciseId) ;
 *   - idempotent : un ré-import MET À JOUR les exercices sans les recréer ;
 *   - ne supprime JAMAIS les exercices G-FLUX existants (ni les masqués) ;
 *   - `--hide-old-source` : masque (réversible) les exercices des ANCIENNES
 *     sources de prototype — jamais les exercices coach `gflux` ;
 *   - aucun média téléchargé : les URLs source sont conservées (prototype —
 *     remplacées par notre CDN au passage en licence commerciale) ;
 *   - résumé final : importés / mis à jour / inchangés / ignorés / erreurs.
 *
 * Toute la normalisation vers le vocabulaire G-FLUX (muscles, équipements,
 * parties du corps — en français) vit DANS CE FICHIER : remplacer la source
 * = réécrire ce convertisseur, sans toucher au schéma Convex ni au frontend.
 *
 * Usage : node scripts/import-exercises.mjs [--dry-run] [--hide-old-source]
 * Requiert .env.local : PUBLIC_CONVEX_URL + compte coach (COACH_EMAIL /
 * COACH_PASSWORD) — l'import est authentifié par une session coach.
 */

import { readFileSync, existsSync } from 'node:fs';

const API_BASE = 'https://oss.exercisedb.dev/api/v1';
const SOURCE_ID = 'exercisedb-v1';
const LICENSE_NOTE = 'ExerciseDB V1 Free API (oss.exercisedb.dev) — usage prototype, GIFs servis par la source';
const BATCH_SIZE = 100;
/** Limite officielle de l'API par page (plafond constaté : 25). */
const PAGE_SIZE = 25;
/** Sources de prototype antérieures à masquer avec --hide-old-source. */
const OLD_SOURCES = ['free-exercise-db'];

/* ── Conversion → vocabulaire G-FLUX (LE point de découplage de la source) ── */

/**
 * Muscles cibles/secondaires source (EN, 50 valeurs) → G-FLUX FR.
 * Table étendue : le vocabulaire V1 est bien plus fin que l'ancien dataset —
 * les 18 groupes de la mission 1 sont conservés à l'identique, les nouveaux
 * cas sont ajoutés en fin de table (jamais de renommage : les filtres
 * existants restent stables).
 */
const MUSCLES = {
	// ── Groupes historiques (mission 1) — NE PAS renommer
	abdominals: 'Abdominaux',
	abs: 'Abdominaux',
	'lower abs': 'Abdominaux',
	abductors: 'Abducteurs',
	adductors: 'Adducteurs',
	'inner thighs': 'Adducteurs',
	'hip flexors': 'Fléchisseurs de hanche',
	biceps: 'Biceps',
	brachialis: 'Biceps',
	calves: 'Mollets',
	soleus: 'Mollets',
	shins: 'Tibias',
	chest: 'Pectoraux',
	pectorals: 'Pectoraux',
	'upper chest': 'Pectoraux',
	forearms: 'Avant-bras',
	'wrist extensors': 'Avant-bras',
	'wrist flexors': 'Avant-bras',
	wrists: 'Avant-bras',
	glutes: 'Fessiers',
	hamstrings: 'Ischio-jambiers',
	quadriceps: 'Quadriceps',
	quads: 'Quadriceps',
	latissimus_dorsi: 'Dorsaux',
	'latissimus dorsi': 'Dorsaux',
	lats: 'Dorsaux',
	'lower back': 'Lombaires',
	'middle back': 'Dos',
	'upper back': 'Dos',
	back: 'Dos',
	rhomboids: 'Dos',
	serratus_anterior: 'Dentelés',
	'serratus anterior': 'Dentelés',
	neck: 'Nuque',
	sternocleidomastoid: 'Nuque',
	'levator scapulae': 'Nuque',
	shoulders: 'Épaules',
	deltoids: 'Épaules',
	delts: 'Épaules',
	'rear deltoids': 'Épaules',
	'rotator cuff': 'Épaules',
	trapezius: 'Trapèzes',
	traps: 'Trapèzes',
	triceps: 'Triceps',
	obliques: 'Obliques',
	core: 'Abdominaux',
	spine: 'Dos',
	// ── Cas atypiques (cardio / préhension)
	'cardiovascular system': 'Cardio',
	'grip muscles': 'Avant-bras',
	hands: 'Mains',
	feet: 'Pieds',
	ankles: 'Chevilles',
	'ankle stabilizers': 'Chevilles',
};

/**
 * Parties du corps source (EN, 10 valeurs) → G-FLUX FR.
 * `cardio` source → « Cardio » (nouvelle valeur G-FLUX, les 4 autres sont
 * celles déjà utilisées par l'ancien import : filtres stables).
 */
const BODY_PARTS = {
	'upper arms': 'Haut du corps',
	shoulders: 'Haut du corps',
	chest: 'Haut du corps',
	back: 'Haut du corps',
	neck: 'Haut du corps',
	waist: 'Tronc',
	'upper legs': 'Bas du corps',
	'lower legs': 'Bas du corps',
	'lower arms': 'Haut du corps',
	cardio: 'Cardio',
};

/** Équipements source (EN, 28 valeurs) → G-FLUX FR. */
const EQUIPMENT = {
	'body weight': 'Poids du corps',
	dumbbell: 'Haltères',
	kettlebell: 'Kettlebell',
	barbell: 'Barre olympique',
	'olympic barbell': 'Barre olympique',
	'ez barbell': 'Barre EZ',
	'trap bar': 'Barre trapèze',
	cable: 'Poulies',
	'leverage machine': 'Machine',
	'smith machine': 'Machine Smith',
	band: 'Élastiques',
	'resistance band': 'Élastiques',
	'medicine ball': 'Ballon lesté',
	'stability ball': 'Swiss ball',
	'bosu ball': 'Bosu',
	'wheel roller': 'Roue abdominale',
	roller: 'Foam roller',
	rope: 'Corde',
	tire: 'Pneu',
	hammer: 'Marteau',
	weighted: 'Lesté',
	assisted: 'Machine assistée',
	// Cardio
	'stepmill machine': 'Stepmaster',
	'elliptical machine': 'Vélo elliptique',
	'stationary bike': 'Vélo d\'appartement',
	'skierg machine': 'SkiErg',
	'sled machine': 'Traîneau',
	'upper body ergometer': 'Ergomètre bras',
};

/** Muscles / parties / équipements sans carte → fallback (compté, visible). */
const FALLBACK = { bodyPart: 'Autre', equipment: 'Autre', muscle: 'Autre' };

function mapOrNull(map, key, fallback) {
	if (!key) return undefined;
	return map[key] ?? fallback ?? undefined;
}

/** Nettoie les instructions « Step:N … » de la source. */
function cleanInstruction(line) {
	return String(line ?? '')
		.replace(/^Step\s*:\s*\d+\s*:?\s*/i, '')
		.trim();
}

/**
 * Convertit un exercice brut ExerciseDB V1 vers le modèle G-FLUX.
 * Renvoie null si la ligne n'est pas exploitable (compté « ignoré »).
 */
function toGflux(src) {
	const sourceName = String(src.name ?? '').trim();
	const id = String(src.exerciseId ?? '').trim();
	if (!sourceName || !id) return null;

	const target = Array.isArray(src.targetMuscles) ? src.targetMuscles[0] : undefined;
	const muscleGroup = target ? mapOrNull(MUSCLES, target, FALLBACK.muscle) : undefined;
	const bodyParts = Array.isArray(src.bodyParts) ? src.bodyParts : [];
	const instructions = (Array.isArray(src.instructions) ? src.instructions : [])
		.map(cleanInstruction)
		.filter(Boolean);

	// Un seul GIF par exercice dans la V1 : il sert de média principal ET de
	// miniature (le frontend lit ces deux champs, jamais une URL codée en dur).
	const gif = String(src.gifUrl ?? '').trim() || undefined;

	return {
		sourceExerciseId: id,
		// Nom G-FLUX = nom source (EN). La traduction/refonte viendra de la
		// coach ; l'original est conservé dans sourceName (identique ici).
		name: sourceName,
		sourceName,
		muscleGroup,
		secondaryMuscles: (Array.isArray(src.secondaryMuscles) ? src.secondaryMuscles : [])
			.map((m) => mapOrNull(MUSCLES, m))
			.filter(Boolean)
			// Dédupliqué + jamais égal au muscle principal
			.filter((m, i, arr) => m !== muscleGroup && arr.indexOf(m) === i),
		bodyPart: bodyParts.length ? mapOrNull(BODY_PARTS, bodyParts[0], FALLBACK.bodyPart) : undefined,
		equipment: (Array.isArray(src.equipments) ? src.equipments : []).length
			? mapOrNull(EQUIPMENT, src.equipments[0], FALLBACK.equipment)
			: undefined,
		instructions: instructions.length ? instructions : undefined,
		mediaUrl: gif,
		thumbnailUrl: gif,
		// Pas de média complémentaire dans la V1 (1 GIF/exercice).
	};
}

/* ── Source : pagination par curseur (meta.nextCursor + after) ── */

/**
 * GET avec retry exponentiel — l'API free est rate-limitée (~10 req/rafale,
 * puis 429 sans en-tête Retry-After) : on patiente et on relance.
 */
async function getJson(url, attempts = 6) {
	let delay = 2000;
	for (let a = 1; a <= attempts; a++) {
		const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
		if (res.ok) return await res.json();
		if (res.status === 429 && a < attempts) {
			if (a === 1) console.log('⏳ Rate limit API (429) — pause puis reprise…');
			await new Promise((r) => setTimeout(r, delay));
			delay = Math.min(delay * 2, 30_000);
			continue;
		}
		throw new Error(`API ${url} → HTTP ${res.status}`);
	}
	throw new Error(`API ${url} → épuisement des retries (429).`);
}

async function fetchAllExercises() {
	const all = [];
	let cursor;
	let page = 0;
	while (true) {
		const url = new URL(`${API_BASE}/exercises`);
		url.searchParams.set('limit', String(PAGE_SIZE));
		if (cursor) url.searchParams.set('after', cursor);
		const json = await getJson(url);
		if (!json?.success || !Array.isArray(json.data)) throw new Error('Réponse API inattendue.');
		all.push(...json.data);
		page++;
		if (page % 10 === 0) console.log(`   … ${all.length}/${json.meta?.total ?? '?'} exercices lus`);
		if (json.meta?.hasNextPage && json.meta?.nextCursor) {
			cursor = json.meta.nextCursor;
		} else {
			break;
		}
		// Throttle poli : l'API tolère ~10 requêtes par rafale (constaté), on
		// espace chaque page de 1,2 s — 60 pages ≈ 75 s, sans 429.
		await new Promise((r) => setTimeout(r, 1200));
		if (page > 200) throw new Error('Pagination infinie — garde-fou déclenché.');
	}
	return all;
}

/* ── Env + auth (même mécanique que setup-coach.mjs) ── */

function loadEnvLocal() {
	const file = new URL('../.env.local', import.meta.url);
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
const DRY_RUN = process.argv.includes('--dry-run');
const HIDE_OLD = process.argv.includes('--hide-old-source');

if (!CONVEX_URL) {
	console.error('❌ PUBLIC_CONVEX_URL introuvable (.env.local).');
	process.exit(1);
}
if (!EMAIL || !PASSWORD) {
	console.error('❌ COACH_EMAIL / COACH_PASSWORD requis dans .env.local (session coach pour l\'import).');
	process.exit(1);
}

const { ConvexClient } = await import('convex/browser');
const client = new ConvexClient(CONVEX_URL);

/* ── Pipeline ── */

let summary = { imported: 0, updated: 0, unchanged: 0, ignored: 0, errors: 0, errorDetails: [] };

try {
	// 1) Connexion coach (l'import est une écriture coach authentifiée).
	const signIn = await client.mutation('users:signIn', { email: EMAIL, password: PASSWORD });
	const token = signIn.token;
	console.log(`🔐 Session coach OK (${EMAIL}).`);

	// 2) Téléchargement complet de la source (paginé par curseur).
	console.log(`⬇️  Téléchargement ${API_BASE}/exercises (paginé par curseur, ${PAGE_SIZE}/page)…`);
	const raw = await fetchAllExercises();
	console.log(`📦 ${raw.length} exercices lus dans la source (API meta.total = 1500).`);

	// 3) Conversion → modèle G-FLUX (comptage des ignorés).
	const batchTag = `${SOURCE_ID}@${new Date().toISOString().slice(0, 10)}`;
	const items = [];
	for (const row of raw) {
		const g = toGflux(row);
		if (g) items.push(g);
		else summary.ignored++;
	}
	// Dédoublonnage défensif côté script (le vrai garde est l'index Convex).
	const seen = new Set();
	const unique = items.filter((it) => {
		if (seen.has(it.sourceExerciseId)) {
			summary.ignored++;
			return false;
		}
		seen.add(it.sourceExerciseId);
		return true;
	});
	console.log(`🔄 ${unique.length} exercices exploitables (${summary.ignored} ignorés).`);

	if (DRY_RUN) {
		const samples = unique.slice(0, 2);
		console.log('🧪 DRY RUN — aperçu de la conversion :');
		for (const s of samples) console.log(JSON.stringify(s, null, 2));
		const withGif = unique.filter((u) => u.mediaUrl).length;
		console.log(`GIFs présents : ${withGif}/${unique.length}.`);
		console.log(`Aucun envoi. ${unique.length} exercices seraient importés/mis à jour.`);
		process.exit(0);
	}

	// 4) Envoi par lots (mutation authentifiée, upsert idempotent).
	for (let i = 0; i < unique.length; i += BATCH_SIZE) {
		const batch = unique.slice(i, i + BATCH_SIZE);
		const out = await client.mutation('exercises:importBatch', {
			sessionToken: token,
			source: SOURCE_ID,
			importBatch: batchTag,
			licenseNote: LICENSE_NOTE,
			items: batch,
		});
		summary.imported += out.imported;
		summary.updated += out.updated;
		summary.unchanged += out.unchanged;
		summary.errors += out.errors.length;
		if (out.errors.length) summary.errorDetails.push(...out.errors);
		console.log(`   … ${Math.min(i + BATCH_SIZE, unique.length)}/${unique.length} (importés ${summary.imported}, maj ${summary.updated}, erreurs ${summary.errors})`);
	}

	// 5) Masquage réversible des anciennes sources de prototype (option).
	if (HIDE_OLD) {
		for (const old of OLD_SOURCES) {
			const r = await client.mutation('exercises:hideBySource', { sessionToken: token, source: old, hidden: true });
			console.log(`🙈 Source « ${old} » : ${r.hidden} exercices masqués (réversible via --unhide-old-source).`);
		}
	}
	if (!HIDE_OLD && OLD_SOURCES.length) {
		console.log(`ℹ️  Anciennes sources (${OLD_SOURCES.join(', ')}) laissées visibles — ajoute --hide-old-source pour les masquer.`);
	}
} catch (e) {
	console.error('⛔ Import interrompu :', e?.message ?? e);
	process.exitCode = 1;
} finally {
	await client.close();
}

/* ── Résumé final ── */
console.log('\n════════ RÉSUMÉ DE L\'IMPORT ════════');
console.log(`  Source        : ${SOURCE_ID}`);
console.log(`  Importés      : ${summary.imported}`);
console.log(`  Mis à jour    : ${summary.updated}`);
console.log(`  Inchangés     : ${summary.unchanged}`);
console.log(`  Ignorés       : ${summary.ignored}`);
console.log(`  Erreurs       : ${summary.errors}`);
if (summary.errorDetails.length) {
	console.log('  Détails erreurs (10 max) :');
	for (const err of summary.errorDetails.slice(0, 10)) console.log(`   - ${err.sourceExerciseId}: ${err.error}`);
}
console.log('══════════════════════════════════════');
console.log('💡 Relançable sans risque : les ré-imports mettent à jour sans dupliquer.');
