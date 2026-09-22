import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { api, internal } from "./_generated/api";
import { matchComponentsCore, type MatchedComponent } from "./mealMatch";

/**
 * Analyse d'ÉTIQUETTE nutritionnelle (photo) — orchestration côté Convex.
 *
 * ARCHITECTURE : OpenAI vit DANS une action Convex (runtime node, réseau
 * autorisé) — la clé reste côté serveur (env Convex), le navigateur ne voit
 * que la réponse JSON validée. Le BFF /api/foods/label-scan appelle cette
 * action ; les endpoints /api/* restent la seule porte d'entrée de la PWA.
 *
 * Étapes :
 *  1. session cliente (jamais coach) ;
 *  2. photo → /api/ai/label (BFF SvelteKit héberge la clé) → JSON structuré ;
 *  3. JSON VALIDÉ + normalisé (kcal/portion/100 g distingués, kJ→kcal
 *     signalé) — l'IA ne crée JAMAIS l'aliment, elle préremplit le formulaire.
 *
 * PANNE : si OpenAI est indisponible, l'action renvoie ok:false + reason —
 * la recherche, le barcode et la saisie manuelle restent 100 % fonctionnels.
 */

/** Résout la session DANS le contexte action (runQuery — pas de `db` local). */
async function sessionUserInAction(
	ctx: { runQuery: (ref: never, args: never) => Promise<unknown> },
	sessionToken: string | undefined | null
): Promise<{ _id: string; role: "coach" | "client" }> {
	const user = (await ctx.runQuery(
		api.journal.checkSession as never,
		{ sessionToken } as never
	)) as { _id: string; role: "coach" | "client" } | null;
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") {
		throw new ConvexError("Seuls les comptes clients peuvent utiliser l'analyse photo.");
	}
	return user;
}

/** Valide et borne une valeur nutritionnelle IA (0–plafond, 1 décimale). */
function clampNut(n: unknown, max: number): number | undefined {
	const x = typeof n === "number" ? n : Number(n);
	if (!isFinite(x) || x < 0) return undefined;
	return Math.min(max, Math.round(x * 10) / 10);
}

/** Action : analyse une photo d'étiquette et renvoie un JSON préremplissage. */
export const analyzeLabel = action({
	args: {
		sessionToken: v.optional(v.string()),
		/** Photo (JPEG/WebP) en dataURL — déjà redimensionnée côté PWA (≤ 1600 px). */
		imageDataUrl: v.string(),
		/** Code-barres lu par la PWA sur la même photo (décodeur réel) — info + anti-doublon. */
		barcode: v.optional(v.string()),
	},
	handler: async (ctx, { sessionToken, imageDataUrl, barcode }) => {
		await sessionUserInAction(ctx, sessionToken);
		if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
			throw new ConvexError("Photo d'étiquette invalide.");
		}
		if (imageDataUrl.length > 5_000_000) {
			throw new ConvexError("Photo trop lourde — rapproche-toi de l'étiquette et réessaie.");
		}		// 1) Appel OpenAI via le BFF (la clé vit côté SvelteKit uniquement).
		//    URL du BFF = PUBLIC_APP_URL côté Convex (env) — repli localhost en dev.
		const bffBase = process.env.PUBLIC_APP_URL ?? "http://localhost:5173";
		let ai: LabelAnalysis | null = null;
		let aiError = "";
		const t0 = Date.now();
		try {
			const res = await fetch(`${bffBase}/api/ai/label`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ imageDataUrl }),
				signal: AbortSignal.timeout(45_000),
			});
			const j = (await res.json()) as {
				ok?: boolean;
				analysis?: LabelAnalysis;
				error?: string;
				usage?: { model?: string; inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number };
			};
			if (res.ok && j.ok && j.analysis) ai = j.analysis;
			else aiError = j.error ?? `HTTP ${res.status}`;
			// Traçabilité IA (modèle, tokens, durée, coût estimé) — aucune donnée
			// personnelle : la photo n'est JAMAIS persistée.
			await ctx.runMutation(internal.aiLog.record, {
				kind: "label",
				model: j.usage?.model ?? "unknown",
				inputTokens: j.usage?.inputTokens,
				outputTokens: j.usage?.outputTokens,
				durationMs: Date.now() - t0,
				status: ai ? "ok" : "error",
				estimatedCostUsd: j.usage?.estimatedCostUsd,
				failReason: ai ? undefined : aiError.slice(0, 200),
			});
		} catch (e) {
			aiError = e instanceof Error ? (e.name === "TimeoutError" ? "timeout" : "unreachable") : "unreachable";
			await ctx.runMutation(internal.aiLog.record, {
				kind: "label",
				model: "unknown",
				durationMs: Date.now() - t0,
				status: "error",
				failReason: aiError,
			}).catch(() => null);
		}
		if (!ai) {
			return { ok: false as const, reason: aiError || "ai-unavailable" };
		}

		// 2) Validation stricte : l'IA ne décide rien toute seule.
		const name = (ai.name ?? "").trim().slice(0, 80);
		const brand = (ai.brand ?? "").trim().slice(0, 80) || undefined;
		const kcal100 = clampNut(ai.kcal100, 900);
		const carbs100 = clampNut(ai.carbs100, 100);
		const protein100 = clampNut(ai.protein100, 100);
		const fat100 = clampNut(ai.fat100, 100);
		const fiber100 = clampNut(ai.fiber100, 90);
		const salt100 = clampNut(ai.salt100, 25);
		const servingQty = clampNut(ai.servingQty, 2000);

		// Champs ambigus : chaque valeur porte son état de confiance — l'UI
		// marque « à vérifier » au lieu d'inventer.
		const needsReview: string[] = [];
		if (!kcal100) needsReview.push("kcal");
		if (ai.kcalFromKj) needsReview.push("kcal-kj");
		if (ai.confidence && ai.confidence < 0.6) needsReview.push("valeurs");

		return {
			ok: true as const,
			analysis: {
				name: name.length >= 2 ? name : "",
				brand,
				kcal100,
				carbs100,
				protein100,
				fat100,
				fiber100,
				salt100,
				servingQty,
				kcalFromKj: !!ai.kcalFromKj,
				confidence: typeof ai.confidence === "number" ? ai.confidence : undefined,
				needsReview,
			},
			/** Barcode lu côté PWA (décodeur réel) — jamais deviné par l'IA. */
			barcode: (barcode ?? "").replace(/\D/g, "") || undefined,
		};
	},
});

