import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getSessionUser, localTodayISO } from "./helpers";

/** Types structurels minimaux pour partager helpers entre query/mutation. */
type DbOnly = { db: QueryCtx["db"] };
type WriterDb = MutationCtx["db"];
type ReaderCtx = { db: QueryCtx["db"] } & {
	storage: { getUrl(storageId: Id<"_storage">): Promise<string | null> };
};
type WriterCtx = { db: WriterDb } & {
	storage: { delete(storageId: Id<"_storage">): Promise<void> };
};

/**
 * Médias coach → cliente (retour audio, pièces jointes de bilan, message
 * audio du coach).
 *
 * Les fichiers vivent dans le file storage Convex — jamais dans les documents
 * métier. Cette table conserve les métadonnées et le cycle de vie :
 *
 *   brouillon (invisible cliente) → publié → expiré (fichier réellement supprimé)
 *
 * Rétention audio :
 *   - 72 h après la première écoute réelle (firstListenedAt) ;
 *   - au plus tard 14 jours après la publication ;
 *   - la première échéance atteinte gagne.
 *
 * Les pièces jointes (images optimisées, PDF) sont conservées dans l'historique.
 */

const AUDIO_EXPIRE_MS = 72 * 3600 * 1000; // 72 h après première écoute
const MAX_PUBLISH_MS = 14 * 24 * 3600 * 1000; // 14 j après publication

export const mediaSource = v.union(
	v.literal("checkin_feedback_audio"),
	v.literal("checkin_attachment"),
	v.literal("coach_message_audio")
);
export const mediaKind = v.union(v.literal("audio"), v.literal("image"), v.literal("pdf"));

type MediaRow = Doc<"coachMedia">;

/** Échéance d'expiration d'un fichier (null si aucune rétention ne s'applique). */
export function mediaExpiresAt(row: Pick<MediaRow, "status" | "publishedAt" | "firstListenedAt" | "kind">): number | null {
	if (row.kind !== "audio" || row.status !== "published" || !row.publishedAt) return null;
	const fromListen = row.firstListenedAt ? row.firstListenedAt + AUDIO_EXPIRE_MS : null;
	const fromPublish = row.publishedAt + MAX_PUBLISH_MS;
	return fromListen ? Math.min(fromListen, fromPublish) : fromPublish;
}

async function requireCoach(ctx: DbOnly, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "coach") throw new ConvexError("Accès réservé au coach.");
	return user;
}

async function requireClient(ctx: DbOnly, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") throw new ConvexError("Accès réservé à l'espace cliente.");
	return user;
}

async function targetClient(ctx: DbOnly, userId: string) {
	const target = await ctx.db.get(userId as Id<"users">);
	if (!target || target.role !== "client") throw new ConvexError("Cliente introuvable.");
	return target;
}

/** URL d'upload Convex (courte durée) — la route serveur y POST le fichier. */
export const generateUploadUrl = mutation({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		await requireCoach(ctx, sessionToken);
		return await ctx.storage.generateUploadUrl();
	},
});

/**
 * Enregistre les métadonnées d'un fichier déjà uploadé sur le storage.
 * Le fichier démarre en brouillon : il ne devient visible côté cliente qu'au
 * moment explicite de la publication (retour de bilan ou message du coach).
 */
export const record = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		source: mediaSource,
		checkinId: v.optional(v.id("checkins")),
		kind: mediaKind,
		storageId: v.id("_storage"),
		mime: v.string(),
		name: v.string(),
		size: v.number(),
		durationMs: v.optional(v.number()),
	},
	handler: async (ctx, { sessionToken, userId, source, checkinId, kind, storageId, mime, name, size, durationMs }) => {
		const coach = await requireCoach(ctx, sessionToken);
		await targetClient(ctx, userId);
		if (source !== "coach_message_audio" && !checkinId) {
			throw new ConvexError("Un retour/pièce jointe doit être lié à un bilan.");
		}
		if (checkinId) {
			const checkin = await ctx.db.get(checkinId);
			if (!checkin || checkin.userId !== userId) throw new ConvexError("Bilan introuvable pour cette cliente.");
		}
		const id = await ctx.db.insert("coachMedia", {
			userId: userId as never,
			coachId: coach._id,
			source,
			checkinId,
			kind,
			storageId,
			mime,
			name: name.slice(0, 200),
			size,
			durationMs,
			status: "draft",
			createdAt: Date.now(),
		});
		return { mediaId: id };
	},
});

