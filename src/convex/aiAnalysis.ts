import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
import { action, query } from "./_generated/server";
import type { MatchedComponent } from "./mealMatch";
import type { ResolvedBarcodeProduct } from "./off";
import { packagedSearchTerms, demandedFlavorTokens } from "./mealMatch";
import { analyzeLabelImage, analyzeMealImage, analyzeRecipeImage } from "../lib/server/openai";

/**
 * Analyse IA « Alimentation intelligente » — orchestration Convex DIRECTE.
 *
 * ARCHITECTURE (flux sans boucle) :
 *
 *   PWA ──► BFF SvelteKit (/api/foods/label-scan, /api/meals/analyze)
 *              │  auth cookie + flags bêta (betaAccess.flags) — refus tôt
 *              ▼
 *           Action Convex (runtime node, réseau autorisé)
 *              │  re-vérifie la session + les flags bêta (défense en profondeur)
 *              │  appelle OpenAI DIRECTEMENT (src/lib/server/openai.ts, même
 *              │  module que le BFF — la clé vit dans process.env des deux
 *              │  runtimes serveur, jamais côté PWA)
 *              ▼
 *           Validation + clamps + MATCH base G-FLUX (Convex → CIQUAL)
 *
 * Le BFF ne connaît jamais la clé OpenAI en clair via ce chemin (il n'appelle
 * plus /api/ai/* : le couple Convex→BFF→OpenAI créait une boucle inutile
 * PWA→BFF→Convex→BFF→OpenAI — supprimée).
 *
 * RÈGLES MÉTIER :
 *  - l'IA ne crée JAMAIS l'aliment ni les composants : elle préremplit ;
 *  - nutrition = base G-FLUX (customFoods → OFF importé → CIQUAL) ; l'estimation
 *    IA n'apparaît qu'en dernier recours, clairement étiquetée ;
 *  - PANNE OpenAI : ok:false + raison — recherche, barcode et création manuelle
 *    restent 100 % fonctionnels ;
 *  - traçabilité aiUsageLog (modèle, tokens, durée, coût estimé) — aucune
 *    donnée personnelle, aucune image persistée.
 */

/** Garde bêta DANS l'action (re-résolution session — jamais la confiance au BFF). */
async function requireBetaInAction(
	ctx: { runQuery: (ref: never, args: never) => Promise<unknown> },
	sessionToken: string | undefined | null,
	flag: "food_label_ai_beta" | "meal_photo_ai_beta"
): Promise<string> {
	const allowed = (await ctx.runQuery(
		api.betaAccess.flags as never,
		{ sessionToken } as never
	)) as { foodLabelAi: boolean; mealPhotoAi: boolean } | null;
	const ok = flag === "food_label_ai_beta" ? !!allowed?.foodLabelAi : !!allowed?.mealPhotoAi;
	if (!ok) {
		throw new ConvexError("Fonction bêta non disponible pour ce compte.");
	}
	// L'action n'a pas besoin de l'identité au-delà du garde : le matching est
	// relancé par la mutation commit (session + appartenance vérifiés là-bas).
	const user = (await ctx.runQuery(
		api.journal.checkSession as never,
		{ sessionToken } as never
	)) as { _id: string; role: "coach" | "client" } | null;
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") {
		throw new ConvexError("Seuls les comptes clients peuvent utiliser l'analyse photo.");
	}
	return user._id;
}

/** Log IA (best effort : ne masque jamais le résultat métier). */
async function logAi(
	ctx: { runMutation: (ref: never, args: never) => Promise<unknown> },
	entry: {
		kind: "label" | "meal";
		model: string;
		inputTokens?: number;
		outputTokens?: number;
		durationMs: number;
		status: "ok" | "error";
		estimatedCostUsd?: number;
		failReason?: string;
	}
): Promise<void> {
	try {
		await ctx.runMutation(internal.aiLog.record as never, entry as never);
	} catch {
		// journaling best effort
	}
}

