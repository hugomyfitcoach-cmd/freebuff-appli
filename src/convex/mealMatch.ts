import { internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { FOOD_SEARCH_CANDIDATES, rankFoods, tokenize, norm } from "./foodRanking";
import { toHit, type FoodHit } from "./journal";
import { searchCiqualLocal, resolveCiqualLabel } from "./ciqual";
import { getSessionUser } from "./helpers";
import type { QueryCtx } from "./_generated/server";
import { preferCookedForMeal, cookedBonusFor } from "../lib/cookedState";
import { nameMatchScore, flavorConflict } from "../lib/foodText";
import type { MealQtySource } from "../lib/mealFusion";

/** Tokens de rivalité suivis par flavorConflict (axes goût / MG / sucre). */
export const FLAVOR_TOKENS: ReadonlySet<string> = new Set([
	"nature", "fraise", "vanille", "chocolat", "stracciatella", "myrtille",
	"peche", "abricot", "cacao", "cafe", "caramel", "citron", "orange", "pomme",
	"ecreme", "demi", "entier", "zero", "classic", "classique", "light",
]);

/**
 * Variantes DEMANDÉES pour un composant emballé : tokens de rivalité présents
 * dans le nom ET/OU la variante lue par l'IA (« Stracciatella » dans variant,
 * « Coca-Cola Zero » dans le nom — les deux se cumulent).
 */
export function demandedFlavorTokens(name: string, variant?: string): string[] {
	const collect = (s: string) =>
		norm(s)
			.split(" ")
			.filter((t) => FLAVOR_TOKENS.has(t));
	return [...new Set([...collect(name), ...collect(variant ?? "")])];
}

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
 * Produit emballé déjà résolu par code-barres (Repas IA) : la résolution
 * `off.resolveBarcodeInternal` a trouvé la fiche EXACTE (base locale, aliment
 * personnel ou API OFF) — aucun rapprochement nominal à faire, le score est
 * de confiance maximale. Côté formulaire, l'IA n'a JAMAIS inventé ce match :
 * il vient d'un code lisible sur la photo (même moteur que le scan).
 */
export type PreResolvedBarcode = {
	source: "food" | "custom";
	foodId?: string;
	customFoodId?: string;
	name: string;
	brand?: string;
	kcal100: number;
	carbs100: number;
	protein100: number;
	fat100: number;
};

/**
 * Termes de recherche d'un composant EMBALLÉ, du plus spécifique au plus
 * générique : « marque + variante + produit » puis déclinaisons. L'ordre
 * applique la règle produit : on ne force JAMAIS un match de marque faible —
 * si aucun terme ne trouve de correspondance fiable, le composant retombe en
 * « Estimation IA » (jamais une fiche de marque approchante mais fausse).
 */
export function packagedSearchTerms(name: string, brand?: string, variant?: string): string[] {
	const clean = (s: string) => s.trim().replace(/\s+/g, " ");
	const n = clean(name);
	const b = brand ? clean(brand) : "";
	const v = variant && clean(variant).toLowerCase() !== n.toLowerCase() ? clean(variant) : "";
	const terms: string[] = [];
	const push = (t: string) => {
		const k = clean(t);
		if (k.length >= 2 && !terms.includes(k)) terms.push(k);
	};
	if (b && v) push(`${b} ${v} ${n}`);
	if (v) push(`${v} ${n}`);
	if (b) push(`${b} ${n}`);
	push(n);
	return terms;
}

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
	/** Provenance de la QUANTITÉ (méta d'affichage Repas IA multimodal) :
	 *  'user' = écrite par l'utilisatrice (texte/correction) — prioritaire ;
	 *  'photo' = reconnue sur la photo ; 'estimated' = estimée, à vérifier.
	 *  ABSENT sur le chemin photo seul (comportement historique préservé). */
	qtySource?: MealQtySource;
};

