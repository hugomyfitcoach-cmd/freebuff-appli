import { query } from "./_generated/server";

/**
 * PREVIEW ONLY — dernières erreurs d'outil tracées dans assistantMessages
 * (champ toolErrors, §9 batterie E2E). Aucune donnée personnelle : uniquement
 * « nomOutil : raison (trim 120) ». Scan récent ordonné par createdAt.
 * Cette query n'est JAMAIS appelée sur la prod (gated diag, POST/GET preview).
 */
export const recentToolErrors = query({
	args: {},
	handler: async (ctx) => {
		// Aucun index sur contents : scan borné, ordonné à la main — le
		// diagnostic preview n'a pas besoin d'un accessoire d'index.
		const rows = await ctx.db.query("assistantMessages").collect();
		rows.sort((a, b) => b.createdAt - a.createdAt);
		const errors: string[] = [];
		for (const r of rows) {
			if (r.role !== "assistant") continue;
			const te = (r as { toolErrors?: string[] }).toolErrors;
			if (Array.isArray(te)) errors.push(...te);
			if (errors.length >= 30) break;
			if (rows.length > 600 && errors.length === 0 && r.createdAt < Date.now() - 3600_000) break;
		}
		const recentCalls: { messageAt: number; tools: string[]; pendingAction: boolean }[] = [];
		for (const r of rows) {
			if (r.role !== "assistant" || recentCalls.length >= 20) continue;
			recentCalls.push({
				messageAt: r.createdAt,
				tools: (r.toolCalls ?? []).slice(0, 8),
				pendingAction: !!r.actionId,
			});
		}
		return { errors, recentCalls };
	},
});
