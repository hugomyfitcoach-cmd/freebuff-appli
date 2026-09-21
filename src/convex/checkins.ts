import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { answersValidator } from "./answers";
import { formatWeekLabel, getSessionUser, isMondayISO } from "./helpers";
import type { QueryCtx } from "./_generated/server";
import { recordEvent } from "./notifications";

/**
 * Bilan hebdo côté client — tout est rattaché au compte connecté
 * (plus d'identification par prénom/nom). Le jeton de session est vérifié
 * dans la fonction : impossible d'écrire ou de lire pour quelqu'un d'autre.
 */

async function requireClient(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") {
		throw new ConvexError("Seuls les comptes clients peuvent remplir un bilan hebdo.");
	}
	return user;
}

/**
 * Soumet (ou met à jour) le bilan hebdo de la semaine pour l'utilisateur
 * connecté. Une fois le retour coach envoyé, le bilan est verrouillé.
 */
export const submit = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		weekStart: v.string(),
		answers: answersValidator,
	},
	handler: async (ctx, { sessionToken, weekStart, answers }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isMondayISO(weekStart)) {
			throw new ConvexError("La semaine envoyée est invalide.");
		}

		const existing = await ctx.db
			.query("checkins")
			.withIndex("by_user_week", (q) => q.eq("userId", user._id).eq("weekStart", weekStart))
			.first();

		if (existing) {
			if (existing.status === "retour_envoye") {
				throw new ConvexError(
					"Ce bilan de la semaine a déjà été validé par ton coach. Envoie-lui un message sur WhatsApp si besoin."
				);
			}
			const weekLabel = formatWeekLabel(weekStart);
			await ctx.db.patch(existing._id, { answers, weekLabel });
			// Journal CRM : le bilan (re)soumis avant retour est une activité réelle
			// de la cliente — même mécanisme central que les autres événements.
			await recordEvent(ctx, user._id, "bilan_envoye", `Bilan mis à jour — ${weekLabel}`, { weekStart });
			return { checkinId: existing._id, weekLabel, updated: true };
		}

		const weekLabelNew = formatWeekLabel(weekStart);
		const checkinId = await ctx.db.insert("checkins", {
			userId: user._id,
			weekStart,
			weekLabel: weekLabelNew,
			answers,
			status: "nouveau",
		});
		// Journal CRM : « Bilan hebdo envoyé » — le coach le voit live dans son
		// journal (badge temps réel), sans attendre le tick ni un refresh.
		await recordEvent(ctx, user._id, "bilan_envoye", `Bilan hebdo envoyé — ${weekLabelNew}`, { weekStart });
		return { checkinId, weekLabel: weekLabelNew, updated: false };
	},
});

/** Tous les bilans de l'utilisateur connecté, du plus récent au plus ancien. */
export const myCheckins = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireClient(ctx, sessionToken);
		const rows = await ctx.db
			.query("checkins")
			.withIndex("by_user_week", (q) => q.eq("userId", user._id))
			.order("desc")
			.collect();
		return rows;
	},
});
