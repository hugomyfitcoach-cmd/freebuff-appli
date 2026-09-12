import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { api } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import type { FoodHit } from "./journal";
import { rankFoods } from "./foodRanking";

/**
 * Recherche Open Food Facts (action).
 *
 * Stratégie : recherche dans la base locale `foods` (index plein texte
 * `by_name`), sinon appel à l'API publique OFF puis mise en cache dans
 * `foods` (la base s'enrichit au fil des recherches).
 */

type OffProduct = {
	code?: string;
	product_name?: string;
	brands?: string;
	image_front_small_url?: string;
	serving_quantity?: number;
	quantity?: string;
	nutriments?: {
		"energy-kcal_100g"?: number;
		"carbohydrates_100g"?: number;
		"proteins_100g"?: number;
		"fat_100g"?: number;
	};
};

// NB : la recherche plein texte n'existe pas en v2 — c'est l'endpoint v1
// (cgi/search.pl) qui fait une vraie recherche par nom.
const OFF_SEARCH_URL =
	"https://world.openfoodfacts.org/cgi/search.pl?search_terms={q}&search_simple=1&action=process&json=1&page_size=25&fields=code,product_name,brands,image_front_small_url,nutriments,serving_quantity,quantity&lc=fr&cc=fr";
const OFF_UA = "GFluxCoaching/1.0 (Suivi coaching G-Flux; contact: hugomyfitcoach@gmail.com)";