/** Valide et borne une valeur nutritionnelle IA (0–plafond, 1 décimale). */
function clampNut(n: unknown, max: number): number | undefined {
	const x = typeof n === "number" ? n : Number(n);
	if (!isFinite(x) || x < 0) return undefined;
	return Math.min(max, Math.round(x * 10) / 10);
}

/* ─────────────── ÉTIQUETTE NUTRITIONNELLE ─────────────── */

/**
 * Statut de la configuration IA de CE déploiement (diagnostic preview).
 * Renvoie des BOOLÉENS et le nom de modèle — JAMAIS la valeur de la clé.
 * Sans session : aucune donnée, aucune information sensible.
 * ACTION (runtime node) = même environnement que les VRAIS appels OpenAI.
 */
export const keyStatus = action({
	args: {},
	handler: async () => {
		return {
			openaiKeyPresent: !!process.env.OPENAI_API_KEY,
			openaiModel: process.env.OPENAI_MODEL ?? null,
		};
	},
});

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
		await requireBetaInAction(ctx, sessionToken, "food_label_ai_beta");
		if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
			throw new ConvexError("Photo d'étiquette invalide.");
		}
		if (imageDataUrl.length > 5_000_000) {
			throw new ConvexError("Photo trop lourde — rapproche-toi de l'étiquette et réessaie.");
		}

		// OpenAI DIRECT (runtime node Convex) — plus de boucle Convex→BFF.
		const t0 = Date.now();
		let ai: Awaited<ReturnType<typeof analyzeLabelImage>>["analysis"] | null = null;
		let aiError = "";
		try {
			const r = await analyzeLabelImage(imageDataUrl);
			ai = r.analysis;
			await logAi(ctx, {
				kind: "label",
				model: r.usage.model,
				inputTokens: r.usage.inputTokens,
				outputTokens: r.usage.outputTokens,
				durationMs: r.usage.durationMs,
				status: "ok",
				estimatedCostUsd: r.usage.estimatedCostUsd,
			});
		} catch (e) {
			aiError = e instanceof Error ? e.message : "unreachable";
			await logAi(ctx, {
				kind: "label",
				model: "unknown",
				durationMs: Date.now() - t0,
				status: "error",
				failReason: aiError.slice(0, 200),
			});
		}
		if (!ai) {
			return { ok: false as const, reason: aiError || "ai-unavailable" };
		}

		// Validation stricte : l'IA ne décide rien toute seule (clamps + revue).
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
		// Garde-fou colonnes (mission) : la résolution lib/labelColumns.ts refuse
		// de mélanger 100 g et portion — si les kcal et les macros ne sont pas
		// toutes présentes ENSEMBLE après résolution, c'est qu'aucune colonne
		// n'était lisible en entier : l'UI passe en revue au lieu d'inventer.
		if (kcal100 === undefined) needsReview.push("kcal");
		const partialMacros =
			(kcal100 !== undefined && (carbs100 === undefined || protein100 === undefined || fat100 === undefined)) ||
			(kcal100 === undefined && (carbs100 !== undefined || protein100 !== undefined || fat100 !== undefined));
		if (partialMacros) needsReview.push("valeurs-partielles");
		if (ai.kcalFromKj) needsReview.push("kcal-kj");
		if (ai.confidence !== undefined && ai.confidence < 0.6) needsReview.push("valeurs");

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
				kcalFromKj: ai.kcalFromKj === true,
				confidence: ai.confidence,
				needsReview,
			},
			/** Barcode lu côté PWA (décodeur réel) — jamais deviné par l'IA. */
			barcode: (barcode ?? "").replace(/\D/g, "") || undefined,
		};
	},
});

/* ─────────────── REPAS PHOTOGRAPHIÉ ─────────────── */

/** Analyse une photo de REPAS : l'IA identifie les composants + quantités,
 *  la base G-FLUX tranche la nutrition (jamais l'IA). */
