import {
	action,
	internalAction,
	internalMutation,
	internalQuery,
	type ActionCtx,
} from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import type { FoodHit } from "./journal";
import { rankFoods, tokenize } from "./foodRanking";
import { nameMatchScore, flavorConflict } from "../lib/foodText";
import { applyKcalGuard } from "../lib/nutritionGuard";

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
	// Noms localisés : certains produits n'ont AUCUN product_name standard
	// mais un nom dans des clés traduites (ex. Italpizza Margherita, EAN
	// 8015673029861 : l'API v2 produit renvoie le JSON complet, avec clés
	// product_name_de/_it…). Les autres clés localisées sont parcourues via
	// un cast Record dans resolveProductName.
	product_name_fr?: string;
	product_name_en?: string;
	brands?: string;
	image_front_small_url?: string;
	serving_quantity?: number;
	quantity?: string;
	nutriments?: {
		"energy-kcal_100g"?: number;
		"carbohydrates_100g"?: number;
		"proteins_100g"?: number;
		"fat_100g"?: number;
		// Composés à coefficient kcal ≠ 4 (garde-fou kcal↔macros) : fibres 2,
		// polyols 0–3, alcool 7 kcal/g — présents sur les fiches complètes.
		"fiber_100g"?: number;
		"polyols_100g"?: number;
		// Convention OFF : % vol (ex. vin 12,5 → « 12.5 »).
		"alcohol_100g"?: number;
		/* ── Fiche détaillée (R5a) — facultatifs, servis en `null` si absents. ── */
		"sugars_100g"?: number;
		/** OFF nomme ce nutriment « saturated-fat_100g » (tiret). */
		"saturated-fat_100g"?: number;
		"salt_100g"?: number;
	};
};

// NB : la recherche plein texte n'existe pas en v2 — c'est l'endpoint v1
// (cgi/search.pl) qui fait une vraie recherche par nom.
const OFF_SEARCH_URL =
	"https://world.openfoodfacts.org/cgi/search.pl?search_terms={q}&search_simple=1&action=process&json=1&page_size=25&fields=code,product_name,product_name_fr,product_name_en,brands,image_front_small_url,nutriments,serving_quantity,quantity&lc=fr&cc=fr";
const OFF_UA = "GFluxCoaching/1.0 (Suivi coaching G-Flux; contact: hugomyfitcoach@gmail.com)";

