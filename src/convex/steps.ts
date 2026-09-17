import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Pas quotidiens côté cliente — une seule valeur par jour (`dailySteps`),
 * modifiable si la cliente s'est trompée. La moyenne hebdo n'est jamais
 * calculée sur les jours sans donnée (jour vide ≠ 0) : les agrégations
 * vivent dans dashboard.getDashboard (récap cliente) et coach.client360
 * (cockpit CRM), qui ne comptent que les jours réellement renseignés.
 *
 * `count` est LA valeur lue partout (page « Mes pas », Accueil, dashboard,
 * CRM, graphiques, objectifs) : c'est la saisie de la cliente. `manualCount`
 * conserve la même valeur (provenance de la saisie manuelle) — schéma et
 * données historiques inchangés.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function requireClient(ctx: Pick<MutationCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") {
		throw new ConvexError("Seuls les comptes clients peuvent enregistrer leurs pas.");
	}
	return user;
}

/**
 * Écrit la saisie/correction MANUELLE du jour : manualCount = count et la
 * valeur effective (`count`) devient cette saisie. Un jour déjà renseigné est
 * mis à jour (1 cliente + 1 date = 1 valeur) — jamais de doublon.
 */
async function upsertRow(
	ctx: Pick<MutationCtx, "db">,
	userId: Id<"users">,
	date: string,
	count: number
): Promise<void> {
	const existing = await ctx.db
		.query("dailySteps")
		.withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date))
		.first();
	if (existing) await ctx.db.patch(existing._id, { count, manualCount: count, createdAt: Date.now() });
	else await ctx.db.insert("dailySteps", { userId, date, count, manualCount: count, createdAt: Date.now() });
}

function validateCount(count: number): void {
	if (!Number.isFinite(count) || count < 0 || count > 150000 || !Number.isInteger(count)) {
		throw new ConvexError("Nombre de pas invalide (entre 0 et 150 000).");
	}
}

/**
 * Historique quotidien des pas + objectif coach — même source que le
 * dashboard et le CRM (aucune deuxième base de données). La page « Mes pas »
 * construit sa fenêtre de 7 jours côté client (fuseau de la cliente) ; une
 * journée sans ligne n'est jamais interprétée comme 0 pas.
 */
export const myHistory = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx: QueryCtx, { sessionToken }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user || user.role !== "client") throw new ConvexError("Session invalide.");
		const [goalsRow, rows] = await Promise.all([
			ctx.db.query("clientGoals").withIndex("by_userId", (q) => q.eq("userId", user._id)).first(),
			ctx.db.query("dailySteps").withIndex("by_user", (q) => q.eq("userId", user._id)).order("asc").collect(),
		]);
		return {
			goal: goalsRow?.stepGoal ?? null,
			rows: rows.map((r) => ({ date: r.date, count: r.count })),
		};
	},
});

/** Enregistre (ou corrige) le nombre de pas de la journée — saisie manuelle. */
export const setSteps = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
		count: v.number(),
	},
	handler: async (ctx, { sessionToken, date, count }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!DATE_RE.test(date)) throw new ConvexError("Date invalide.");
		validateCount(count);
		await upsertRow(ctx, user._id, date, count);
		return { ok: true };
	},
});
