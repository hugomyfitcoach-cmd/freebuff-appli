import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { api, internal } from "./_generated/api"; // api utilisé par mirrorBatch/mirrorThumbnail

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { getSessionUser } from "./helpers";
import { offThumb100 } from "../lib/foodImage";

/**
 * Miroir G-FLUX des miniatures alimentaires (table `foodImageCache`).
 *
 * PRINCIPE — Open Food Facts ne sert qu'UNE fois par produit : le premier
 * cache miss télécharge la miniature 100 px, la copie vit dans le storage
 * Convex, puis TOUS les affichages suivants (toutes clientes confondues) sont
 * servis depuis la copie G-FLUX via une URL de storage stable. OFF tombe en
 * panne → les produits déjà miroir fonctionnent normalement ; les produits
 * jamais demandés retombent sur l'URL OFF puis le placeholder — sans jamais
 * bloquer texte, sélection ni Journal.
 *
 * DÉDUPLICATION STRICTE — créneau exclusif par offId (claim) : N demandes
 * simultanées → UNE seule copie stockée ; les perdants d'une course suppriment
 * leur doublon à la validation (jamais d'orphelin). Un créneau `pending`
 * stalé (> 60 s, crash en vol) est repris par le demandeur suivant — aucun
 * produit n'est jamais définitivement bloqué.
 *
 * ZÉRO remplissage à l'avance : le cache ne se remplit que par les produits réellement
 * demandés (préchauffage à la sélection + à l'ajout au Journal, jamais à la
 * simple recherche). `lastUsedAt` permet une purge future sans toucher aux
 * fiches aliments ni à l'historique nutritionnel.
 */

/** Plafond de taille d'une miniature miroir. Un JPEG/PNG 100 px dépasse
 *  rarement 20 Ko ; 60 Ko est une marge large. Au-delà : réponse anormale
 *  (contenu erroné, HTML d'erreur…) → JAMAIS stockée silencieusement. */
export const MAX_THUMB_BYTES = 60 * 1024;

const clampInt = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(n)));

/** Champ ajouté aux hits aliments : URL miroir G-FLUX prête à servir. */
type WithThumb = { thumbUrl?: string };

/* ── Lecture (contexte query) — utilisée par searchLocal, recentFoods,
      getDay, favoris : jointure directe, aucun appel réseau. ── */