function normalizeQuery(q: string): string {
	return q.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Nom d'affichage d'un produit OFF — ordre de préférence strict :
 * 1) product_name_fr ; 2) product_name (standard) ; 3) product_name_en ;
 * 4) premier champ localisé `product_name_*` non vide (de, it…) ;
 * 5) undefined → le produit est rejeté (on n'invente JAMAIS de nom).
 */
function resolveProductName(p: OffProduct): string | undefined {
	if (typeof p.product_name_fr === "string" && p.product_name_fr.trim()) return p.product_name_fr.trim();
	if (typeof p.product_name === "string" && p.product_name.trim()) return p.product_name.trim();
	if (typeof p.product_name_en === "string" && p.product_name_en.trim()) return p.product_name_en.trim();
	const localized = p as unknown as Record<string, unknown>;
	for (const [key, value] of Object.entries(localized)) {
		if (!key.startsWith("product_name_")) continue;
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

/** Garde uniquement les produits exploitables (nom + calories + code). */
function parseProducts(products: OffProduct[] | undefined) {
	/** Valeur de DÉTAIL /100 g : 0 est une valeur réelle (ex. 0 g de sucres),
	 *  contrairement à `round1` qui la traite comme absente pour le garde-fou.
	 *  Déclarée ICI pour que le bloc reste autonome (extrait et exécuté tel
	 *  quel par les tests du fallback de nom). */
	const detail1 = (n: number | undefined) =>
		typeof n === "number" && isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : undefined;
	const out: {
		offId: string;
		name: string;
		brand?: string;
		kcal100: number;
		carbs100: number;
		protein100: number;
		fat100: number;
		fiber100?: number;
		polyols100?: number;
		alcohol100?: number;
		/** Détail nutritionnel /100 g (R5a) — absents si OFF ne les publie pas. */
		sugars100?: number;
		saturatedFat100?: number;
		salt100?: number;
		imageUrl?: string;
		servingQty?: number;
		servingUnit?: string;
	}[] = [];
	for (const p of products ?? []) {
		if (!p.code) continue;
		// product_name vide mais nom localisé présent → accepté (voir
		// resolveProductName) ; aucun nom exploitable → rejet.
		const name = resolveProductName(p);
		if (!name) continue;
		const kcal = p.nutriments?.["energy-kcal_100g"];
		if (typeof kcal !== "number" || !isFinite(kcal) || kcal <= 0) continue;
		const round1 = (n: number | undefined) => (typeof n === "number" && isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : undefined);
		const qty = p.serving_quantity && isFinite(p.serving_quantity) ? p.serving_quantity : null;
		out.push({
			offId: p.code,
			name,
			brand: p.brands?.trim() ? p.brands.trim() : undefined,
			kcal100: Math.round(kcal),
			carbs100: round1(p.nutriments?.["carbohydrates_100g"]) ?? 0,
			protein100: round1(p.nutriments?.["proteins_100g"]) ?? 0,
			fat100: round1(p.nutriments?.["fat_100g"]) ?? 0,
			// Gardés pour le garde-fou kcal↔macros (jamais affichés) : fibres,
			// polyols, alcool — n'entrent ni dans les macros ni dans les totaux.
			fiber100: round1(p.nutriments?.["fiber_100g"]),
			polyols100: round1(p.nutriments?.["polyols_100g"]),
			alcohol100: round1(p.nutriments?.["alcohol_100g"]),
			// Détail /100 g (R5a) : 0 est une valeur réelle (jamais confondue
			// avec une valeur absente).
			sugars100: detail1(p.nutriments?.["sugars_100g"]),
			saturatedFat100: detail1(p.nutriments?.["saturated-fat_100g"]),
			salt100: detail1(p.nutriments?.["salt_100g"]),
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

/**
 * CŒUR de résolution d'un code-barres (EAN/GTIN) pour le Repas IA — MÊME
 * ordre de résolution que le scan du Journal (`barcodeLookup`) :
 *
 * 1) Base locale `foods` (EAN/GTIN = offId, garde-fou kcal appliqué à la
 *    lecture) ; 2) aliments personnels de la cliente (produit créé via une
 *    étiquette / un scan inconnu — le code est rattaché à SA fiche) ;
 * 3) API OFF produit + cache local (le produit sera trouvé en local ensuite).
 * Réponse : la fiche résolue, ou null (code inconnu / OFF indisponible).
 */
async function resolveBarcodeCore(
	ctx: ActionCtx,
	sessionToken: string | undefined,
	code: string
): Promise<ResolvedBarcodeProduct | null> {
	// 1) Base locale d'abord (EAN/GTIN = offId dans le dump).
	const local: Doc<"foods"> | null = await ctx.runQuery(api.journal.foodByBarcode, {
		sessionToken,
		barcode: code,
	});
	if (local) {
		return {
			source: "food",
			foodId: local._id,
			name: local.name,
			brand: local.brand,
			kcal100: local.kcal100,
			carbs100: local.carbs100,
			protein100: local.protein100,
			fat100: local.fat100,
			offId: local.offId,
			servingQty: local.servingQty,
		};
	}

	// 1 bis) Aliment personnel de CETTE cliente : produit créé via une
	// étiquette / un scan inconnu — le code est rattaché à SA fiche, le
	// rescan la retrouve immédiatement (jamais de second scan ni de
	// « produit non trouvé » sur un produit déjà créé par la cliente).
	const own = await ctx.runQuery(api.customFoods.byBarcode, {
		sessionToken,
		barcode: code,
	});
	if (own) {
		return {
			source: "custom",
			customFoodId: own._id,
			name: own.name,
			brand: own.brand,
			kcal100: own.kcal100,
			carbs100: own.carbs100,
			protein100: own.protein100,
			fat100: own.fat100,
			offId: own.barcode,
			servingQty: own.servingQty,
		};
	}

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
					const foods: (Doc<"foods"> | null)[] = await ctx.runQuery(api.journal.foodsByIds, {
						sessionToken,
						ids,
					});
					const f = foods.find((x): x is Doc<"foods"> => x !== null && x.offId === code);
					if (f) {
						return {
							source: "food",
							foodId: f._id,
							name: f.name,
							brand: f.brand,
							kcal100: f.kcal100,
							carbs100: f.carbs100,
							protein100: f.protein100,
							fat100: f.fat100,
							offId: f.offId,
							servingQty: f.servingQty,
						};
					}
				}
			}
		}
	} catch {
		// OFF indisponible : « introuvable » — l'appelant dégrade proprement.
	}
	return null;
}

/** Produit résolu par code-barres (fiche base, aliment personnel, ou OFF). */
export type ResolvedBarcodeProduct = {
	source: "food" | "custom";
	foodId?: Id<"foods">;
	customFoodId?: Id<"customFoods">;
	offId?: string;
	name: string;
	brand?: string;
	/** kcal sous garde-fou (lecture via foodByBarcode / foodsByIds). */
	kcal100: number;
	carbs100: number;
	protein100: number;
	fat100: number;
	servingQty?: number;
};

/** Version interne (action aiAnalysis.analyzeMeal — sans session requise ici). */
export const resolveBarcodeInternal = internalAction({
	args: {
		sessionToken: v.optional(v.string()),
		barcode: v.string(),
	},
	handler: async (ctx, { sessionToken, barcode }): Promise<ResolvedBarcodeProduct | null> => {
		const code = barcode.replace(/\D/g, "");
		if (!code) return null;
		return resolveBarcodeCore(ctx, sessionToken, code);
	},
});

/**
 * Produit OFF retenu par la recherche live du Repas IA (client → produit).
 * `kcal100` est déjà sous garde-fou kcal↔macros (lecture via `guardedFood100`
 * après relecture de la fiche mise en cache).
 */
export type OffLiveProduct = {
	foodId: Id<"foods">;
	name: string;
	brand?: string;
	kcal100: number;
	carbs100: number;
	protein100: number;
	fat100: number;
};

/**
 * Recherche OFF LIVE pour le Repas IA (action interne — une query n'a pas le
 * droit au réseau). MÊME PIPELINE que la recherche cliente (`fetchOffSearch` :
 * v1 CGI + règles strictes de `parseProducts`), puis mise en cache `foods`
 * (`journal.cacheFoods`) et relecture sous garde-fou — le produit devient
 * une fiche `foods` normale, comme pour la recherche client.
 *
 * SÉLECTION (côté action, règles variantes) :
 *  - tokens de rivalité (flavorConflict) : une fiche portant une variante
 *    rivale de celle demandée est éliminée (« nature » pour « stracciatella ») ;
 *  - la fiche retenue doit PORTER la variante demandée si l'IA en a lu une ;
 *  - correspondance nominale minimale 0.5 (sinon : aucun match fiable).
 * Échec OFF (indisponible, rate-limit) → null : l'appelant retombe sur le
 * socle local, jamais d'échec brut.
 */
export const searchOffProductsInternal = internalAction({
	args: {
		sessionToken: v.optional(v.string()),
		/** Terme de recherche précis (marque + variante + produit). */
		query: v.string(),
		/** Nom du composant (pour la correspondance nominale). */
		componentName: v.string(),
		/** Variantes demandées (tokens de rivalité, normalisés). */
		demandedFlavors: v.array(v.string()),
	},
	handler: async (ctx, { sessionToken, query, componentName, demandedFlavors }): Promise<OffLiveProduct | null> => {
		const q = query.trim();
		if (q.length < 2) return null;
		try {
			const products = await fetchOffSearch(q);
			if (products.length === 0) return null;
			const compToks = tokenize(componentName);
			let best: (typeof products)[number] | null = null;
			let bestScore = 0;
			for (const p of products) {
				const pToks = tokenize(p.name);
				if (demandedFlavors.length > 0 && flavorConflict(demandedFlavors, pToks)) continue;
				if (demandedFlavors.length > 0 && !demandedFlavors.every((f) => pToks.includes(f))) continue;
				const s = nameMatchScore(componentName, p.name) + 0.1 * nameMatchScore(q, p.name);
				if (s < 0.5) continue;
				if (s > bestScore) {
					bestScore = s;
					best = p;
				}
			}
			if (!best) return null;
			// Cache `foods` (upsert par offId) puis relecture sous garde-fou.
			const ids: Id<"foods">[] = await ctx.runMutation(api.journal.cacheFoods, {
				sessionToken,
				products: [best],
			});
			const foods: (Doc<"foods"> | null)[] = await ctx.runQuery(api.journal.foodsByIds, {
				sessionToken,
				ids,
			});
			const f = foods.find((x): x is Doc<"foods"> => x !== null && x.offId === best!.offId);
			if (!f) return null;
			return {
				foodId: f._id,
				name: f.name,
				brand: f.brand,
				kcal100: f.kcal100,
				carbs100: f.carbs100,
				protein100: f.protein100,
				fat100: f.fat100,
			};
		} catch {
			// OFF indisponible / rate-limit : l'appelant retombe sur le socle local.
			return null;
		}
	},
});

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
	handler: async (
		ctx,
		{ sessionToken, barcode }
	): Promise<(Doc<"foods"> | (Doc<"customFoods"> & { custom: boolean }))[]> => {
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

		// 1 bis) Aliment personnel de CETTE cliente : produit créé via une
		// étiquette / un scan inconnu — le code est rattaché à SA fiche, le
		// rescan la retrouve immédiatement (jamais de second scan ni de
		// « produit non trouvé » sur un produit déjà créé par la cliente).
		const own = await ctx.runQuery(api.customFoods.byBarcode, {
			sessionToken,
			barcode: code,
		});
		if (own) return [{ ...own, custom: true }];

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
			// Garde-fou kcal ↔ macros (lecture seule) : kcal aberrantes → théoriques,
			// la fiche fraîchement mise en cache reste intacte en base.
			const hits = rankFoods(
				foods.map((f) => {
					const g = applyKcalGuard(f);
					return {
						_id: f._id,
						custom: false,
						offId: f.offId,
						name: f.name,
						brand: f.brand,
						kcal100: g.kcal100,
						kcalRecalculated: g.kcalRecalculated || undefined,
						carbs100: f.carbs100,
						protein100: f.protein100,
						fat100: f.fat100,
						imageUrl: f.imageUrl,
						servingQty: f.servingQty,
						servingUnit: f.servingUnit,
					};
				}),
				q
			).slice(0, limit);
			// Miniatures miroir déjà prêtes → thumbUrl (chemin action : lecture via
			// runQuery ; l'URL de storage est résolue dans le contexte query).
			const offIds = hits.map((it) => it.offId).filter((x): x is string => typeof x === "string");
			const thumbs = offIds.length ? await ctx.runQuery(internal.foodImages.thumbUrlsForOffIds, { offIds }) : [];
			const thumbMap = new Map(thumbs.map((t: { offId: string; url: string }) => [t.offId, t.url]));
			const withThumbs = hits.map((it) =>
				it.offId && thumbMap.has(it.offId) ? { ...it, thumbUrl: thumbMap.get(it.offId) } : it
			);
			return { items: withThumbs, hasMore: false };
		},
});

/* ═══ FICHE DÉTAILLÉE OFF (R5a) — sucres, fibres, AGS, sel /100 g ══════════
 * Conservés à l'insertion dans `foods` (parseProducts, tous optionnels) puis
 * COMPLÉTÉS À LA DEMANDE : `refreshOffDetails` n'est appelée qu'à l'ouverture
 * de la fiche de détail et au plus UNE fois tous les 30 jours par aliment
 * (horodatage `foods.detailsRefreshedAt`). Aucun traitement de masse, aucune
 * écriture sur les autres fiches.
 */

/** Délai minimal entre deux complétions OFF d'un même aliment. */
export const DETAILS_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

/** Valeurs de détail /100 g — toutes optionnelles (OFF ne les publie pas toujours). */
export type OffDetails = {
	sugars100?: number;
	fiber100?: number;
	saturatedFat100?: number;
	salt100?: number;
};

/**
 * Produit OFF par code-barres (v2, champs utiles seulement).
 *  - `null`  : OFF injoignable (réseau, timeout, 5xx) — aucun horodatage n'est
 *              posé, un nouvel essai reste donc possible ;
 *  - `{}`    : OFF a répondu (produit inconnu ou sans valeurs de détail).
 */
async function fetchOffDetails(offId: string): Promise<OffDetails | null> {
	const url = `https://world.openfoodfacts.org/api/v2/product/${offId}.json?fields=code,nutriments`;
	try {
		const res = await fetch(url, {
			headers: { "User-Agent": OFF_UA, Accept: "application/json" },
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) return res.status === 404 ? {} : null;
		const data = (await res.json()) as { status?: number; product?: OffProduct };
		if (data.status !== 1 || !data.product) return {};
		// MÊME parsing que l'insertion (`parseProducts`) : une seule source
		// de vérité pour les valeurs de détail OFF.
		const parsed = parseProducts([data.product])[0];
		if (!parsed) return {};
		const details: OffDetails = {};
		if (parsed.sugars100 !== undefined) details.sugars100 = parsed.sugars100;
		if (parsed.fiber100 !== undefined) details.fiber100 = parsed.fiber100;
		if (parsed.saturatedFat100 !== undefined) details.saturatedFat100 = parsed.saturatedFat100;
		if (parsed.salt100 !== undefined) details.salt100 = parsed.salt100;
		return details;
	} catch {
		return null;
	}
}

/** Lecture interne d'une fiche `foods` (pour l'action de complétion). */
export const offFoodById = internalQuery({
	args: { foodId: v.id("foods") },
	handler: async (ctx, { foodId }) => await ctx.db.get(foodId),
});

/** Écriture interne : valeurs de détail fournies + horodatage (jamais destructif). */
export const applyOffDetails = internalMutation({
	args: {
		foodId: v.id("foods"),
		sugars100: v.optional(v.number()),
		fiber100: v.optional(v.number()),
		saturatedFat100: v.optional(v.number()),
		salt100: v.optional(v.number()),
		refreshedAt: v.number(),
	},
	handler: async (ctx, { foodId, refreshedAt, sugars100, fiber100, saturatedFat100, salt100 }) => {
		const patch: Partial<
			Pick<Doc<"foods">, "sugars100" | "fiber100" | "saturatedFat100" | "salt100">
		> & { detailsRefreshedAt: number } = { detailsRefreshedAt: refreshedAt };
		if (sugars100 !== undefined) patch.sugars100 = sugars100;
		if (fiber100 !== undefined) patch.fiber100 = fiber100;
		if (saturatedFat100 !== undefined) patch.saturatedFat100 = saturatedFat100;
		if (salt100 !== undefined) patch.salt100 = salt100;
		await ctx.db.patch(foodId, patch);
	},
});

/**
 * Complète un aliment DÉJÀ EN CACHE avec les détails OFF manquants.
 *
 * Appelée uniquement à l'ouverture de la fiche nutritionnelle détaillée, par
 * une cliente connectée. Au plus une tentative réussie tous les 30 jours par
 * aliment (`detailsRefreshedAt`) : les ouvertures suivantes ne font AUCUN appel
 * réseau. Une panne OFF (réseau/timeout) n'horodate pas et laisse donc la
 * possibilité de réessayer à la prochaine ouverture. Relecture des valeurs via
 * la requête `foodDetails` — l'action ne renvoie aucune donnée.
 */
export const refreshOffDetails = action({
	args: { sessionToken: v.optional(v.string()), foodId: v.id("foods") },
	handler: async (ctx, { sessionToken, foodId }): Promise<null> => {
		const user: { _id: Id<"users">; role: "coach" | "client" } | null = await ctx.runQuery(
			api.journal.checkSession,
			{ sessionToken }
		);
		if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
		if (user.role !== "client") {
			throw new ConvexError("Seuls les comptes clients peuvent utiliser le journal alimentaire.");
		}

		const food: Doc<"foods"> | null = await ctx.runQuery(internal.off.offFoodById, { foodId });
		if (!food || !food.offId) return null;

		const now = Date.now();
		if (typeof food.detailsRefreshedAt === "number" && now - food.detailsRefreshedAt < DETAILS_REFRESH_MS) {
			return null;
		}

		const details = await fetchOffDetails(food.offId);
		// OFF injoignable : on ne pose PAS l'horodatage (nouvel essai possible).
		if (details === null) return null;
		await ctx.runMutation(internal.off.applyOffDetails, { foodId, ...details, refreshedAt: now });
		return null;
	},
});