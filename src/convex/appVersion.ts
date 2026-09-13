import { action, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";

/**
 * Version sémantique du CONTRAT API du backend (Convex).
 *
 * Historique — incrémenté à chaque breaking change volontaire :
 * - 1 : recherche d'aliments renvoyant un tableau `Food[]` brut ;
 * - 2 : recherche paginée `{ items, hasMore }` (scroll infini, commit 4e6e884
 *   du 12/09/2026) — première rupture constatée en production le 13/09
 *   (écran vide silencieux côté anciennes PWA).
 * - 3 : version courante (garde-fous contrat côté client + détection
 *   d'obsolescence par bandeau). Toute future rupture de contrat : incrémenter
 *   ici APRÈS avoir ajouté la compatibilité côté BFF
 *   (src/routes/api/app/version/+server.ts) pour les anciens clients.
 *
 * Le BFF (SvelteKit) lit cette version après chaque déploiement via
 * `ensureAppVersion` : s'il a été compilé contre une version DIFFÉRENTE de
 * celle du backend, il le signale aux clients (champ `compatible: false`) →
 * bandeau « Une nouvelle version de G-FLUX est disponible ».
 */

/** Version du contrat supportée par CE backend. */
export const CURRENT_API_VERSION = 3;

const META_KEY = "api";

/** Lit la version courante (usage BFF/outils). */
export const getApiVersion = query({
	args: {},
	handler: async (ctx): Promise<number> => {
		const row = await ctx.db
			.query("meta")
			.withIndex("by_key", (q) => q.eq("key", META_KEY))
			.first();
		return row?.version ?? CURRENT_API_VERSION;
	},
});

/** Interne : ligne brute meta.api (null si absente). */
export const readMetaRow = query({
	args: {},
	handler: async (ctx): Promise<{ version: number } | null> => {
		const row = await ctx.db
			.query("meta")
			.withIndex("by_key", (q) => q.eq("key", META_KEY))
			.first();
		return row ? { version: row.version } : null;
	},
});

/** Interne : met à jour la version existante. */
export const writeVersion = internalMutation({
	args: { version: v.number() },
	handler: async (ctx, { version }) => {
		const row = await ctx.db
			.query("meta")
			.withIndex("by_key", (q) => q.eq("key", META_KEY))
			.first();
		if (row) await ctx.db.patch(row._id, { version });
	},
});

/** Interne : insère la ligne meta.api (première exécution). */
export const insertVersion = internalMutation({
	args: { version: v.number() },
	handler: async (ctx, { version }) => {
		await ctx.db.insert("meta", { key: META_KEY, version });
	},
});

/**
 * Idempotent : aligne la ligne `meta.api` sur la version de CE déploiement.
 * Appelé par le BFF (premier appel de /api/app/version après un
 * `npm run deploy`) — jamais par le navigateur directement.
 */
export const ensureAppVersion = action({
	args: {},
	handler: async (ctx): Promise<number> => {
		const row = await ctx.runQuery(api.appVersion.readMetaRow);
		if (row?.version === CURRENT_API_VERSION) return row.version;
		if (row) {
			await ctx.runMutation(internal.appVersion.writeVersion, { version: CURRENT_API_VERSION });
		} else {
			await ctx.runMutation(internal.appVersion.insertVersion, { version: CURRENT_API_VERSION });
		}
		return CURRENT_API_VERSION;
	},
});
