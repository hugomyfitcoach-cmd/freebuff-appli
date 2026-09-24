import { internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { FOOD_SEARCH_CANDIDATES, rankFoods } from "./foodRanking";
import { toHit, type FoodHit } from "./journal";
import { searchCiqualLocal, resolveCiqualLabel } from "./ciqual";
import { getSessionUser } from "./helpers";
import type { QueryCtx } from "./_generated/server";
import { preferCookedForMeal, cookedBonusFor } from "../lib/cookedState";
import { nameMatchScore } from "../lib/foodText";

/**
 * MATCH « repas photographié » — résolution des composants reconnus par l'IA
 * vers les références G-FLUX.
 *
 * HIÉRARCHIE (règle produit) :
 *   1. Convex comme source applicative :
 *      a. aliments « Créés par moi » de la cliente (ses produits réels) ;
 *      b. aliments OFF DÉJÀ importés dans Convex (jamais d'appel live OFF
 *         pour chaque composant d'un repas — l'IA identifie, la base tranche) ;
 *   2. CIQUAL pour les aliments génériques (poulet grillé, riz, courgettes…)
 *      — fiche de référence par libellé officiel exact, valeurs résolues
 *      côté serveur, jamais de nutrition transmise par le client ;
 *   3. Aucun match fiable → composant conservé « Estimation IA » (l'IA a
 *      fourni des valeurs /100 g prudentes, clairement étiquetées).
 *
 * L'IA n'est JAMAIS la source nutritionnelle principale : en « ai », les
 * valeurs /100 g transmises sont des REPÈRES à valider, affichés comme tels.
 */

/** Seuil de confiance : en dessous, on préfère « Estimation IA » au match. */
const MIN_MATCH_SCORE = 0.55;

/**
 * Score de rapprochement nominal — implémentation partagée dans
 * src/lib/foodText.ts (extrait à l'identique pour être testable hors Convex).
 */

/** Résultat d'un match brut : fiche Convex (OFF importé ou custom) ou Ciqual. */
export type MealMatchRow =
	| { kind: "food"; source: "off_imported" | "custom"; foodId: string; ciqualLabel?: undefined; name: string; brand?: string; kcal100: number; carbs100: number; protein100: number; fat100: number; score: number }
	| { kind: "ciqual"; source: "ciqual"; foodId?: undefined; ciqualLabel: string; name: string; brand?: undefined; kcal100: number; carbs100: number; protein100: number; fat100: number; score: number };

/** Détail d'un composant après matching (contrat consommé par le BFF). */
export type MatchedComponent = {
	label: string;
	/** Quantité estimée par l'IA (g) — toujours vérifiable/correctible côté UI. */
	qtyGrams: number;
	/** "custom" = aliment de la cliente · "off_imported" = produit OFF déjà en base · "ciqual" = référence générique · "ai" = estimation IA (pas de match fiable). */
	matchSource: "custom" | "off_imported" | "ciqual" | "ai";
	/** Ids / libellés résolus (absents quand matchSource = "ai"). */
	foodId?: string;
	customFoodId?: string;
	ciqualLabel?: string;
	name: string;
	brand?: string;
	/** Valeurs /100 g du match (absentes en "ai" — l'UI n'invente rien). */
	kcal100?: number;
	carbs100?: number;
	protein100?: number;
	fat100?: number;
	/** Valeurs IA /100 g (secours « Estimation IA », jamais la source principale). */
	aiKcal100?: number;
	aiCarbs100?: number;
	aiProtein100?: number;
	aiFat100?: number;
	/** Repère IA fourni en plus (portion annoncée, imprécision…). */
	aiNote?: string;
	/** Score du rapprochement nominal (0–1) — debug/UX légère. */
	score?: number;
};

/** Quantité bornée (1–2000 g), valeur défensive pour des données IA. */
function clampQty(n: number | undefined): number {
	if (n === undefined || !isFinite(n)) return 100;
	return Math.min(2000, Math.max(1, Math.round(n)));
}

/** Composant « Estimation IA » (aucun match fiable). */
function aiFallback(
	label: string,
	c: { qtyGrams: number; kcal100?: number; carbs100?: number; protein100?: number; fat100?: number; note?: string }
): MatchedComponent {
	return {
		label,
		qtyGrams: clampQty(c.qtyGrams),
		matchSource: "ai",
		name: label,
		aiKcal100: c.kcal100,
		aiCarbs100: c.carbs100,
		aiProtein100: c.protein100,
		aiFat100: c.fat100,
		aiNote: c.note,
	};
}

/**
 * Recherche le meilleur match pour UN composant : base Convex d'abord (custom
 * + OFF importé via search index, re-tri ranking maison), CIQUAL ensuite
 * (recherche locale dans la table embarquée, résolution par libellé officiel).
 * Aucune valeur nutritionnelle du client n'est acceptée ici.
 *
 * Le contexte est minimal (seule la lecture `db` est requise) : la fonction
 * est appelée depuis une query authentifiée OU une action (via runQuery
 * dédiée) — voir matchComponents / matchComponentsCore.
 */
async function findBestMatch(
	ctx: QueryCtx,
	userId: string,
	name: string,
	opts?: { searchTerm?: string; wantCooked?: boolean }
): Promise<MealMatchRow | null> {
	// Règle « état cuit par défaut » (repas IA uniquement) : le terme de
	// recherche porte « cuit » pour les féculents servis dans une assiette.
	const term = (opts?.searchTerm ?? name).trim().toLowerCase();
	if (term.length < 2) return null;
	const wantCooked = opts?.wantCooked === true;

	let best: MealMatchRow | null = null;
	let bestScore = 0;

	// 1a) Aliments de la cliente (ses produits réels d'abord).
	const customs = await ctx.db
		.query("customFoods")
		.withSearchIndex("by_name", (sb) => sb.search("name", term))
		.take(8);
	for (const f of customs) {
		let s = nameMatchScore(name, f.name) + 0.05; // bonus « sa propre base »
		s += cookedBonusFor(f.name, wantCooked);
		if (s > bestScore) {
			bestScore = s;
			best = {
				kind: "food",
				source: "custom",
				foodId: f._id,
				name: f.name,
				brand: f.brand,
				kcal100: f.kcal100,
				carbs100: f.carbs100,
				protein100: f.protein100,
				fat100: f.fat100,
				score: s,
			};
		}
	}

	// 1b) Produits OFF déjà importés dans Convex (recherche LOCALE uniquement).
	const foods = await ctx.db
		.query("foods")
		.withSearchIndex("by_name", (sb) => sb.search("name", term))
		.take(FOOD_SEARCH_CANDIDATES);
	const ranked = rankFoods(foods.map(toHit), term).slice(0, 5);
	for (const hit of ranked) {
		let s = nameMatchScore(name, hit.name) - (hit.brand?.trim() ? 0.08 : 0);
		s += cookedBonusFor(hit.name, wantCooked);
		if (s > bestScore) {
			bestScore = s;
			best = {
				kind: "food",
				source: "off_imported",
				foodId: hit._id,
				name: hit.name,
				brand: hit.brand,
				kcal100: hit.kcal100,
				carbs100: hit.carbs100,
				protein100: hit.protein100,
				fat100: hit.fat100,
				score: s,
			};
		}
	}

	// 2) CIQUAL — recherché SI le socle Convex est insuffisant OU en compétition
	//    directe (le score final garde le meilleur des deux mondes).
	const ciqHits = searchCiqualLocal(term);
	for (const c of ciqHits) {
		if (resolveCiqualLabel(c.label) === null) continue; // sécurité : fiche exacte uniquement
		let s = nameMatchScore(name, c.label) + 0.05; // bonus référence officielle
		s += cookedBonusFor(c.label, wantCooked);
		if (s > bestScore) {
			bestScore = s;
			best = {
				kind: "ciqual",
				source: "ciqual",
				ciqualLabel: c.label,
				name: c.label,
				kcal100: c.kcal,
				carbs100: c.carbs ?? 0,
				protein100: c.protein ?? 0,
				fat100: c.fat ?? 0,
				score: s,
			};
		}
	}

	return best && bestScore >= MIN_MATCH_SCORE ? best : null;
}

/** Cœur partagé : matching d'une liste de composants IA (query authentifiée ou action). */
export async function matchComponentsCore(
	ctx: QueryCtx,
	userId: string,
	components: { name: string; qtyGrams: number; kcal100?: number; carbs100?: number; protein100?: number; fat100?: number; note?: string }[]
): Promise<MatchedComponent[]> {
	const out: MatchedComponent[] = [];
	for (const c of components.slice(0, 12)) {
		const label = String(c.name ?? "").trim().slice(0, 80);
		if (!label) continue;
		const qty = clampQty(c.qtyGrams);
		// Règle repas « servi cuit » : riz/pâtes/semoule… visibles dans une
		// assiette sont recherchés en variante CUITE (jamais cru) — sauf si
		// l'ingrédient porte déjà « cru »/« sec » (photo d'aliment sec). La
		// recherche générale (Journal) n'est PAS concernée : ce code ne vit
		// que dans le matching des composants d'une photo.
		const cookedTerm = preferCookedForMeal(label);
		let m = await findBestMatch(ctx, userId, label, {
			searchTerm: cookedTerm ?? label,
			wantCooked: cookedTerm !== null,
		});
		if (!m && cookedTerm) {
			// Aucune variante cuite trouvée (recherche étroite) : repli sur la
			// recherche nominale — la pénalité « cru » reste appliquée, donc une
			// fiche crue ne gagne QUE si c'est le seul candidat crédible.
			m = await findBestMatch(ctx, userId, label, { searchTerm: label, wantCooked: true });
		}
		if (m) {
			// Un aliment « Créés par moi » doit être référencé comme customFoodId
			// (jamais foodId, réservé à la base OFF) ; Ciqual passe par son libellé.
			const isCustom = m.kind === "food" && m.source === "custom";
			out.push({
				label,
				qtyGrams: qty,
				matchSource: m.source,
				foodId: m.kind === "food" && m.source === "off_imported" ? m.foodId : undefined,
				customFoodId: isCustom ? m.foodId : undefined,
				ciqualLabel: m.ciqualLabel,
				name: m.name,
				brand: m.brand,
				kcal100: m.kcal100,
				carbs100: m.carbs100,
				protein100: m.protein100,
				fat100: m.fat100,
				aiKcal100: c.kcal100,
				aiCarbs100: c.carbs100,
				aiProtein100: c.protein100,
				aiFat100: c.fat100,
				aiNote: c.note,
				score: Math.round(m.score * 100) / 100,
			});
		} else {
			out.push(aiFallback(label, { ...c, qtyGrams: qty }));
		}
	}
	return out;
}

/** Version query authentifiée (cliente) — usage direct depuis le BFF. */
export const matchComponents = query({
	args: {
		sessionToken: v.optional(v.string()),
		components: v.array(
			v.object({
				name: v.string(),
				qtyGrams: v.number(),
				/** Valeurs IA /100 g (secours si aucun match) — jamais la source. */
				kcal100: v.optional(v.number()),
				carbs100: v.optional(v.number()),
				protein100: v.optional(v.number()),
				fat100: v.optional(v.number()),
				note: v.optional(v.string()),
			})
		),
	},
	handler: async (ctx, { sessionToken, components }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) throw new Error("Session invalide ou expirée.");
		if (user.role !== "client") throw new Error("Réservé aux comptes clients.");
		return matchComponentsCore(ctx, user._id, components);
	},
});

/** Version interne (action aiAnalysis.analyzeMeal, sans session) — la session
 *  y est déjà vérifiée ; ce fragment ne fait que la lecture base. */
export const matchComponentsInternal = internalQuery({
	args: {
		userId: v.id("users"),
		components: v.array(
			v.object({
				name: v.string(),
				qtyGrams: v.number(),
				kcal100: v.optional(v.number()),
				carbs100: v.optional(v.number()),
				protein100: v.optional(v.number()),
				fat100: v.optional(v.number()),
				note: v.optional(v.string()),
			})
		),
	},
	handler: async (ctx, { userId, components }) => matchComponentsCore(ctx, userId, components),
});

export type { FoodHit };