/**
 * Supprime réellement un fichier (storage + ligne). Réservé à la coach :
 * brouillons à remplacer/supprimer, ou fichiers d'un retour passé en
 * brouillon. Un fichier déjà consulté peut être retiré manuellement.
 */
export const deleteMedia = mutation({
	args: { sessionToken: v.optional(v.string()), mediaId: v.id("coachMedia") },
	handler: async (ctx, { sessionToken, mediaId }) => {
		await requireCoach(ctx, sessionToken);
		const row = await ctx.db.get(mediaId);
		if (!row) return { ok: true };
		// Si l'audio supprimé était le « message du coach » actif, on nettoie la référence.
		if (row.source === "coach_message_audio") {
			const target = await ctx.db.get(row.userId);
			if (target && target.coachMessageAudioId === mediaId) {
				await ctx.db.patch(row.userId, { coachMessageAudioId: undefined });
			}
		}
		await ctx.storage.delete(row.storageId);
		await ctx.db.delete(mediaId);
		return { ok: true };
	},
});

/** Première écoute réelle d'un retour audio par la cliente → déclenche la rétention 72 h. */
export const markListened = mutation({
	args: { sessionToken: v.optional(v.string()), mediaId: v.id("coachMedia") },
	handler: async (ctx, { sessionToken, mediaId }) => {
		const user = await requireClient(ctx, sessionToken);
		const row = await ctx.db.get(mediaId);
		if (!row || row.userId !== user._id) return { ok: false };
		if (row.kind === "audio" && row.status === "published" && !row.firstListenedAt) {
			await ctx.db.patch(mediaId, { firstListenedAt: Date.now() });
		}
		return { ok: true };
	},
});

/** Fichiers d'un bilan pour le CRM (brouillons inclus — réservé à la coach). */
export const forCheckin = query({
	args: { sessionToken: v.optional(v.string()), checkinId: v.id("checkins") },
	handler: async (ctx, { sessionToken, checkinId }) => {
		await requireCoach(ctx, sessionToken);
		const rows = await ctx.db
			.query("coachMedia")
			.withIndex("by_checkin", (q) => q.eq("checkinId", checkinId))
			.order("asc")
			.collect();
		return await hydrate(ctx, rows);
	},
});

/** Tous les fichiers d'une cliente (CRM — brouillons inclus). */
export const forUser = query({
	args: { sessionToken: v.optional(v.string()), userId: v.id("users") },
	handler: async (ctx, { sessionToken, userId }) => {
		await requireCoach(ctx, sessionToken);
		await targetClient(ctx, userId as never);
		const rows = await ctx.db
			.query("coachMedia")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.order("asc")
			.collect();
		return await hydrate(ctx, rows);
	},
});

/**
 * Médias publiés de la cliente connectée (retours de bilans + message audio
 * actif). Les brouillons n'existent jamais ici. Un fichier expiré est renvoyé
 * avec url:null pour afficher « Retour audio expiré » sans lien cassé.
 */
export const myPublished = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireClient(ctx, sessionToken);
		const rows = await ctx.db
			.query("coachMedia")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.collect();
		const published = rows.filter((r) => r.status === "published");
		const all = await hydrate(ctx, published);
		const byCheckin = new Map<string, typeof all>();
		for (const m of all) {
			if (!m.checkinId) continue;
			const list = byCheckin.get(m.checkinId) ?? [];
			list.push(m);
			byCheckin.set(m.checkinId, list);
		}
		return {
			byCheckin: Object.fromEntries(byCheckin),
			messageAudio: all.find((m) => m.source === "coach_message_audio" && m.checkinId == null) ?? null,
		};
	},
});

/**
 * Message du coach du jour : éphémère — il expire au MINUIT LOCAL DE LA
 * CLIENTE suivant la publication (coachMessageExpiresAt, calculé dans son
 * fuseau à la publication) ; on retire alors le message (texte/audio) de
 * l'état actif (Accueil). Replis compat : messages antérieurs au passage en
 * horodatage = 24 h fixes, puis (pré-timestamp) = jour exact. Les FICHIERS
 * audio référencés par le journal CRM (coachMessages) sont conservés pour la
 * réécoute dans la Vision 360 ; seuls les fichiers sans autre utilité
 * (brouillons, doublons) sont réellement supprimés. Les retours de bilan ne
 * sont PAS concernés : ils font partie de l'historique (rétention 72 h/14 j).
 */
