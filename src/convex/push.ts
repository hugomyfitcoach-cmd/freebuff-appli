import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { getSessionUser } from "./helpers";

/**
 * Notifications push Web (service worker + VAPID).
 *
 * Le navigateur de la cliente s'abonne via le push service (Firebase Cloud
 * Messaging, Mozilla Autopush…) et nous stockons ici son endpoint + ses clés
 * de chiffrement (p256dh, auth). La clé privée VAPID, elle, vit UNIQUEMENT
 * côté serveur SvelteKit — jamais exposée ni stockée dans Convex.
 *
 * Flux :
 *   cliente (Accueil) ──subscribe──▶  push.saveSubscription
 *   coach (CRM) ──publication──▶  serveur SvelteKit lit subscriptionsFor
 *                                 et envoie la notification chiffrée (web-push).
 *
 * Les abonnements sont des données privées : supprimés avec le compte client.
 */

async function requireClient(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") throw new ConvexError("Réservé à l'espace cliente.");
	return user;
}

async function requireCoach(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "coach") throw new ConvexError("Accès réservé au coach.");
	return user;
}

/** Abonnement push envoyé par le navigateur (format PushSubscription JSON). */
export const saveSubscription = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		subscription: v.object({
			endpoint: v.string(),
			keys: v.object({ p256dh: v.string(), auth: v.string() }),
		}),
	},
	handler: async (ctx, { sessionToken, subscription }) => {
		const user = await requireClient(ctx, sessionToken);
		const endpoint = subscription.endpoint.slice(0, 500);
		const existing = await ctx.db
			.query("pushSubscriptions")
			.withIndex("by_user_endpoint", (q) => q.eq("userId", user._id).eq("endpoint", endpoint))
			.first();
		if (existing) return { ok: true };
		await ctx.db.insert("pushSubscriptions", {
			userId: user._id as never,
			endpoint,
			p256dh: subscription.keys.p256dh.slice(0, 200),
			auth: subscription.keys.auth.slice(0, 200),
			createdAt: Date.now(),
		});
		return { ok: true };
	},
});

/** Retire l'abonnement de la cliente connectée (désactivation / poussée rejetée). */
export const removeSubscription = mutation({
	args: { sessionToken: v.optional(v.string()), endpoint: v.string() },
	handler: async (ctx, { sessionToken, endpoint }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) return { ok: false };
		const rows = await ctx.db
			.query("pushSubscriptions")
			.withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint.slice(0, 500)))
			.collect();
		for (const r of rows) {
			if (r.userId === user._id || user.role === "coach") await ctx.db.delete(r._id);
		}
		return { ok: true };
	},
});

/** Retire un endpoint précis — appelé par le serveur quand le push service le déclare mort (410). */
export const removeEndpoint = mutation({
	args: { sessionToken: v.optional(v.string()), endpoint: v.string() },
	handler: async (ctx, { sessionToken, endpoint }) => {
		await requireCoach(ctx, sessionToken);
		const rows = await ctx.db
			.query("pushSubscriptions")
			.withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint.slice(0, 500)))
			.collect();
		for (const r of rows) await ctx.db.delete(r._id);
		return { ok: true };
	},
});

/** Abonnements push actifs d'une cliente (lecture par le serveur, via session coach). */
export const subscriptionsFor = query({
	args: { sessionToken: v.optional(v.string()), userId: v.id("users") },
	handler: async (ctx, { sessionToken, userId }) => {
		await requireCoach(ctx, sessionToken);
		const rows = await ctx.db
			.query("pushSubscriptions")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();
		return rows.map((r) => ({ endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }));
	},
});

/** Abonnements d'une cliente SANS session — réservé au moteur interne (cron rappel 12 h). */
export const internalSubscriptionsOfUser = internalQuery({
	args: { userId: v.id("users") },
	handler: async (ctx, { userId }) => {
		const rows = await ctx.db
			.query("pushSubscriptions")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();
		return rows.map((r) => ({ endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }));
	},
});

/** Retrait interne d'un endpoint mort (404/410) — moteur de rappel 12 h. */
export const internalRemoveEndpoint = internalMutation({
	args: { endpoint: v.string() },
	handler: async (ctx, { endpoint }) => {
		const rows = await ctx.db
			.query("pushSubscriptions")
			.withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint.slice(0, 500)))
			.collect();
		for (const r of rows) await ctx.db.delete(r._id);
		return { ok: true };
	},
});

/**
 * État de permission notifications déclaré par le navigateur de la cliente
 * ("granted" | "denied" | "unsupported" | "default"). Sert au moteur de
 * rappel 12 h : permission refusée ou indisponible → rappel interne + badge
 * uniquement (le push n'est jamais une dépendance, §24).
 */
export const setPermission = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		permission: v.union(
			v.literal("granted"),
			v.literal("denied"),
			v.literal("unsupported"),
			v.literal("default")
		),
	},
	handler: async (ctx, { sessionToken, permission }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) return { ok: false };
		if (user.pushPermission !== permission) {
			await ctx.db.patch(user._id, { pushPermission: permission, pushPermissionAskedAt: Date.now() });
		}
		return { ok: true };
	},
});

/** Supprime tous les abonnements d'une cliente (suppression de compte). */
export async function deleteAllForUser(ctx: Pick<MutationCtx, "db">, userId: string) {
	const rows = await ctx.db
		.query("pushSubscriptions")
		.withIndex("by_user", (q) => q.eq("userId", userId as never))
		.collect();
	for (const r of rows) await ctx.db.delete(r._id);
}