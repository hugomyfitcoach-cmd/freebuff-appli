import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import type { Doc } from "./_generated/dataModel";

/**
 * Dossier G-FLUX — une entrée par note ou fichier, rattachée à une cliente.
 *
 * Visibilité par entrée :
 *  - « private » (défaut) : note / document privé coach — jamais envoyé ;
 *  - « shared »          : partagé avec la cliente → visible dans « Ressources ».
 *
 * Aucune duplication physique : le fichier vit une seule fois sur le storage ;
 * seule la visibilité détermine qui peut y accéder. La cliente ne peut ni
 * modifier, ni supprimer, ni changer la visibilité.
 */

type Resource = Doc<"coachResources">;
type UserDoc = Doc<"users">;

async function requireCoach(ctx: { db: import("./_generated/server").QueryCtx["db"] }, sessionToken: string | undefined | null): Promise<UserDoc> {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "coach") throw new ConvexError("Accès réservé à la coach (CRM).");
	return user;
}

async function requireClient(ctx: { db: import("./_generated/server").QueryCtx["db"] }, sessionToken: string | undefined | null): Promise<UserDoc> {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") throw new ConvexError("Accès réservé à l'espace cliente.");
	return user;
}

async function targetClient(ctx: { db: import("./_generated/server").QueryCtx["db"] }, userId: string) {
	const target = await ctx.db.get(userId as import("./_generated/dataModel").Id<"users">);
	if (!target || target.role !== "client") throw new ConvexError("Cliente introuvable.");
	return target;
}

/** Ajoute l'URL de lecture aux entrées fichier (storage) — tri : plus récent d'abord. */
async function withUrls(
	ctx: { db: import("./_generated/server").QueryCtx["db"]; storage: { getUrl(storageId: import("./_generated/dataModel").Id<"_storage">): Promise<string | null> } },
	rows: Resource[]
) {
	const out: (Resource & { url: string | null })[] = [];
	for (const r of rows) {
		let url: string | null = null;
		if (r.kind === "file" && r.storageId) url = await ctx.storage.getUrl(r.storageId);
		out.push({ ...r, url });
	}
	out.sort((a, b) => b.createdAt - a.createdAt);
	return out;
}

/** Contenu du Dossier d'une cliente pour le CRM (privé + partagé, tout confondu). */
export const coachResources = query({
	args: { sessionToken: v.optional(v.string()), userId: v.id("users") },
	handler: async (ctx, { sessionToken, userId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		await targetClient(ctx, userId);
		const rows = await ctx.db.query("coachResources").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
		return await withUrls(ctx, rows);
	},
});

/** Page cliente « Ressources » : uniquement les entrées explicitement partagées (visibility = shared). */
export const clientResources = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireClient(ctx, sessionToken);
		const rows = await ctx.db
			.query("coachResources")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.filter((q) => q.eq(q.field("visibility"), "shared"))
			.collect();
		return await withUrls(ctx, rows);
	},
});

/** Crée une entrée du Dossier (note ou fichier déjà uploadé sur le storage). Visibilité par défaut : privée coach. */
export const addResource = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		kind: v.union(v.literal("note"), v.literal("file")),
		title: v.string(),
		body: v.optional(v.string()),
		storageId: v.optional(v.id("_storage")),
		mime: v.optional(v.string()),
		name: v.optional(v.string()),
		size: v.optional(v.number()),
	},
	handler: async (ctx, { sessionToken, userId, kind, title, body, storageId, mime, name, size }) => {
		await requireCoach(ctx, sessionToken);
		await targetClient(ctx, userId);
		const titleClean = title.trim().slice(0, 120);
		if (!titleClean) throw new ConvexError("Donne un titre à cette entrée.");
		if (kind === "file" && (!storageId || !mime || !name || !size)) {
			throw new ConvexError("Fichier incomplet (upload requis d'abord).");
		}
		if (kind === "note") {
			const bodyClean = body?.trim().slice(0, 20_000) ?? "";
			if (!bodyClean) throw new ConvexError("Écris le contenu de la note.");
		}
		const now = Date.now();
		const id = await ctx.db.insert("coachResources", {
			userId: userId as never,
			kind,
			title: titleClean,
			...(kind === "note" ? { body: (body?.trim() ?? "").slice(0, 20_000) } : {}),
			// Défaut : privé coach — le partage est un choix explicite du coach.
			visibility: "private",
			...(kind === "file"
				? {
						storageId: storageId as never,
						mime: (mime ?? "").slice(0, 120),
						name: (name ?? "").slice(0, 200),
						size: size ?? 0,
					}
				: {}),
			createdAt: now,
			updatedAt: now,
		});
		return { ok: true, resourceId: id };
	},
});

/** Modifie titre / contenu / visibilité d'une entrée du Dossier (contrôle « Privé coach ⇄ Partager »). */
export const updateResource = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		resourceId: v.id("coachResources"),
		title: v.optional(v.string()),
		body: v.optional(v.string()),
		visibility: v.optional(v.union(v.literal("private"), v.literal("shared"))),
	},
	handler: async (ctx, { sessionToken, resourceId, title, body, visibility }) => {
		await requireCoach(ctx, sessionToken);
		const row = await ctx.db.get(resourceId);
		if (!row) throw new ConvexError("Entrée introuvable.");
		const patch: Record<string, unknown> = { updatedAt: Date.now() };
		if (title !== undefined) {
			const t = title.trim().slice(0, 120);
			if (!t) throw new ConvexError("Donne un titre à cette entrée.");
			patch.title = t;
		}
		if (row.kind === "note" && body !== undefined) {
			const b = body.trim().slice(0, 20_000);
			if (!b) throw new ConvexError("Écris le contenu de la note.");
			patch.body = b;
		}
		if (visibility !== undefined) patch.visibility = visibility;
		await ctx.db.patch(resourceId, patch);
		return { ok: true };
	},
});

/** Supprime définitivement une entrée (fichier du storage inclus) — réservé à la coach. */
export const deleteResource = mutation({
	args: { sessionToken: v.optional(v.string()), resourceId: v.id("coachResources") },
	handler: async (ctx, { sessionToken, resourceId }) => {
		await requireCoach(ctx, sessionToken);
		const row = await ctx.db.get(resourceId);
		if (!row) return { ok: true };
		if (row.kind === "file" && row.storageId) {
			await ctx.storage.delete(row.storageId).catch(() => {});
		}
		await ctx.db.delete(resourceId);
		return { ok: true };
	},
});

/** Suppression définitive de la cliente : vide son Dossier (fichiers compris). */
export async function deleteAllResourcesForUser(
	ctx: { db: import("./_generated/server").MutationCtx["db"]; storage: { delete(storageId: import("./_generated/dataModel").Id<"_storage">): Promise<void> } },
	userId: import("./_generated/dataModel").Id<"users">
) {
	const rows = await ctx.db.query("coachResources").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
	for (const r of rows) {
		if (r.kind === "file" && r.storageId) await ctx.storage.delete(r.storageId).catch(() => {});
		await ctx.db.delete(r._id);
	}
}
