import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { getSessionUser } from "./helpers";

/**
 * Connexion OAuth Google Calendar du coach (système de rendez-vous).
 *
 * Le refresh token est chiffré AES-256-GCM côté serveur SvelteKit (BFF)
 * avec GOOGLE_ENC_KEY — la table `googleAccounts` ne stocke JAMAIS le
 * token en clair, seulement le blob chiffré (base64) + ses métadonnées
 * non sensibles. Deux fonctions renvoient les blobs (`secrets`),
 * strictement réservées au coach : les blobs ne sortent jamais vers le
 * navigateur.
 */

async function requireCoach(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "coach") throw new ConvexError("Accès réservé au coach.");
	return user;
}

function publicConnection(c: Doc<"googleAccounts">) {
	return {
		email: c.email,
		scope: c.scope,
		expiry: c.expiry ?? null,
		connectedAt: c.connectedAt,
	};
}

/** État de connexion Google Calendar du coach (aucun token ici). */
export const status = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireCoach(ctx, sessionToken);
		const c = await ctx.db
			.query("googleAccounts")
			.withIndex("by_coach", (q) => q.eq("coachId", user._id))
			.unique();
		return c ? publicConnection(c) : null;
	},
});

/** Blobs chiffrés du coach (déchiffrés en mémoire côté BFF, jamais au navigateur). */
export const secrets = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireCoach(ctx, sessionToken);
		const c = await ctx.db
			.query("googleAccounts")
			.withIndex("by_coach", (q) => q.eq("coachId", user._id))
			.unique();
		if (!c) return null;
		return {
			email: c.email,
			scope: c.scope,
			encRefreshToken: c.encRefreshToken,
			encAccessToken: c.encAccessToken ?? null,
			expiry: c.expiry ?? null,
		};
	},
});

/**
 * Blobs chiffrés pour un appel BFF sans session coach (réservation cliente) :
 * accessible uniquement au coach lui-même ou à une cliente rattachée à CE
 * coach. Les blobs restent chiffrés (clé GOOGLE_ENC_KEY côté serveur) —
 * l'exposition à une cliente du coach ne révèle aucun secret déchiffrable.
 */
export const secretsForClientOfCoach = query({
	args: { sessionToken: v.optional(v.string()), coachId: v.id("users") },
	handler: async (ctx, { sessionToken, coachId }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
		const isCoach = user.role === "coach" && user._id === coachId;
		const isClientOf = user.role === "client" && user.createdBy === coachId;
		if (!isCoach && !isClientOf) throw new ConvexError("Accès refusé : ce coach ne t'est pas rattaché.");
		const c = await ctx.db
			.query("googleAccounts")
			.withIndex("by_coach", (q) => q.eq("coachId", coachId))
			.unique();
		if (!c) return null;
		return {
			coachId: c.coachId,
			email: c.email,
			encRefreshToken: c.encRefreshToken,
			encAccessToken: c.encAccessToken ?? null,
			expiry: c.expiry ?? null,
		};
	},
});

/** Enregistre (ou remplace) la connexion OAuth du coach — blobs chiffrés uniquement. */
export const upsertConnection = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		email: v.string(),
		/** Refresh token chiffré AES-256-GCM (base64) — jamais en clair. */
		encRefreshToken: v.string(),
		/** Access token chiffré (base64). */
		encAccessToken: v.optional(v.string()),
		/** Expiration de l'access token (ms) — 0 si inconnue. */
		expiry: v.optional(v.number()),
		scope: v.string(),
	},
	handler: async (ctx, { sessionToken, email, encRefreshToken, encAccessToken, expiry, scope }) => {
		const user = await requireCoach(ctx, sessionToken);
		const existing = await ctx.db
			.query("googleAccounts")
			.withIndex("by_coach", (q) => q.eq("coachId", user._id))
			.unique();
		const patch = {
			email,
			encRefreshToken,
			...(encAccessToken !== undefined ? { encAccessToken } : {}),
			...(expiry !== undefined ? { expiry } : {}),
			scope,
			connectedAt: Date.now(),
		};
		if (existing) await ctx.db.patch(existing._id, patch);
		else await ctx.db.insert("googleAccounts", { coachId: user._id, ...patch });
		return { ok: true };
	},
});

/** Persiste un access token rafraîchi (chiffré) — le refresh token reste inchangé. */
export const updateAccess = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		encAccessToken: v.string(),
		expiry: v.number(),
	},
	handler: async (ctx, { sessionToken, encAccessToken, expiry }) => {
		const user = await requireCoach(ctx, sessionToken);
		const c = await ctx.db
			.query("googleAccounts")
			.withIndex("by_coach", (q) => q.eq("coachId", user._id))
			.unique();
		if (c) await ctx.db.patch(c._id, { encAccessToken, expiry });
		return { ok: true };
	},
});

/** Persiste un access token rafraîchi — même contrôle d'accès que secretsForClientOfCoach. */
export const updateAccessForCoach = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		coachId: v.id("users"),
		encAccessToken: v.string(),
		expiry: v.number(),
	},
	handler: async (ctx, { sessionToken, coachId, encAccessToken, expiry }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
		const isCoach = user.role === "coach" && user._id === coachId;
		const isClientOf = user.role === "client" && user.createdBy === coachId;
		if (!isCoach && !isClientOf) throw new ConvexError("Accès refusé : ce coach ne t'est pas rattaché.");
		const c = await ctx.db
			.query("googleAccounts")
			.withIndex("by_coach", (q) => q.eq("coachId", coachId))
			.unique();
		if (c) await ctx.db.patch(c._id, { encAccessToken, expiry });
		return { ok: true };
	},
});

/** Déconnecte le compte Google Calendar du coach (blobs chiffrés supprimés). */
export const disconnect = mutation({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireCoach(ctx, sessionToken);
		const c = await ctx.db
			.query("googleAccounts")
			.withIndex("by_coach", (q) => q.eq("coachId", user._id))
			.unique();
		if (c) await ctx.db.delete(c._id);
		return { ok: true };
	},
});
