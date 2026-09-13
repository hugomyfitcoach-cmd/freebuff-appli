/**
 * Repères G-FLUX — portions usuelles internes (whitelist contrôlée).
 *
 * Objectif : proposer des aides de saisie (1 œuf, 1 tranche, 1 c. à soupe…)
 * uniquement quand c'est PERTINENT pour le produit — sans jamais toucher aux
 * portions officielles Open Food Facts ni aux données Ciqual. Chaque repère
 * possède son équivalent en g/ml : derrière, tout est converti en grammes et
 * le moteur nutritionnel existant (valeurs pour 100 g) fait le reste.
 *
 * Principe : whitelist courte et fiable, facilement extensible. Si aucun
 * repère ne correspond, on n'invente rien (l'onglet « Repères G-FLUX »
 * n'apparaît simplement pas dans la feuille de quantité).
 *
 * Correspondance volontairement prudente :
 * - comparaison sans accents / majuscules / ponctuation (œ → oe) ;
 * - mots entiers uniquement (tokenisation, pas de sous-chaîne) ;
 * - le TYPE d'aliment principal prime sur les adjectifs : « yaourt sucré »
 *   → pot de yaourt (le « sucré » n'active JAMAIS le repère sucre) ;
 * - exclusions possibles par règle (ex. « pain au chocolat » n'est pas une
 *   tranche de pain) ;
 * - première règle gagnante → les règles les plus spécifiques en premier.
 */

/** Un repère usuel : libellé + équivalent indicatif en g (ou ml, liquides). */
export type GFluxRepere = {
	/** Libellé au singulier, ex. « tranche ». */
	label: string;
	/** Libellé au pluriel, ex. « tranches ». */
	plural: string;
	/** Équivalent indicatif pour 1 repère, en grammes (ou ml pour les liquides). */
	grams: number;
	unit: 'g' | 'ml';
};

/* ————— Repères de la whitelist (équivalents usuels, valeur indicative) ————— */

const TRANCHE: GFluxRepere = { label: 'tranche', plural: 'tranches', grams: 25, unit: 'g' };
const TRANCHE_BLANC: GFluxRepere = { label: 'tranche', plural: 'tranches', grams: 40, unit: 'g' };
const OEUF: GFluxRepere = { label: 'œuf', plural: 'œufs', grams: 50, unit: 'g' };
const STEAK: GFluxRepere = { label: 'steak', plural: 'steaks', grams: 125, unit: 'g' };
const MORCEAU: GFluxRepere = { label: 'morceau', plural: 'morceaux', grams: 5, unit: 'g' };
const C_A_CAFE: GFluxRepere = { label: 'c. à café', plural: 'c. à café', grams: 5, unit: 'g' };
const C_A_SOUPLE: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 15, unit: 'g' };
const POT_YAOURT: GFluxRepere = { label: 'pot', plural: 'pots', grams: 125, unit: 'g' };
const POT_COMPOTE: GFluxRepere = { label: 'pot', plural: 'pots', grams: 100, unit: 'g' };
const VERRE: GFluxRepere = { label: 'verre', plural: 'verres', grams: 250, unit: 'ml' };
const CANETTE: GFluxRepere = { label: 'canette', plural: 'canettes', grams: 330, unit: 'ml' };
const BOUTEILLE: GFluxRepere = { label: 'bouteille', plural: 'bouteilles', grams: 500, unit: 'ml' };
const GALETTE_RIZ: GFluxRepere = { label: 'galette', plural: 'galettes', grams: 8, unit: 'g' };

/** Règle de correspondance nom de produit → repères. */
type GFluxRule = {
	/** Le nom doit COMMENCER par l'un de ces mots (ex. « sucre blanc »). */
	head?: string[];
	/** Mots-clés : au moins UN requis. */
	any?: string[];
	/** Mots-clés : TOUS requis (ordre indifférent). */
	all?: string[];
	/** Expressions consécutives : au moins UNE requise. */
	phrases?: string[];
	/** Mots interdits : la règle est ignorée si l'un apparaît. */
	never?: string[];
	reperes: GFluxRepere[];
};

/* ————— Whitelist — première règle gagnante, spécifiques d'abord ————— */

