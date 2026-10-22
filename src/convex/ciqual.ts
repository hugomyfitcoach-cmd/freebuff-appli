/**
 * Fiches Ciqual (ANSES) — sélection locale de références et résolution des
 * valeurs officielles. AUCUN réseau, AUCUNE écriture en base : la table est
 * embarquée (ciqualNutrients.ts) et le tri est effectué ici.
 *
 * Deux usages distincts (règle produit : scan = OFF uniquement, Ciqual =
 * recherche texte) :
 *  - `searchCiqualLocal(q)` / `rankCiqual(q)` : références pertinentes pour le
 *    bloc « Aliments de référence » ;
 *  - `resolveCiqualLabel(label)` : kcal/macros /100 g de la fiche exacte.
 *    Appelée CÔTÉ SERVEUR à l'ajout : le client ne transmet qu'un libellé,
 *    jamais de valeurs nutritionnelles (aucune fusion Ciqual/OFF possible).
 *
 * ── CLASSEMENT (Mission R1), par ordre de priorité ─────────────────────────
 *  1. TOUS les mots de la recherche présents (en début de mot) — les autres
 *     fiches ne sont pas candidates (« riz cuit » → uniquement des riz cuits) ;
 *  2. les noms qui commencent par le premier mot recherché passent d'abord
 *     (format Ciqual : aliment, puis précisions — « Beurre à 80% MG, salé »
 *     avant « Haricot beurre, cru », « Jambon cru » avant « Porc, escalope
 *     de jambon crue »). Préfixe de mot (« haricots » ≈ « Haricot vert »),
 *     puis — après l'état — l'accord exact du mot tapé départage les faux
 *     amis au pluriel : « pâtes cuites » → « Pâtes sèches, cuites » avant
 *     « Pâte sablée, cuite » ;
 *  3. état de cuisson : s'il est tapé (cuit, cru, poêlé…), sa famille passe
 *     d'abord ; sinon ordre par défaut cru → poêlé/sauté → cuit à l'eau ;
 *  4. à égalité, le nom le plus court passe en premier (puis alphabétique).
 * Bonus : les aliments déjà ajoutés par la cliente remontent en tête de la
 * section Ciqual (`usedLabels`, résolus côté serveur dans la query).
 * Normalisation partagée (foodRanking) : accents, majuscules, pluriels
 * simples, « oeuf » = « œuf », « cuit » couvre « bouilli/cuit à l'eau ».
 *
 * Exception documentée (produit, testée dans tests/mission-journal-compact) :
 * la famille ŒUF en requête générique garde son ordre pédagogique fixe
 * œuf cru → œuf dur → œuf au plat, avant les plats aux œufs.
 */

