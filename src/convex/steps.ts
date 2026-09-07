import { mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Pas quotidiens côté cliente — une seule valeur par jour (`dailySteps`),
 * modifiable si la cliente s'est trompée. La moyenne hebdo n'est jamais
 * calculée sur les jours sans donnée (jour vide ≠ 0) : les agrégations
 * vivent dans dashboard.getDashboard (récap cliente) et coach.client360
 * (cockpit CRM), qui ne comptent que les jours réellement renseignés.
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
	if (existing) await ctx.db.patch(existing._id, { count, createdAt: Date.now() });
	else await ctx.db.insert("dailySteps", { userId, date, count, createdAt: Date.now() });
}

/** Enregistre (ou corrige) le nombre de pas de la journée. */
export const setSteps = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
		count: v.number(),
	},
	handler: async (ctx, { sessionToken, date, count }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!DATE_RE.test(date)) throw new ConvexError("Date invalide.");
		if (!Number.isFinite(count) || count < 0 || count > 150000 || !Number.isInteger(count)) {
			throw new ConvexError("Nombre de pas invalide (entre 0 et 150 000).");
		}
		await upsertRow(ctx, user._id, date, count);
		return { ok: true };
	},
});
