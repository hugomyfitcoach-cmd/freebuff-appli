import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * TRAÇABILITÉ IA — écriture INTERNE (depuis les actions Convex appelées par
 * le BFF ; la clé OpenAI ne quitte jamais le serveur, cette table ne stocke
 * aucune donnée personnelle ni image).
 */
export const record = internalMutation({
	args: {
		kind: v.union(v.literal("label"), v.literal("meal"), v.literal("coach_draft")),
		model: v.string(),
		inputTokens: v.optional(v.number()),
		outputTokens: v.optional(v.number()),
		/** Tokens d'entrée servis depuis le cache de prompt (modèles OpenAI). */
		cachedInputTokens: v.optional(v.number()),
		durationMs: v.number(),
		status: v.union(v.literal("ok"), v.literal("error")),
		estimatedCostUsd: v.optional(v.number()),
		failReason: v.optional(v.string()),
		/**
		 * Paramètre/champ refusé par OpenAI (`error.param` ou `error.code`), borné
		 * à 40 caractères — jamais `error.message`. Diagnostic d'un HTTP 400.
		 */
		failParam: v.optional(v.string()),
		/**
		 * Identifiant technique du bilan concerné (brouillon coach) — borne la
		 * double génération en 30 s. Jamais un contenu, jamais un prénom.
		 */
		checkinId: v.optional(v.string()),
	},
	handler: async (ctx, entry) => {
		await ctx.db.insert("aiUsageLog", { ...entry, createdAt: Date.now() });
		return { ok: true };
	},
});