export const analyzeMeal = action({
	args: {
		sessionToken: v.optional(v.string()),
		imageDataUrl: v.string(),
	},
	handler: async (ctx, { sessionToken, imageDataUrl }) => {
		const userId = await requireBetaInAction(ctx, sessionToken, "meal_photo_ai_beta");
		if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
			throw new ConvexError("Photo invalide.");
		}
		if (imageDataUrl.length > 5_000_000) {
			throw new ConvexError("Photo trop lourde — réessaie avec un cadrage plus serré.");
		}

		// 1) Reconnaissance des composants (OpenAI DIRECT — aliments + quantités).
		const t0 = Date.now();
		let ai: Awaited<ReturnType<typeof analyzeMealImage>>["result"] | null = null;
		let aiError = "";
		try {
			const r = await analyzeMealImage(imageDataUrl);
			ai = r.result;
			await logAi(ctx, {
				kind: "meal",
				model: r.usage.model,
				inputTokens: r.usage.inputTokens,
				outputTokens: r.usage.outputTokens,
				durationMs: r.usage.durationMs,
				status: ai.items.length > 0 ? "ok" : "error",
				estimatedCostUsd: r.usage.estimatedCostUsd,
				failReason: ai.items.length > 0 ? undefined : "no-components",
			});
		} catch (e) {
			aiError = e instanceof Error ? e.message : "unreachable";
			await logAi(ctx, {
				kind: "meal",
				model: "unknown",
				durationMs: Date.now() - t0,
				status: "error",
				failReason: aiError.slice(0, 200),
			});
		}
		if (!ai || ai.items.length === 0) {
			// Photo réellement inexploitable (ou IA indisponible) : l'UI affiche
			// un message propre — JAMAIS un « no comment » brut du modèle.
			return {
				ok: false as const,
				reason: aiError || "no-components",
				/** Type de photo déclaré par le modèle ("unclear" si échec IA). */
				photoType: ai?.photoType ?? "unclear",
			};
		}

		// 2) Composants à code-barres lisible : résolution EXACTE par le MÊME
		//    moteur que le scan du Journal (base locale → aliments personnels →
		//    API OFF + cache). Priorité de la règle produit : un code lisible
		//    tranche, avant tout rapprochement nominal.
		const resolved = new Map<number, ResolvedBarcodeProduct>();
		for (let i = 0; i < ai.items.length; i++) {
			const code = ai.items[i].barcode;
			if (!code) continue;
			try {
				const p = (await ctx.runAction(
					internal.off.resolveBarcodeInternal as never,
					{ sessionToken, barcode: code } as never
				)) as ResolvedBarcodeProduct | null;
				if (p) resolved.set(i, p);
			} catch {
				// Résolution indisponible : le composant suit le chemin nominal
				// (marque + produit → OFF local → Ciqual → estimation IA).
			}
		}

		// 3) Produits emballés SANS code-barres : recherche OFF LIVE précise
		//    (marque + variante + produit) — même pipeline que la recherche
		//    cliente, mise en cache `foods`, règles variantes (jamais « nature »
		//    pour « Stracciatella »). Une query n'ayant pas le droit au réseau,
		//    la recherche vit DANS CETTE ACTION ; le produit retenu est transmis
		//    au matcher en `preResolved` (même chemin que le code-barres).
		for (let i = 0; i < ai.items.length; i++) {
			if (resolved.has(i) || !ai.items[i].packaged) continue;
			const it = ai.items[i];
			const name = String(it.name ?? "").slice(0, 80);
			const terms = packagedSearchTerms(name, it.brand, it.variant);
			const flavors = demandedFlavorTokens(name, it.variant);
			for (const term of terms) {
				try {
					const p = (await ctx.runAction(
						internal.off.searchOffProductsInternal as never,
						{
							sessionToken,
							query: term,
							componentName: name,
							demandedFlavors: flavors,
						} as never
					)) as { foodId: Id<"foods">; name: string; brand?: string; kcal100: number; carbs100: number; protein100: number; fat100: number } | null;
					if (p) {
						resolved.set(i, {
							source: "food" as const,
							foodId: p.foodId,
							name: p.name,
							brand: p.brand,
							kcal100: p.kcal100,
							carbs100: p.carbs100,
							protein100: p.protein100,
							fat100: p.fat100,
						});
						break;
					}
				} catch {
					// OFF indisponible : terme suivant, puis socle local.
				}
			}
		}

		// 4) MATCH base G-FLUX (customFoods → OFF importé → CIQUAL → estimation IA)
		//    — même process que la requête : actions node, `db` indisponible, on
		//    emprunte la requête interne via runQuery.
		const matched = (await ctx.runQuery(
			internal.mealMatch.matchComponentsInternal as never,
			{
				userId,
				components: ai.items.map((it, i) => ({
					name: String(it.name ?? "").slice(0, 80),
					qtyGrams: it.qtyGrams,
					kcal100: it.kcal100,
					carbs100: it.carbs100,
					protein100: it.protein100,
					fat100: it.fat100,
					note: it.note,
					packaged: it.packaged,
					brand: it.brand,
					variant: it.variant,
					preResolved: resolved.get(i),
				})),
			} as never
		)) as MatchedComponent[];

		return { ok: true as const, components: matched, hint: ai.hint, photoType: ai.photoType };
	},
});

