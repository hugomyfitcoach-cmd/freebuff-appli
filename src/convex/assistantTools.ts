/**
 * COUCHE OUTILS ASSISTANT — G-FLUX V1 (preview isolée).
 *
 * Séparation stricte avec `assistant.ts` (orchestration) et le frontend :
 *  - ce module ne fait QUE de la LECTURE déterministe et de la PRÉPARATION
 *    d'écritures (création d'une ligne `assistantActions` en attente) ;
 *  - AUCUNE écriture métier n'est commise ici : elle n'arrive qu'après le clic
 *    « Enregistrer » de la cliente, via `assistant.resolveAction` ;
 *  - AUCUN outil ne touche un objectif (calories/macros/pas), le coachingMode,
 *    l'entraînement ou le planning Coach — ces écritures N'EXISTENT PAS ici
 *    (liste fermée `assistantActionType` dans schema.ts) ;
 *  - AUCUNE duplication : les écritures réelles réutilisent les mutations
 *    existantes (`meals.commitAnalyzedMeal`, `journal.removeEntry`,
 *    `steps.setSteps`, `metrics.upsert`) — le LLM n'est jamais la source de
 *    vérité, il choisit l'outil et reformule le résultat du serveur.
 *
 * Toutes les fonctions revérifient la session, le flag serveur ET le hard
 * lock Billing (défense en profondeur : le BFF ne suffit pas).
 */

import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getSessionUser, localTodayISO, mondayISOof, addDaysISO } from "./helpers";
import { trustedClientToday } from "./journal";
import { assistantLimits, assistantEnabledFor } from "../lib/assistant/policy";

/** Liste FERMÉE des écritures préparables (miroir de schema.ts). */
type AssistantActionType =
	| "journal_add"
	| "journal_remove"
	| "steps"
	| "weight"
	| "measurement"
	| "coach_question";
import { accessStateForUser } from "./billing";
import { ciqualFoodSource } from "./ciqualSource";
import { searchCiqualLocal } from "./ciqual";
import { guardedKcal100 } from "../lib/nutritionGuard";
import { rankFoods, norm, tokenize, FOOD_SEARCH_CANDIDATES } from "./foodRanking";
import { reperesForFood } from "../lib/data/gfluxReperes";
import { recipes, newRecipes } from "../lib/data/recettes";
import { kcalGoalForDate, withCurrentGoal } from "../lib/goalHistory";


/* ─────────────────────────── Garde commune ─────────────────────────── */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Cliente authentifiée, flag Assistant ON et accès app NON bloqué.
 *  Exporté : garde commune partagée par les outils de lecture étendus (Lot 2). */
export async function requireAssistantClient(ctx: QueryCtx | MutationCtx, sessionToken?: string) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") throw new ConvexError("L'Assistant est réservé aux comptes clients.");
	if (!assistantEnabledFor(user.email)) throw new ConvexError("L'Assistant n'est pas activé pour ce compte.");
	// HARD LOCK Autonomie prioritaire — même décision que le BFF, recalculée ici.
	if (accessStateForUser(user, Date.now()).decision === "block") {
		throw new ConvexError("Accès suspendu — mets à jour ton abonnement pour continuer.");
	}
	return user;
}

function assertDate(date: string, opts?: { noFuture?: boolean }): void {
	if (!DATE_RE.test(date)) throw new ConvexError("Date invalide.");
	// Frontière « futur » : même règle que le Journal (fuseau cliente ≠ UTC
	// serveur) — la date envoyée est acceptée si elle est plausible (±1 jour).
	const today = trustedClientToday(date);
	if (opts?.noFuture && date > today) throw new ConvexError("Pas de saisie future.");
	if (date < "2000-01-01" || date > addDaysISO(localTodayISO(), 400)) throw new ConvexError("Date invalide.");
}

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

/* ───────── FIDÉLITÉ DES ALIMENTS (chantier A) ─────────
 *
 * Deux helpers déterministes utilisés par `prepareJournalEntry` :
 *  - `nameCovers` : la fiche candidate « représente-t-elle » l'aliment
 *    demandé ? Recouvrement de mots normalisés (nom de fiche ⊇ demande ou
 *    inversement), marque tolérée mais jamais suffisante. Empêche la
 *    substitution silencieuse (« jus d'orange » ↔ « pur jus de pomme »).
 *  - `searchFoodInternal` : recherche par nom faite PAR LE SERVEUR quand le
 *    modèle n'a pas fourni d'identifiant — réutilise exactement les mêmes
 *    sources que `searchFood` (OFF + aliments cliente + Ciqual).
 */

/** Tokens significatifs d'un nom (hors mots outils et états de préparation). */
function significantTokens(name: string): string[] {
	const STOP = new Set([
		"au", "a", "la", "aux", "de", "du", "des", "en", "et", "avec", "sans",
		"pur", "nature", "type", "style", "cuit", "cuite", "cru", "crue", "fume",
		"grille", "fraiche", "frais", "surgele", "sec", "seche", "bio",
	]);
	return norm(name)
		.split(" ")
		.filter((t) => t.length >= 2 && !STOP.has(t))
		.map((t) => (t.length >= 5 && t.endsWith("s") ? t.slice(0, -1) : t));
}

/**
 * La fiche représente-t-elle l'aliment demandé ? True si le recouvrement de
 * tokens significatifs est total dans un sens ou l'autre (la demande peut
 * être plus courte que la fiche : « avoine » ⊑ « Flocons d'avoine »).
 */
export function nameCovers(refName: string, refBrand: string | undefined, declared: string): boolean {
	const refToks = new Set(significantTokens(refName));
	// La marque de la fiche ne doit PAS être comptée comme couvrante seule :
	// « Tropicana » ne justifie pas « jus d'orange ». Mais si la demande cite
	// la marque, ça ne doit pas non plus la faire passer pour un autre aliment.
	const askToks = significantTokens(declared);
	if (refToks.size === 0 || askToks.length === 0) return false;
	const covers = (a: Set<string>, b: string[]) => b.every((t) => a.has(t));
	if (covers(refToks, askToks)) return true;
	const askSet = new Set(askToks);
	if (covers(askSet, [...refToks])) return true;
	// Tolérance singulier/pluriel via norm+singularise déjà appliquée.
	return false;
}

/**
 * Référence générique Ciqual à placer EN PREMIER quand aucun produit OFF ne
 * matche directement la requête (« pommes » → « Pomme » Ciqual, pas
 * « Pur jus de pomme Tropicana »). Un produit OFF dont le nom COMMENCE par la
 * requête (« lait demi-écrémé », « coca cola ») garde la priorité : c'est le
 * produit exact, marque incluse.
 */
export function genericCiqualFirst(term: string): FoodRef | null {
	const hits = searchCiqualLocal(term);
	const termNorm = norm(term);
	for (const hit of hits) {
		if (!nameCovers(hit.label, undefined, term)) continue;
		const src = ciqualFoodSource(hit.label);
		if (!src) continue;
		return {
			ciqualLabel: hit.label,
			name: src.name,
			kcal100: src.kcal100,
			carbs100: src.carbs100,
			protein100: src.protein100,
			fat100: src.fat100,
			origin: "reference",
		};
	}
	void termNorm;
	return null;
}

