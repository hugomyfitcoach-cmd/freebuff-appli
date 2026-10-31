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
 * Règle Mission R1 : les candidats qui portent TOUS les mots de la recherche
 * (en début de mot — voir `allWordsPresent`) passent devant les autres, avant
 * tous les critères ci-dessous (même normalisation que la recherche Ciqual).
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

/** Normalisation pour comparaison : minuscules, sans accents, ponctuation →
 *  espace. Les apostrophes droites ET typographiques SÉPARENT les mots :
 *  « d'avoine » / « d’avoine » → « d » + « avoine » (jamais « davoine »),
 *  pour qu'une recherche « avoine » trouve « Flocon d'avoine ». */
export function norm(s: string): string {
	return deaccent(s.toLowerCase())
		.replace(/['\u2019]/g, " ")
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

/**
 * Nombre de tokens du PREMIER SEGMENT d'un nom (avant la première virgule).
 * C'est le segment qui NOMME l'aliment (« Frites de pommes de terre », « Sole »),
 * par opposition à la queue qui décrit la préparation (« frite », « au four »).
 * Un nom sans virgule est entièrement segment d'aliment.
 */
export function headTokenCount(name: string): number {
	const comma = name.indexOf(',');
	return tokenize(comma === -1 ? name : name.slice(0, comma)).length;
}

/* ─── États de cuisson (normalisation partagée Ciqual + OFF) ───
 *
 * SOURCE UNIQUE : src/lib/cookedState.ts (détection, badge, rangs). Utilisée
 * ici pour (1) reconnaître qu'un mot d'état de la REQUÊTE est présent dans un
 * nom (« riz cuit » → « Riz blanc, bouilli/cuit à l'eau »), (2) ordonner la
 * cuisson à l'intérieur d'une variété Ciqual (convex/ciqual.ts).
 */
import {
	cookingFamily,
	cookingStateOfToken,
	type CookingState,
} from "../lib/cookedState";

/** Famille de cuisson d'un token normalisé (undefined = ce n'est pas un état). */
export function stateClassOf(tok: string): CookingState | undefined {
	return cookingStateOfToken(tok);
}

/** État de cuisson tapé dans la requête (undefined = aucun état demandé).
 *
 * Le PREMIER mot de la recherche est l'ALIMENT, jamais un mode de cuisson
 * (Mission R1-quater) : « frites » cherche les frites de pommes de terre (et
 * non les poissons frits), « poisson frit » garde « frit » comme cuisson.
 */
export function queryCookState(qt: string[]): CookingState | undefined {
	for (const t of qt.slice(1)) {
		const c = cookingStateOfToken(t);
		if (c) return c;
	}
	return undefined;
}

/** Le nom porte-t-il un état de la même famille que l'état cherché ? */
export function sameCookFamily(a: CookingState, b: CookingState): boolean {
	return cookingFamily(a) === cookingFamily(b);
}

/**
 * Les mots tapés se suivent-ils, dans le même ordre, dans le nom ?
 * « pain complet » → vrai pour « Pain complet ou intégral »,
 * faux pour « Pain grillé au blé complet » (Mission R1-bis, règle 1).
 * Requête d'un seul mot : neutre (toujours vrai).
 */
export function phrasePresent(toks: string[], qt: string[]): boolean {
	if (qt.length < 2) return true;
	outer: for (let i = 0; i + qt.length <= toks.length; i++) {
		for (let j = 0; j < qt.length; j++) {
			if (toks[i + j] !== qt[j]) continue outer;
		}
		return true;
	}
	return false;
}

/* ─── Règle « tous les mots présents (en début de mot) » ───
 *
 * Un mot de la recherche est présent si un mot du nom le commence
 * (« pâtes » ≈ « pâte », « cuite » ≈ « cuit »), ou — pour un mot d'ÉTAT —
 * si le nom porte un état de la même famille (« cuit » couvre
 * « bouilli/cuit à l'eau »). La réciproque (mot du nom préfixe du mot tapé)
 * absorbe le genre (« complet » ≈ « complètes »).
 */
export function wordPresent(toks: string[], qTok: string, foodWord = false, head = toks.length): boolean {
	// `foodWord` : mot de l'ALIMENT (1er mot de la recherche). Il n'a pas de
	// sens de cuisson : « frites » ne doit pas être satisfait par « frit »
	// (poisson frit), sinon le mode de cuisson cité prend la place de l'aliment.
	const sc = foodWord ? undefined : cookingStateOfToken(qTok);
	// Un mot d'aliment qui RESSEMBLE à une cuisson (« frites », « rôties ») ne
	// peut être satisfait que par le segment qui NOMME l'aliment (avant la
	// première virgule) : « Sole, frite » n'est pas « frites ».
	const headOnly = foodWord && cookingStateOfToken(qTok) !== undefined;
	const last = headOnly ? Math.min(head, toks.length) : toks.length;
	for (let i = 0; i < last; i++) {
		const t = toks[i];
		if (t.startsWith(qTok)) return true;
		const tc = sc !== undefined ? cookingStateOfToken(t) : undefined;
		if (sc !== undefined && tc !== undefined && sameCookFamily(sc, tc)) return true;
		// Réciproque (genre : « complètes » ≈ « complet ») UNIQUEMENT sur un
		// mot significatif : sans ce seuil, « avoine » matchait tous les noms
		// contenant « a », « au », « d »… — 560 fiches hors sujet (Sole,
		// Homard, Navet) présentées comme résultats. Les mots outils d'une
		// fiche ne rendent jamais son nom pertinent.
		if (t.length >= 4 && qTok.startsWith(t)) {
			// …et jamais par un mot de cuisson quand on cherche un ALIMENT
			// (« frites » ≠ « frit », « rôties » ≠ « rôti »).
			if (!foodWord || cookingStateOfToken(t) === undefined) return true;
		}
	}
	return false;
}

/** Tous les mots de la recherche sont-ils présents (en début de mot) dans le nom ? */
export function allWordsPresent(toks: string[], qt: string[], head = toks.length): boolean {
	return qt.every((q, i) => wordPresent(toks, q, i === 0, head));
}

/* ─── Mots VIDES de la recherche (mission RECHERCHE-INTRUS) ───
 *
 * L'index plein texte (Convex `by_name`, API OFF) admet un candidat dès qu'il
 * porte AU MOINS UN des mots de la requête : « Ragoût de veau » ramenait donc
 * « Velouté de légumes », « Bière blonde de haute fermentation »… dont le seul
 * point commun est « de ». Ces mots outils ne décident jamais de la
 * pertinence : ils sont retirés de la requête AVANT tout filtre. Une requête
 * qui ne contiendrait QUE des mots vides (« de ») est conservée telle quelle
 * (règle explicite : on ne cherche jamais « rien »).
 */
export const QUERY_STOP_WORDS = new Set([
	"de", "du", "des", "d", "la", "le", "les", "l", "un", "une",
	"au", "aux", "a", "et", "en", "avec", "sans", "pour",
]);

/**
 * Mots SIGNIFICATIFS d'une requête (normalisés + singularisés, mots vides
 * retirés). Requête sans mot significatif → tokens complets (jamais vide si
 * la requête ne l'est pas).
 */
export function significantTokens(query: string): string[] {
	const toks = tokenize(query);
	const sig = toks.filter((t) => !QUERY_STOP_WORDS.has(t));
	return sig.length > 0 ? sig : toks;
}

/**
 * Le nom partage-t-il AU MOINS UN mot significatif de la requête ?
 * C'est le plancher d'ÉLIGIBILITÉ d'un résultat : un nom qui ne partage que
 * des mots vides (« Velouté de légumes » pour « ragoût de veau ») n'est pas un
 * résultat, quel que soit le classement. La règle R1 (« tous les mots
 * présents ») reste, elle, l'ordre de classement (clé `allWordsPresent`).
 */
export function sharesSignificantWord(name: string, query: string): boolean {
	const sig = significantTokens(query);
	if (sig.length === 0) return true;
	const toks = tokenize(name);
	const head = headTokenCount(name);
	return sig.some((t) => wordPresent(toks, t, false, head));
}

/** Marque exploitable : ni vide, ni le littéral « null » hérité de certains
 *  imports Open Food Facts (« null » n'est pas une marque). */
function usableBrand(brand: string | null | undefined): string {
	if (typeof brand !== 'string') return '';
	const b = brand.trim();
	return b && b.toLowerCase() !== 'null' ? b : '';
}

/**
 * La MARQUE partage-t-elle au moins un mot significatif de la requête ?
 * Un produit commercialisé sous une marque se cherche par son nom OU par sa
 * marque : « bodymass » doit trouver « Bar Protéinée Caramel Cookie » (dont le
 * nom ne contient pas la marque). À pertinence égale, une correspondance de
 * NOM passe avant une correspondance de MARQUE seule (voir `rankFoods`).
 */
export function sharesBrandWord(brand: string | null | undefined, query: string): boolean {
	const b = usableBrand(brand);
	if (!b) return false;
	const sig = significantTokens(query);
	if (sig.length === 0) return false;
	const toks = tokenize(b);
	return sig.some((t) => wordPresent(toks, t));
}

/**
 * Filtre d'éligibilité partagé par TOUTES les sources (base locale, aliments
 * personnels, cache/API Open Food Facts) et TOUS les lots (première page comme
 * suivantes) : les candidats admis par l'index sur un seul mot vide sont
 * écartés au lieu d'être simplement relégués en fin de liste — c'est ce qui
 * faisait apparaître des intrus AU MILIEU des résultats pertinents.
 * La correspondance porte sur le NOM ou la MARQUE (recherche par marque) ;
 * `rankFoods` conserve le classement R1 des candidats restants et place le
 * nom devant la marque seule.
 */
export function filterByQueryWords<T extends RankableFood>(items: readonly T[], query: string): T[] {
	const sig = significantTokens(query);
	if (sig.length === 0) return [...items];
	return items.filter((f) => sharesSignificantWord(f.name, query) || sharesBrandWord(f.brand, query));
}

/**
 * Texte de recherche d'une fiche `foods` : NOM + MARQUE normalisés.
 * Stocké dans `foods.searchText` (champ optionnel) et interrogé par l'index de
 * recherche dédié `by_searchText` — la recherche locale trouve ainsi un produit
 * par sa marque sans parcourir la table. Une fiche sans marque vaut son nom.
 */
export function searchTextOf(name: string, brand?: string | null): string {
	const n = norm(name);
	const b = usableBrand(brand) ? norm(usableBrand(brand)) : '';
	if (!b || n.split(' ').includes(b)) return n;
	return n ? `${n} ${b}` : b;
}

/**
 * La fiche a-t-elle besoin d'être (re)écrite ? Faux quand `searchText` est déjà
 * exactement le texte attendu : le rattrapage rejoué ne réécrit jamais une
 * fiche déjà à jour (idempotence).
 */
export function needsSearchTextUpdate(
	row: { searchText?: string },
	text: string
): boolean {
	return row.searchText !== text;
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
		// Nom d'abord, marque seule ensuite : à pertinence égale, un résultat dont
		// le NOM contient la recherche passe avant celui qui ne la porte que dans
		// sa marque. Les candidats admis par leur nom valent tous 0 : l'ordre R1
		// des recherches existantes est donc strictement inchangé.
		const byName = sharesSignificantWord(f.name, query) ? 0 : 1;
		return {
			f,
			// ABÉRANT < TOUS LES MOTS < NOM/MARQUE < ANCHOR < tier < marque(0/1) < ciqual(0/1) < longueur < alpha
			key: [
				mismatch !== undefined && mismatch > ABERRATION_THRESHOLD ? 1 : 0,
				allWordsPresent(nt, qt, headTokenCount(f.name)) ? 0 : 1,
				byName,
				anchorKey,
				tierOf(qt, nt),
				// À pertinence égale : les mots tapés consécutifs d'abord.
				phrasePresent(nt, qt) ? 0 : 1,
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
		// 9 clés numériques puis le nom (départage alphabétique stable).
		for (let i = 0; i < 9; i++) {
			if (ka[i] !== kb[i]) return (ka[i] as number) - (kb[i] as number);
		}
		return ka[9].localeCompare(kb[9], "fr");
	});
	return scored.map((s) => s.f);
}