const RULES: GFluxRule[] = [
	// Spécifiques
	{ phrases: ['steak hache'], reperes: [STEAK] },
	{ phrases: ['galette de riz'], reperes: [GALETTE_RIZ] },
	{ all: ['fromage', 'tranche'], reperes: [TRANCHE] },
	// Tranche FINE (≈ 25 g) : jambon cru/sec — avant la règle jambon générique.
	{
		any: ['serrano', 'parma', 'parme', 'prosciutto', 'bayonne', 'kintoa'],
		phrases: ['jambon cru', 'jambon sec', 'pata negra'],
		reperes: [TRANCHE],
	},
	// Tranche ÉPAISSE (40 g) : jambon blanc/cuit et blancs de volaille.
	{ any: ['jambon'], reperes: [TRANCHE_BLANC] },
	{ phrases: ['blanc de poulet', 'blanc de dinde'], reperes: [TRANCHE_BLANC] },
	// Pain (avant la règle sucre : « pain sucré » reste une tranche de pain)
	{ any: ['pain'], never: ['chocolat'], reperes: [TRANCHE] },
	// Unités naturelles — le TYPE principal gagne toujours sur « sucré »
	{ any: ['oeuf'], reperes: [OEUF] },
	{ any: ['yaourt'], reperes: [POT_YAOURT] },
	{ any: ['compote'], reperes: [POT_COMPOTE] },
	// Cuillères (liquides et sauces)
	{ any: ['huile'], reperes: [C_A_CAFE, C_A_SOUPLE] },
	{ any: ['miel'], reperes: [C_A_CAFE, C_A_SOUPLE] },
	{ any: ['sauce', 'ketchup', 'mayonnaise', 'moutarde'], reperes: [C_A_CAFE, C_A_SOUPLE] },
	// Boissons (verre / canette / bouteille)
	{
		any: ['boisson', 'soda', 'cola', 'coca', 'limonade', 'sirop', 'jus', 'lait', 'the', 'tea', 'eau'],
		// « laitue » n'est pas du lait, « poudre » ≠ boisson liquide.
		never: ['poudre', 'laitue'],
		reperes: [VERRE, CANETTE, BOUTEILLE],
	},
	// Sucre : uniquement un produit IDENTIFIÉ comme sucre — le nom COMMENCE
	// par « sucre » (« sucre blanc », « sucre roux », « sucre de canne »,
	// « sucre en morceaux »…). Un adjectif (« yaourt sucré », « biscuit
	// sucré ») n'active JAMAIS ce repère.
	{ head: ['sucre', 'sucres'], reperes: [MORCEAU] },
];

/** Libellé accordé du repère : « tranche » / « tranches » (n > 1). */
export function unitWord(n: number, r: GFluxRepere): string {
	return n > 1 ? r.plural : r.label;
}

/** Minuscules, sans accents, œ/æ décomposés — base de toute comparaison. */
function normalize(s: string): string {
	return s
		.toLowerCase()
		.replace(/œ/g, 'oe')
		.replace(/æ/g, 'ae')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

/** Découpe en mots normalisés (« Ketchup 5 Ingrédients » → [ketchup, 5, ingredients]). */
function tokenize(s: string): string[] {
	return normalize(s)
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

/** True si les `phrase` mots consécutifs apparaissent dans les tokens du nom. */
function hasPhrase(nameTokens: string[], phrase: string): boolean {
	const p = tokenize(phrase);
	if (p.length === 0 || p.length > nameTokens.length) return false;
	outer: for (let i = 0; i + p.length <= nameTokens.length; i++) {
		for (let j = 0; j < p.length; j++) {
			if (nameTokens[i + j] !== p[j]) continue outer;
		}
		return true;
	}
	return false;
}

/**
 * Mot-clé présent dans le nom : mot entier (pluriel simple accepté :
 * « oeufs » ↔ « oeuf ») ou radical pour les mots longs (≥ 4 caractères,
 * « fromagerie » ← « fromage »). Les mots courts exigent le mot exact pour
 * éviter les collisions (lait ≠ laitue… sauf exclusions gérées via never).
 */
function matchWord(toks: string[], kw: string): boolean {
	if (toks.includes(kw)) return true;
	if (toks.includes(kw + 's') || toks.includes(kw + 'x')) return true;
	return kw.length >= 4 && toks.some((t) => t.length > kw.length && t.startsWith(kw));
}

/**
 * Repères G-FLUX applicables à un produit (nom tel qu'affiché).
 * Retourne une liste vide si aucun repère fiable ne correspond — on
 * n'invente rien, la feuille masquera simplement l'onglet.
 */
export function reperesForFood(name: string): readonly GFluxRepere[] {
	const toks = tokenize(name);
	if (toks.length === 0) return [];
	for (const rule of RULES) {
		if (rule.never?.some((w) => toks.includes(w))) continue;
		if (rule.head && !rule.head.includes(toks[0] ?? '')) continue;
		if (rule.phrases?.some((p) => hasPhrase(toks, p))) return rule.reperes;
		if (rule.any?.some((w) => matchWord(toks, w))) return rule.reperes;
		if (rule.all?.length && rule.all.every((w) => matchWord(toks, w))) return rule.reperes;
		// Règle à head seul (ex. sucre) : le 1er mot EST le déclencheur.
		if (rule.head && !rule.phrases && !rule.any && !rule.all) return rule.reperes;
	}
	return [];
}
