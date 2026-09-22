import { v, ConvexError } from "convex/values";
import { internalMutation, httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { normalizeEmail, hashPassword, localTodayISO } from "./helpers";
import { resolveCiqualLabel } from "./ciqual";

/**
 * SEED PREVIEW — données 100 % FICTIVES, JAMAIS la production.
 *
 * TROIS garde-fous indépendants :
 *  1. l'écriture est une INTERNAL mutation : non appelable depuis la PWA ;
 *  2. le token PREVIEW_SEED_TOKEN est requis (variable d'env configurée
 *     UNIQUEMENT sur le Convex Preview — jamais sur la prod) ;
 *  3. verrou défensif : refuse explicitement si l'environnement ressemble à
 *     la prod (URL de déploiement) — et l'appelant (script/CI) revérifie
 *     l'URL avant d'appeler.
 *
 * Idempotent : crée uniquement ce qui manque (coach de test, cliente bêta
 * allowlist IA, journal Ciqual du jour).
 */
const PROD_URL_MARK = "calm-jaguar-475";

function assertNotProd(): void {
	if ((process.env.CONVEX_CLOUD_URL ?? "").includes(PROD_URL_MARK)) {
		throw new ConvexError("Seed refusé : déploiement de production détecté.");
	}
}

function requireSeedToken(token: string): void {
	const expected = process.env.PREVIEW_SEED_TOKEN;
	if (!expected || token !== expected) {
		throw new ConvexError("Seed refusé (token invalide ou absent).");
	}
}

const seedInternal = internalMutation({
	handler: async (ctx): Promise<{ coachEmail: string; betaEmail: string; coachPassword: string; betaPassword: string }> => {
		assertNotProd();

		// 1) Coach de test (fictif)
		const coachEmail = normalizeEmail("preview-test-coach@example.com");
		let coachId = (await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", coachEmail)).unique())?._id;
		if (!coachId) {
			coachId = await ctx.db.insert("users", {
				email: coachEmail,
				passwordHash: await hashPassword("PreviewCoach2026!"),
				role: "coach",
				prenom: "Coach",
				nom: "Preview",
			});
		}

		// 2) Cliente bêta (allowlist IA) — rattachée au coach de test
		const betaEmail = normalizeEmail("contact@myfit-coach.fr");
		let betaId = (await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", betaEmail)).unique())?._id;
		if (!betaId) {
			betaId = await ctx.db.insert("users", {
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
		const existing = await ctx.db
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
				await ctx.db.insert("diaryEntries", {
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
	},
});
export { seedInternal as seedPreviewDataInternal };

/**
 * Endpoint HTTP public : POST /seedPreview { seedToken } — appelé par
 * scripts/seed-preview.mjs après déploiement du preview. Vérifie le token
 * AVANT tout le reste, refuse la prod, puis écrit les données fictives.
 */
export const seedPreviewHttp = httpAction(async (ctx, request) => {
	const json = (payload: unknown, status: number) =>
		new Response(JSON.stringify(payload), {
			status,
			headers: {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
			},
		});
	try {
		const body = (await request.json()) as { seedToken?: string };
		requireSeedToken(String(body.seedToken ?? ""));
		assertNotProd();
		const result = await ctx.runMutation(internal.previewSeed.seedPreviewDataInternal, {});
		return json({ status: "success", result }, 200);
	} catch (e) {
		return json({ status: "error", error: e instanceof Error ? e.message : "seed failed" }, 403);
	}
});