async function expireStaleCoachMessages(ctx: WriterCtx, now: number) {
	const users = await ctx.db
		.query("users")
		.filter((q) => q.eq(q.field("role"), "client"))
		.collect();
	let removed = 0;
	for (const u of users) {
		// Expiration : minuit local cliente stocké à la publication → repli 24 h
		// fixes pour les messages antérieurs → repli jour exact (jamais un message
		// périmé qui ressortirait). Le cron horaire ne nettoie jamais un message frais.
		let expired = false;
		if (u.coachMessageExpiresAt != null) {
			expired = now >= u.coachMessageExpiresAt;
		} else if (u.coachMessageAt != null) {
			expired = now - u.coachMessageAt >= 24 * 3600 * 1000;
		} else if (u.coachMessageDate != null) {
			expired = u.coachMessageDate < localTodayISO(new Date(now));
		}
		if (!expired) continue;
		await ctx.db.patch(u._id, {
			coachMessage: undefined,
			coachMessageDate: undefined,
			coachMessageAt: undefined,
			coachMessageExpiresAt: undefined,
			coachMessageReadAt: undefined,
			coachMessageAudioId: undefined,
		});
		// Supprime uniquement les fichiers non référencés par le journal CRM.
		await deleteMessageAudioRows(ctx, u._id);
		removed++;
	}
	return removed;
}

/** Ids des audios conservés par le journal CRM (coachMessages) — pour une cliente. */
async function journalAudioIds(ctx: Pick<WriterCtx, "db">, userId: Id<"users">): Promise<Set<string>> {
	const rows = await ctx.db
		.query("coachMessages")
		.withIndex("by_user", (q) => q.eq("userId", userId as never))
		.collect();
	return new Set(rows.map((r) => (r.audioId ? String(r.audioId) : "")).filter(Boolean));
}

/** Ids de TOUS les audios journalisés (toutes clientes) — pour le cron global. */
async function allJournalAudioIds(ctx: Pick<WriterCtx, "db">): Promise<Set<string>> {
	const rows = await ctx.db.query("coachMessages").collect();
	return new Set(rows.map((r) => (r.audioId ? String(r.audioId) : "")).filter(Boolean));
}

/** Nettoyage automatique des audios expirés (cron horaire) — suppression réelle du storage. */
export const expire = mutation({
	args: { sessionToken: v.optional(v.string()), guard: v.optional(v.string()) },
	handler: async (ctx, { sessionToken, guard }) => {
		// Appelé par le cron sans session. Garde-fou anti-abus : seuls le cron
		// (sans jeton) ou un coach authentifié peuvent déclencher la purge.
		if (sessionToken && guard) {
			const user = await getSessionUser(ctx, sessionToken);
			if (!user || user.role !== "coach") throw new ConvexError("Accès réservé au coach.");
		} else if (sessionToken || !guard || guard !== "cron-purge-2026") {
			throw new ConvexError("Purge refusée.");
		}
		const now = Date.now();
		// 1) Messages du coach du jour expirés (minuit local cliente) : retrait de
		//    l'état actif ; les fichiers journalisés (Vision 360) sont conservés.
		await expireStaleCoachMessages(ctx, now);
		// Audios conservés par le journal CRM : jamais purgés, ni par l'éphémère
		// 24 h ni par la rétention 72 h/14 j (ils servent à la réécoute coach).
		const journaled = await allJournalAudioIds(ctx);
		const rows = await ctx.db.query("coachMedia").collect();
		let removed = 0;
		for (const row of rows) {
			// Audios publiés : première échéance atteinte (72 h après écoute / 14 j max).
			if (row.kind === "audio" && row.status === "published") {
				// Audio du message du jour référencé par le journal CRM : conservé pour
				// la réécoute coach — ni l'éphémère 24 h ni la rétention ne s'appliquent.
				if (row.source === "coach_message_audio" && journaled.has(String(row._id))) {
					continue;
				}
				// Audio du message du jour non journalisé (orphelin) : éphémère 24 h.
				if (row.source === "coach_message_audio" && row.publishedAt && now - row.publishedAt >= 24 * 3600 * 1000) {
					await ctx.storage.delete(row.storageId);
					await ctx.db.delete(row._id);
					removed++;
					continue;
				}
				const expiresAt = mediaExpiresAt(row);
				if (expiresAt && expiresAt <= now) {
					await ctx.storage.delete(row.storageId);
					await ctx.db.patch(row._id, { status: "expired" });
					removed++;
				}
				continue;
			}
			// Brouillons abandonnés (jamais publiés) : purge douce pour ne jamais
			// laisser de fichiers orphelins — 24 h pour un message audio jamais
			// envoyé, 3 jours pour un retour de bilan jamais publié.
			if (row.status === "draft") {
				const age = now - row.createdAt;
				const limit = row.source === "coach_message_audio" ? 24 * 3600 * 1000 : 3 * 24 * 3600 * 1000;
				if (age > limit) {
					await ctx.storage.delete(row.storageId);
					await ctx.db.delete(row._id);
					removed++;
				}
			}
		}
		return { removed };
	},
});

