import { v, ConvexError } from "convex/values";
import { mutation, internalMutation, httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { normalizeEmail, hashPassword, localTodayISO } from "./helpers";
import { resolveCiqualLabel } from "./ciqual";

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
 */
const PROD_URL_MARK = "calm-jaguar-475";

function assertNotProd(): void {
	const cloudUrl = process.env.CONVEX_CLOUD_URL ?? "";
	if (cloudUrl.includes(PROD_URL_MARK)) {
		throw new ConvexError("Seed refusé : déploiement de production détecté.");
	}
}

/** Écriture réelle (idempotente) — pure fonction sur le `db` du contexte. */
async function seedCoreData(
	db: MutationCtx["db"]
): Promise<{ coachEmail: string; betaEmail: string; coachPassword: string; betaPassword: string }> {
	// 1) Coach de test (fictif)
	const coachEmail = normalizeEmail("preview-test-coach@example.com");
	let coachId = (await db.query("users").withIndex("by_email", (q) => q.eq("email", coachEmail)).unique())?._id;
	if (!coachId) {
		coachId = await db.insert("users", {
			email: coachEmail,
			passwordHash: await hashPassword("PreviewCoach2026!"),
			role: "coach",
			prenom: "Coach",
			nom: "Preview",
		});
	}

	// 2) Cliente bêta (allowlist IA) — rattachée au coach de test
	const betaEmail = normalizeEmail("contact@myfit-coach.fr");
	let betaId = (await db.query("users").withIndex("by_email", (q) => q.eq("email", betaEmail)).unique())?._id;
	if (!betaId) {
		betaId = await db.insert("users", {
			email: betaEmail,
			passwordHash: await hashPassword("PreviewBeta2026!"),
			role: "client",
			prenom: "Hugo",
			nom: "GOURHEUX",
			createdBy: coachId,
			startDate: localTodayISO(),
		});
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

	return {
		coachEmail,
		betaEmail,
		coachPassword: "PreviewCoach2026!",
		betaPassword: "PreviewBeta2026!",
	};
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