/** Forme du JSON renvoyé par le BFF (/api/ai/label) — OpenAI structuré. */
export type LabelAnalysis = {
	name?: string;
	brand?: string;
	/** kcal /100 g — normalisées depuis kJ si nécessaire (kcalFromKj = true). */
	kcal100?: number;
	carbs100?: number;
	protein100?: number;
	fat100?: number;
	fiber100?: number;
	salt100?: number;
	/** Portion annoncée par l'étiquette (g). */
	servingQty?: number;
	/** true si les kcal ont dû être converties depuis des kJ. */
	kcalFromKj?: boolean;
	/** Confiance globale 0–1 déclarée par l'IA. */
	confidence?: number;
};

/* ─────────────── REPAS PHOTOGRAPHIÉ ─────────────── */

/** Analyse une photo de REPAS : l'IA identifie les composants + quantités,
 *  la base G-FLUX tranche la nutrition (jamais l'IA). */
export const analyzeMeal = action({
	args: {
		sessionToken: v.optional(v.string()),
		imageDataUrl: v.string(),
	},
	handler: async (ctx, { sessionToken, imageDataUrl }) => {
		const user = await sessionUserInAction(ctx, sessionToken);
		if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
			throw new ConvexError("Photo invalide.");
		}
		if (imageDataUrl.length > 5_000_000) {
			throw new ConvexError("Photo trop lourde — réessaie avec un cadrage plus serré.");
		}		// 1) Reconnaissance des composants (OpenAI — aliments + quantités SEULEMENT).
		const bffBase = process.env.PUBLIC_APP_URL ?? "http://localhost:5173";
		let ai: MealComponents | null = null;
		let aiError = "";
		const t0 = Date.now();
		try {
			const res = await fetch(`${bffBase}/api/ai/meal`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ imageDataUrl }),
				signal: AbortSignal.timeout(45_000),
			});
			const j = (await res.json()) as {
				ok?: boolean;
				components?: MealComponents;
				error?: string;
				usage?: { model?: string; inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number };
			};
			if (res.ok && j.ok && j.components) ai = j.components;
			else aiError = j.error ?? `HTTP ${res.status}`;
			await ctx.runMutation(internal.aiLog.record, {
				kind: "meal",
				model: j.usage?.model ?? "unknown",
				inputTokens: j.usage?.inputTokens,
				outputTokens: j.usage?.outputTokens,
				durationMs: Date.now() - t0,
				status: ai && ai.items.length > 0 ? "ok" : "error",
				estimatedCostUsd: j.usage?.estimatedCostUsd,
				failReason: ai && ai.items.length > 0 ? undefined : aiError.slice(0, 200) || "no-components",
			});
		} catch (e) {
			aiError = e instanceof Error && e.name === "TimeoutError" ? "timeout" : "unreachable";
			await ctx.runMutation(internal.aiLog.record, {
				kind: "meal",
				model: "unknown",
				durationMs: Date.now() - t0,
				status: "error",
				failReason: aiError,
			}).catch(() => null);
		}
		if (!ai || ai.items.length === 0) {
			return { ok: false as const, reason: aiError || "no-components" };
		}

		// 2) MATCH base G-FLUX (Convex → CIQUAL → estimation IA) — via la query
		//    dédiée (une action n'a pas de `db` direct), zéro appel live OFF,
		//    aucune nutrition IA acceptée comme source.
		const matched = (await ctx.runQuery(
			internal.mealMatch.matchComponentsInternal as never,
			{
				userId: user._id,
				components: ai.items.map((it) => ({
					name: String(it.name ?? "").slice(0, 80),
					qtyGrams: it.qtyGrams,
					// Valeurs IA /100 g de secours (« Estimation IA ») — jamais source.
					kcal100: it.kcal100,
					carbs100: it.carbs100,
					protein100: it.protein100,
					fat100: it.fat100,
					note: it.note,
				})),
			} as never
		)) as MatchedComponent[];

		return { ok: true as const, components: matched, hint: ai.hint };
	},
});

/** Forme du JSON renvoyé par le BFF (/api/ai/meal). */
export type MealComponents = {
	items: {
		name: string;
		qtyGrams: number;
		/** Valeurs IA /100 g de secours — repères à valider, jamais la source. */
		kcal100?: number;
		carbs100?: number;
		protein100?: number;
		fat100?: number;
		note?: string;
	}[];
	/** Rappel discret éventuel (« Huile, sauce ou matière grasse utilisée ? »). */
	hint?: string;
};

export type { MatchedComponent };
