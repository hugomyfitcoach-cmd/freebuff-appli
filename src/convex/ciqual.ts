/**
 * Fiches Ciqual (ANSES) — sélection locale de références et résolution des
 * valeurs officielles. AUCUN réseau, AUCUNE écriture en base : la table est
 * embarquée (ciqualNutrients.ts) et le tri est effectué ici.
 *
 * Deux usages distincts (règle produit : scan = OFF uniquement, Ciqual =
 * recherche texte) :
 *  - `searchCiqual(q)` : jusqu'à 3 références VRAIMENT pertinentes pour le
 *    bloc « Aliments de référence » — exact > préfixe de mots > mots entiers,
 *    PUIS références officielles préférées (libellés courts, sans « aliment
 *    moyen » ni variantes ultra-spécifiques) ;
 *  - `resolveCiqualLabel(label)` : kcal/macros /100 g de la fiche exacte.
 *    Appelée CÔTÉ SERVEUR à l'ajout : le client ne transmet qu'un libellé,
 *    jamais de valeurs nutritionnelles (aucune fusion Ciqual/OFF possible).
 */

import { ciqualNutrients } from "./ciqualNutrients";
import { anchorTokens, tokenize } from "./foodRanking";
import { query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";

export const CIQUAL_MAX_RESULTS = 3;

/** Fiche publique de recherche : libellé officiel + valeurs /100 g. */
export type CiqualHit = {
	label: string;
	kcal: number;
	protein?: number;
	carbs?: number;
	fat?: number;
};

/**
 * Marqueurs de PLAT PRÉPARÉ dans un libellé Ciqual : ce sont des recettes
 * (« Riz au lait, au caramel », « Tomate farcie », « Poulet basquaise »…),
 * pas des aliments de référence — elles passent derrière les variantes
 * d'état (cru, cuit, bouilli…) à niveau de pertinence égal. Les variantes
 * d'état légitimes (« rôti », « grillé », « vapeur ») ne sont PAS des recettes.
 */
const RECIPE_MARKERS = [
	"farc", "provençal", "provencal", "basquaise", "preemball", "préemball",
	"rayon", "caramel", "sirop", "au lait", "a la", "à la", "gratin", "sauc",
	"rhum", "vinaigrette", "mayonnaise",
];

/** Libellé « référence officielle » : court, sans marqueur d'aliment moyen. */
function isReferenceLabel(label: string): boolean {
	const s = label.toLowerCase();
	if (s.includes("(aliment moyen)")) return false;
	const toks = tokenize(label);
	// Les libellés de référence restent courts (≤ 8 tokens après le nom).
	return toks.length <= 8;
}

/* ── Formes SIMPLES vs préparations ÉLABORÉES (recherche générique) ──
 *
 * « pomme de terre » → crue d'abord, puis bouillie/vapeur, puis le reste ;
 * dauphine / duchesse / préfrites / gratin / frit / pané / sauce… passent
 * APRÈS les formes de base. Jamais par calories : uniquement le vocabulaire
 * de préparation du libellé officiel + la longueur du nom. Une requête
 * précise (« pomme de terre dauphine ») fait remonter la dauphine
 * normalement : le filtre d'ancres + le tier préfixe dominent déjà.
 */
const SIMPLE_PREP = new Set(["cru", "crue", "bouilli", "bouillie", "vapeur", "eau"]);
const ELAB_TOKENS = new Set([
	"dauphine", "duchesse", "prefrite", "frite", "gratin", "gratinee", "pane",
	"panee", "sauce", "beignet", "poelee", "sautee", "rissolee", "surgele",
	"surgelee", "appertise", "appertisee", "noisette", "friture", "frit", "puree",
]);
const ELAB_SUBSTR = ["sous vide"];

/**
 * Score de pertinence d'une référence pour la requête.
 * Plus petit = meilleur (même hiérarchie que le ranking OFF : exact >
 * préfixe de mots > mots entiers), puis :
 *   − préparations élaborées fortement pénalisées (+2,5) ;
 *   − formes simples (cru / eau / vapeur / bouilli) favorisées (−1) ;
 *   − recettes préparées pénalisées (+1,5) ; « aliment moyen » +1 ;
 *   − noms courts favorisés (+0,05/token, jamais de quoi changer de tier).
 */
function scoreRef(qt: string[], refToks: string[], label: string): number {
	const normed = refToks.join(" ");
	const isRecipe = RECIPE_MARKERS.some((m) => normed.includes(m)) ? 1.5 : 0;
	const isRef = isReferenceLabel(label) ? 0 : 1;
	const isElab =
		refToks.some((t) => ELAB_TOKENS.has(t)) || ELAB_SUBSTR.some((m) => normed.includes(m));
	const prep = isElab ? 2.5 : refToks.some((t) => SIMPLE_PREP.has(t)) ? -1 : 0;
	const lengthTerm = refToks.length * 0.05;
	if (refToks.join(" ") === qt.join(" ")) return 0 + prep + isRecipe + isRef + lengthTerm; // exact
	if (qt.every((t, i) => refToks[i] === t)) return 2 + prep + isRecipe + isRef + lengthTerm; // préfixe de mots
	if (refToks.every((t) => qt.includes(t)) && refToks.length > 0)
		return 4 + prep + isRecipe + isRef + lengthTerm; // la requête couvre tous les mots du libellé
	if (refToks.some((t) => qt.includes(t))) return 6 + prep + isRecipe + isRef + lengthTerm; // un mot en commun
	return Number.POSITIVE_INFINITY;
}

const REFS_BY_FIRST: Map<string, { toks: string[]; ref: CiqualHit }[]> = (() => {
	const m = new Map<string, { toks: string[]; ref: CiqualHit }[]>();
	for (const r of ciqualNutrients) {
		const toks = tokenize(r.name);
		if (toks.length === 0) continue;
		const hit: CiqualHit = {
			label: r.name,
			kcal: r.kcal,
			protein: r.p,
			carbs: r.c,
			fat: r.f,
		};
		const bucket = m.get(toks[0]);
		const row = { toks, ref: hit };
		if (bucket) bucket.push(row);
		else m.set(toks[0], [row]);
	}
	return m;
})();

/**
 * Jusqu'à 3 références Ciqual pertinentes pour une requête utilisateur
 * (« riz » → Riz blanc cru, Riz complet cru, Riz cuit… ; « poulet » → Poulet
 * cru / rôti…). Aucun remplissage artificiel : moins de résultats si moins
 * de références pertinentes. Tri STABLE à score égal (ordre de la table).
 *
 * Multi-mots : le PREMIER aliment est obligatoire (anchorTokens — « poulet
 * cuit au four » n'exige que « poulet », les variantes d'état Ciqual restent
 * candidates), et les mots NON préparatoires (« riz complet » → complet)
 * doivent TOUS être présents — « complet » seul ne ramène pas autre chose.
 */
export function searchCiqualLocal(query: string): CiqualHit[] {
	const qt = tokenize(query);
	if (qt.length === 0) return [];
	const anchors = anchorTokens(query);
	const candidates: { score: number; ref: CiqualHit }[] = [];
	for (const [, bucket] of REFS_BY_FIRST) {
		for (const { toks, ref } of bucket) {
			if (!anchors.every((a) => toks.includes(a))) continue;
			const s = scoreRef(qt, toks, ref.label);
			if (s < Number.POSITIVE_INFINITY) candidates.push({ score: s, ref });
		}
	}
	candidates.sort((a, b) => a.score - b.score);
	const out: CiqualHit[] = [];
	const seen = new Set<string>();
	for (const c of candidates) {
		if (seen.has(c.ref.label)) continue;
		seen.add(c.ref.label);
		out.push(c.ref);
		if (out.length >= CIQUAL_MAX_RESULTS) break;
	}
	return out;
}

/**
 * Valeurs /100 g de la fiche Ciqual EXACTE (comparaison normalisée, sans
 * accents ni pluriels). Le libellé affiché au client est toujours l'officiel.
 */
export function resolveCiqualLabel(label: string): CiqualHit | null {
	const toks = tokenize(label);
	if (toks.length === 0) return null;
	const bucket = REFS_BY_FIRST.get(toks[0]);
	if (!bucket) return null;
	const want = toks.join(" ");
	for (const { toks: rt, ref } of bucket) {
		if (rt.join(" ") === want) return ref;
	}
	return null;
}

/** Libellé de source affiché dans l'UI (badge des fiches de référence). */
export const CIQUAL_SOURCE_LABEL = "Référence Ciqual – ANSES";

/**
 * Recherche locale de fiches Ciqual (bloc « Aliments de référence ») —
 * jusqu'à 3 références pertinentes, aucun remplissage artificiel. Lecture
 * seule : la table Ciqual est embarquée, la base OFF n'est JAMAIS touchée.
 */
export const searchCiqual = query({
	args: { sessionToken: v.optional(v.string()), query: v.string() },
	handler: async (ctx, { sessionToken, query: q }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
		if (q.trim().length < 2) return [] as CiqualHit[];
		return searchCiqualLocal(q);
	},
});
