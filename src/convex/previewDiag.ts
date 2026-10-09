import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * PREVIEW ONLY — dernières erreurs d'outil tracées dans assistantMessages
 * (champ toolErrors, §9 batterie E2E). Aucune donnée personnelle : uniquement
 * « nomOutil : raison (trim 120) ». Dernier 40 messages assistant.
 * Cette query n'est JAMAIS appelée sur la prod (gated diag).
 */
export const recentToolErrors = query({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db
			.query("assistantMessages")
			.withIndex("by_thread_created", (q) => q.gt("createdAt", 0))
			.order("desc")
			.take(120);
		const errors: string[] = [];
		for (const r of rows) {
			if (r.role !== "assistant") continue;
			const te = (r as { toolErrors?: string[] }).toolErrors;
			if (Array.isArray(te)) errors.push(...te);
			if (errors.length >= 30) break;
		}
		return { errors };
	},
});