/** Recherche aliment par nom CÔTÉ SERVEUR (mêmes sources que searchFood). */
async function searchFoodInternal(
	ctx: QueryCtx,
	userId: Id<"users">,
	declared: string
): Promise<FoodRef | null> {
	const term = declared.trim().toLowerCase().slice(0, 60);
	if (term.length < 2) return null;
	const [foods, customs] = await Promise.all([
		// MÊME fenêtre de candidats que la recherche du journal (foodRanking) :
		// un aliment trouvé par la cliente dans le journal DOIT être trouvable par
		// l'assistant — un seul moteur de classement, pas deux.
		ctx.db.query("foods").withSearchIndex("by_name", (sb) => sb.search("name", term)).take(FOOD_SEARCH_CANDIDATES),
		ctx.db
			.query("customFoods")
			.withSearchIndex("by_name", (sb) => sb.search("name", term))
			.filter((q) => q.eq(q.field("userId"), userId))
			.take(6),
	]);
	// Aliment personnel d'abord (c'est SA fiche) — MAIS seulement s'il
	// représente vraiment la demande (sinon substitution silencieuse).
	if (customs.length > 0 && nameCovers(customs[0].name, customs[0].brand, declared)) {
		const c = customs[0];
		return {
			customFoodId: c._id,
			name: c.name,
			brand: c.brand,
			kcal100: c.kcal100,
			carbs100: c.carbs100,
			protein100: c.protein100,
			fat100: c.fat100,
			...(c.servingQty ? { servingQty: c.servingQty } : {}),
			origin: "personal",
		};
	}
	const ranked = rankFoods(
		foods.map((f) => ({ _id: f._id as string, name: f.name, brand: f.brand, kcal100: f.kcal100, carbs100: f.carbs100, protein100: f.protein100, fat100: f.fat100 })),
		term
	);
	// Générique Ciqual d'abord si le meilleur produit OFF n'est pas direct.
	const offTopDirect = ranked[0] ? norm(ranked[0].name).startsWith(norm(term)) : false;
	if (!offTopDirect) {
		const generic = genericCiqualFirst(term);
		if (generic && nameCovers(generic.name, undefined, declared)) return generic;
	}
	for (const f of ranked) {
		// La fiche retenue doit représenter la demande (anti-substitution).
		if (nameCovers(f.name, f.brand, declared)) {
			return {
				foodId: f._id as Id<"foods">,
				name: f.name,
				brand: f.brand,
				kcal100: guardedKcal100(f as never),
				carbs100: f.carbs100,
				protein100: f.protein100,
				fat100: f.fat100,
				origin: "product",
			};
		}
	}
	for (const hit of searchCiqualLocal(term)) {
		if (nameCovers(hit.label, undefined, declared)) {
			const src = ciqualFoodSource(hit.label);
			if (!src) continue;
			return {
				ciqualLabel: hit.label,
				name: src.name,
				kcal100: src.kcal100,
				carbs100: src.carbs100,
				protein100: src.protein100,
				fat100: src.fat100,
				origin: "reference",
			};
		}
	}
	return null;
}

/* ───────────────────── 1. Objectifs + restes du jour ───────────────────── */

export type DaySnapshot = {
	date: string;
	goals: { kcal: number; carbs: number; protein: number; fat: number; stepGoal: number | null };
	eaten: { kcal: number; carbs: number; protein: number; fat: number };
	remaining: { kcal: number; carbs: number; protein: number; fat: number };
	/** % de l'objectif calorique atteint (0–200 borné pour l'affichage). */
	percentEaten: number;
	steps: { count: number | null; goal: number | null };
	weight: { kg: number; date: string } | null;
	entriesCount: number;
};

async function daySnapshot(
	ctx: QueryCtx,
	userId: Id<"users">,
	date: string
): Promise<DaySnapshot> {
	const [entries, goalsRow, history, stepsRow, metrics] = await Promise.all([
		ctx.db
			.query("diaryEntries")
			.withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date))
			.collect(),
		ctx.db.query("clientGoals").withIndex("by_userId", (q) => q.eq("userId", userId)).first(),
		ctx.db
			.query("clientGoalHistory")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.order("asc")
			.collect(),
		ctx.db.query("dailySteps").withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date)).first(),
		ctx.db
			.query("bodyMetrics")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.order("desc")
			.take(1),
	]);
	// Objectif CALORIES : historisé (une seule défaut applicable par date) —
	// JAMAIS recalculé par le modèle (§21).
	const kcalGoal = kcalGoalForDate(withCurrentGoal(history, goalsRow?.kcal ?? 2000, date), date, goalsRow?.kcal ?? 2000);
	const goals = {
		kcal: kcalGoal,
		carbs: goalsRow?.carbs ?? 0,
		protein: goalsRow?.protein ?? 0,
		fat: goalsRow?.fat ?? 0,
		stepGoal: goalsRow?.stepGoal ?? null,
	};
	const eaten = { kcal: 0, carbs: 0, protein: 0, fat: 0 };
	for (const e of entries) {
		eaten.kcal += e.kcal;
		eaten.carbs += e.carbs;
		eaten.protein += e.protein;
		eaten.fat += e.fat;
	}
	const r = (n: number) => Math.round(n);
	const eatenR = { kcal: r(eaten.kcal), carbs: round1(eaten.carbs), protein: round1(eaten.protein), fat: round1(eaten.fat) };
	const remaining = {
		kcal: r(goals.kcal - eaten.kcal),
		carbs: round1(goals.carbs - eaten.carbs),
		protein: round1(goals.protein - eaten.protein),
		fat: round1(goals.fat - eaten.fat),
	};
	const latest = metrics[0] ?? null;
	return {
		date,
		goals,
		eaten: eatenR,
		remaining,
		percentEaten: goals.kcal > 0 ? Math.min(200, Math.round((eaten.kcal / goals.kcal) * 100)) : 0,
		steps: { count: stepsRow?.count ?? null, goal: goals.stepGoal },
		weight: latest?.weightKg !== undefined && latest?.weightKg !== null ? { kg: latest.weightKg, date: latest.date } : null,
		entriesCount: entries.length,
	};
}

/**
 * `getCurrentGoals` + `getRemainingToday` (§20) — en une seule lecture.
 * Tous les chiffres sont déterministes ; le modèle les EXPLIQUE seulement.
 */
export const getToday = query({
	args: { sessionToken: v.optional(v.string()), date: v.optional(v.string()) },
	handler: async (ctx, { sessionToken, date }): Promise<DaySnapshot> => {
		const user = await requireAssistantClient(ctx, sessionToken);
		const d = date && DATE_RE.test(date) ? date : localTodayISO();
		return daySnapshot(ctx, user._id, d);
	},
});

/* ───────────────────────── 2. Recherche aliment ───────────────────────── */

export type FoodRef = {
	foodId?: string;
	customFoodId?: string;
	ciqualLabel?: string;
	name: string;
	brand?: string;
	kcal100: number;
	carbs100: number;
	protein100: number;
	fat100: number;
	/** Portion suggérée du produit (g) si connue. */
	servingQty?: number;
	/** Dernière quantité RÉELLEMENT validée par la cliente (g). */
	rememberedQty?: number;
	/** Repères G-FLUX pertinents (« 1 tranche », « 1 c. à soupe »…). */
	reperes?: { label: string; grams: number }[];
	/** D'où vient la fiche : product (OFF) | personal | reference (Ciqual). */
	origin: "product" | "personal" | "reference";
};