function normalizeQuery(q: string): string {
	return q.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Garde uniquement les produits exploitables (nom + calories + code). */
function parseProducts(products: OffProduct[] | undefined) {
	const out: {
		offId: string;
		name: string;
		brand?: string;
		kcal100: number;
		carbs100: number;
		protein100: number;
		fat100: number;
		imageUrl?: string;
		servingQty?: number;
		servingUnit?: string;
	}[] = [];
	for (const p of products ?? []) {
		if (!p.code || !p.product_name) continue;
		const kcal = p.nutriments?.["energy-kcal_100g"];
		if (typeof kcal !== "number" || !isFinite(kcal) || kcal <= 0) continue;
		const round1 = (n: number | undefined) => (typeof n === "number" && isFinite(n) ? Math.round(n * 10) / 10 : 0);
		const qty = p.serving_quantity && isFinite(p.serving_quantity) ? p.serving_quantity : null;
		out.push({
			offId: p.code,
			name: p.product_name.trim(),
			brand: p.brands?.trim() ? p.brands.trim() : undefined,
			kcal100: Math.round(kcal),
			carbs100: round1(p.nutriments?.["carbohydrates_100g"]),
			protein100: round1(p.nutriments?.["proteins_100g"]),
			fat100: round1(p.nutriments?.["fat_100g"]),
			imageUrl: p.image_front_small_url || undefined,
			servingQty: qty ?? undefined,
			servingUnit: p.quantity ? "g" : undefined,
		});
	}
	return out;
}

async function fetchOffSearch(q: string): Promise<ReturnType<typeof parseProducts>> {
	const url = OFF_SEARCH_URL.replace("{q}", encodeURIComponent(q));
	// OFF peut renvoyer un 503 ponctuel (maintenance) : on retente une fois.
	for (let attempt = 1; attempt <= 2; attempt++) {
		try {
			const res = await fetch(url, {
				headers: { "User-Agent": OFF_UA, Accept: "application/json" },
				signal: AbortSignal.timeout(10_000),
			});
		if (res.ok) {
			const text = await res.text();
			try {
				const data = JSON.parse(text) as { products?: OffProduct[] };
				return rankFoods(parseProducts(data.products), q);
			} catch {
				// Réponse HTML (page indisponible / rate-limit) : on retente.
			}
		}
		} catch {
			// erreur réseau : on retente aussi
		}
		if (attempt === 1) await new Promise((r) => setTimeout(r, 800));
	}
	throw new ConvexError(
		"Open Food Facts ne répond pas pour le moment. Réessaie dans quelques secondes."
	);
}

/** Recherche un produit OFF : cache local d'abord, sinon API + mise en cache. */
/**
 * Recherche par code-barres (action).
 *
 * 1) Lookup exact `offId` dans la base locale (780k produits, EAN-13…).
 * 2) Sinon : API OFF (api/v2/product/<code>.json) puis mise en cache dans
 *    `foods` — le produit sera trouvé en local la prochaine fois.
 */
export const barcodeLookup = action({
	args: {
		sessionToken: v.optional(v.string()),
		barcode: v.string(),
	},
	handler: async (ctx, { sessionToken, barcode }): Promise<Doc<"foods">[]> => {
		const user: { _id: Id<"users">; role: "coach" | "client" } | null = await ctx.runQuery(
			api.journal.checkSession,
			{ sessionToken }
		);
		if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
		if (user.role !== "client") {
			throw new ConvexError("Seuls les comptes clients peuvent utiliser le journal alimentaire.");
		}
		const code = barcode.replace(/\D/g, "");
		if (!code) return [];

		// 1) Base locale d'abord (EAN/GTIN = offId dans le dump).
		const local: Doc<"foods"> | null = await ctx.runQuery(api.journal.foodByBarcode, {
			sessionToken,
			barcode: code,
		});
		if (local) return [local];

		// 2) Sinon : API OFF produit + cache local.
		const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json`;
		try {
			const res = await fetch(url, {
				headers: { "User-Agent": OFF_UA, Accept: "application/json" },
				signal: AbortSignal.timeout(10_000),
			});
			if (res.ok) {
				const data = (await res.json()) as { status?: number; product?: OffProduct };
				if (data.status === 1 && data.product) {
					const parsed = parseProducts([data.product]);
					if (parsed.length > 0) {
						const ids: Id<"foods">[] = await ctx.runMutation(api.journal.cacheFoods, {
							sessionToken,
							products: parsed,
						});
						return ctx.runQuery(api.journal.foodsByIds, { sessionToken, ids });
					}
				}
			}
		} catch {
			// OFF indisponible : on renvoie simplement « introuvable ».
		}
		return [];
	},
});

/**
 * Forme de réponse : tranches de 25 produits classés (scroll infini) + flag
 * de suite. Import du type depuis journal.ts (source de FoodHit).
 */
export type SearchPage = { items: FoodHit[]; hasMore: boolean };

/** Recherche par nom (base locale + aliments personnels d'abord, OFF en secours). */
export const searchFoods = action({
	args: {
		sessionToken: v.optional(v.string()),
		query: v.string(),
		/** Décalage dans le classement (0 = première page de 25). */
		offset: v.optional(v.number()),
		/** Taille de tranche (défaut 25 — l'UI charge 25 par 25). */
		limit: v.optional(v.number()),
	},		handler: async (ctx, { sessionToken, query, offset = 0, limit = 25 }): Promise<SearchPage> => {
			// Annotations explicites : `api` référence ce module (cycle
			// d'inférence TS), on ne laisse donc rien s'inférer via lui.
			const user: { _id: Id<"users">; role: "coach" | "client" } | null = await ctx.runQuery(
				api.journal.checkSession,
				{ sessionToken }
			);
			if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
			if (user.role !== "client") {
				throw new ConvexError("Seuls les comptes clients peuvent utiliser le journal alimentaire.");
			}
			const q = normalizeQuery(query);
			if (!q || q.length < 2) return { items: [], hasMore: false };

			// 1) Base locale + aliments personnels d'abord (pagination côté serveur).
			const local: SearchPage = await ctx.runQuery(api.journal.searchLocal, {
				sessionToken,
				query: q,
				offset,
				limit,
			});
			if (local.items.length > 0 || local.hasMore) return local;

			// 2) Sinon : appel OFF (seulement pour la première page — l'API v1
			// publique renvoie 25 produits par appel, pager au-delà n'apporte rien)
			// + upsert dans `foods` (la base locale s'enrichit).
			if (offset > 0) return { items: [], hasMore: false };
			const products = await fetchOffSearch(q);
			const ids: Id<"foods">[] = await ctx.runMutation(api.journal.cacheFoods, { sessionToken, products });
			const foods = await ctx.runQuery(api.journal.foodsByIds, { sessionToken, ids });
			// Re-tri identique à la recherche locale : aliments bruts d'abord.
			const items = rankFoods(
				foods.map((f) => ({
					_id: f._id,
					custom: false,
					offId: f.offId,
					name: f.name,
					brand: f.brand,
					kcal100: f.kcal100,
					carbs100: f.carbs100,
					protein100: f.protein100,
					fat100: f.fat100,
					imageUrl: f.imageUrl,
					servingQty: f.servingQty,
					servingUnit: f.servingUnit,
				})),
				q
			).slice(0, limit);
			return { items, hasMore: false };
		},
});