import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * TRAÇABILITÉ IA — écriture INTERNE (depuis les actions Convex appelées par
 * le BFF ; la clé OpenAI ne quitte jamais le serveur, cette table ne stocke
 * aucune donnée personnelle ni image).
 */
export const record = internalMutation({
	args: {
		kind: v.union(v.literal("label"), v.literal("meal")),
		model: v.string(),
		inputTokens: v.optional(v.number()),
		outputTokens: v.optional(v.number()),
		durationMs: v.number(),
		status: v.union(v.literal("ok"), v.literal("error")),
		estimatedCostUsd: v.optional(v.number()),
		failReason: v.optional(v.string()),
	},
	handler: async (ctx, entry) => {
		await ctx.db.insert("aiUsageLog", { ...entry, createdAt: Date.now() });
		return { ok: true };
	},
});