async function portionMemory(
	ctx: QueryCtx,
	userId: Id<"users">,
	ref: { foodId?: Id<"foods">; customFoodId?: Id<"customFoods">; ciqualLabel?: string }
): Promise<number | null> {
	let row = null;
	if (ref.foodId) {
		row = await ctx.db
			.query("foodPortions")
			.withIndex("by_user_food", (q) => q.eq("userId", userId).eq("foodId", ref.foodId!))
			.first();
	} else if (ref.customFoodId) {
		row = await ctx.db
			.query("foodPortions")
			.withIndex("by_user_custom", (q) => q.eq("userId", userId).eq("customFoodId", ref.customFoodId!))
			.first();
	} else if (ref.ciqualLabel) {
		row = await ctx.db
			.query("foodPortions")
			.withIndex("by_user_ciqual", (q) => q.eq("userId", userId).eq("ciqualLabel", ref.ciqualLabel!))
			.first();
	}
	return row?.qtyGrams ?? null;
}

function repereList(name: string): { label: string; grams: number }[] {
	return reperesForFood(name)
		.slice(0, 4)
		.map((r) => ({ label: r.plural, grams: r.grams }));
}

/**
 * `searchFood` (§19) — RÉUTILISE la base existante : OFF importé (`foods`),
 * aliments de la cliente (`customFoods`), références Ciqual/ANSES. Aucune
 * deuxième base parallèle.
 */
export const searchFood = query({
	args: { sessionToken: v.optional(v.string()), query: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, { sessionToken, query: raw, limit = 8 }) => {
		const user = await requireAssistantClient(ctx, sessionToken);
		const term = (raw ?? "").trim().toLowerCase().slice(0, 60);
		if (term.length < 2) return { items: [] as FoodRef[] };
		const [foods, customs] = await Promise.all([
		ctx.db.query("foods").withSearchIndex("by_name", (sb) => sb.search("name", term)).take(FOOD_SEARCH_CANDIDATES),
		ctx.db
			.query("customFoods")
			.withSearchIndex("by_name", (sb) => sb.search("name", term))
			.filter((q) => q.eq(q.field("userId"), user._id))
			.take(8),
		]);
		const ranked = rankFoods(
			foods.map((f) => ({
				_id: f._id as string,
				name: f.name,
				brand: f.brand,
				kcal100: f.kcal100,
				carbs100: f.carbs100,
				protein100: f.protein100,
				fat100: f.fat100,
			})),
			term
		);
		const out: FoodRef[] = [];
		for (const c of customs) {
			out.push({
				customFoodId: c._id,
				name: c.name,
				brand: c.brand,
				kcal100: c.kcal100,
				carbs100: c.carbs100,
				protein100: c.protein100,
				fat100: c.fat100,
				...(c.servingQty ? { servingQty: c.servingQty } : {}),
				origin: "personal",
			});
		}
		// Générique Ciqual EN PREMIER si le meilleur produit OFF ne commence pas
		// directement par la requête (anti « jus de pomme pour des pommes »).
		const offTopDirect = ranked[0] ? norm(ranked[0].name).startsWith(norm(term)) : false;
		if (!offTopDirect) {
			const generic = genericCiqualFirst(term);
			if (generic) out.push(generic);
		}
		for (const f of ranked) {
			if (out.length >= limit) break;
			out.push({
				foodId: f._id,
				name: f.name,
				brand: f.brand,
				kcal100: f.kcal100,
				carbs100: f.carbs100,
				protein100: f.protein100,
				fat100: f.fat100,
				origin: "product",
			});
		}
		if (out.length < limit) {
			for (const hit of searchCiqualLocal(term)) {
				if (out.length >= limit) break;
				const src = ciqualFoodSource(hit.label);
				if (!src) continue;
				out.push({
					ciqualLabel: hit.label,
					name: src.name,
					kcal100: src.kcal100,
					carbs100: src.carbs100,
					protein100: src.protein100,
					fat100: src.fat100,
					origin: "reference",
				});
			}
		}
		// Portions mémorisées (top résultats seulement — requêtes bornées).
		for (const item of out.slice(0, 6)) {
			const qty = await portionMemory(ctx, user._id, {
				foodId: item.foodId as Id<"foods"> | undefined,
				customFoodId: item.customFoodId as Id<"customFoods"> | undefined,
				ciqualLabel: item.ciqualLabel,
			});
			if (qty) item.rememberedQty = qty;
			const rep = repereList(item.name);
			if (rep.length) item.reperes = rep;
		}
		return { items: out };
	},
});

/** `getFoodReference` — une fiche précise + portion mémorisée. */
export const getFoodReference = query({
	args: {
		sessionToken: v.optional(v.string()),
		foodId: v.optional(v.string()),
		customFoodId: v.optional(v.string()),
		ciqualLabel: v.optional(v.string()),
	},
	handler: async (ctx, { sessionToken, foodId, customFoodId, ciqualLabel }) => {
		const user = await requireAssistantClient(ctx, sessionToken);
		const ref = await resolveRef(ctx, user._id, { foodId, customFoodId, ciqualLabel });
		if (!ref) return { ok: false as const, reason: "not_found" };
		ref.rememberedQty = (await portionMemory(ctx, user._id, {
			foodId: ref.foodId as Id<"foods"> | undefined,
			customFoodId: ref.customFoodId as Id<"customFoods"> | undefined,
			ciqualLabel: ref.ciqualLabel,
		})) ?? undefined;
		return { ok: true as const, item: ref };
	},
});

/** `estimateFoodPortion` — priorité §18 : mémorisée → produit → repère G-FLUX. */
export const estimateFoodPortion = query({
	args: {
		sessionToken: v.optional(v.string()),
		name: v.string(),
		foodId: v.optional(v.string()),
		customFoodId: v.optional(v.string()),
		ciqualLabel: v.optional(v.string()),
	},
	handler: async (ctx, { sessionToken, name, foodId, customFoodId, ciqualLabel }) => {
		const user = await requireAssistantClient(ctx, sessionToken);
		const ref = await resolveRef(ctx, user._id, { foodId, customFoodId, ciqualLabel });
		const remembered = ref
			? await portionMemory(ctx, user._id, {
					foodId: ref.foodId as Id<"foods"> | undefined,
					customFoodId: ref.customFoodId as Id<"customFoods"> | undefined,
					ciqualLabel: ref.ciqualLabel,
				})
			: null;
		return {
			rememberedQty: remembered,
			servingQty: ref?.servingQty ?? null,
			reperes: repereList(ref?.name ?? name),
			/** true → toute valeur proposée doit être affichée « ≈ Estimation ». */
			mustEstimate: remembered === null && !ref?.servingQty,
			source: remembered !== null ? "portion" : ref?.servingQty ? "product" : "reference",
		};
	},
});