/** Lit le miroir par offId et retourne la carte offId → URL storage. */
async function mirrorUrlMap(ctx: QueryCtx, offIds: string[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	for (const offId of new Set(offIds)) {
		const row = await ctx.db
			.query("foodImageCache")
			.withIndex("by_offId", (q) => q.eq("offId", offId))
			.first();
		if (row?.status === "ready" && row.storageId) {
			const url = await ctx.storage.getUrl(row.storageId);
			if (url) out.set(offId, url);
		}
	}
	return out;
}

/** Résout les URLs miroir prêtes pour une liste d'offIds (lecture pure). */
export async function mirrorUrlForOffIds(ctx: QueryCtx, offIds: string[]): Promise<Map<string, string>> {
	return mirrorUrlMap(ctx, offIds);
}

/**
 * Attache `thumbUrl` à des items portant un `foodId` (entrées du journal,
 * items planifiés, ingrédients de repas) : foodId → fiche foods → offId →
 * miroir. Les items sans foodId ou sans miroir passent tels quels.
 */
export async function attachThumbsForFoodIds<T extends { foodId?: Id<"foods"> }>(
	ctx: QueryCtx,
	items: T[]
): Promise<(T & WithThumb)[]> {
	const ids = [...new Set(items.map((i) => i.foodId).filter((x): x is Id<"foods"> => !!x))];
	if (!ids.length) return items as (T & WithThumb)[];
	const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
	const offByFoodId = new Map<string, string>();
	for (const f of rows) if (f?.offId) offByFoodId.set(f._id, f.offId);
	if (!offByFoodId.size) return items as (T & WithThumb)[];
	const urls = await mirrorUrlMap(ctx, [...offByFoodId.values()]);
	if (!urls.size) return items as (T & WithThumb)[];
	const thumbByFoodId = new Map<string, string>();
	for (const [foodId, offId] of offByFoodId) {
		const url = urls.get(offId);
		if (url) thumbByFoodId.set(foodId, url);
	}
	return items.map((i) => {
		const thumbUrl = i.foodId ? thumbByFoodId.get(i.foodId) : undefined;
		return thumbUrl ? { ...i, thumbUrl } : (i as T & WithThumb);
	});
}

/**
 * Attache `thumbUrl` (copie miroir prête) à un lot de hits aliments.
 * Helper de LECTURE pur — les hits sans miroir passent tels quels
 * (fallback OFF 100 px puis placeholder, géré par FoodImg).
 */
export async function attachThumbs<T extends { offId?: string }>(ctx: QueryCtx, hits: T[]): Promise<(T & WithThumb)[]> {
	const offIds = hits.map((h) => h.offId).filter((x): x is string => typeof x === "string");
	if (!offIds.length) return hits as (T & WithThumb)[];
	const urls = await mirrorUrlMap(ctx, offIds);
	if (!urls.size) return hits as (T & WithThumb)[];
	return hits.map((h) => (h.offId && urls.has(h.offId) ? { ...h, thumbUrl: urls.get(h.offId) } : h));
}

/** Variante pour le chemin action (lecture via runQuery). */
export const thumbUrlsForOffIds = internalQuery({
	args: { offIds: v.array(v.string()) },
	handler: async (ctx, { offIds }) => {
		const map = await mirrorUrlMap(ctx, offIds);
		return [...map.entries()].map(([offId, url]) => ({ offId, url }));
	},
});

/* ── Créneau exclusif (idempotence / concurrence) ── */

const PENDING_TAKEOVER_MS = 60_000;

/**
 * Réserve le créneau miroir d'un offId :
 * - `ready` → cache hit global, rien à faire ;
 * - `pending` récent → course en cours, le demandeur s'efface ;
 * - `pending` stalé → repris (crash en vol, jamais bloquant) ;
 * - `failed` → retenté (OFF de nouveau joignable) ;
 * - absent → insert exclusif ; les concurrents perdants sont dédupliqués
 *   au commit (leur copie est supprimée).
 */
export const claimMirrorSlot = internalMutation({
	args: { offId: v.string() },
	handler: async (ctx, { offId }) => {
		const existing = await ctx.db
			.query("foodImageCache")
			.withIndex("by_offId", (q) => q.eq("offId", offId))
			.first();
		const now = Date.now();
		if (existing) {
			if (existing.status === "ready") return { done: true };
			if (existing.status === "pending" && now - existing.createdAt < PENDING_TAKEOVER_MS) return { done: true };
			// pending stalé ou failed : on reprend le MÊME document (unicité).
			if (existing.storageId) await ctx.storage.delete(existing.storageId);
			await ctx.db.patch(existing._id, { status: "pending" as const, createdAt: now, failReason: undefined });
			return { done: false };
		}
		await ctx.db.insert("foodImageCache", { offId, status: "pending" as const, createdAt: now });
		return { done: false };
	},
});

/**
 * Valide le miroir avec la copie téléchargée. Si la ligne n'est plus
 * `pending` (perdant d'une course / repris), le storageId reçu est
 * supprimé → déduplication stricte, jamais de doublon ni d'orphelin.
 */
export const commitMirror = internalMutation({
	args: {
		offId: v.string(),
		storageId: v.id("_storage"),
		sourceUrl: v.string(),
		thumbnailSourceUrl: v.string(),
		bytes: v.number(),
		contentType: v.string(),
	},
	handler: async (ctx, { offId, storageId, sourceUrl, thumbnailSourceUrl, bytes, contentType }) => {
		const row = await ctx.db
			.query("foodImageCache")
			.withIndex("by_offId", (q) => q.eq("offId", offId))
			.first();
		if (!row || row.status !== "pending") {
			// Un concurrent a déjà commité : on jette notre copie.
			await ctx.storage.delete(storageId);
			return { ok: false };
		}
		await ctx.db.patch(row._id, {
			status: "ready" as const,
			storageId,
			sourceUrl,
			thumbnailSourceUrl,
			bytes,
			contentType,
			updatedAt: Date.now(),
			lastUsedAt: Date.now(),
		});
		return { ok: true };
	},
});

/** Échec du miroir (aucun stockage créé) : tracé, retentable à la demande. */
export const failMirror = internalMutation({
	args: { offId: v.string(), reason: v.string() },
	handler: async (ctx, { offId, reason }) => {
		const row = await ctx.db
			.query("foodImageCache")
			.withIndex("by_offId", (q) => q.eq("offId", offId))
			.first();
		if (!row || row.status !== "pending") return;
		await ctx.db.patch(row._id, { status: "failed" as const, failReason: reason.slice(0, 200), updatedAt: Date.now() });
	},
});

/** Rafraîchit lastUsedAt des lignes miroir prêtes (traçage d'usage / purge future). */
export const touchByOffIds = internalMutation({
	args: { offIds: v.array(v.string()) },
	handler: async (ctx, { offIds }) => {
		const now = Date.now();
		for (const offId of new Set(offIds)) {
			const row = await ctx.db
				.query("foodImageCache")
				.withIndex("by_offId", (q) => q.eq("offId", offId))
				.first();
			if (row?.status === "ready" && now - (row.lastUsedAt ?? 0) > 60_000) {
				await ctx.db.patch(row._id, { lastUsedAt: now });
			}
		}
	},
});

/* ── Action premier cache miss (BFF uniquement) ── */

/**
 * Télécharge UNE fois la miniature OFF 100 px (variante `.100` dérivée, repli
 * URL originale) et la stocke. Ne lève JAMAIS pour un incident OFF : retourne
 * ok=false avec la raison — l'UX ne dépend jamais d'OFF. Timeout court (4 s),
 * un seul essai par URL, aucun retry agressif.
 */
export const mirrorThumbnail = action({
	args: {
		offId: v.string(),
		sourceUrl: v.string(),
		/** URL OFF 100 px dérivée — utilisée en premier. */
		thumbnailSourceUrl: v.string(),
		/** Timeout fetch OFF en ms (défaut 4000, borné 1–10 s). */
		timeoutMs: v.optional(v.number()),
	},
	handler: async (ctx, { offId, sourceUrl, thumbnailSourceUrl, timeoutMs }) => {
		if (!/^[0-9A-Za-z.\-]{4,32}$/.test(offId)) throw new ConvexError("offId invalide.");
		for (const u of [thumbnailSourceUrl, sourceUrl]) {
			if (!/^https:\/\/([a-z0-9.\-]+\.)?openfoodfacts\.org\//i.test(u)) throw new ConvexError("URL OFF invalide.");
		}

		const claim = await ctx.runMutation(internal.foodImages.claimMirrorSlot, { offId });
		if (claim.done) return { ok: true, deduped: true } as const;

		const timeout = clampInt(timeoutMs ?? 4_000, 1_000, 10_000);
		const attempts = [thumbnailSourceUrl, sourceUrl];
		let lastReason = "off-unreachable";
		for (const url of attempts) {
			try {
				const res = await fetch(url, {
					headers: {
						"User-Agent": "GFluxCoaching/1.0 (Suivi coaching G-Flux; contact: hugomyfitcoach@gmail.com)",
						Accept: "image/*",
					},
					signal: AbortSignal.timeout(timeout),
					redirect: "follow",
				});
				if (!res.ok) {
					lastReason = `off-http-${res.status}`;
					continue;
				}
				const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
				if (!contentType.startsWith("image/")) {
					lastReason = "off-not-image";
					continue;
				}
				const buf = new Uint8Array(await res.arrayBuffer());
				if (buf.byteLength < 64) {
					lastReason = "off-too-small";
					continue;
				}
				if (buf.byteLength > MAX_THUMB_BYTES) {
					// Anomalie assumée : jamais de « miniature » anormalement
					// grosse en stock — échec tracé, retentable.
					lastReason = `off-too-big-${Math.round(buf.byteLength / 1024)}Ko`;
					continue;
				}
				const uploadUrl = await ctx.storage.generateUploadUrl();
				const up = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": contentType }, body: buf });
				if (!up.ok) {
					lastReason = `storage-${up.status}`;
					continue;
				}
				const { storageId } = (await up.json()) as { storageId: Id<"_storage"> };
				const commit = await ctx.runMutation(internal.foodImages.commitMirror, {
					offId,
					storageId,
					sourceUrl,
					thumbnailSourceUrl,
					bytes: buf.byteLength,
					contentType,
				});
				if (!commit.ok) return { ok: true, deduped: true } as const;
				return { ok: true, mirrored: true, bytes: buf.byteLength } as const;
			} catch (e) {
				const name = (e as { name?: string } | null)?.name;
				lastReason = name === "TimeoutError" || name === "AbortError" ? "off-timeout" : "off-unreachable";
			}
		}
		await ctx.runMutation(internal.foodImages.failMirror, { offId, reason: lastReason });
		return { ok: false, reason: lastReason } as const;
	},
});

/**
 * Miroir d'un lot (préchauffage après sélection : ≤ 12, séquentiel, jamais
 * d'exception remontée — chaque item renvoie son statut). Les items prêts
 * renvoient leur URL de storage → l'UI re-attache thumbUrl sans re-fetch.
 */
export const mirrorBatch = action({
	args: {
		items: v.array(v.object({ offId: v.string(), sourceUrl: v.string(), thumbnailSourceUrl: v.string() })),
	},
	handler: async (ctx, { items }) => {
		const out: { offId: string; ok: boolean; mirrored?: boolean; reason?: string; thumbUrl?: string }[] = [];
		for (const it of items.slice(0, 12)) {
			try {
				const r = (await ctx.runAction(api.foodImages.mirrorThumbnail, {
					offId: it.offId,
					sourceUrl: it.sourceUrl,
					thumbnailSourceUrl: it.thumbnailSourceUrl,
				})) as { ok: boolean; mirrored?: boolean; reason?: string };
				out.push({ offId: it.offId, ...r });
			} catch (e) {
				out.push({ offId: it.offId, ok: false, reason: e instanceof ConvexError ? String(e.message) : "action-error" });
			}
		}
		// URLs de storage fraîchement prêtes (résolues en contexte query).
		const okIds = out.filter((r) => r.ok).map((r) => r.offId);
		const urls = okIds.length ? await ctx.runQuery(internal.foodImages.thumbUrlsForOffIds, { offIds: okIds }) : [];
		const urlMap = new Map(urls.map((t) => [t.offId, t.url]));
		for (const r of out) if (r.ok) r.thumbUrl = urlMap.get(r.offId);
		return { results: out };
	},
});

/** Statistiques du miroir (observabilité). */
export const stats = query({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("foodImageCache").collect();
		let ready = 0;
		let pending = 0;
		let failed = 0;
		let totalBytes = 0;
		for (const r of rows) {
			if (r.status === "ready") {
				ready++;
				totalBytes += r.bytes ?? 0;
			} else if (r.status === "pending") pending++;
			else failed++;
		}
		return { total: rows.length, ready, pending, failed, totalBytes };
	},
});

/** Purge manuelle ciblée (coach) — brique de base de la purge future : la
 *  fiche aliment et l'historique ne sont jamais touchés, seule la copie
 *  image disparaît (elle se re-mirolera à la prochaine demande). */
export const purgeOffId = mutation({
	args: { sessionToken: v.optional(v.string()), offId: v.string() },
	handler: async (ctx, { sessionToken, offId }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user || user.role !== "coach") throw new ConvexError("Réservé à la coach.");
		const row = await ctx.db
			.query("foodImageCache")
			.withIndex("by_offId", (q) => q.eq("offId", offId))
			.first();
		if (!row) return { ok: false };
		if (row.storageId) await ctx.storage.delete(row.storageId);
		await ctx.db.delete(row._id);
		return { ok: true };
	},
});

/** Référence utile au préchauffage côté BFF (dérivation 100 px). */
export const thumbFor = (sourceUrl: string | undefined) => offThumb100(sourceUrl) ?? sourceUrl;