/**
 * Import de RECETTE par photo — extraction de la LISTE D'INGRÉDIENTS.
 *
 * DIFFÉRENCE avec analyzeMeal (repas servi) :
 *  - le sujet est une liste écrite (livre, fiche, capture) → poids CRU/SEC :
 *    la règle « servi cuit » est neutralisée (ignoreCookedRule) ;
 *  - la quantité n'est PAS devinée : conversion fiable seulement (œufs, ml,
 *    cuillères) ; sinon qtyGrams absent + qtyUncertain → « Quantité à compléter » ;
 *  - produits de marque listés → MÊME recherche OFF live que le Repas IA.
 * MÊMES briques réutilisées : garde bêta, log IA (kind "meal"), matchComponentsInternal,
 * off.searchOffProductsInternal — AUCUN moteur parallèle, aucun changement schema.
 */
export const analyzeRecipe = action({
	args: {
		sessionToken: v.optional(v.string()),
		imageDataUrl: v.string(),
	},
	handler: async (ctx, { sessionToken, imageDataUrl }) => {
		const userId = await requireBetaInAction(ctx, sessionToken, "meal_photo_ai_beta");
		if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
			throw new ConvexError("Photo invalide.");
		}
		if (imageDataUrl.length > 5_000_000) {
			throw new ConvexError("Photo trop lourde — réessaie avec un cadrage plus serré.");
		}

		// 1) Extraction de la liste d'ingrédients (OpenAI DIRECT — mêmes garde-fous).
		const t0 = Date.now();
		let recipe: Awaited<ReturnType<typeof analyzeRecipeImage>>["result"] | null = null;
		let aiError = "";
		try {
			const r = await analyzeRecipeImage(imageDataUrl);
			recipe = r.result;
			await logAi(ctx, {
				kind: "meal",
				model: r.usage.model,
				inputTokens: r.usage.inputTokens,
				outputTokens: r.usage.outputTokens,
				durationMs: r.usage.durationMs,
				status: recipe.items.length > 0 ? "ok" : "error",
				estimatedCostUsd: r.usage.estimatedCostUsd,
				failReason: recipe.items.length > 0 ? undefined : "no-components",
			});
		} catch (e) {
			aiError = e instanceof Error ? e.message : "unreachable";
			await logAi(ctx, {
				kind: "meal",
				model: "unknown",
				durationMs: Date.now() - t0,
				status: "error",
				failReason: aiError.slice(0, 200),
			});
		}
		if (!recipe || recipe.items.length === 0) {
			// Photo inexploitable OU pas une liste d'ingrédients : message propre,
			// JAMAIS un « no comment » brut du modèle.
			return {
				ok: false as const,
				reason: aiError || "no-components",
			};
		}

		// 2) Produits de marque listés SANS code-barres : même recherche OFF live
		//    que le Repas IA (aiAnalysis.analyzeMeal) — cache `foods`, règles variantes.
		const resolved = new Map<number, ResolvedBarcodeProduct>();
		for (let i = 0; i < recipe.items.length; i++) {
			const it = recipe.items[i];
			if (!it.packaged) continue;
			const name = String(it.name ?? "").slice(0, 80);
			const terms = packagedSearchTerms(name, it.brand, it.variant);
			const flavors = demandedFlavorTokens(name, it.variant);
			for (const term of terms) {
				try {
					const p = (await ctx.runAction(
						internal.off.searchOffProductsInternal as never,
						{ sessionToken, query: term, componentName: name, demandedFlavors: flavors } as never
					)) as { foodId: Id<"foods">; name: string; brand?: string; kcal100: number; carbs100: number; protein100: number; fat100: number } | null;
					if (p) {
						resolved.set(i, {
							source: "food" as const,
							foodId: p.foodId,
							name: p.name,
							brand: p.brand,
							kcal100: p.kcal100,
							carbs100: p.carbs100,
							protein100: p.protein100,
							fat100: p.fat100,
						});
						break;
					}
				} catch {
					// OFF indisponible : terme suivant, puis socle local (custom → OFF importé → Ciqual).
				}
			}
		}

		// 3) MATCH base G-FLUX — MÊME matcher que le Repas IA, poids crus
		//    (ignoreCookedRule : « 50 g de quinoa » reste QUINOA CRU).
		const matched = (await ctx.runQuery(
			internal.mealMatch.matchComponentsInternal as never,
			{
				userId,
				components: recipe.items.map((it, i) => ({
					name: String(it.name ?? "").slice(0, 80),
					// Quantité incertaine → 100 g de DÉFAUT AFFICHÉ, JAMAIS un poids deviné :
					// l'utilisateur complète avant sauvegarde (quantité requise côté UI).
					qtyGrams: it.qtyGrams ?? 100,
					kcal100: it.kcal100,
					carbs100: it.carbs100,
					protein100: it.protein100,
					fat100: it.fat100,
					note: it.note,
					packaged: it.packaged,
					brand: it.brand,
					variant: it.variant,
					ignoreCookedRule: true,
					preResolved: resolved.get(i),
				})),
			} as never
		)) as MatchedComponent[];

		return {
			ok: true as const,
			components: matched,
			/** Titre de la recette (si visible) — pré-remplissage modifiable. */
			name: recipe.name,
			/** Personnes/portions si clairement écrites — proposées, jamais imposées. */
			servings: recipe.servings,
			/** Index des ingrédients dont la quantité doit être complétée. */
			uncertainQtyIdx: recipe.items
				.map((it, i) => (it.qtyUncertain === true ? i : -1))
				.filter((i) => i >= 0),
			/** Quantités écrites sur la recette (affichage « tel qu'écrit »). */
			qtyRaw: recipe.items.map((it) => it.qtyRaw),
		};
	},
});

/** Forme du JSON renvoyé par l'action recette — consommé par le BFF. */
export type RecipeAnalysis = {
	ok: true;
	components: MatchedComponent[];
	name?: string;
	servings?: number;
	uncertainQtyIdx?: number[];
	qtyRaw?: (string | undefined)[];
};

/** Forme du JSON renvoyé par l'analyse étiquette — consommé par le BFF. */
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

/** Composant IA brut (reconnaissance repas) — avant match G-FLUX. */
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