/** Résout une référence alimentaire (jamais depuis le navigateur : on relit la base). */
async function resolveRef(
	ctx: QueryCtx,
	userId: Id<"users">,
	ref: { foodId?: string; customFoodId?: string; ciqualLabel?: string }
): Promise<FoodRef | null> {
	if (ref.foodId) {
		if (!/^[a-zA-Z0-9_-]{10,}$/.test(ref.foodId)) return null;
		let f: Doc<"foods"> | null = null;
		try {
			f = await ctx.db.get(ref.foodId as Id<"foods">);
		} catch {
			// ID bien formé regex MAIS intervalle/décodage Convex invalide
			// (ID fabriqué par le modèle, ex « Invalid ID length 31 ») →
			// pas de crash : « réf. inconnue », le pipeline re-résout par nom.
			return null;
		}
		if (!f) return null;
		return {
			foodId: f._id,
			name: f.name,
			brand: f.brand,
			kcal100: guardedKcal100(f),
			carbs100: f.carbs100,
			protein100: f.protein100,
			fat100: f.fat100,
			...(f.servingQty ? { servingQty: f.servingQty } : {}),
			origin: "product",
		};
	}
	if (ref.customFoodId) {
		if (!/^[a-zA-Z0-9_-]{10,}$/.test(ref.customFoodId)) return null;
		let f: Doc<"customFoods"> | null = null;
		try {
			f = await ctx.db.get(ref.customFoodId as Id<"customFoods">);
		} catch {
			return null; // ID fabriqué → réf. inconnue, jamais un crash
		}
		if (!f || f.userId !== userId) return null;
		return {
			customFoodId: f._id,
			name: f.name,
			brand: f.brand,
			kcal100: f.kcal100,
			carbs100: f.carbs100,
			protein100: f.protein100,
			fat100: f.fat100,
			...(f.servingQty ? { servingQty: f.servingQty } : {}),
			origin: "personal",
		};
	}
	if (ref.ciqualLabel) {
		const src = ciqualFoodSource(ref.ciqualLabel);
		if (!src) return null;
		return {
			ciqualLabel: ref.ciqualLabel,
			name: src.name,
			kcal100: src.kcal100,
			carbs100: src.carbs100,
			protein100: src.protein100,
			fat100: src.fat100,
			origin: "reference",
		};
	}
	return null;
}

/* ─────────────────────── 3. Recettes (base existante) ──────────────────── */

type RecipeHit = { index: string; name: string; meal: string; kcal: number; prot: number; temps?: string };

function allRecipes(): RecipeHit[] {
	const out: RecipeHit[] = [];
	const push = (bag: Record<string, unknown[] | undefined>, meal: string) => {
		for (const [key, list] of Object.entries(bag)) {
			if (!Array.isArray(list)) continue;
			for (const r of list as { index?: string; name?: string; kcal?: number; prot?: number; temps?: string }[]) {
				if (!r?.name) continue;
				out.push({ index: r.index ?? `${meal}-${out.length}`, name: r.name, meal: key, kcal: r.kcal ?? 0, prot: r.prot ?? 0, temps: r.temps });
			}
		}
	};
	push(recipes as Record<string, unknown[] | undefined>, "gflux");
	push(newRecipes as Record<string, unknown[] | undefined>, "nouvelles");
	return out;
}

/** `searchRecipes` — guide G-FLUX existant, AUCUNE base parallèle. */
export const searchRecipes = query({
	args: { sessionToken: v.optional(v.string()), query: v.string(), maxKcal: v.optional(v.number()), limit: v.optional(v.number()) },
	handler: async (ctx, { sessionToken, query: raw, maxKcal, limit = 6 }) => {
		await requireAssistantClient(ctx, sessionToken);
		const term = (raw ?? "").trim().toLowerCase();
		const cap = typeof maxKcal === "number" && maxKcal > 0 ? Math.min(3000, maxKcal) : null;
		let hits = allRecipes().filter((r) => (cap ? r.kcal <= cap : true));
		if (term.length >= 2) {
			const scored = hits
				.map((r) => {
					const n = r.name.toLowerCase();
					let score = 0;
					for (const w of term.split(/\s+/)) if (w.length > 2 && n.includes(w)) score += 2;
					if (n.includes(term)) score += 3;
					return { r, score };
				})
				.filter((x) => x.score > 0)
				.sort((a, b) => b.score - a.score || a.r.kcal - b.r.kcal);
			hits = scored.map((x) => x.r);
		} else {
			hits = hits.sort((a, b) => a.kcal - b.kcal);
		}
		return { items: hits.slice(0, limit) };
	},
});

/* ─────────────────────── 4. Récap de période (déterministe) ───────────── */

/**
 * `getPeriodRecap` — agrégats FACTUELS calculés ici, jamais par le modèle :
 * journées enregistrées, moyennes (jours avec donnée uniquement — un jour
 * vide n'est pas un 0), écarts aux objectifs, poids moyen, pas moyens.
 */
export const getPeriodRecap = query({
	args: { sessionToken: v.optional(v.string()), period: v.union(v.literal("day"), v.literal("week")), date: v.optional(v.string()) },
	handler: async (ctx, { sessionToken, period, date }) => {
		const user = await requireAssistantClient(ctx, sessionToken);
		const end = date && DATE_RE.test(date) ? date : localTodayISO();
		const days = period === "day" ? [end] : rangeDays(mondayISOof(end), end);
		const [entries, stepsRows, metricRows, goalsRow] = await Promise.all([
			ctx.db
				.query("diaryEntries")
				.withIndex("by_user_date", (q) => q.eq("userId", user._id).gte("date", days[0]).lt("date", addDaysISO(days[days.length - 1], 1)))
				.collect(),
			ctx.db
				.query("dailySteps")
				.withIndex("by_user", (q) => q.eq("userId", user._id))
				.order("asc")
				.collect(),
			ctx.db
				.query("bodyMetrics")
				.withIndex("by_user", (q) => q.eq("userId", user._id))
				.order("asc")
				.collect(),
			ctx.db.query("clientGoals").withIndex("by_userId", (q) => q.eq("userId", user._id)).first(),
		]);
		const daySet = new Set(days);
		const goalKcal = goalsRow?.kcal ?? 2000;
		const byDay = new Map<string, { kcal: number; carbs: number; protein: number; fat: number }>();
		for (const e of entries) {
			if (!daySet.has(e.date)) continue;
			const cur = byDay.get(e.date) ?? { kcal: 0, carbs: 0, protein: 0, fat: 0 };
			cur.kcal += e.kcal;
			cur.carbs += e.carbs;
			cur.protein += e.protein;
			cur.fat += e.fat;
			byDay.set(e.date, cur);
		}
		const logged = [...byDay.entries()].map(([d, t]) => ({ date: d, kcal: Math.round(t.kcal), carbs: round1(t.carbs), protein: round1(t.protein), fat: round1(t.fat) }));
		const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
		const steps = stepsRows.filter((s) => daySet.has(s.date));
		const weights = metricRows.filter((m) => daySet.has(m.date) && typeof m.weightKg === "number");
		return {
			period,
			days: days.length,
			daysWithJournal: logged.length,
			goalKcal,
			journal: logged,
			avgKcal: avg(logged.map((l) => l.kcal)),
			avgCarbs: avg(logged.map((l) => l.carbs)),
			avgProtein: avg(logged.map((l) => l.protein)),
			avgFat: avg(logged.map((l) => l.fat)),
			avgSteps: avg(steps.map((s) => s.count)),
			stepsDays: steps.length,
			avgWeight: avg(weights.map((m) => m.weightKg as number)),
			weightDays: weights.length,
			latestWeight: weights.length ? (weights[weights.length - 1].weightKg ?? null) : null,
		};
	},
});

function rangeDays(start: string, end: string): string[] {
	const out: string[] = [];
	let cur = start;
	let guard = 0;
	while (cur <= end && guard++ < 400) {
		out.push(cur);
		cur = addDaysISO(cur, 1);
	}
	return out.length ? out : [end];
}

