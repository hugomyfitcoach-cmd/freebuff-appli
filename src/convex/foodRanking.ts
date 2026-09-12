/**
 * Pertinence de la recherche d'aliments (aucune écriture en base, pur tri).
 *
 * Problème : l'index plein texte Convex (`by_name`, BM25) renvoie toujours les
 * résultats dans SON ordre de pertinence, sans possibilité de tri custom — et
 * cet ordre favorise les produits industriels/marque (« Sauce tomate basilic
 * Barilla ») alors que les clientes tapent des aliments bruts simples
 * (« tomate », « riz », « courgette »).
 *
 * Correction : on élargit la fenêtre de candidats (voir FOOD_SEARCH_CANDIDATES)
 * puis on re-trie ici, du plus « aliment brut » au plus transformé :
 *
 *   1. correspondance EXACTE du nom (« Tomate », « Tomates ») ;
 *   2. le mot tapé ouvre le nom — famille de l'aliment brut
 *      (« Tomates cerises », « Riz complet », « Courgette râpée ») ;
 *   3. le mot tapé apparaît comme mot entier ailleurs dans le nom
 *      (« Tarte à la tomate », « Salade de riz ») ;
 *   4. simple sous-chaîne (« Confiture de tomates vertes »).
 *
 * À niveau égal, deux signaux de « généricité fiable », 100 % locaux :
 *
 *   - **Ciqual d'abord** : le nom du produit est le préfixe mot à mot d'un
 *     libellé officiel de la table Ciqual 2025 (ANSES, embarquée dans
 *     `ciqualNames.ts` — « Tomate » → « Tomate verte, crue », « Riz complet »
 *     → « Riz complet, cru »). Vocabulaire générique français de référence.
 *   - **sans marque** ensuite (générique = plus proche du brut), puis nom le
 *     plus court (les noms courts sont les plus simples), puis ordre
 *     alphabétique. À score identique, l'ordre BM25 initial est conservé (tri
 *     stable) — il reste un bon départage.
 *
 * Sans accents ni casse : « tomates », « TOMATE », « pêche » ≈ « peche ».
 */

import { ciqualNames } from './ciqualNames';
import { ciqualNutrients, type CiqualRef } from './ciqualNutrients';

/** Nombre de candidats remontés du search index avant re-tri (le tri BM25 brut peut enterrer l'aliment brut bien au-delà de 25). */
export const FOOD_SEARCH_CANDIDATES = 150;

export type RankableFood = {
	name: string;
	brand?: string;
	/** Nutrition /100 g — sert au contrôle de cohérence Ciqual (optionnel : sans valeurs, pas de contrôle). */
	kcal100?: number;
	protein100?: number;
	carbs100?: number;
	fat100?: number;
};

/** œ/æ puis accents → ascii (« pêche » ≈ « peche », « œuf » ≈ « oeuf »). */
function deaccent(s: string): string {
	return s
		.replace(/œ/g, "oe")
		.replace(/Œ/g, "oe")
		.replace(/æ/g, "ae")
		.replace(/Æ/g, "ae")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
}