/** Quantité bornée (1–2000 g), valeur défensive pour des données IA. */
function clampQty(n: number | undefined): number {
	if (n === undefined || !isFinite(n)) return 100;
	return Math.min(2000, Math.max(1, Math.round(n)));
}

/** Composant « Estimation IA » (aucun match fiable). */
function aiFallback(
	label: string,
	c: { qtyGrams: number; kcal100?: number; carbs100?: number; protein100?: number; fat100?: number; note?: string; qtySource?: MealQtySource }
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
		qtySource: c.qtySource,
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
 *
 * ⚠ PRODUIT EMBALLÉ DEMANDANT UNE VARIANTE : une fiche portant une variante
 * RIVALE (nature vs stracciatella, écrémé vs demi-écrémé, Zero vs classique,
 * fraise vs vanille…) est toujours rejetée (voir flavorConflict) — une
 * couverture nominale élevée (« yaourt à la grecque ») ne peut plus faire
 * gagner « nature » quand la photo montre « Stracciatella ».
 */
async function findBestMatch(
	ctx: QueryCtx,
	userId: string,
	name: string,
	opts?: { searchTerm?: string; wantCooked?: boolean; demandedFlavors?: string[] }
): Promise<MealMatchRow | null> {
	// Règle « état cuit par défaut » (repas IA uniquement) : le terme de
	// recherche porte « cuit » pour les féculents servis dans une assiette.
	const term = (opts?.searchTerm ?? name).trim().toLowerCase();
	if (term.length < 2) return null;
	const wantCooked = opts?.wantCooked === true;

	// Variantes DEMANDÉES du composant (« stracciatella », « zero », « écrémé »…):
	// tokens de rivalité présents dans la requête — une fiche portant une
	// variante RIVALE doit être rejetée (jamais « nature » pour « stracciatella »).
	const reqToks = tokenize(name);
	const demandedFlavors = [
		...reqToks.filter((t) => FLAVOR_TOKENS.has(t)),
		...(opts?.demandedFlavors ?? []),
	];

	let best: MealMatchRow | null = null;
	let bestScore = 0;

	// 1a) Aliments de la cliente (ses produits réels d'abord).
	const customs = await ctx.db
		.query("customFoods")
		.withSearchIndex("by_name", (sb) => sb.search("name", term))
		.take(8);
	for (const f of customs) {
		if (demandedFlavors.length > 0 && flavorConflict(demandedFlavors, tokenize(f.name))) continue;
		let s = nameMatchScore(name, f.name) + 0.05; // bonus « sa propre base »
		// Variante demandée absente de la fiche (« Coca-Cola » pour « Zero ») :
		// même handicap que Ciqual — la fiche tombe sous le seuil.
		if (demandedFlavors.length > 0) {
			const fToks = tokenize(f.name);
			if (!demandedFlavors.every((fl) => fToks.includes(fl))) s -= 0.35;
		}
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
		if (demandedFlavors.length > 0 && flavorConflict(demandedFlavors, tokenize(hit.name))) continue;
		let s = nameMatchScore(name, hit.name) - (hit.brand?.trim() ? 0.08 : 0);
		// Variante demandée absente de la fiche (« Coca-Cola » classique pour un
		// « Zero ») : handicap majeur uniforme (Ciqual, custom, OFF local).
		if (demandedFlavors.length > 0) {
			const hToks = tokenize(hit.name);
			if (!demandedFlavors.every((fl) => hToks.includes(fl))) s -= 0.35;
		}
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
		if (demandedFlavors.length > 0 && flavorConflict(demandedFlavors, tokenize(c.label))) continue;
		let s = nameMatchScore(name, c.label) + 0.05; // bonus référence officielle
		// Variante demandée ABSENTE du libellé Ciqual (« grecque aromatisé, sucré »
		// sans parfum précis) : HANDICAP MAJEUR (−0.35) — le meilleur score
		// nominal possible (~0.85) passe sous le seuil global (0.55) → la fiche
		// générique est écartée au profit de l'ESTIMATION IA (règle produit :
		// jamais une fiche générique pour un produit dont la variante est connue).
		if (demandedFlavors.length > 0) {
			const labelToks = tokenize(c.label);
			if (!demandedFlavors.every((f) => labelToks.includes(f))) s -= 0.35;
		}
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

/**
 * Recherche OFF LIVE pour un composant emballé : elle vit DANS L'ACTION
 * (aiAnalysis.analyzeMeal — une query n'a pas le droit au réseau) via
 * `off.searchOffProductsInternal` ; le produit retenu est mis en cache
 * (`journal.cacheFoods`) puis transmis ici en `preResolved`, exactement
 * comme le chemin code-barres. Le socle local ci-dessous reste le repli.
 */

/** Cœur partagé : matching d'une liste de composants IA (query authentifiée ou action). */
export async function matchComponentsCore(
	ctx: QueryCtx,
	userId: string,
	components: {
		name: string;
		qtyGrams: number;
		kcal100?: number;
		carbs100?: number;
		protein100?: number;
		fat100?: number;
		note?: string;
		/** Produit emballé (paquet, bouteille, brique…) — recherche dédiée. */
		packaged?: boolean;
		/** Marque imprimée sur l'emballage (ex. « Haribo ») — jamais inventée. */
		brand?: string;
		/** Variante / déclinaison imprimée (ex. « Dragibus », « demi-écrémé »). */
		variant?: string;
		/** Code-barres lisible — résolu en amont (off.resolveBarcodeInternal). */
		preResolved?: PreResolvedBarcode;
		/** Import de RECETTE : la liste donne des poids CRU/SEC (« 50 g de quinoa ») —
		 *  la règle repas « servi cuit » ne s'applique PAS. Additif : absent =
		 *  comportement inchangé (Repas IA). */
		ignoreCookedRule?: boolean;
		/** Source de la quantité (multimodal : 'user' / 'photo' / 'estimated') —
		 *  méta d'affichage recopiée telle quelle, aucun effet sur le matching. */
		qtySource?: MealQtySource;
	}[]
): Promise<MatchedComponent[]> {
	const out: MatchedComponent[] = [];
	for (const c of components.slice(0, 12)) {
		const label = String(c.name ?? "").trim().slice(0, 80);
		if (!label) continue;
		const qty = clampQty(c.qtyGrams);

		// 0) Produit emballé déjà résolu PAR CODE-BARRES : match exact (même
		//    moteur que le scan), aucun rapprochement nominal, aucune heuristique.
		if (c.preResolved) {
			const p = c.preResolved;
			out.push({
				label,
				qtyGrams: qty,
				matchSource: p.source === "custom" ? "custom" : "off_imported",
				foodId: p.source === "food" ? p.foodId : undefined,
				customFoodId: p.source === "custom" ? p.customFoodId : undefined,
				name: p.name,
				brand: p.brand,
				kcal100: p.kcal100,
				carbs100: p.carbs100,
				protein100: p.protein100,
				fat100: p.fat100,
				aiKcal100: c.kcal100,
				aiCarbs100: c.carbs100,
				aiProtein100: c.protein100,
				aiFat100: c.fat100,
				aiNote: c.note,
				qtySource: c.qtySource,
				score: 1,
			});
			continue;
		}
		// Produit EMBALLÉ sans code-barres exploitable : recherche « marque +
		// variante + produit » du plus spécifique au plus générique. La règle
		// « servi cuit » ne s'applique PAS (le paquet n'est pas dans l'assiette) :
		// aucune réécriture du terme, aucun bonus cuit.
		let m: MealMatchRow | null = null;
		if (c.packaged) {
			// Variante lue par l'IA même si elle n'est pas dans le nom
			// (« Stracciatella » dans variant, nom = « Yaourt à la grecque »).
			const demanded = demandedFlavorTokens(label, c.variant);
			const runLocalSearch = async (term: string) =>
				findBestMatch(ctx, userId, label, {
					searchTerm: term,
					wantCooked: false,
					demandedFlavors: demanded,
				});
			// 1) OPEN FOOD FACTS LIVE : résolu DANS L'ACTION (aiAnalysis) via
			//    `off.searchOffProductsInternal` + cache → transmis en
			//    `preResolved` (même chemin que le code-barres). Ici : socle local
			//    (custom → OFF importé → Ciqual), ladder spécifique → générique.
			for (const term of packagedSearchTerms(label, c.brand, c.variant)) {
				m = await runLocalSearch(term);
				if (m) break;
			}
		} else {
			// Règle repas « servi cuit » : riz/pâtes/semoule… visibles dans une
			// assiette sont recherchés en variante CUITE (jamais cru) — sauf si
			// l'ingrédient porte déjà « cru »/« sec » (photo d'aliment sec). La
			// recherche générale (Journal) n'est PAS concernée : ce code ne vit
			// que dans le matching des composants d'une photo.
			// Import de RECETTE (ignoreCookedRule) : la liste d'ingrédients donne
			// des poids CRU/SEC — jamais réécrits en « cuit ».
			const cookedTerm = c.ignoreCookedRule ? null : preferCookedForMeal(label);
			m = await findBestMatch(ctx, userId, label, {
				searchTerm: cookedTerm ?? label,
				wantCooked: cookedTerm !== null,
			});
			if (!m && cookedTerm) {
				// Aucune variante cuite trouvée (recherche étroite) : repli sur la
				// recherche nominale — la pénalité « cru » reste appliquée, donc une
				// fiche crue ne gagne QUE si c'est le seul candidat crédible.
				m = await findBestMatch(ctx, userId, label, { searchTerm: label, wantCooked: true });
			}
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
				qtySource: c.qtySource,
				score: Math.round(m.score * 100) / 100,
			});
		} else {
			// Estimation IA : le libellé porte la marque connue si elle existe
			// (ex. « Dragibus (Haribo) ») — jamais une fausse fiche de marque.
			const labelWithBrand =
				c.brand && !label.toLowerCase().includes(c.brand.toLowerCase()) ? `${label} (${c.brand})` : label;
			out.push(aiFallback(labelWithBrand.slice(0, 80), { ...c, qtyGrams: qty }));
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
				/** Métadonnées emballage lues par l'IA sur la photo. */
				packaged: v.optional(v.boolean()),
				brand: v.optional(v.string()),
				variant: v.optional(v.string()),
				/** Provenance de la quantité (multimodal) — recopiée, jamais interprétée ici. */
				qtySource: v.optional(v.union(v.literal("user"), v.literal("photo"), v.literal("estimated"))),
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
				/** Métadonnées emballage lues par l'IA sur la photo. */
				packaged: v.optional(v.boolean()),
				brand: v.optional(v.string()),
				variant: v.optional(v.string()),
				/** Import de recette : poids crus — règle « servi cuit » neutralisée. */
				ignoreCookedRule: v.optional(v.boolean()),
				/** Provenance de la quantité (multimodal) — recopiée, jamais interprétée ici. */
				qtySource: v.optional(v.union(v.literal("user"), v.literal("photo"), v.literal("estimated"))),
				/** Produit DÉJÀ résolu par code-barres — assemblé CÔTÉ SERVEUR
				 *  uniquement (aiAnalysis), jamais transmis par la cliente : la
				 *  query publique matchComponents n'accepte PAS ce champ. */
				preResolved: v.optional(
					v.object({
						source: v.union(v.literal("food"), v.literal("custom")),
						foodId: v.optional(v.string()),
						customFoodId: v.optional(v.string()),
						name: v.string(),
						brand: v.optional(v.string()),
						kcal100: v.number(),
						carbs100: v.number(),
						protein100: v.number(),
						fat100: v.number(),
					})
				),
			})
		),
	},
	handler: async (ctx, { userId, components }) => matchComponentsCore(ctx, userId, components),
});

export type { FoodHit };