/** Lignes du journal d'une date — pour corriger / retirer un aliment. */
export const getJournalEntries = query({
	args: { sessionToken: v.optional(v.string()), date: v.optional(v.string()) },
	handler: async (ctx, { sessionToken, date }) => {
		const user = await requireAssistantClient(ctx, sessionToken);
		const d = date && DATE_RE.test(date) ? date : localTodayISO();
		const entries = await ctx.db
			.query("diaryEntries")
			.withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", d))
			.collect();
		return {
			date: d,
			items: entries.map((e) => ({
				entryId: e._id,
				name: e.name,
				brand: e.brand,
				meal: e.meal,
				qtyGrams: e.qtyGrams,
				kcal: e.kcal,
				source: e.source ?? null,
			})),
		};
	},
});

/**
 * LOT 2B — ÉTAT DE LA TÂCHE EN COURS : la dernière action journal_add EN
 * ATTENTE du fil (preview incluse). Sert à la relance informée : quand la
 * cliente clarifie un aliment, le serveur donne au modèle les lignes déjà
 * préparées — il complète la tâche au lieu de repartir de zéro (et ne
 * redemande jamais une information déjà présente dans la preview).
 */
export const latestPendingJournalAdd = query({
	args: { sessionToken: v.optional(v.string()), threadId: v.string() },
	handler: async (ctx, { sessionToken, threadId }) => {
		const user = await requireAssistantClient(ctx, sessionToken);
		if (!/^[a-zA-Z0-9_-]{10,}$/.test(threadId)) return null;
		const tid = await ctx.db.get(threadId as Id<"assistantThreads">);
		if (!tid || tid.userId !== user._id) return null;
		const rows = await ctx.db
			.query("assistantActions")
			.withIndex("by_thread", (q) => q.eq("threadId", tid._id))
			.order("desc")
			.take(20);
		const a = rows.find(
			(r) => r.userId === user._id && r.status === "pending" && r.actionType === "journal_add" && r.expiresAt > Date.now()
		);
		if (!a) {
			// Diagnostic preview : ce que l'index by_thread renvoie vraiment.
			return null;
		}
		return { actionId: a._id, preview: a.preview };
	},
});

/* ──────────────── 5. Préparations d'écriture (preview seulement) ───────── */

type PreviewLine = {
	label: string;
	detail?: string;
	kcal?: number;
	carbs?: number;
	protein?: number;
	fat?: number;
	estimated?: boolean;
	source?: string;
};

type PendingPreview = {
	title: string;
	lines: PreviewLine[];
	totals?: { kcal: number; carbs: number; protein: number; fat: number };
	notice?: string;
};

async function insertPending(
	ctx: MutationCtx,
	userId: Id<"users">,
	threadId: Id<"assistantThreads">,
	actionType: AssistantActionType,
	topic: string,
	preview: PendingPreview,
	payload: unknown,
	previousValue?: unknown,
	newValue?: unknown
): Promise<{ actionId: Id<"assistantActions">; preview: PendingPreview }> {
	const now = Date.now();
	// LOT 2B (Bug 3) — UN fil = UNE action en attente. Sans ça, une seconde
	// préparation laissait l'ancienne `pending` en base : après confirmation
	// de la nouvelle, `historyFor` remontait l'ANCIENNE au rechargement et la
	// carte réapparaissait avec une preview obsolète. Les précédentes sont
	// marquées « cancelled » (audit intact, jamais réapparaissantes).
	const stale = await ctx.db
		.query("assistantActions")
		.withIndex("by_thread", (q) => q.eq("threadId", threadId))
		.order("desc")
		.take(20);
	for (const s of stale) {
		if (s.status === "pending" && s.expiresAt > now) {
			await ctx.db.patch(s._id, {
				status: "cancelled",
				resolvedAt: now,
				result: "Remplacée par une action plus récente.",
			});
		}
	}
	const actionId = await ctx.db.insert("assistantActions", {
		userId,
		threadId,
		actionType,
		status: "pending",
		topic,
		preview,
		payload: JSON.stringify(payload),
		...(previousValue !== undefined ? { previousValue: JSON.stringify(previousValue) } : {}),
		...(newValue !== undefined ? { newValue: JSON.stringify(newValue) } : {}),
		createdAt: now,
		expiresAt: now + assistantLimits().actionTtlMs,
	});
	return { actionId, preview };
}

/** Le fil appartient bien à la cliente (isolation userId — §38). */
async function assertThread(
	ctx: MutationCtx,
	userId: Id<"users">,
	threadId: string
): Promise<Id<"assistantThreads">> {
	if (!/^[a-zA-Z0-9_-]{10,}$/.test(threadId)) throw new ConvexError("Conversation introuvable.");
	const row = await ctx.db.get(threadId as Id<"assistantThreads">);
	if (!row || row.userId !== userId) throw new ConvexError("Conversation introuvable.");
	return row._id;
}

/**
 * `prepareJournalEntry` — construit la PREVIEW (§16) et pose l'action en
 * attente. Rien n'est écrit au journal ici.
 */
export const prepareJournalEntry = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		threadId: v.string(),
		topic: v.string(),
		date: v.string(),
		meal: v.string(),
		items: v.array(
			v.object({
				foodId: v.optional(v.string()),
				customFoodId: v.optional(v.string()),
				ciqualLabel: v.optional(v.string()),
				name: v.string(),
				qtyGrams: v.number(),
				/** Quantité non certaine → affichée « ≈ Estimation » (§18). */
				estimated: v.optional(v.boolean()),
				aiKcal100: v.optional(v.number()),
				aiCarbs100: v.optional(v.number()),
				aiProtein100: v.optional(v.number()),
				aiFat100: v.optional(v.number()),
			})
		),
	},		handler: async (ctx, { sessionToken, threadId, topic, date, meal, items }) => {
		const user = await requireAssistantClient(ctx, sessionToken);
		const tId = await assertThread(ctx, user._id, threadId);
		const { preview, payload } = await buildJournalEntryPreview(ctx, user._id, date, meal, items);
		return insertPending(ctx, user._id, tId, "journal_add", topic, preview, payload);
	},
});

/**
 * LOT 2B — Raffinement d'une ligne par une clarification. Recouvrement
 * strict (nameCovers) D'ABORD ; sinon match « même aliment de base » :
 * l'intersection de tokens contient le PREMIER token de la ligne et couvre
 * au moins la moitié de ses tokens (« Pain de mie blanc, préemballé » est
 * raffiné par « Pain de mie complet » ; « Beurre doux » ne raffine PAS
 * « Pain de mie blanc »). Côté serveur uniquement — jamais le modèle.
 */
export function refineMatch(lineName: string, clarified: string): boolean {
	if (nameCovers(lineName, undefined, clarified) || nameCovers(clarified, undefined, lineName)) return true;
	const lineToks = tokenize(lineName);
	const clToks = new Set(tokenize(clarified));
	if (lineToks.length === 0 || clToks.size === 0) return false;
	if (!clToks.has(lineToks[0])) return false;
	const shared = lineToks.filter((t) => clToks.has(t)).length;
	// La moitié des tokens de la ligne, OU l'aliment de base à 2 mots
	// (« Riz basmati complet » raffine « Riz basmati, cuit, sans sel ajouté »).
	return shared * 2 >= lineToks.length || shared >= 2;
}