/* ── Helpers ─────────────────────────────────────────────────────────── */

async function hydrate(ctx: ReaderCtx, rows: MediaRow[]) {
	const out = [];
	for (const row of rows) {
		const expiresAt = mediaExpiresAt(row);
		const expired = row.status === "expired" || (expiresAt !== null && expiresAt <= Date.now());
		out.push({
			_id: row._id,
			userId: row.userId,
			source: row.source,
			checkinId: row.checkinId ?? null,
			kind: row.kind,
			mime: row.mime,
			name: row.name,
			size: row.size,
			durationMs: row.durationMs ?? null,
			status: expired && row.status !== "expired" ? "expired" : row.status,
			publishedAt: row.publishedAt ?? null,
			firstListenedAt: row.firstListenedAt ?? null,
			createdAt: row.createdAt,
			expiresAt,
			expired,
			url: expired ? null : await ctx.storage.getUrl(row.storageId),
		});
	}
	return out;
}

/**
 * Publie (ou retire) les médias d'un bilan quand le retour passe publié /
 * brouillon. Appelé par coach.setFeedback — un seul point de vérité pour la
 * visibilité côté cliente.
 */
export async function setCheckinMediaVisibility(
	ctx: Pick<MutationCtx, "db">,
	checkinId: Id<"checkins">,
	published: boolean
) {
	const rows = await ctx.db
		.query("coachMedia")
		.withIndex("by_checkin", (q) => q.eq("checkinId", checkinId as never))
		.collect();
	const now = Date.now();
	for (const row of rows) {
		if (row.status === "expired") continue;
		if (published && row.status === "draft") {
			await ctx.db.patch(row._id, { status: "published", publishedAt: now });
		} else if (!published && row.status === "published") {
			// Retour passé en brouillon → les fichiers redeviennent invisibles.
			await ctx.db.patch(row._id, {
				status: "draft",
				publishedAt: undefined,
				firstListenedAt: undefined,
			});
		}
	}
}

/**
 * Supprime les fichiers du message du coach d'une cliente (remplacement ou
 * effacement) — JAMAIS ceux référencés par le journal CRM (coachMessages),
 * qui servent à la réécoute dans la Vision 360.
 */
export async function deleteMessageAudioRows(
	ctx: WriterCtx,
	userId: Id<"users">,
	exceptId?: Id<"coachMedia">
) {
	const rows = await ctx.db
		.query("coachMedia")
		.withIndex("by_user_source", (q) => q.eq("userId", userId as never).eq("source", "coach_message_audio"))
		.collect();
	const journaled = await journalAudioIds(ctx, userId);
	for (const row of rows) {
		if (exceptId && row._id === exceptId) continue;
		if (journaled.has(String(row._id))) continue;
		await ctx.storage.delete(row.storageId);
		await ctx.db.delete(row._id);
	}
}

/** Supprime tous les fichiers d'une cliente (suppression de compte). */
export async function deleteAllForUser(ctx: WriterCtx, userId: string) {
	const rows = await ctx.db
		.query("coachMedia")
		.withIndex("by_user", (q) => q.eq("userId", userId as never))
		.collect();
	for (const row of rows) {
		await ctx.storage.delete(row.storageId);
		await ctx.db.delete(row._id);
	}
}
