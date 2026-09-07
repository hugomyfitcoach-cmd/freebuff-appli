import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Photos de suivi : le client choisit un moment (démarrage, mois 1…6) et
 * envoie des photos, stockées définitivement dans le file storage Convex.
 *
 * - Le client ne peut que déposer des photos et voir la confirmation d'envoi
 *   (jamais les images après coup : `mySubmissions` ne renvoie aucun URL).
 * - La coach voit toutes les photos (avec URL) dans le CRM (`listForCoach`).
 */

export const PHOTO_STEPS = ["demarrage", "mois1", "mois2", "mois3", "mois4", "mois5", "mois6"] as const;
export type PhotoStep = (typeof PHOTO_STEPS)[number];

export const PHOTO_STEP_LABELS: Record<PhotoStep, string> = {
	demarrage: "Démarrage",
	mois1: "Mois 1",
	mois2: "Mois 2",
	mois3: "Mois 3",
	mois4: "Mois 4",
	mois5: "Mois 5",
	mois6: "Mois 6",
};

export function isPhotoStep(s: string): s is PhotoStep {
	return (PHOTO_STEPS as readonly string[]).includes(s);
}

async function requireClient(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") throw new ConvexError("Seuls les comptes clients peuvent envoyer des photos de suivi.");
	return user;
}

/** Génère une URL d'upload Convex (courte durée). Le client poste le fichier dessus. */
export const generateUploadUrl = mutation({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		await requireClient(ctx, sessionToken);
		return await ctx.storage.generateUploadUrl();
	},
});

/** Enregistre une série de photos (les fichiers ont déjà été uploadés via l'URL). */
export const submit = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		step: v.string(),
		photos: v.array(v.object({ storageId: v.id("_storage"), label: v.string() })),
	},
	handler: async (ctx, { sessionToken, step, photos }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isPhotoStep(step)) throw new ConvexError("Moment invalide.");
		if (photos.length < 1 || photos.length > 6) {
			throw new ConvexError("Envoie entre 1 et 6 photos.");
		}
		const now = new Date();
		const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
		await ctx.db.insert("progressPhotos", {
			userId: user._id,
			step,
			date,
			photos,
			createdAt: Date.now(),
		});
		return { ok: true, count: photos.length };
	},
});

/** Métadonnées des envois du client connecté (confirmation uniquement, jamais les images). */
export const mySubmissions = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireClient(ctx, sessionToken);
		const rows = await ctx.db
			.query("progressPhotos")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.order("desc")
			.collect();
		return rows.map((r) => ({
			_id: r._id,
			step: r.step,
			date: r.date,
			createdAt: r._creationTime,
			count: r.photos.length,
		}));
	},
});

/** Toutes les photos d'un client avec leurs URL — réservé à la coach (CRM). */
export const listForCoach = query({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
	},
	handler: async (ctx, { sessionToken, userId }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") throw new ConvexError("Réservé à la coach.");
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") throw new ConvexError("Client introuvable.");
		const rows = await ctx.db
			.query("progressPhotos")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.order("asc")
			.collect();
		const result: {
			_id: Id<"progressPhotos">;
			step: string;
			date: string;
			createdAt: number;
			photos: { storageId: Id<"_storage">; label: string; url: string | null }[];
		}[] = [];
		for (const row of rows) {
			const photos = [];
			for (const p of row.photos) {
				photos.push({ storageId: p.storageId, label: p.label, url: await ctx.storage.getUrl(p.storageId) });
			}
			result.push({
				_id: row._id,
				step: row.step,
				date: row.date,
				createdAt: row._creationTime,
				photos,
			});
		}
		return result;
	},
});