/**
 * LOT 2B — MISE À JOUR DÉTERMINISTE d'une action journal_add EN ATTENTE :
 * une clarification (« pain de mie complet ») complète la preview EXISTANTE
 * au lieu d'en créer une seconde (bug : deux boutons, action obsolète). La
 * fusion serveur garantit qu'aucune information déjà donnée (quantités,
 * autres aliments) n'est perdue — la mémoire ne repose pas sur le modèle.
 *
 * Stratégie : les items du modèle remplacent l'aliment qu'ils recouvrent
 * (nameCovers) et CONSERVENT les autres lignes. Quantité non redonnée ?
 * Celle de la ligne remplacée est réutilisée. Expiration/double contrôle :
 * l'action doit être PENDING, à la cliente, du même fil.
 */
export const updatePendingJournalEntry = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		threadId: v.string(),
		topic: v.string(),
		/** Absent → le serveur retrouve la DERNIÈRE action journal_add pending du fil. */
		actionId: v.optional(v.string()),
		items: v.array(
			v.object({
				foodId: v.optional(v.string()),
				customFoodId: v.optional(v.string()),
				ciqualLabel: v.optional(v.string()),
				name: v.string(),
				/** Absent → quantité de la ligne remplacée conservée. */
				qtyGrams: v.optional(v.number()),
				estimated: v.optional(v.boolean()),
			})
		),
	},
	handler: async (ctx, { sessionToken, threadId, topic, actionId, items }) => {
		const user = await requireAssistantClient(ctx, sessionToken);
		if (!Array.isArray(items) || items.length === 0) throw new ConvexError("Aucune clarification à appliquer.");
		if (items.length > 12) throw new ConvexError("Maximum 12 aliments par repas.");
		const tId = await assertThread(ctx, user._id, threadId);
		let doc: Doc<"assistantActions"> | null = null;
		if (actionId) {
			doc = await ctx.db.get(actionId as Id<"assistantActions">);
		} else {
			// Dernière action journal_add EN ATTENTE de ce fil (la plus récente).
			const rows = await ctx.db
				.query("assistantActions")
				.withIndex("by_thread", (q) => q.eq("threadId", tId))
				.order("desc")
				.take(20);
			doc = rows.find((r) => r.userId === user._id && r.status === "pending" && r.actionType === "journal_add" && r.expiresAt > Date.now()) ?? null;
		}
		if (!doc || doc.userId !== user._id || doc.status !== "pending" || doc.actionType !== "journal_add")
			throw new ConvexError("Aucune action en attente à mettre à jour.");
		if (doc.threadId !== tId)
			throw new ConvexError("Action d'une autre conversation.");
		if (doc.expiresAt <= Date.now()) throw new ConvexError("Action expirée — relance la préparation.");

		// Lignes actuelles (payload serveur = source de vérité).
		const payload = JSON.parse(doc.payload) as {
			date: string;
			meal: string;
			components: { foodId?: string; customFoodId?: string; ciqualLabel?: string; name: string; qtyGrams: number }[];
		};
		const current = payload.components ?? [];

		// Fusion : chaque item de clarification remplace la ligne qu'il recouvre.
		const changed: { from: string; to: string; qtyGrams: number }[] = [];
		const taken = new Set<number>();
		for (const it of items) {
			const declared = (it.name || "").trim().slice(0, 80);
			let matchIdx = -1;
			for (let i = 0; i < current.length; i++) {
				if (taken.has(i)) continue;
				const c = current[i];
			// Même référence explicite OU recouvrement de nom — l'item
			// clarifié (« pain de mie complet ») raffine la ligne existante.
			if (
				(it.foodId && c.foodId && it.foodId === c.foodId) ||
				(it.ciqualLabel && c.ciqualLabel && it.ciqualLabel === c.ciqualLabel) ||
				refineMatch(c.name, declared)
			) {
					matchIdx = i;
					break;
				}
			}
			if (matchIdx >= 0) {
				taken.add(matchIdx);
				const old = current[matchIdx];
				changed.push({ from: old.name, to: declared, qtyGrams: old.qtyGrams });
				// Si la clarification change le nom SANS référence explicite, on
				// DÉTACHE l'ancienne fiche : la recherche serveur résoudra le
				// nouveau nom (« pain de mie complet » ne doit pas hériter du
				// foodId « Pain de mie blanc » — rejet « référence incohérente »).
				const hasExplicitRef = !!(it.foodId || it.customFoodId || it.ciqualLabel);
				const keepsOldRef = hasExplicitRef || nameCovers(old.name, undefined, declared);
				current[matchIdx] = {
					...(keepsOldRef ? { foodId: old.foodId, customFoodId: old.customFoodId, ciqualLabel: old.ciqualLabel } : {}),
					...(it.foodId ? { foodId: it.foodId } : {}),
					...(it.customFoodId ? { customFoodId: it.customFoodId } : {}),
					...(it.ciqualLabel ? { ciqualLabel: it.ciqualLabel } : {}),
					name: declared,
					qtyGrams: old.qtyGrams,
					...(it.qtyGrams !== undefined ? { qtyGrams: it.qtyGrams } : {}),
				};
			} else {
				// LOT 2B (mission §5, corrigé en batterie E2E B5) — l'item qui ne
				// recouvre AUCUNE ligne est un AJOUT nouveau (« avec 10 g de
				// beurre aussi » pendant une préparation pain de mie) : il est
				// AJOUTÉ à la preview, jamais abandonné silencieusement (sinon
				// l'aliment annoncé disparaissait — fausse annonce). La quantité
				// servira à la recherche serveur si elle est fournie ; la
				// validation « Quantité invalide » du pipeline commun s'applique.
				current.push({
					...(it.foodId ? { foodId: it.foodId } : {}),
					...(it.customFoodId ? { customFoodId: it.customFoodId } : {}),
					...(it.ciqualLabel ? { ciqualLabel: it.ciqualLabel } : {}),
					name: declared,
					...(it.qtyGrams !== undefined ? { qtyGrams: it.qtyGrams } : {}),
				} as never);
				changed.push({ from: "", to: declared, qtyGrams: it.qtyGrams ?? 0 });
			}
		}
		// Recalcul SERVEUR complet (mêmes verrous que la préparation initiale) :
		// identité, recherche, valeurs — aucune valeur récité par le modèle.
		const { preview, payload: newPayload } = await buildJournalEntryPreview(ctx, user._id, payload.date, payload.meal, current as never);
		await ctx.db.patch(doc._id, {
			topic,
			preview,
			payload: JSON.stringify(newPayload),
			createdAt: Date.now(),
			expiresAt: Date.now() + assistantLimits().actionTtlMs,
		});
		return { ok: true as const, actionId: doc._id, preview, changed };
	},
});

/**
 * Pipeline PARTAGÉ préparation/mise à jour : vérifications anti-substitution,
 * recherche serveur, valeurs Ciqual/OFF, preview et payload. Retourne sans
 * écrire — `prepareJournalEntry` insère, `updatePendingJournalEntry` patche.
 */
