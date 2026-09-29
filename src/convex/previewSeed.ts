import { v, ConvexError } from "convex/values";
import { mutation, internalMutation, httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { normalizeEmail, hashPassword, localTodayISO } from "./helpers";
// Seed DEMO Vision 360 (import STATIQUE : le bundler Convex ne garantit pas
// la résolution des imports dynamiques relatifs dans le bundle fonctions).
import { seedVision360DemoData } from "./previewSeedVision360";
import {
	GFLUX_OFFICIAL_EXERCISES,
	GFLUX_OFFICIAL_SOURCE,
	GFLUX_OFFICIAL_LICENSE,
	type SeedExercise,
} from "./exercisesSeedData";

/** Mot de passe de test — réappliqué à chaque seed (compte toujours authentifiable). */
const BETA_PASSWORD = "PreviewBeta2026!";
const COACH_PASSWORD = "PreviewCoach2026!";
import { resolveCiqualLabel } from "./ciqual";
// Produits OFF de RÉFÉRENCE pour la preview (données factuelles publiques —
// aucune donnée cliente ; voir PREVIEW_OFF_PRODUCTS pour la licence).
import { PREVIEW_OFF_PRODUCTS } from "./previewOffProducts";

/**
 * SEED PREVIEW — données 100 % FICTIVES, JAMAIS la production.
 *
 * EXÉCUTION AUTOMATIQUE (workflow officiel Convex × Netlify) :
 * `npx convex deploy --preview-run previewSeed:seedPreviewData` — Convex
 * exécute cette fonction APRÈS chaque déploiement sur un PREVIEW deployment
 * et L'IGNORE en production. Aucune intervention manuelle, aucun token.
 *
 * GARDE-FOUS :
 *  - `--preview-run` n'existe que pour les déploiements preview (prod = jamais) ;
 *  - verrou défensif : refuse explicitement si l'environnement ressemble à la
 *    prod (identifiant de déploiement détecté) ;
 *  - idempotent : crée uniquement ce qui manque — sûr à chaque build preview.
 *
 * CONTENU (fictif, aucun client réel) :
 *  - coach de test  : preview-test-coach@example.com / PreviewCoach2026!
 *  - cliente bêta   : contact@myfit-coach.fr (allowlist IA) / PreviewBeta2026!
 *  - journal Ciqual : 2 entrées du jour (poitrine de poulet rôtie, riz basmati).
 *  - produits OFF de référence (foods) : un échantillon de PRODUITS EMBALLÉS
 *    réels Open Food Facts (voir previewOffProducts.ts) — sans lui, le Repas
 *    IA et la recherche produits ne peuvent JAMAIS trouver de produit de
 *    marque en preview (la base 780 k n'est importée qu'en production).
 */
const PROD_URL_MARK = "calm-jaguar-475";

/**
 * Id portable stable — MÊME algorithme que stableGfluxId de exercises.ts
 * (sha256("source:slug") → "ex_" + 20 hex) : les exercices seedés en preview
 * portent les mêmes identifiants que la prod, sans jamais la contacter.
 */
async function stableSeedGfluxId(source: string, sourceExerciseId: string): Promise<string> {
	const data = new TextEncoder().encode(`${source}:${sourceExerciseId}`);
	const digest = await crypto.subtle.digest("SHA-256", data);
	const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
	return `ex_${hex.slice(0, 20)}`;
}

/**
 * PROGRAMME DE TEST — modèle + séance « Haut du corps » (5 exercices × 3
 * séries) + assignation 4 semaines (mer/ven) vers la cliente bêta.
 *
 * Idempotent : le programme modèle n'est créé que s'il manque ; si la cliente
 * a DÉJÀ une assignation active, aucune nouvelle assignation ni occurrence
 * n'est créée (re-seed sans doublon, historique de test respecté).
 * 100 % fictif : la cliente visée est le compte de test, jamais une vraie.
 */
async function seedTestProgram(
	db: MutationCtx["db"],
	coachId: Id<"users">,
	betaId: Id<"users">,
	exercises: { _id: Id<"exercises">; name: string }[]
): Promise<{ created: boolean; programId: Id<"trainingPrograms"> | null; scheduledCount: number }> {
	if (exercises.length < 5) return { created: false, programId: null, scheduledCount: 0 };

	// Programme modèle (côté coach de test) — 1 seul, reconnu par son nom.
	const TEST_PROGRAM_NAME = "Preview — Test Entraînement";
	let programId = (
		await db.query("trainingPrograms").withIndex("by_coach", (q) => q.eq("coachId", coachId)).collect()
	).find((p) => !p.clientId && p.name === TEST_PROGRAM_NAME)?._id;
	if (!programId) {
		programId = await db.insert("trainingPrograms", {
			coachId,
			name: TEST_PROGRAM_NAME,
			description: "Programme de test de la preview — 100 % fictif.",
			goal: "remise_en_forme",
			level: "debutante",
			sessionsPerWeek: 2,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	}

	// Séance unique « Haut du corps » (ordre 0) — créée une seule fois.
	let sessionId = (
		await db.query("trainingSessions").withIndex("by_program", (q) => q.eq("programId", programId)).collect()
	).find((s) => s.name === "Haut du corps")?._id;
	if (!sessionId) {
		sessionId = await db.insert("trainingSessions", {
			programId,
			name: "Haut du corps",
			order: 0,
			createdAt: Date.now(),
		});
	}

	// 5 exercices de la bibliothèque seedée, 3 séries chacun (10 reps, 60 s).
	const existingSe = await db
		.query("trainingSessionExercises")
		.withIndex("by_session", (q) => q.eq("sessionId", sessionId))
		.collect();
	if (existingSe.length === 0) {
		const picks = [
			{ slug: "band-external-rotation", mode: "reps" as const },
			{ slug: "band-pallof-press", mode: "reps" as const },
			{ slug: "swiss-ball-crunch", mode: "reps" as const },
			{ slug: "swiss-ball-body-saw", mode: "reps" as const },
			{ slug: "glute-bridge-mini-band-abduction", mode: "reps" as const },
		];
		for (let i = 0; i < picks.length; i++) {
			const ex = exercises[i];
			if (!ex) continue;
			const seId = await db.insert("trainingSessionExercises", {
				sessionId,
				exerciseId: ex._id,
				order: i,
				mode: picks[i].mode,
				createdAt: Date.now(),
			});
			for (let order = 0; order < 3; order++) {
				await db.insert("trainingSets", {
					sessionExerciseId: seId,
					order,
					repsMin: 10,
					repsMax: 10,
					restSeconds: 60,
				});
			}
		}
	}

	// Assignation vers la cliente bêta — jamais deux fois (re-seed sans doublon).
	const alreadyAssigned = await db
		.query("trainingAssignments")
		.withIndex("by_user", (q) => q.eq("userId", betaId))
		.collect()
		.then((rows) => rows.some((a) => !a.removedAt));
	if (alreadyAssigned) return { created: false, programId, scheduledCount: 0 };

	// Copie indépendante du programme (même mécanique que l'assignation coach).
	const copyId = await db.insert("trainingPrograms", {
		coachId,
		clientId: betaId,
		sourceProgramId: programId,
		name: TEST_PROGRAM_NAME,
		description: "Copie de test (preview) — assignée à la cliente fictive.",
		goal: "remise_en_forme",
		level: "debutante",
		sessionsPerWeek: 2,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	});
	// Copie de la séance + de la prescription (la copie est INDEPENDANTE).
	const copySessionId = await db.insert("trainingSessions", {
		programId: copyId,
		name: "Haut du corps",
		order: 0,
		createdAt: Date.now(),
	});
	const templateSes = await db
		.query("trainingSessionExercises")
		.withIndex("by_session", (q) => q.eq("sessionId", sessionId))
		.collect();
	templateSes.sort((a, b) => a.order - b.order);
	for (const se of templateSes) {
		const copySeId = await db.insert("trainingSessionExercises", {
			sessionId: copySessionId,
			exerciseId: se.exerciseId,
			order: se.order,
			mode: se.mode,
			createdAt: Date.now(),
		});
		const sets = await db
			.query("trainingSets")
			.withIndex("by_sessionExercise", (q) => q.eq("sessionExerciseId", se._id))
			.collect();
		sets.sort((a, b) => a.order - b.order);
		for (const st of sets) {
			await db.insert("trainingSets", {
				sessionExerciseId: copySeId,
				order: st.order,
				repsMin: st.repsMin,
				repsMax: st.repsMax,
				targetWeight: st.targetWeight,
				targetRir: st.targetRir,
				restSeconds: st.restSeconds,
				durationSeconds: st.durationSeconds,
			});
		}
	}

	// Occurrences : 4 semaines, mercredis + vendredis à partir de lundi prochain.
	const today = localTodayISO();
	const [ty, tm, td] = today.split("-").map(Number);
	const monday = new Date(ty, tm - 1, td);
	const dow = monday.getDay();
	monday.setDate(monday.getDate() + (dow === 0 ? -6 : 1 - dow));
	const isoOf = (d: Date) =>
		`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
	const assignmentId = await db.insert("trainingAssignments", {
		coachId,
		userId: betaId,
		programId: copyId,
		sourceProgramId: programId,
		startDate: isoOf(monday),
		endDate: isoOf(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 27)),
		weekdays: [3, 5],
		createdAt: Date.now(),
	});
	let scheduledCount = 0;
	for (let w = 0; w < 4; w++) {
		for (const wd of [3, 5]) {
			const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + w * 7 + (wd - 1));
			await db.insert("trainingScheduledSessions", {
				userId: betaId,
				assignmentId,
				sessionId: copySessionId,
				date: isoOf(d),
				status: "planned",
				createdAt: Date.now(),
			});
			scheduledCount++;
		}
	}
	return { created: true, programId, scheduledCount };
}

/**
 * BIBLIOTHÈQUE OFFICIELLE G-FLUX — upsert idempotent dans `exercises`.
 *
 * Données de RÉFÉRENCE uniquement (aucune donnée personnelle) : la
 * bibliothèque est un socle applicatif, pas une donnée cliente. Même
 * sémantique que exercises:importBatch : reconnaissance par
 * (source, sourceExerciseId), mise à jour si changement, JAMAIS de doublon,
 * réactivation douce si inactive. Médias = URLs relatives au dépôt
 * (`/exercises/<slug>/…`) servies par chaque déploiement Netlify — AUCUN
 * Storage ID Convex prod n'est copié.
 */
async function seedOfficialExercises(db: MutationCtx["db"]): Promise<{
	total: number;
	imported: number;
	updated: number;
	unchanged: number;
}> {
	const now = Date.now();
	let imported = 0;
	let updated = 0;
	let unchanged = 0;

	const toRow = (item: SeedExercise) => ({
		name: item.name,
		sourceName: item.sourceName,
		muscleGroup: item.muscleGroup,
		secondaryMuscles: item.secondaryMuscles,
		bodyPart: item.bodyPart,
		equipment: item.equipment,
		instructions: item.instructions,
		cues: item.cues,
		mistakes: item.mistakes,
		levels: item.levels,
		breathing: item.breathing,
		posterUrl: item.posterUrl,
		animationUrl: item.animationUrl,
	});

	for (const item of GFLUX_OFFICIAL_EXERCISES) {
		const existing = await db
			.query("exercises")
			.withIndex("by_source_id", (q) =>
				q.eq("source", GFLUX_OFFICIAL_SOURCE).eq("sourceExerciseId", item.sourceExerciseId)
			)
			.unique();

		if (existing) {
			const target = toRow(item);
			const patch: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(target)) {
				if (JSON.stringify((existing as Record<string, unknown>)[key]) !== JSON.stringify(value)) {
					patch[key] = value;
				}
			}
			if (!existing.active) patch.active = true; // réactivation douce (jamais un hidden coach)
			if (existing.licenseNote !== GFLUX_OFFICIAL_LICENSE) patch.licenseNote = GFLUX_OFFICIAL_LICENSE;
			if (Object.keys(patch).length > 0) {
				await db.patch(existing._id, { ...patch, updatedAt: now });
				updated++;
			} else {
				unchanged++;
			}
			continue;
		}

		await db.insert("exercises", {
			...toRow(item),
			gfluxExerciseId: await stableSeedGfluxId(GFLUX_OFFICIAL_SOURCE, item.sourceExerciseId),
			source: GFLUX_OFFICIAL_SOURCE,
			sourceExerciseId: item.sourceExerciseId,
			licenseNote: GFLUX_OFFICIAL_LICENSE,
			active: true,
			system: true,
			importBatch: `${GFLUX_OFFICIAL_SOURCE}@seed-preview`,
			createdAt: now,
			updatedAt: now,
		});
		imported++;
	}
	return { total: GFLUX_OFFICIAL_EXERCISES.length, imported, updated, unchanged };
}

function assertNotProd(): void {
	const cloudUrl = process.env.CONVEX_CLOUD_URL ?? "";
	if (cloudUrl.includes(PROD_URL_MARK)) {
		throw new ConvexError("Seed refusé : déploiement de production détecté.");
	}
}

/** Écriture réelle (idempotente) — pure fonction sur le `db` du contexte. */
async function seedCoreData(
	db: MutationCtx["db"]
): Promise<{
	coachEmail: string;
	betaEmail: string;
	coachPassword: string;
	betaPassword: string;
	exercises: { total: number; imported: number; updated: number; unchanged: number };
	testProgram: { created: boolean; scheduledCount: number };
	vision360Demo: { ok: boolean; demoEmail: string; days: number } | { ok: false; error: string };
	offProducts: { imported: number; created: number };
}> {
	// 1) Coach de test (fictif) — hash réappliqué à chaque seed (self-healing :
	// le mot de passe documenté fonctionne toujours, même après N builds).
	const coachEmail = normalizeEmail("preview-test-coach@example.com");
	const coachHash = await hashPassword(COACH_PASSWORD);
	let coachId = (await db.query("users").withIndex("by_email", (q) => q.eq("email", coachEmail)).unique())?._id;
	if (!coachId) {
		coachId = await db.insert("users", {
			email: coachEmail,
			passwordHash: coachHash,
			role: "coach",
			prenom: "Coach",
			nom: "Preview",
		});
	} else {
		await db.patch(coachId, { passwordHash: coachHash });
	}

	// 2) Cliente bêta (allowlist IA) — rattachée au coach de test, hash réappliqué.
	const betaEmail = normalizeEmail("contact@myfit-coach.fr");
	const betaHash = await hashPassword(BETA_PASSWORD);
	let betaId = (await db.query("users").withIndex("by_email", (q) => q.eq("email", betaEmail)).unique())?._id;
	if (!betaId) {
		betaId = await db.insert("users", {
			email: betaEmail,
			passwordHash: betaHash,
			role: "client",
			prenom: "Hugo",
			nom: "GOURHEUX",
			createdBy: coachId,
			startDate: localTodayISO(),
		});
	} else {
		await db.patch(betaId, { passwordHash: betaHash });
	}

	// 3) Journal de test (Ciqual embarqué — snapshots serveur, idempotent)
	const today = localTodayISO();
	const existing = await db
		.query("diaryEntries")
		.withIndex("by_user_date", (q) => q.eq("userId", betaId).eq("date", today))
		.collect();
	if (existing.length === 0) {
		const chicken = resolveCiqualLabel("Poulet, poitrine, viande et peau rôties/cuites au four");
		const rice = resolveCiqualLabel("Riz basmati, cuit, sans sel ajouté");
		for (const [f, qty] of [
			[chicken, 150],
			[rice, 180],
		] as const) {
			if (!f) continue;
			await db.insert("diaryEntries", {
				userId: betaId,
				date: today,
				meal: "dejeuner",
				name: f.label,
				qtyGrams: qty,
				kcal: Math.round((f.kcal * qty) / 100),
				carbs: Math.round(((f.carbs ?? 0) * qty) / 100 * 10) / 10,
				protein: Math.round(((f.protein ?? 0) * qty) / 100 * 10) / 10,
				fat: Math.round(((f.fat ?? 0) * qty) / 100 * 10) / 10,
				createdAt: Date.now(),
			});
		}
	}

	// 4) Bibliothèque officielle G-FLUX (référence, idempotent) — le module
	//    Entraînement est testable de bout en bout sur la preview.
	const exercises = await seedOfficialExercises(db);

	// 4 bis) Produits OFF de RÉFÉRENCE (idempotent, upsert par offId) —
	//    échantillon factuel public de produits emballés réels. Sans lui,
	//    aucune recherche produit de marque ne peut aboutir en preview :
	//    ni la recherche cliente, ni le Repas IA (matching), ni le scan.
	const offProducts = await seedPreviewOffProducts(db);


	// 5) Programme de test + assignation (parcours complet coach → cliente).
	const allOfficial = await db
		.query("exercises")
		.withIndex("by_source_id", (q) => q.eq("source", GFLUX_OFFICIAL_SOURCE))
		.collect();
	const testProgram = await seedTestProgram(db, coachId, betaId, allOfficial);

	// 6) Cliente DEMO Vision 360 (100 % synthétique — 3 semaines de données
	//    poids/pas/alimentation/sport/mensurations + bilan démo). Idempotent,
	//    verrou anti-prod propre au module ; non bloquant : un échec démo
	//    n'empêche JAMAIS le seed principal (Entraînement reste testable).
	let vision360Demo: { ok: boolean; demoEmail: string; days: number } | { ok: false; error: string } = { ok: false, error: "non exécuté" };
	try {
		vision360Demo = await seedVision360DemoData(db);
	} catch (e) {
		// Non bloquant : un échec DEMO n'empêche JAMAIS le seed principal
		// (Entraînement / comptes de test restent fonctionnels).
		vision360Demo = { ok: false, error: e instanceof Error ? e.message : String(e) };
	}

	return {
		coachEmail,
		betaEmail,
		coachPassword: COACH_PASSWORD,
		betaPassword: BETA_PASSWORD,
		exercises,
		testProgram: {
			created: testProgram.created,
			scheduledCount: testProgram.scheduledCount,
		},
		vision360Demo,
		offProducts,
	};
}

/**
 * Produits OFF de RÉFÉRENCE pour la preview — échantillon factuel public
 * (upsert idempotent par offId, aucune donnée cliente, jamais en prod via
 * assertNotProd). Cible exprès les cas de test du Repas IA / recherche :
 * produits de marque AVEC variantes différenciantes (stracciatella ≠ nature,
 * Zero ≠ classique, écrémé ≠ demi-écrémé, fraise ≠ vanille…).
 */
async function seedPreviewOffProducts(db: MutationCtx["db"]): Promise<{ imported: number; created: number }> {
	let created = 0;
	for (const p of PREVIEW_OFF_PRODUCTS) {
		const existing = await db
			.query("foods")
			.withIndex("by_offId", (q) => q.eq("offId", p.offId))
			.first();
		if (existing) continue;
		await db.insert("foods", p);
		created++;
	}
	return { imported: PREVIEW_OFF_PRODUCTS.length, created };
}

/**
 * Hook `--preview-run` : SANS argument (exigence Convex), idempotent,
 * verrouillé contre la prod. Convex l'appelle automatiquement après chaque
 * déploiement d'un PREVIEW deployment — jamais en production.
 */
export const seedPreviewData = mutation({
	args: {},
	handler: async (ctx) => {
		assertNotProd();
		return await seedCoreData(ctx.db);
	},
});

/** Variante interne — appelée par l'endpoint HTTP de secours. */
export const seedPreviewDataInternal = internalMutation({
	handler: async (ctx) => {
		assertNotProd();
		return await seedCoreData(ctx.db);
	},
});

/**
 * Endpoint HTTP de secours : POST /seedPreview — ne demande PAS de token :
 * il n'est sûr que si PREVIEW_SEED_TOKEN N'EST PAS configuré sur ce
 * déploiement (cas du Convex Preview automatique). Si la variable existe,
 * le token reste requis (comportement verrouillé).
 */
export const seedPreviewHttp = httpAction(async (ctx, request) => {
	const json = (payload: unknown, status: number) =>
		new Response(JSON.stringify(payload), {
			status,
			headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
		});
	try {
		assertNotProd();
		const body = (await request.json().catch(() => ({}))) as { seedToken?: string };
		const expected = process.env.PREVIEW_SEED_TOKEN;
		if (expected && body.seedToken !== expected) {
			throw new ConvexError("Seed refusé (token requis).");
		}
		const result = await ctx.runMutation(internal.previewSeed.seedPreviewDataInternal, {});
		return json({ status: "success", result }, 200);
	} catch (e) {
		return json({ status: "error", error: e instanceof Error ? e.message : "seed failed" }, 403);
	}
});