import { ciqualNutrients } from "./ciqualNutrients";
import {
	allWordsPresent,
	cookStateOf,
	cookStateRank,
	norm,
	queryCookState,
	tokenize,
	type CookState,
} from "./foodRanking";
import { query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const CIQUAL_DEFAULT_RESULTS = 3;
/** Hard ceiling for a user-requested expanded list. */
export const CIQUAL_MAX_RESULTS = 13;

/** Fiche publique de recherche : libellé officiel + valeurs /100 g. */
export type CiqualHit = {
	label: string;
	kcal: number;
	protein?: number;
	carbs?: number;
	fat?: number;
};

/** Options de classement — `usedLabels` = libellés déjà journalisés par la cliente. */
export type RankOpts = { usedLabels?: Iterable<string> };

/** Ligne embarquée pré-tokenisée (calculée une fois par isolate, jamais par recherche). */
type Row = {
	/** Libellé officiel exact. */
	ref: CiqualHit;
	/** Tokens normalisés + singularisés. */
	toks: string[];
	/** Nom normalisé (longueur + départage alphabétique + famille œuf). */
	normed: string;
	/** Premier token (règle 2 : « nom qui commence par le premier mot »). */
	first: string;
	/** Famille de cuisson du nom (premier état rencontré, « neutre » sinon). */
	state: CookState;
};

const ROWS: Row[] = (() => {
	const rows: Row[] = [];
	for (const r of ciqualNutrients) {
		const toks = tokenize(r.name);
		if (toks.length === 0) continue;
		rows.push({
			ref: { label: r.name, kcal: r.kcal, protein: r.p, carbs: r.c, fat: r.f },
			toks,
			normed: norm(r.name),
			first: toks[0],
			state: cookStateOf(toks),
		});
	}
	return rows;
})();

/** Résolution exacte libellé → fiche (1re occurrence en cas de libellé partagé). */
const BY_NORMALIZED_LABEL: Map<string, CiqualHit> = (() => {
	const m = new Map<string, CiqualHit>();
	for (const row of ROWS) {
		const key = row.toks.join(" ");
		if (!m.has(key)) m.set(key, row.ref);
	}
	return m;
})();

/* ── Exception documentée : famille ŒUF en requête générique ───────────────
 *
 * L'ordre pédagogique voulu (et testé) est œuf CRU → œuf DUR → œuf AU PLAT,
 * avant les plats aux œufs (« Oeufs au lait », « Oeuf au jambon en gelée »)
 * et les parties (blancs/jaunes). Le vocabulaire Ciqual place ces états dans
 * la TÊTE du libellé (« Oeuf dur » sans virgule) : préfixe strict sur le
 * nom normalisé — « Oeuf, blanc (blanc d'oeuf), cru » ne matche PAS.
 * Uniquement en requête GÉNÉRIQUE : « œuf dur » tapé explicitement reste une
 * recherche spécifique (règles 1-4 en pertinence pure).
 */
const EGG_STATE_TOKENS = new Set([
	"dur", "dure", "mollet", "poche", "pochee", "brouille", "brouillee", "coque", "plat",
]);

function eggStateRank(normed: string): number {
	if (normed.startsWith("oeuf cru")) return 0;
	if (normed.startsWith("oeuf dur")) return 1;
	if (normed.startsWith("oeuf au plat")) return 2;
	if (normed.startsWith("oeuf a la coque")) return 3;
	if (normed.startsWith("oeuf poche")) return 4;
	if (normed.startsWith("oeuf brouille")) return 5;
	return 9; // hors famille (blancs, jaunes, d'oie/caille, plats aux œufs…)
}

/** Requette générique de la famille œuf (aucun état tapé) → ordre pédagogique. */
function isGenericEggQuery(qt: string[]): boolean {
	return (
		qt[0].startsWith("oeuf") &&
		!qt.some((t) => EGG_STATE_TOKENS.has(t) || queryCookState([t]) !== undefined)
	);
}

/**
 * Classement COMPLET des références Ciqual pour une requête (règles 1-4 +
 * bonus « déjà utilisés »), sans plafond de résultats — `searchCiqualLocal`
 * en est la tranche visible. Tri STABLE : alphabétique du nom normalisé à
 * clé identique.
 */
export function rankCiqual(q: string, opts?: RankOpts): CiqualHit[] {
	const qt = tokenize(q);
	if (qt.length === 0) return [];
	// Bonus « déjà ajoutés » : identité = libellé officiel normalisé.
	const used = new Set<string>();
	for (const l of opts?.usedLabels ?? []) used.add(norm(l));

	const egg = isGenericEggQuery(qt);
	const typedState = queryCookState(qt);
	const rawFirst = norm(q).split(" ")[0];

	const seen = new Set<string>();
	const scored: { key: (number | string)[]; ref: CiqualHit }[] = [];
	for (const row of ROWS) {
		// Règle 1 — TOUS les mots de la recherche présents (en début de mot).
		if (!allWordsPresent(row.toks, qt)) continue;
		// Doublons de libellé : une seule fiche affichée (1re occurrence).
		if (seen.has(row.ref.label)) continue;
		seen.add(row.ref.label);
		// Règle 3 — état de cuisson : tapé → prioritaire ; sinon ordre par
		// défaut cru → poêlé/sauté → cuit à l'eau → neutre (sec, fumé, recettes).
		const stateKey =
			typedState !== undefined
				? row.state === typedState
					? 0
					: 1 + cookStateRank(row.state)
				: cookStateRank(row.state);
		scored.push({
			ref: row.ref,
			key: [
				used.has(row.normed) ? 0 : 1, // bonus aliments déjà ajoutés
				egg ? eggStateRank(row.normed) : 0, // exception famille œuf
				row.first.startsWith(qt[0]) ? 0 : 1, // règle 2 — aliment en tête du nom
				stateKey, // règle 3 — état de cuisson
				row.normed.startsWith(rawFirst) ? 0 : 1, // règle 2 (accord exact du mot tapé)
				row.normed.length, // règle 4 — nom le plus court
				row.normed, // départage alphabétique déterministe
			],
		});
	}
	scored.sort((a, b) => {
		for (let i = 0; i < 6; i++) {
			const ka = a.key[i] as number;
			const kb = b.key[i] as number;
			if (ka !== kb) return ka - kb;
		}
		return (a.key[6] as string).localeCompare(b.key[6] as string, "fr");
	});
	return scored.map((s) => s.ref);
}

/**
 * Jusqu'à `limit` références Ciqual pertinentes pour une requête utilisateur.
 * Aucun remplissage artificiel : moins de résultats si moins de références
 * réellement pertinentes. `usedLabels` (optionnel) = libellés déjà journalisés
 * par la cliente — ils remontent en tête de la section.
 */
export function searchCiqualLocal(q: string, limit = CIQUAL_DEFAULT_RESULTS, opts?: RankOpts): CiqualHit[] {
	const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : CIQUAL_DEFAULT_RESULTS;
	const maxResults = Math.max(1, Math.min(CIQUAL_MAX_RESULTS, requestedLimit));
	return rankCiqual(q, opts).slice(0, maxResults);
}

/**
 * Valeurs /100 g de la fiche Ciqual EXACTE (comparaison normalisée, sans
 * accents ni pluriels). Le libellé affiché au client est toujours l'officiel.
 */
export function resolveCiqualLabel(label: string): CiqualHit | null {
	const toks = tokenize(label);
	if (toks.length === 0) return null;
	return BY_NORMALIZED_LABEL.get(toks.join(" ")) ?? null;
}

/** Libellé de source affiché dans l'UI (badge des fiches de référence). */
export const CIQUAL_SOURCE_LABEL = "Référence Ciqual – ANSES";

/** Fenêtre d'historique analysée pour le bonus « déjà ajoutés » (scan borné). */
const USED_WINDOW = 120;

/**
 * Libellés Ciqual réellement AJOUTÉS par l'utilisateur — portions mémorisées
 * (validation « Ajouter au Journal ») + journal récent (fenêtre bornée, index
 * `by_user` existant — même philosophie que freqFoods). Lecture seule.
 */
async function usedCiqualLabels(ctx: Pick<QueryCtx, "db">, userId: Id<"users">): Promise<Set<string>> {
	const [portions, recent] = await Promise.all([
		ctx.db
			.query("foodPortions")
			.withIndex("by_user_ciqual", (q) => q.eq("userId", userId))
			.take(60),
		ctx.db
			.query("diaryEntries")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.order("desc")
			.take(USED_WINDOW),
	]);
	const used = new Set<string>();
	for (const p of portions) if (p.ciqualLabel) used.add(p.ciqualLabel);
	for (const e of recent) {
		if (e.foodId || e.customFoodId || e.mealId) continue;
		if (resolveCiqualLabel(e.name)) used.add(e.name);
	}
	return used;
}

/**
 * Recherche locale de fiches Ciqual (bloc « Aliments de référence ») —
 * jusqu'à 13 références pertinentes à la demande, aucun remplissage
 * artificiel. Lecture seule : la table Ciqual est embarquée, la base OFF n'est
 * JAMAIS touchée. Les libellés déjà journalisés par l'utilisateur remontent en
 * tête de la section (bonus, jamais au prix de la pertinence : la règle
 * « tous les mots présents » reste prioritaire).
 */
export const searchCiqual = query({
	args: { sessionToken: v.optional(v.string()), query: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, { sessionToken, query: q, limit }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
		if (q.trim().length < 2) return [] as CiqualHit[];
		const usedLabels = await usedCiqualLabels(ctx, user._id);
		return searchCiqualLocal(q, limit ?? CIQUAL_DEFAULT_RESULTS, { usedLabels });
	},
});