async function buildJournalEntryPreview(
	ctx: MutationCtx,
	userId: Id<"users">,
	date: string,
	meal: string,
	items: { foodId?: string; customFoodId?: string; ciqualLabel?: string; name: string; qtyGrams?: number; estimated?: boolean }[]
): Promise<{ preview: PendingPreview; payload: { date: string; meal: string; components: { foodId?: Id<"foods">; customFoodId?: Id<"customFoods">; ciqualLabel?: string; name: string; qtyGrams: number }[] } }> {
	assertDate(date);
	if (!["petit-dej", "dejeuner", "diner", "collation"].includes(meal)) throw new ConvexError("Repas invalide.");
	if (!Array.isArray(items) || items.length === 0) throw new ConvexError("Aucun aliment à préparer.");
	if (items.length > 12) throw new ConvexError("Maximum 12 aliments par repas.");

		/* ── VERROU ANTI-SUBSTITUTION (chantier A, V1/V2) ─────────────────
		 * Le backend contrôle la FIDÉLITÉ de la préparation à la demande :
		 *  - fusion des doublons internes (même référence) ;
		 *  - l'identifiant fourni doit CORRESPONDRE au nom déclaré — sinon
		 *    REJET (jamais de remplacement silencieux par une autre fiche) ;
		 *  - sans identifiant, le SERVEUR fait lui-même la recherche par nom
		 *    (jamais une création « estimation IA » directe) ; une référence
		 *    n'est retenue que si elle représente l'aliment demandé.
		 */
		// V2 — fusion des doublons internes (même référence ou même nom).
		const merged = new Map<string, (typeof items)[number]>();
		for (const it of items) {
			const key = it.foodId ?? it.customFoodId ?? it.ciqualLabel ?? norm(it.name ?? "");
			if (!key) throw new ConvexError("Aliment sans nom ni référence.");
			const prev = merged.get(key);
			if (prev) prev.qtyGrams = (prev.qtyGrams ?? 0) + (it.qtyGrams ?? 0);
			else merged.set(key, { ...it });
		}
		const deduped = [...merged.values()];
		if (deduped.length !== items.length) {
			console?.log?.(`[assistant] journal_add : ${items.length} items → ${deduped.length} après fusion`);
		}

		const lines: PreviewLine[] = [];
		const components: {
			foodId?: Id<"foods">;
			customFoodId?: Id<"customFoods">;
			ciqualLabel?: string;
			name: string;
			qtyGrams: number;
			aiKcal100?: number;
			aiCarbs100?: number;
			aiProtein100?: number;
			aiFat100?: number;
		}[] = [];
		const totals = { kcal: 0, carbs: 0, protein: 0, fat: 0 };
		const mealLabel: Record<string, string> = {
			"petit-dej": "Petit-déjeuner",
			dejeuner: "Déjeuner",
			diner: "Dîner",
			collation: "Collation",
		};

		for (const it of deduped) {
			const qty = it.qtyGrams !== undefined && Number.isFinite(it.qtyGrams) ? Math.min(5000, Math.max(1, Math.round(it.qtyGrams))) : 0;
			if (!qty) throw new ConvexError("Quantité invalide.");
			const declared = (it.name || "").trim().slice(0, 80);
			if (declared.length < 2) throw new ConvexError("Nom d'aliment trop court.");
			let ref = await resolveRef(ctx, userId, {
				foodId: it.foodId,
				customFoodId: it.customFoodId,
				ciqualLabel: it.ciqualLabel,
			});
			// V1 — identité vérifiée : l'identifiant fourni doit représenter
			// l'aliment demandé. Incohérent (référence du mauvais item, modèle
			// qui confond deux items du même appel) → la référence est JETÉE et
			// le nom déclaré est re-résolu par searchFoodInternal : le rapport
			// reste « la demande » — jamais de substitution silencieuse entre
			// fiches ; la résolution par nom reste guidée par la fidélité (fiche
			// Covering uniquement), donc aucune substitution cachée ne passe.
			let refMisnamed = false;
			if (ref && !nameCovers(ref.name, ref.brand, declared)) {
				ref = null;
				refMisnamed = true;
			}
			let resolved: FoodRef | null = ref;
			if (!resolved || refMisnamed) {
				// V1 — sans identifiant OU référence incohérente jetée : recherche
				// SERVEUR par le nom déclaré. Jamais une création « estimation
				// IA » directe ici.
				resolved = await searchFoodInternal(ctx, userId, declared);
				if (!resolved) {
					throw new ConvexError(
						`Aliment introuvable en base : « ${declared} ». N'invente PAS de fiche et ne propose PAS d'enregistrement : signale à l'utilisatrice que cet aliment est introuvable et propose de le créer manuellement dans son journal.`
					);
				}
				if (!nameCovers(resolved.name, resolved.brand, declared)) {
					throw new ConvexError(
						`Aucune fiche fiable pour « ${declared} » (meilleur candidat : « ${resolved.name} »). Demande la clarifcation plutôt que de substituer.`
					);
				}
			}
			// Un aliment sans identité G-FLUX n'atteint JAMAIS ce point :
			// searchFoodInternal a déjà rejeté (throw) si aucune fiche fiable.
			// (Les composants poussés portent TOUJOURS une référence résolue.)
			components.push({
				...(resolved!.foodId ? { foodId: resolved!.foodId as Id<"foods"> } : {}),
				...(resolved!.customFoodId ? { customFoodId: resolved!.customFoodId as Id<"customFoods"> } : {}),
				...(resolved!.ciqualLabel ? { ciqualLabel: resolved!.ciqualLabel } : {}),
				name: resolved!.name,
				qtyGrams: qty,
			});
			const name = resolved!.name;
			const kcal100 = resolved!.kcal100;
			const carbs100 = resolved!.carbs100;
			const protein100 = resolved!.protein100;
			const fat100 = resolved!.fat100;
			const source =
				resolved!.origin === "product" ? "product" : resolved!.origin === "personal" ? "personal" : "reference";
			// Quantité écrite par la cliente → pas une estimation.
			const isEstimate = it.estimated === true;
			const k = qty / 100;
			const kcal = Math.round(kcal100 * k);
			const carbs = round1(carbs100 * k);
			const protein = round1(protein100 * k);
			const fat = round1(fat100 * k);
			totals.kcal += kcal;
			totals.carbs += carbs;
			totals.protein += protein;
			totals.fat += fat;
			lines.push({
				label: name,
				detail: `${qty} g${ref?.brand ? ` · ${ref.brand}` : ""}`,
				kcal,
				carbs,
				protein,
				fat,
				...(isEstimate ? { estimated: true } : {}),
				source,
			});
		}

		const preview = {
			title: `Ajouter au journal — ${mealLabel[meal] ?? meal}`,
			lines,
			totals: {
				kcal: Math.round(totals.kcal),
				carbs: round1(totals.carbs),
				protein: round1(totals.protein),
				fat: round1(totals.fat),
			},
			notice: lines.some((l) => l.estimated)
				? "Certaines valeurs sont des estimations (≈) : tu peux les modifier avant d’enregistrer."
				: undefined,
		};
		return { preview, payload: { date, meal, components } };
	}

/** `prepareJournalEntry` inverse — retirer des aliments du journal. */
export const prepareJournalRemoval = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		threadId: v.string(),
		topic: v.string(),
		entryIds: v.array(v.string()),
	},
	handler: async (ctx, { sessionToken, threadId, topic, entryIds }) => {
		const user = await requireAssistantClient(ctx, sessionToken);
		if (!Array.isArray(entryIds) || entryIds.length === 0) throw new ConvexError("Aucun aliment à retirer.");
		if (entryIds.length > 12) throw new ConvexError("Trop d’aliments d’un coup.");
		const lines: PreviewLine[] = [];
		const snapshot: Doc<"diaryEntries">[] = [];
		for (const raw of entryIds) {
			if (!/^[a-zA-Z0-9_-]{10,}$/.test(raw)) throw new ConvexError("Entrée invalide.");
			const row = await ctx.db.get(raw as Id<"diaryEntries">);
			if (!row || row.userId !== user._id) throw new ConvexError("Entrée introuvable.");
			snapshot.push(row);
			lines.push({
				label: row.name,
				detail: `${row.qtyGrams} g · ${row.meal}`,
				kcal: row.kcal,
				carbs: row.carbs,
				protein: row.protein,
				fat: row.fat,
				...(row.source === "ai_estimation" ? { estimated: true, source: "ai" } : {}),
			});
		}
		const preview = {
			title: "Retirer du journal",
			lines,
			totals: {
				kcal: Math.round(lines.reduce((a, l) => a + (l.kcal ?? 0), 0)),
				carbs: round1(lines.reduce((a, l) => a + (l.carbs ?? 0), 0)),
				protein: round1(lines.reduce((a, l) => a + (l.protein ?? 0), 0)),
				fat: round1(lines.reduce((a, l) => a + (l.fat ?? 0), 0)),
			},
		};
		return insertPending(
			ctx,
			user._id,
			await assertThread(ctx, user._id, threadId),
			"journal_remove",
			topic,
			preview,
			{ entryIds: snapshot.map((s) => s._id) },
			{ entries: snapshot }
		);
	},
});