/** Normalisation pour comparaison : minuscules, sans accents, ponctuation → espace. */
export function norm(s: string): string {
	return deaccent(s.toLowerCase())
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

/** Singularisation grossière (vocabulaire alimentaire) : « tomates » → « tomate ».
 *  Garde les mots courts (« riz », « pois ») et ceux sans « s » intacts. */
function singularize(t: string): string {
	return t.length >= 5 && t.endsWith("s") ? t.slice(0, -1) : t;
}

/** Tokens normalisés + singularisés d'un texte (« Tomates cerises » → ["tomate", "cerise"]). */
export function tokenize(s: string): string[] {
	return norm(s).split(" ").filter(Boolean).map(singularize);
}

/* ─── Requête multi-mots : le PREMIER aliment est obligatoire ───
 *
 * « poulet cuit au four » : « poulet » est l'aliment, le reste n'affine que.
 * Mots de PRÉPARATION (« cuit », « fumé »…) et mots OUTIL (« au », « à la »…)
 * sont exclus des mots requis : seul « poulet » reste obligatoire. Sans ça,
 * « au four » ferait remonter agneau / ail / truite, et « fumé » du saumon.
 * Le sigle FQ (ci-dessous) laisse à OFF le soin d'énumérer les variantes
 * réelles (« poulet grillé »…) : côté base on impose juste l'ancre.
 */
const PREP_WORDS = new Set([
	"cuit", "cuite", "cru", "crue", "fume", "fumee", "grille", "grillee",
	"roti", "rotie", "bouilli", "bouillie", "vapeur", "frais", "fraiche",
	"congel", "surgele", "surgelee", "brut", "seche", "sechee", "egoutte",
	"egouttee", "bio", "sec", "sauce", "au", "a", "la", "aux", "de", "du",
	"en", "et", "avec", "sans", "type", "style",
]);

/**
 * Mots OBLIGATOIRES d'une requête : le premier token (aliment principal)
 * PLUS les mots qui ne sont ni préparation ni outil (« riz complet » →
 * [riz, complet] : les deux comptent ; « poulet cuit au four » → [poulet]).
 */
export function anchorTokens(query: string): string[] {
	const toks = tokenize(query);
	const out = toks.filter((t, i) => i === 0 || !PREP_WORDS.has(t));
	return out.length > 0 ? out : toks.slice(0, 1);
}

/* ─── Signal Ciqual (table ANSES embarquée, 100 % local, zéro réseau) ───
 *
 * Index : 1er token du libellé → tokenisations Ciqual commençant par ce mot.
 * « Le produit est Ciqual » ssi ses tokens sont un PRÉFIXE mot à mot d'un
 * libellé officiel (« Tomate » ⊑ « Tomate cerise, crue », « Riz complet » ⊑
 * « Riz complet, cru »). Une sous-chaîne quelconque ne compte PAS : la
 * « Sauce tomate » ne peut pas hériter de la qualité de « Tomate ».
 * Module-level : calculé une fois par isolate, jamais à chaque recherche.
 */
const CIQUAL_BY_FIRST: Map<string, string[][]> = (() => {
	const m = new Map<string, string[][]>();
	for (const label of ciqualNames) {
		const toks = tokenize(label);
		if (toks.length === 0) continue;
		const bucket = m.get(toks[0]);
		if (bucket) bucket.push(toks);
		else m.set(toks[0], [toks]);
	}
	return m;
})();

/** Le nom (normalisé, singularisé) est-il le préfixe mot à mot d'un libellé Ciqual ? */
function isCiqualVocab(n: string): boolean {
	const toks = tokenize(n);
	const bucket = toks.length > 0 ? CIQUAL_BY_FIRST.get(toks[0]) : undefined;
	if (!bucket) return false;
	outer: for (const cand of bucket) {
		if (cand.length < toks.length) continue;
		for (let i = 0; i < toks.length; i++) {
			if (cand[i] !== toks[i]) continue outer;
		}
		return true;
	}
	return false;
}

/* ── Cohérence NUTRITIONNELLE : distance kcal/macros à la référence Ciqual ──
 *
 * Même définition de « reconnu » que le signal vocabulaire (préfixe mot à mot
 * d'un libellé officiel), mais appliquée aux références AVEC nutriments : la
 * fiche est comparée à la référence la plus proche parmi celles qui matchent
 * (« tomate » matche « Tomate verte, crue » ET « Tomate cerise, crue »…).
 * Distance = écart kcal relatif + écarts macros absolus pénalisés (protéines
 * et glucides pèsent plus que les lipides, souvent plus variables). Les
 * infos manquantes côté Ciqual sont neutres (moyenne des présents).
 */
const NUT_BY_FIRST: Map<string, CiqualRef[]> = (() => {
	const m = new Map<string, CiqualRef[]>();
	for (const ref of ciqualNutrients) {
		const toks = tokenize(ref.name);
		if (toks.length === 0) continue;
		const bucket = m.get(toks[0]);
		if (bucket) bucket.push(ref);
		else m.set(toks[0], [ref]);
	}
	return m;
})();

/**
 * Marqueurs de plats préparés dans un libellé Ciqual : quand la fiche a un
 * nom GÉNÉRIQUE (« tomate »), ces références (« Tomate farcie », « double
 * concentré », « à la provençale »…) ne doivent pas servir de référence de
 * cohérence — elles masqueraient l'aberration. Une fiche au nom du plat
 * (« Tomates à la provençale ») continue de matcher sa propre référence : le
 * marqueur n'est cherché que DANS LA QUEUE du libellé, après le préfixe
 * consommé par la fiche.
 */
const PREPARED_MARKERS = ["farc", "concentr", "appertis", "preemball", "sauce", "a la"];

/** Références Ciqual dont le libellé commence par les tokens donnés. */
function matchingRefs(toks: string[]): CiqualRef[] {
	const bucket = toks.length > 0 ? NUT_BY_FIRST.get(toks[0]) : undefined;
	if (!bucket) return [];
	return bucket.filter((ref) => {
		const rt = tokenize(ref.name);
		if (!toks.every((t, i) => rt[i] === t)) return false;
		const tail = rt.slice(toks.length).join(" ");
		return !PREPARED_MARKERS.some((m) => tail.includes(m));
	});
}

/** Écart nutritionnel d'une fiche vs une référence (0 = identique, ≈1 = très loin, ≥2 = aberrant). */
function nutrientDistance(kcal: number, p: number, c: number, f: number, ref: CiqualRef): number {
	let d = Math.abs(kcal - ref.kcal) / Math.max(ref.kcal, 30);
	const parts: (number | undefined)[] = [
		ref.p !== undefined ? Math.abs(p - ref.p) / 10 : undefined,
		ref.c !== undefined ? Math.abs(c - ref.c) / 15 : undefined,
		ref.f !== undefined ? Math.abs(f - ref.f) / 20 : undefined,
	];
	const present = parts.filter((x) => x !== undefined) as number[];
	if (present.length > 0) d += present.reduce((a, b) => a + b, 0) / present.length;
	return d;
}

/**
 * Distance minimale de la fiche aux références Ciqual reconnues, ou undefined
 * si la fiche n'est pas reconnue (pas de référence) ou sans nutrition.
 */
export function ciqualMismatch(n: string, kcal?: number, p?: number, c?: number, f?: number): number | undefined {
	if (kcal === undefined || kcal <= 0) return undefined;
	const refs = matchingRefs(tokenize(n));
	if (refs.length === 0) return undefined;
	let best = Infinity;
	for (const ref of refs) {
		const d = nutrientDistance(kcal, p ?? 0, c ?? 0, f ?? 0, ref);
		if (d < best) best = d;
	}
	return best;
}

/**
 * « Distance » au(x) mot(s) tapé(s), via tokens singularisés :
 * 0 = nom identique, puis famille (les premiers mots du nom sont exactement
 * la requête — « tomates cerises » pour « tomate », mais PAS
 * « Tomatenpüree » dont le premier mot est un composé allemand), puis mot
 * entier de la requête présent dans le nom, puis simple sous-chaîne. La
 * marque creuse chaque famille d'un cran (un produit de marque est
 * rarement l'aliment brut).
 */
function tierOf(qt: string[], nt: string[]): number {
	if (nt.join(" ") === qt.join(" ")) return 0; // correspondance exacte
	if (qt.every((t, i) => nt[i] === t)) return 1; // famille (préfixe de mots)
	if (nt.some((t) => qt.includes(t))) return 2; // mot entier dans le nom
	return 3; // simple sous-chaîne (« confiture de tomates… »)
}

/** Au-delà de cet écart kcal/macros vs Ciqual, une fiche reconnue est jugée aberrante. */
const ABERRATION_THRESHOLD = 1;

/**
 * Re-trie les candidats, du plus fiable au moins fiable :
 *
 *   1. cohérence NUTRITIONNELLE — une fiche reconnue Ciqual dont kcal/macros
 *      s'écartent trop de la référence passe derrière TOUTES les fiches
 *      cohérentes (des calories fausses sont pires qu'un nom moins pertinent) ;
 *   2. correspondance du nom (exact > famille > mot entier > sous-chaîne) ;
 *   3. sans marque, puis vocabulaire Ciqual officiel, puis nom le plus court,
 *      puis alphabétique. À key identique, l'ordre BM25 initial est conservé
 *      (tri stable).
 *
 * Retourne une NOUVELLE liste (l'entrée n'est jamais modifiée) — à appliquer
 * sur les résultats du search index, du cache OFF ou de l'API OFF.
 */
export function rankFoods<T extends RankableFood>(items: readonly T[], query: string): T[] {
	const q = norm(query);
	if (!q) return [...items];
	const qt = tokenize(query);
	// Ancres = mots obligatoires (aliment principal + qualificatifs non liés à
	// la préparation). Les mots de préparation affinent le tri, jamais l'éligibilité.
	const anchors = anchorTokens(query);
	const scored = items.map((f) => {
		const n = norm(f.name);
		const nt = tokenize(f.name);
		const mismatch = ciqualMismatch(n, f.kcal100, f.protein100, f.carbs100, f.fat100);
		// Mots obligatoires manquants, position-aware : l'ALIMENT PRINCIPAL
		// (1er ancre) est le plus important — « Poulet rôti » (a l'aliment, il
		// manque la précision) doit battre « Ail au four » (a juste le mot de
		// préparation, pas l'aliment). Schéma : tout trouvé = 0 ; aliment
		// présent, qualificatif manquant = 1 ; aliment ABSENT = ≥3 (derrière
		// toutes les fiches qui parlent du bon aliment).
		const at = nt.filter((t) => anchors.includes(t));
		const hasMain = at.includes(anchors[0]);
		const anchorKey =
			at.length === anchors.length ? 0 : hasMain ? 1 : 2 + (anchors.length - at.length);
		return {
			f,
			// ABÉRANT < ANCHOR < tier < marque(0/1) < ciqual(0/1) < longueur < alpha
			key: [
				mismatch !== undefined && mismatch > ABERRATION_THRESHOLD ? 1 : 0,
				anchorKey,
				tierOf(qt, nt),
				f.brand?.trim() ? 1 : 0,
				isCiqualVocab(n) ? 0 : 1,
				n.length,
				n,
			] as const,
		};
	});
	scored.sort((a, b) => {
		const ka = a.key;
		const kb = b.key;
		for (let i = 0; i < 6; i++) {
			if (ka[i] !== kb[i]) return (ka[i] as number) - (kb[i] as number);
		}
		return ka[6].localeCompare(kb[6], "fr");
	});
	return scored.map((s) => s.f);
}