/**
 * `prepareMeasurementEntry` — poids, pas ou mensurations (seules écritures
 * hors journal autorisées en V1). Les bornes sont celles des mutations
 * existantes : le serveur rejette toute valeur hors plage.
 */
export const prepareMeasurement = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		threadId: v.string(),
		topic: v.string(),
		kind: v.union(v.literal("weight"), v.literal("steps"), v.literal("measurement")),
		date: v.string(),
		weightKg: v.optional(v.number()),
		count: v.optional(v.number()),
		neckCm: v.optional(v.number()),
		waistCm: v.optional(v.number()),
		hipCm: v.optional(v.number()),
	},
	handler: async (ctx, { sessionToken, threadId, topic, kind, date, weightKg, count, neckCm, waistCm, hipCm }) => {
		const user = await requireAssistantClient(ctx, sessionToken);
		assertDate(date, { noFuture: true });
		const clamp = (n: number | undefined, min: number, max: number, label: string) => {
			if (n === undefined) return undefined;
			if (!Number.isFinite(n) || n < min || n > max) throw new ConvexError(`${label} hors plage (${min}–${max}).`);
			return Math.round(n * 10) / 10;
		};

		const lines: PreviewLine[] = [];
		let payload: Record<string, unknown> = {};
		let previous: Record<string, unknown> | null = null;
		let title = "";

		if (kind === "steps") {
			if (count === undefined || !Number.isInteger(count) || count < 0 || count > 150_000) {
				throw new ConvexError("Nombre de pas invalide (0 à 150 000).");
			}
			const existing = await ctx.db
				.query("dailySteps")
				.withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", date))
				.first();
			previous = existing ? { count: existing.count, manualCount: existing.manualCount ?? null } : null;
			// LOT 2B (Bug 6) — détection de DOUBLON : si les pas de ce jour sont
			// déjà EXACTEMENT cette valeur, aucune écriture n'est nécessaire.
			// On informe au lieu de proposer une « correction » identique.
			if (existing && existing.count === count) {
				return {
					duplicate: true as const,
					count,
					date,
				};
			}
			payload = { date, count };
			title = "Enregistrer mes pas";
			lines.push({ label: `${count.toLocaleString("fr-FR")} pas`, detail: date, ...(existing ? { source: "correction" } : {}) });
			if (existing) lines.push({ label: "Valeur précédente", detail: `${existing.count.toLocaleString("fr-FR")} pas` });
		} else {
			const w = clamp(weightKg, 30, 350, "Le poids");
			const n = clamp(neckCm, 20, 80, "Le tour de cou");
			const wa = clamp(waistCm, 40, 250, "Le tour de taille");
			const h = clamp(hipCm, 50, 300, "La circonférence des hanches");
			if (w === undefined && n === undefined && wa === undefined && h === undefined) {
				throw new ConvexError("Aucune mesure fournie.");
			}
			const existing = await ctx.db
				.query("bodyMetrics")
				.withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", date))
				.first();
			// LOT 2B (Bug 6) — même détection pour le POIDS (valeur unique exacte).
			if (kind === "weight" && w !== undefined && existing?.weightKg === w) {
				return {
					duplicate: true as const,
					count: w,
					date,
				};
			}
			previous = existing
				? {
						weightKg: existing.weightKg ?? null,
						neckCm: existing.neckCm ?? null,
						waistCm: existing.waistCm ?? null,
						hipCm: existing.hipCm ?? null,
					}
				: null;
			payload = {
				date,
				...(w !== undefined ? { weightKg: w } : {}),
				...(n !== undefined ? { neckCm: n } : {}),
				...(wa !== undefined ? { waistCm: wa } : {}),
				...(h !== undefined ? { hipCm: h } : {}),
			};
			title = kind === "weight" ? "Enregistrer mon poids" : "Enregistrer mes mensurations";
			if (w !== undefined) lines.push({ label: `${String(w).replace(".", ",")} kg`, detail: `Poids · ${date}`, ...(existing?.weightKg != null && existing.weightKg !== w ? { source: `précédent ${String(existing.weightKg).replace(".", ",")} kg` } : {}) });
			if (n !== undefined) lines.push({ label: `${String(n).replace(".", ",")} cm`, detail: `Tour de cou · ${date}` });
			if (wa !== undefined) lines.push({ label: `${String(wa).replace(".", ",")} cm`, detail: `Tour de taille · ${date}` });
			if (h !== undefined) lines.push({ label: `${String(h).replace(".", ",")} cm`, detail: `Hanches · ${date}` });
		}

		return insertPending(
			ctx,
			user._id,
			await assertThread(ctx, user._id, threadId),
			kind === "measurement" ? "measurement" : kind,
			topic,
			{ title, lines },
			payload,
			previous
		);
	},
});

/**
 * `saveQuestionForCoach` — note/question pour Hugo (§25/§26). Écriture simple
 * et additive, mais elle passe PAR LA MÊME preview → confirmation (§15).
 */
export const prepareCoachQuestion = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		threadId: v.string(),
		topic: v.string(),
		text: v.string(),
		destination: v.union(v.literal("bilan"), v.literal("note")),
	},
	handler: async (ctx, { sessionToken, threadId, topic, text, destination }) => {
		const user = await requireAssistantClient(ctx, sessionToken);
		const clean = (text ?? "").trim().slice(0, 600);
		if (clean.length < 3) throw new ConvexError("Question trop courte.");
		const weekStart = destination === "bilan" ? mondayISOof(localTodayISO()) : undefined;
		const preview = {
			title: destination === "bilan" ? "Ajouter à mon prochain bilan" : "Noter une question pour Hugo",
			lines: [{ label: clean, detail: destination === "bilan" ? "Visible par Hugo au prochain bilan" : "Note simple" }],
		};
		return insertPending(
			ctx,
			user._id,
			await assertThread(ctx, user._id, threadId),
			"coach_question",
			topic,
			preview,
			{ text: clean, destination, weekStart }
		);
	},
});

/** Usage du jour (affichage discret des quotas — jamais un compteur anxiogène). */
export const usageFor = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireAssistantClient(ctx, sessionToken);
		const day = new Date().toISOString().slice(0, 10);
		const row = await ctx.db
			.query("assistantUsage")
			.withIndex("by_user_day", (q) => q.eq("userId", user._id).eq("day", day))
			.first();
		return { day, textCount: row?.textCount ?? 0, visionCount: row?.visionCount ?? 0 };
	},
});
