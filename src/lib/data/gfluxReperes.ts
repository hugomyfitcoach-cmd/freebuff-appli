/**
 * Repères G-FLUX — portions usuelles internes (whitelist contrôlée).
 *
 * Objectif : proposer des aides de saisie (1 œuf, 1 tranche, 1 c. à soupe…)
 * uniquement quand c'est PERTINENT pour le produit — sans jamais toucher aux
 * portions officielles Open Food Facts ni aux données Ciqual. Chaque repère
 * possède son équivalent en g/ml : derrière, tout est converti en grammes et
 * le moteur nutritionnel existant (valeurs pour 100 g) fait le reste.
 *
 * Principe : whitelist contrôlée, facilement extensible. Si aucun repère ne
 * correspond, on n'invente rien (l'onglet « Repères G-FLUX » n'apparaît
 * simplement pas dans la feuille de quantité). Tous les poids sont des
 * VALEURS INDICATIVES.
 *
 * Correspondance volontairement prudente :
 * - comparaison sans accents / majuscules / ponctuation (œ → oe) ;
 * - mots entiers uniquement (tokenisation, pas de sous-chaîne) ;
 * - le TYPE d'aliment principal prime sur les adjectifs : « yaourt sucré »
 *   → pot de yaourt, « purée d'amande » → c. à soupe (pas 1 amande) ;
 * - exclusions par règle (« pain au chocolat » n'est pas une tranche de
 *   pain, « ravioli » n'entre pas dans les pâtes) ;
 * - première règle gagnante → règles les plus SPÉCIFIQUES d'abord ;
 * - état CRU/SEC vs CUIT : repère cuillère seulement si le nom le précise
 *   (cuit, bouilli, à l'eau, égoutté… ou cru, sec). État inconnu + poids
 *   différents → pas de repère (on ne risque rien).
 *
 * NOTE INTERFACE : l'onglet Repères sélectionne le repère par `label` (une
 * seule occurrence de chaque libellé possible). Une règle ne propose donc
 * qu'UN repère pertinent, jamais deux fois « c. à soupe ».
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
const TRANCHE_BACON: GFluxRepere = { label: 'tranche', plural: 'tranches', grams: 20, unit: 'g' };
const TRANCHE_WASA: GFluxRepere = { label: 'tranche', plural: 'tranches', grams: 10, unit: 'g' };
const TRANCHE_MELON: GFluxRepere = { label: 'tranche', plural: 'tranches', grams: 150, unit: 'g' };
const TRANCHE_PASTEQUE: GFluxRepere = { label: 'tranche', plural: 'tranches', grams: 200, unit: 'g' };
const TRANCHE_ANANAS: GFluxRepere = { label: 'tranche', plural: 'tranches', grams: 100, unit: 'g' };
const OEUF: GFluxRepere = { label: 'œuf', plural: 'œufs', grams: 50, unit: 'g' };
const STEAK: GFluxRepere = { label: 'steak', plural: 'steaks', grams: 125, unit: 'g' };
const MORCEAU: GFluxRepere = { label: 'morceau', plural: 'morceaux', grams: 5, unit: 'g' };
const CARRE_CHOCO: GFluxRepere = { label: 'carré', plural: 'carrés', grams: 10, unit: 'g' };
const C_A_CAFE: GFluxRepere = { label: 'c. à café', plural: 'c. à café', grams: 5, unit: 'g' };
const C_A_SOUPLE: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 15, unit: 'g' };
const C_S_RIZ_CRU: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 12, unit: 'g' };
const C_S_PATES_CRU: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 10, unit: 'g' };
const C_S_CUISONNEE: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 18, unit: 'g' };
const C_S_FLOCONS: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 8, unit: 'g' };
const C_S_MUESLI: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 10, unit: 'g' };
const C_S_FARINE: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 10, unit: 'g' };
const C_S_CACAO: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 8, unit: 'g' };
const C_S_CONFITURE: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 20, unit: 'g' };
const C_S_RAISIN_SEC: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 10, unit: 'g' };
const C_S_SAME: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 12, unit: 'g' };
const C_S_LIN: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 10, unit: 'g' };
const C_S_COUCOURGE: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 10, unit: 'g' };
const C_S_SESAME: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 9, unit: 'g' };
const C_S_COCO_RAPEE: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 5, unit: 'g' };
const C_S_POLANTA_CUITE: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 20, unit: 'g' };
const POT_YAOURT: GFluxRepere = { label: 'pot', plural: 'pots', grams: 125, unit: 'g' };
const POT_COMPOTE: GFluxRepere = { label: 'pot', plural: 'pots', grams: 100, unit: 'g' };
const POT_PETIT_SUISSE: GFluxRepere = { label: 'pot', plural: 'pots', grams: 60, unit: 'g' };
const POT_FB_INDIV: GFluxRepere = { label: 'pot', plural: 'pots', grams: 100, unit: 'g' };
const VERRE: GFluxRepere = { label: 'verre', plural: 'verres', grams: 250, unit: 'ml' };
const CANETTE: GFluxRepere = { label: 'canette', plural: 'canettes', grams: 330, unit: 'ml' };
const BOUTEILLE: GFluxRepere = { label: 'bouteille', plural: 'bouteilles', grams: 500, unit: 'ml' };
const GALETTE_RIZ: GFluxRepere = { label: 'galette', plural: 'galettes', grams: 8, unit: 'g' };
const BOULE_MOZZA: GFluxRepere = { label: 'boule', plural: 'boules', grams: 125, unit: 'g' };
const BOULE_MINI_MOZZA: GFluxRepere = { label: 'boule', plural: 'boules', grams: 10, unit: 'g' };
const PORTION_BEURRE: GFluxRepere = { label: 'portion', plural: 'portions', grams: 10, unit: 'g' };
const PORTION_FROMAGE: GFluxRepere = { label: 'portion', plural: 'portions', grams: 20, unit: 'g' };
const PIECE: GFluxRepere = { label: 'pièce', plural: 'pièces', grams: 60, unit: 'g' };
const PIECE_VIENNOISERIE: GFluxRepere = { label: 'pièce', plural: 'pièces', grams: 70, unit: 'g' };
const PIECE_SAUCISSE: GFluxRepere = { label: 'pièce', plural: 'pièces', grams: 60, unit: 'g' };
const PIECE_CHIPOLATA: GFluxRepere = { label: 'pièce', plural: 'pièces', grams: 50, unit: 'g' };
const PIECE_MERGUEZ: GFluxRepere = { label: 'pièce', plural: 'pièces', grams: 50, unit: 'g' };
const ESCALOPE: GFluxRepere = { label: 'escalope', plural: 'escalopes', grams: 120, unit: 'g' };
const FILET: GFluxRepere = { label: 'filet', plural: 'filets', grams: 130, unit: 'g' };
const FILET_POISSON: GFluxRepere = { label: 'filet', plural: 'filets', grams: 150, unit: 'g' };
const PAVE_SAUMON: GFluxRepere = { label: 'pavé', plural: 'pavés', grams: 125, unit: 'g' };
const SURIMI: GFluxRepere = { label: 'bâtonnet', plural: 'bâtonnets', grams: 18, unit: 'g' };
const BATONNET_POISSON: GFluxRepere = { label: 'bâtonnet', plural: 'bâtonnets', grams: 30, unit: 'g' };
const BOULETTE: GFluxRepere = { label: 'boulette', plural: 'boulettes', grams: 25, unit: 'g' };
const FALAFEL: GFluxRepere = { label: 'falafel', plural: 'falafels', grams: 25, unit: 'g' };
const NUGGET: GFluxRepere = { label: 'nugget', plural: 'nuggets', grams: 20, unit: 'g' };
const BAGEL: GFluxRepere = { label: 'bagel', plural: 'bagels', grams: 85, unit: 'g' };
const PITA: GFluxRepere = { label: 'pita', plural: 'pitas', grams: 60, unit: 'g' };
const BISCOTTE: GFluxRepere = { label: 'biscotte', plural: 'biscottes', grams: 8, unit: 'g' };
const CRACKER: GFluxRepere = { label: 'cracker', plural: 'crackers', grams: 8, unit: 'g' };
const CREPE: GFluxRepere = { label: 'crêpe', plural: 'crêpes', grams: 40, unit: 'g' };
const PANCAKE: GFluxRepere = { label: 'pancake', plural: 'pancakes', grams: 50, unit: 'g' };
const GAUFRE: GFluxRepere = { label: 'gaufre', plural: 'gaufres', grams: 50, unit: 'g' };
const CROISSANT: GFluxRepere = { label: 'croissant', plural: 'croissants', grams: 50, unit: 'g' };
const POMME: GFluxRepere = { label: 'pomme', plural: 'pommes', grams: 150, unit: 'g' };
const BANANE: GFluxRepere = { label: 'banane', plural: 'bananes', grams: 120, unit: 'g' };
const POIRE: GFluxRepere = { label: 'poire', plural: 'poires', grams: 150, unit: 'g' };
const ORANGE: GFluxRepere = { label: 'orange', plural: 'oranges', grams: 150, unit: 'g' };
const CLEMENTINE: GFluxRepere = { label: 'fruit', plural: 'fruits', grams: 70, unit: 'g' };
const KIWI: GFluxRepere = { label: 'kiwi', plural: 'kiwis', grams: 80, unit: 'g' };
const PECHE: GFluxRepere = { label: 'pêche', plural: 'pêches', grams: 140, unit: 'g' };
const NECTARINE: GFluxRepere = { label: 'nectarine', plural: 'nectarines', grams: 140, unit: 'g' };
const ABRICOT_FRAIS: GFluxRepere = { label: 'abricot', plural: 'abricots', grams: 45, unit: 'g' };
const PRUNE: GFluxRepere = { label: 'prune', plural: 'prunes', grams: 60, unit: 'g' };
const FIGUE_FRAICHE: GFluxRepere = { label: 'figue', plural: 'figues', grams: 50, unit: 'g' };
const PAMPLEMOUSSE: GFluxRepere = { label: 'pamplemousse', plural: 'pamplemousses', grams: 250, unit: 'g' };
const DEMI_AVOCAT: GFluxRepere = { label: '1/2 avocat', plural: '1/2 avocat', grams: 75, unit: 'g' };
const AVOCAT: GFluxRepere = { label: 'avocat', plural: 'avocats', grams: 150, unit: 'g' };
const DEMI_MANGUE: GFluxRepere = { label: '1/2 mangue', plural: '1/2 mangue', grams: 100, unit: 'g' };
const FRAISE: GFluxRepere = { label: 'fraise', plural: 'fraises', grams: 15, unit: 'g' };
const CERISE: GFluxRepere = { label: 'cerise', plural: 'cerises', grams: 8, unit: 'g' };
const DATTE: GFluxRepere = { label: 'datte', plural: 'dattes', grams: 8, unit: 'g' };
const PRUNEAU: GFluxRepere = { label: 'pruneau', plural: 'pruneaux', grams: 10, unit: 'g' };
const ABRICOT_SEC: GFluxRepere = { label: 'abricot', plural: 'abricots', grams: 8, unit: 'g' };
const FIGUE_SECHE: GFluxRepere = { label: 'figue', plural: 'figues', grams: 15, unit: 'g' };
const TOMATE: GFluxRepere = { label: 'tomate', plural: 'tomates', grams: 120, unit: 'g' };
const TOMATE_CERISE: GFluxRepere = { label: 'tomate', plural: 'tomates', grams: 15, unit: 'g' };
const CAROTTE: GFluxRepere = { label: 'carotte', plural: 'carottes', grams: 100, unit: 'g' };
const OIGNON: GFluxRepere = { label: 'oignon', plural: 'oignons', grams: 100, unit: 'g' };
const ECHALOTE: GFluxRepere = { label: 'échalote', plural: 'échalotes', grams: 25, unit: 'g' };
const GOUSSE_AIL: GFluxRepere = { label: 'gousse', plural: 'gousses', grams: 5, unit: 'g' };
const COURGETTE: GFluxRepere = { label: 'courgette', plural: 'courgettes', grams: 200, unit: 'g' };
const AUBERGINE: GFluxRepere = { label: 'aubergine', plural: 'aubergines', grams: 300, unit: 'g' };
const CONCOMBRE: GFluxRepere = { label: 'concombre', plural: 'concombres', grams: 300, unit: 'g' };
const POIVRON: GFluxRepere = { label: 'poivron', plural: 'poivrons', grams: 150, unit: 'g' };
const ENDIVE: GFluxRepere = { label: 'endive', plural: 'endives', grams: 150, unit: 'g' };
const POIREAU: GFluxRepere = { label: 'poireau', plural: 'poireaux', grams: 150, unit: 'g' };
const CHAMPIGNON: GFluxRepere = { label: 'champignon', plural: 'champignons', grams: 20, unit: 'g' };
const RADIS: GFluxRepere = { label: 'radis', plural: 'radis', grams: 15, unit: 'g' };
const ASPERGE: GFluxRepere = { label: 'asperge', plural: 'asperges', grams: 20, unit: 'g' };
const FLEURETTE: GFluxRepere = { label: 'fleurette', plural: 'fleurettes', grams: 25, unit: 'g' };
const EPI_MAIS: GFluxRepere = { label: 'épi', plural: 'épis', grams: 150, unit: 'g' };
const POMME_TERRE: GFluxRepere = { label: 'pomme de terre', plural: 'pommes de terre', grams: 150, unit: 'g' };
const PATATE_DOUCE: GFluxRepere = { label: 'patate douce', plural: 'patates douces', grams: 200, unit: 'g' };
const AMANDE: GFluxRepere = { label: 'amande', plural: 'amandes', grams: 1.2, unit: 'g' };
const NOISETTE: GFluxRepere = { label: 'noisette', plural: 'noisettes', grams: 1.2, unit: 'g' };
const NOIX_CAJOU: GFluxRepere = { label: 'noix', plural: 'noix', grams: 1.5, unit: 'g' };
const CERNEAU: GFluxRepere = { label: 'cerneau', plural: 'cerneaux', grams: 4, unit: 'g' };
const NOIX_BRESIL: GFluxRepere = { label: 'noix', plural: 'noix', grams: 5, unit: 'g' };
const NOIX_MACADAMIA: GFluxRepere = { label: 'noix', plural: 'noix', grams: 3, unit: 'g' };
const PISTACHE: GFluxRepere = { label: 'pistache', plural: 'pistaches', grams: 0.6, unit: 'g' };
const CACAHUETE: GFluxRepere = { label: 'cacahuète', plural: 'cacahuètes', grams: 1, unit: 'g' };
const DEMI_PAMPLEMOUSSE: GFluxRepere = { label: '1/2 pamplemousse', plural: '1/2 pamplemousse', grams: 125, unit: 'g' };
const DEMI_BAGUETTE: GFluxRepere = { label: '1/2 baguette', plural: '1/2 baguette', grams: 125, unit: 'g' };
const QUART_BAGUETTE: GFluxRepere = { label: '1/4 baguette', plural: '1/4 baguette', grams: 60, unit: 'g' };
const TRANCHE_SAUMON_FUME: GFluxRepere = { label: 'tranche', plural: 'tranches', grams: 25, unit: 'g' };
const TRANCHE_SAUCISSON: GFluxRepere = { label: 'tranche', plural: 'tranches', grams: 5, unit: 'g' };
const OLIVE: GFluxRepere = { label: 'olive', plural: 'olives', grams: 4, unit: 'g' };
const CORNICHON: GFluxRepere = { label: 'cornichon', plural: 'cornichons', grams: 5, unit: 'g' };
const BOULE_GLACE: GFluxRepere = { label: 'boule', plural: 'boules', grams: 50, unit: 'g' };
const SKYR_POT: GFluxRepere = { label: 'pot', plural: 'pots', grams: 170, unit: 'g' };
const FB_POT: GFluxRepere = { label: 'pot', plural: 'pots', grams: 200, unit: 'g' };
const DESSERT_LACTE_POT: GFluxRepere = { label: 'pot', plural: 'pots', grams: 100, unit: 'g' };
/* Cuillères en ML (vinaigre, jus de citron) : unit = 'ml'. */
const ML_CAFE: GFluxRepere = { label: 'c. à café', plural: 'c. à café', grams: 5, unit: 'ml' };
const ML_SOUPLE: GFluxRepere = { label: 'c. à soupe', plural: 'c. à soupe', grams: 15, unit: 'ml' };

/* ————— Tablette de chocolat sans le mot « chocolat » ————— */

/* Indices clairement chocolat après « tablette » : noir / lait / blanc /
   noisettes / cacao. Un chiffre 50–99 = taux de cacao (sauf poids en g). */
const TABLETTE_CHOCO_HINTS = [
	'noir', 'noire', 'noirs', 'noires',
	'lait',
	'blanc', 'blanche', 'blancs', 'blanches',
	'noisette', 'noisettes',
	'cacao',
];

/** « Tablette (au) noir / lait / blanche / 70 %… » → tablette de chocolat. */
function looksLikeChocolateTablet(name: string): boolean {
	const toks = tokenize(name);
	if (!toks.includes('tablette') && !toks.includes('tablettes')) return false;
	if (TABLETTE_CHOCO_HINTS.some((h) => toks.includes(h))) return true;
	// « Tablette 70 % » : un taux de cacao, pas un poids (jamais suivi de g).
	for (let i = 0; i < toks.length; i++) {
		const n = Number(toks[i]);
		if (!Number.isInteger(n) || n < 50 || n > 99) continue;
		const next = toks[i + 1];
		if (next === 'g' || next === 'gr' || next === 'gramme' || next === 'grammes') continue;
		return true;
	}
	return false;
}

/** Règle de correspondance nom de produit → repères. */
type GFluxRule = {
	/** Le nom doit COMMENCER par l'un de ces mots (ex. « sucre blanc »). */
	head?: string[];
	/** Mots-clés normalisés (sans accents) : au moins UN requis. */
	any?: string[];
	/** Mots-clés normalisés : TOUS requis (ordre indifférent). */
	all?: string[];
	/** Expressions consécutives (normalisées automatiquement) : au moins UNE. */
	phrases?: string[];
	/** Prédicat ad hoc sur le nom complet (cas particuliers). */
	custom?: (name: string) => boolean;
	/** Mots interdits (normalisés, un seul mot chacun). */
	never?: string[];
	/** État requis dans le nom : 'cooked' (cuit/bouilli/égoutté…) ou 'dry' (cru/sec). */
	state?: 'cooked' | 'dry';
	reperes: GFluxRepere[];
};

/* ————— Whitelist — première règle gagnante, spécifiques d'abord ————— */

const RULES: GFluxRule[] = [
	/* — Spécifiques — */
	{ phrases: ['steak haché'], reperes: [STEAK] },
	{ phrases: ['galette de riz'], reperes: [GALETTE_RIZ] },
	{ phrases: ['pain au chocolat', 'chocolatine'], reperes: [PIECE_VIENNOISERIE] },
	{ any: ['croissant'], reperes: [CROISSANT] },
	// Édulcorants marque (avant la règle générique sucre).
	{ phrases: ['pure via', 'specialpatisserie', 'special patisserie'], never: ['liquide'], reperes: [MORCEAU] },

	/* — Unités naturelles : le TYPE principal gagne toujours sur les
	     adjectifs (« yaourt sucré », « compote sucrée pomme »…).
	     Produits laitiers à la cuillère : POT + c. à soupe (sauf à boire) —
	     l'onglet Repères sélectionne par libellé, « pot » et « c. à soupe »
	     cohabitent donc sans conflit. — */
	{ any: ['oeuf'], never: ['caille'], reperes: [OEUF] },
	{ phrases: ['yaourt à boire', 'yaourts à boire', 'boisson lactée', 'boissons lactées', 'lait ribot', 'lait fermenté'], never: ['poudre'], reperes: [VERRE, CANETTE, BOUTEILLE] },
	{ any: ['kéfir', 'kefir'], never: ['poudre'], reperes: [VERRE, CANETTE, BOUTEILLE] },
	{ any: ['yaourt'], never: ['boire'], reperes: [POT_YAOURT, C_A_SOUPLE] },
	{ any: ['skyr'], reperes: [SKYR_POT, C_A_SOUPLE] },
	{ any: ['faisselle'], reperes: [FB_POT, C_A_SOUPLE] },
	{ phrases: ['fromage blanc', 'fromages blancs', 'fromage frais', 'fromages frais', 'fromage battu'], any: ['faisselle'], never: ['individuel', 'individuels'], reperes: [FB_POT, C_A_SOUPLE] },
	{ phrases: ['petit suisse', 'petits suisses'], reperes: [POT_PETIT_SUISSE, C_A_SOUPLE] },
	{ phrases: ['dessert lacté', 'desserts lactés', 'caillé', 'caillés'], reperes: [DESSERT_LACTE_POT, C_A_SOUPLE] },
	{ phrases: ['compote à boire', 'compotes à boire', 'gourde de compote'], reperes: [VERRE, CANETTE, BOUTEILLE] },
	{ any: ['compote'], never: ['boire'], reperes: [POT_COMPOTE, C_A_SOUPLE] },
	// Jus (avant les fruits : « jus d'orange » ≠ 1 orange) — sauf jus de
	// citron vert, qui a ses cuillères dédiées plus bas.
	{ any: ['jus'], never: ['citron', 'lime', 'poudre'], reperes: [VERRE, CANETTE, BOUTEILLE] },

	/* — Farines / poudres (AVANT fruits, légumes, féculents :
	     « fécule de pomme de terre » ≠ 1 pomme de terre,
	     « poudre d'amande » ≠ 1 amande) — */
	{
		phrases: ['farine de blé', 'farine complète', "farine d'avoine", 'farine de riz', 'farine de maïs', 'farine de sarrasin', 'farine de seigle', 'farine d épeautre'],
		any: ['farine'],
		never: ['levure', 'levain'],
		reperes: [C_S_FARINE],
	},
	{
		phrases: ['fécule de maïs', 'maïzena', 'fécule de pomme de terre', 'fécule de tapioca'],
		any: ['fécule', 'maïzena'],
		reperes: [C_S_FARINE],
	},
	{ phrases: ["poudre d'amande", 'poudre d amandes', 'poudre amande'], reperes: [C_S_FARINE] },
	{ phrases: ['cacao en poudre', 'chocolat en poudre'], any: ['cacao'], never: ['beurre'], reperes: [C_S_CACAO] },
	{ any: ['chapelure'], reperes: [C_S_FLOCONS] },

	/* — Fruits : spécifiques d'abord (tomate cerise, fruits secs,
	     demi-avocat / demi-mangue), puis génériques — */
	{ phrases: ['tomate cerise', 'tomates cerises'], reperes: [TOMATE_CERISE] },
	{ phrases: ['abricot sec', 'abricots secs'], any: ['abricot'], never: ['frais', 'fraiche'], reperes: [ABRICOT_SEC] },
	{ any: ['abricot'], never: ['sec'], reperes: [ABRICOT_FRAIS] },
	{ phrases: ['figue sèche', 'figues sèches'], any: ['figue'], never: ['frais', 'fraiche'], reperes: [FIGUE_SECHE] },
	{ any: ['figue'], never: ['seche'], reperes: [FIGUE_FRAICHE] },
	{ phrases: ['demi avocat', 'moitié avocat', 'avocat coupé en deux'], reperes: [DEMI_AVOCAT] },
	{ any: ['avocat'], never: ['huile'], reperes: [AVOCAT] },
	{ phrases: ['demi mangue', 'moitié mangue'], reperes: [DEMI_MANGUE] },
	{ any: ['mangue'], never: ['seche'], reperes: [DEMI_MANGUE] },
	{ any: ['pomme'], never: ['terre'], reperes: [POMME] },
	{ any: ['banane'], never: ['seche'], reperes: [BANANE] },
	{ any: ['poire'], never: ['poireau', 'belle'], reperes: [POIRE] },
	{ any: ['orange'], never: ['amère', 'jus'], reperes: [ORANGE] },
	{ any: ['mandarine', 'clémentine'], never: ['cédrat'], reperes: [CLEMENTINE] },
	{ any: ['kiwi'], reperes: [KIWI] },
	{ any: ['pêche'], never: ['vigne', 'sirop'], reperes: [PECHE] },
	{ any: ['nectarine', 'brugnon'], never: ['sirop'], reperes: [NECTARINE] },
	{ any: ['prune'], never: ['pruneau', 'sec'], reperes: [PRUNE] },
	{ any: ['pamplemousse'], never: ['sirop', 'huile'], reperes: [DEMI_PAMPLEMOUSSE] },
	{ any: ['fraise'], never: ['sirop', 'confiture'], reperes: [FRAISE] },
	{ any: ['cerise'], never: ['amarena', 'sirop'], reperes: [CERISE] },
	{ any: ['melon'], never: ['pastèque', 'sirop'], reperes: [TRANCHE_MELON] },
	{ any: ['pastèque'], never: ['sirop'], reperes: [TRANCHE_PASTEQUE] },
	{ any: ['ananas'], never: ['jus', 'sirop', 'séché', 'sec'], reperes: [TRANCHE_ANANAS] },
	{ any: ['datte'], never: ['sirop'], reperes: [DATTE] },
	{ any: ['pruneau'], never: ['jus'], reperes: [PRUNEAU] },
	{ phrases: ['raisins secs', 'raisin sec', 'raisin de corinthe', 'raisin de smyrne'], reperes: [C_S_RAISIN_SEC] },
	{ any: ['cranberry'], never: ['jus'], reperes: [C_S_RAISIN_SEC] },

	/* — Légumes — */
	{ any: ['tomate'], never: ['purée', 'concassée', 'pelée', 'séchée', 'confite', 'sauce'], reperes: [TOMATE] },
	{ any: ['carotte'], never: ['râpée', 'jus'], reperes: [CAROTTE] },
	{ any: ['oignon'], never: ['frit'], reperes: [OIGNON] },
	{ any: ['échalote'], reperes: [ECHALOTE] },
	{ any: ['ail'], never: ['ours', 'bois', 'confit', 'saucisson'], reperes: [GOUSSE_AIL] },
	{ any: ['courgette'], never: ['spaghetti'], reperes: [COURGETTE] },
	{ any: ['aubergine'], never: ['caviar'], reperes: [AUBERGINE] },
	{ any: ['concombre'], never: ['vinaigrette'], reperes: [CONCOMBRE] },
	{ any: ['poivron'], never: ['rôti', 'grillé'], reperes: [POIVRON] },
	{ any: ['endive'], never: ['jambon'], reperes: [ENDIVE] },
	{ any: ['poireau'], never: ['vinaigrette'], reperes: [POIREAU] },
	{ any: ['champignon'], never: ['sauce', 'velouté'], reperes: [CHAMPIGNON] },
	{ any: ['radis'], never: ['noir'], reperes: [RADIS] },
	{ any: ['asperge'], never: ['conserve'], reperes: [ASPERGE] },
	{ phrases: ['fleurettes de brocoli', 'fleurette de brocoli'], any: ['brocoli'], reperes: [FLEURETTE] },
	{ any: ['brocoli'], never: ['conserve'], reperes: [FLEURETTE] },
	{ phrases: ['maïs en épi', 'épi de maïs', 'épis de maïs'], never: ['maïzena'], reperes: [EPI_MAIS] },
	{ any: ['maïs'], never: ['épi', 'maïzena', 'farine', 'fécule', 'amidon', 'soufflé', 'crème'], reperes: [C_A_SOUPLE] },
	{ phrases: ['petits pois', 'petit pois'], never: ['purée'], reperes: [C_A_SOUPLE] },

	/* — Féculents entiers — */
	{ phrases: ['pomme de terre', 'pommes de terre'], any: ['patate'], never: ['douce', 'douces', 'purée', 'frite', 'sautées'], reperes: [POMME_TERRE] },
	{ phrases: ['patate douce', 'patates douces'], any: ['patate'], never: ['purée', 'frite', 'sautées'], reperes: [PATATE_DOUCE] },

	/* — Graines — */
	{ any: ['chia'], never: ['pain'], reperes: [C_S_SAME] },
	{ any: ['lin'], never: ['huile', 'pain'], reperes: [C_S_LIN] },
	{ phrases: ['graines de courge', 'graine de courge', 'pépites de courge'], reperes: [C_S_COUCOURGE] },
	{ any: ['tournesol'], never: ['huile', 'pain'], reperes: [C_S_COUCOURGE] },
	{ any: ['sésame'], never: ['huile', 'pain'], reperes: [C_S_SESAME] },
	{ phrases: ['noix de coco râpée', 'coco râpée', 'noix de coco rapée'], never: ['huile', 'lait', 'crème'], reperes: [C_S_COCO_RAPEE] },

	{ any: ['olive'], never: ['huile', 'tapenade', 'pate'], reperes: [OLIVE] },
	{ any: ['cornichon'], reperes: [CORNICHON] },

	/* — Purées d'oléagineux / tartinables (AVANT oléagineux :
	     « purée d'amande » → c. à soupe, pas 1 amande) — */
	{ phrases: ['beurre de cacahuète', 'beurre de cacahuètes'], never: ['huile'], reperes: [C_A_SOUPLE] },
	{ any: ['houmous', 'hummus'], reperes: [C_A_SOUPLE] },
	{ any: ['pesto'], reperes: [C_A_SOUPLE] },
	{ any: ['confiture'], never: ['sans'], reperes: [C_S_CONFITURE] },
	{ phrases: ['pâte à tartiner', 'pâtes à tartiner'], any: ['tartiner', 'nutella'], never: ['poudre'], reperes: [C_A_SOUPLE] },
	{ phrases: ["purée d'amande", "purées d'amande", 'puree amande'], never: ['terre'], reperes: [C_A_SOUPLE] },
	{ phrases: ['purée de noisette', 'purées de noisette', 'puree noisette'], reperes: [C_A_SOUPLE] },
	{ phrases: ['purée de cajou', 'purées de cajou', 'puree cajou'], reperes: [C_A_SOUPLE] },

	/* — Crèmes / produits cuisine — */
	{ phrases: ['crème fraîche', 'crème liquide', 'crème de coco'], any: ['crème'], never: ['glacée'], reperes: [C_A_SOUPLE] },

	/* — Glaces : 1 boule ≈ 50 g, uniquement si clairement une glace
	     servie en boules (avant les oléagineux : « noix de coco »…). — */
	{
		any: ['glace', 'sorbet', 'sorbé'],
		phrases: ['crème glacée', 'crèmes glacées'],
		never: ['pièce', 'bâtonnet', 'cornet', 'sandwich', 'sirop', 'au vin', 'jacques'],
		reperes: [BOULE_GLACE],
	},

	/* — Oléagineux (APRÈS purées / tartinables) — */
	{ any: ['cajou'], never: ['purée'], reperes: [NOIX_CAJOU] },
	{ any: ['macadamia'], reperes: [NOIX_MACADAMIA] },
	{ phrases: ['noix du Brésil'], any: ['brésil'], reperes: [NOIX_BRESIL] },
	{ any: ['noix'], never: ['cajou', 'coco', 'muscade', 'brésil', 'macadamia', 'jacques', 'purée', 'beurre', 'tablette'], reperes: [CERNEAU] },
	{ any: ['amande'], never: ['terre', 'lait', 'poudre', 'purée', 'tablette'], reperes: [AMANDE] },
	{ any: ['noisette'], never: ['lait', 'poudre', 'purée', 'tartiner', 'chocolat', 'tablette'], reperes: [NOISETTE] },
	{ any: ['pistache'], never: ['poudre', 'purée', 'tablette'], reperes: [PISTACHE] },
	{ any: ['cacahuète'], never: ['beurre', 'poudre', 'purée', 'huile', 'tablette'], reperes: [CACAHUETE] },

	/* — Riz / pâtes / quinoa / semoule / boulgour : repère cuillère
	     SEULEMENT si l'état cru/cuit est indiqué — */
	{ state: 'cooked', any: ['riz'], never: ['galette', 'lait'], reperes: [C_A_SOUPLE] },
	{ state: 'dry', any: ['riz'], never: ['galette', 'lait'], reperes: [C_S_RIZ_CRU] },
	{ state: 'cooked', any: ['pâtes'], never: ['farcies', 'ravioli', 'tortellini', 'cannelloni'], reperes: [C_A_SOUPLE] },
	{ state: 'dry', any: ['pâtes'], never: ['farcies', 'ravioli', 'tortellini', 'cannelloni'], reperes: [C_S_PATES_CRU] },
	{ state: 'cooked', any: ['spaghetti', 'penne', 'macaroni', 'fusilli', 'coquillettes', 'tagliatelles', 'rigatoni', 'nouilles'], never: ['farcies', 'ravioli', 'tortellini', 'cannelloni'], reperes: [C_A_SOUPLE] },
	{ state: 'dry', any: ['spaghetti', 'penne', 'macaroni', 'fusilli', 'coquillettes', 'tagliatelles', 'rigatoni', 'nouilles'], never: ['farcies', 'ravioli', 'tortellini', 'cannelloni'], reperes: [C_S_PATES_CRU] },
	{ state: 'cooked', any: ['quinoa'], never: ['lait'], reperes: [C_A_SOUPLE] },
	{ state: 'dry', any: ['quinoa'], never: ['lait'], reperes: [C_S_RIZ_CRU] },
	{ state: 'cooked', any: ['semoule', 'couscous'], reperes: [C_S_CUISONNEE] },
	{ state: 'dry', any: ['semoule', 'couscous'], reperes: [C_S_RIZ_CRU] },
	{ state: 'cooked', any: ['boulgour'], never: ['lait'], reperes: [C_A_SOUPLE] },
	{ state: 'dry', any: ['boulgour'], never: ['lait'], reperes: [C_S_RIZ_CRU] },
	{ state: 'cooked', any: ['orge', 'épeautre', 'millet'], never: ['café', 'boisson'], reperes: [C_A_SOUPLE] },
	{ state: 'dry', any: ['orge', 'épeautre', 'millet'], never: ['café', 'boisson'], reperes: [C_S_RIZ_CRU] },

	/* — Légumineuses : même logique cru/cuit — */
	{ state: 'cooked', any: ['lentille'], never: ['cacao'], reperes: [C_A_SOUPLE] },
	{ state: 'dry', any: ['lentille'], never: ['cacao'], reperes: [C_S_RIZ_CRU] },
	{ state: 'cooked', phrases: ['pois chiche', 'pois chiches'], never: ['farine'], reperes: [C_A_SOUPLE] },
	{ state: 'dry', phrases: ['pois chiche', 'pois chiches'], never: ['farine'], reperes: [C_S_RIZ_CRU] },
	{ state: 'cooked', any: ['haricot'], never: ['vert', 'verts'], reperes: [C_A_SOUPLE] },
	{ state: 'dry', any: ['haricot'], never: ['vert', 'verts'], reperes: [C_S_RIZ_CRU] },
	{ state: 'cooked', phrases: ['pois cassé', 'pois cassés'], reperes: [C_A_SOUPLE] },
	{ state: 'dry', phrases: ['pois cassé', 'pois cassés'], reperes: [C_S_RIZ_CRU] },
	{ state: 'cooked', any: ['flageolet'], reperes: [C_A_SOUPLE] },
	{ state: 'dry', any: ['flageolet'], reperes: [C_S_RIZ_CRU] },
	{ state: 'cooked', any: ['fève'], never: ['cacao'], reperes: [C_A_SOUPLE] },
	{ state: 'dry', any: ['fève'], never: ['cacao'], reperes: [C_S_RIZ_CRU] },
	{ state: 'cooked', any: ['mungo', 'soja'], reperes: [C_A_SOUPLE] },
	{ state: 'dry', any: ['mungo', 'soja'], reperes: [C_S_RIZ_CRU] },

	/* — Céréales / flocons — */
	{ any: ['flocon'], never: ['lait'], reperes: [C_S_FLOCONS] },
	{ phrases: ["son d'avoine"], any: ['son'], never: ['flocon'], reperes: [C_S_FLOCONS] },
	{ phrases: ['son de blé'], any: ['son'], never: ['flocon', 'avoine'], reperes: [C_S_FLOCONS] },
	{ any: ['muesli'], never: ['lait'], reperes: [C_S_MUESLI] },
	{ any: ['granola'], never: ['lait', 'barre'], reperes: [C_S_MUESLI] },
	{ state: 'cooked', any: ['polenta'], reperes: [C_S_POLANTA_CUITE] },
	{ state: 'dry', any: ['polenta'], reperes: [C_S_RIZ_CRU] },

	/* — Boulangerie / produits à l'unité — */
	{ any: ['pita'], never: ['chips'], reperes: [PITA] },
	{ any: ['bagel'], never: ['chips'], reperes: [BAGEL] },
	{ any: ['tortilla', 'wrap'], never: ['chips'], reperes: [PIECE] },
	{ phrases: ['muffin anglais', 'muffins anglais'], reperes: [PIECE] },
	{ any: ['biscotte'], reperes: [BISCOTTE] },
	{ any: ['cracker'], never: ['au fromage'], reperes: [CRACKER] },
	{ any: ['wasa', 'knäckebröd'], reperes: [TRANCHE_WASA] },
	{ any: ['crêpe'], never: ['galette'], reperes: [CREPE] },
	{ any: ['pancake'], reperes: [PANCAKE] },
	{ any: ['gaufre'], reperes: [GAUFRE] },

	/* — Fromages (formats variables : pas de poids générique « fromage ») —
	     NB : le fromage BLANC générique est géré plus haut (pot + c. à soupe). — */
	{ phrases: ['fromage blanc individuel', 'fromages blancs individuels', 'fromage blanc individuels'], reperes: [POT_FB_INDIV, C_A_SOUPLE] },
	{ phrases: ['mini mozzarella', 'minis mozzarellas', 'mozzarella mini'], reperes: [BOULE_MINI_MOZZA] },
	{ any: ['mozzarella'], never: ['mini'], reperes: [BOULE_MOZZA] },
	{ phrases: ['portion individuelle', 'portions individuelles'], never: ['tranche'], reperes: [PORTION_FROMAGE] },
	{ phrases: ['parmesan râpé'], any: ['parmesan'], never: ['copeaux'], reperes: [C_S_FARINE] },

	/* — Viandes / poissons à l'unité — */
	{ phrases: ['escalope de poulet', 'escalope de dinde', 'escalope de veau', 'escalope de porc', 'escalopes de poulet', 'escalopes de dinde'], any: ['escalope'], never: ['milanaise', 'cordon'], reperes: [ESCALOPE] },
	{ phrases: ['filet de poulet', 'filets de poulet', 'filet de dinde', 'filets de dinde', 'filet de volaille'], never: ['fumé', 'tranche'], reperes: [FILET] },
	{ phrases: ['pavé de saumon', 'pavés de saumon'], reperes: [PAVE_SAUMON] },
	{ phrases: ['pavé de thon', 'pavés de thon', 'steak de thon', 'steaks de thon'], never: ['conserve'], reperes: [PAVE_SAUMON] },
	{ phrases: ['filet de poisson blanc', 'filet de colin', 'filet de cabillaud', 'filet de merlu', 'filet de tilapia', 'filet de lieu', 'filet de lieue', 'filet de poisson', 'filets de poisson'], never: ['fumé', 'tranche'], reperes: [FILET_POISSON] },
	{ any: ['chipolata'], reperes: [PIECE_CHIPOLATA] },
	{ any: ['merguez'], reperes: [PIECE_MERGUEZ] },
	{ phrases: ['saucisse de toulouse', 'saucisse de francfort', 'saucisse de strasbourg', 'saucisse de morteau', 'saucisse de montbéliard'], any: ['saucisse'], never: ['chipolata'], reperes: [PIECE_SAUCISSE] },
	{ any: ['saucisson'], reperes: [TRANCHE_SAUCISSON] },
	{ phrases: ['saumon fumé', 'saumon fumés', 'truite fumée'], never: ['pavé'], reperes: [TRANCHE_SAUMON_FUME] },
	{ any: ['bacon'], never: ['dés', 'poudre'], reperes: [TRANCHE_BACON] },
	{ any: ['surimi'], never: ['dés'], reperes: [SURIMI] },
	{ phrases: ['bâtonnet de poisson', 'bâtonnets de poisson', 'bâtonnet de cabillaud'], never: ['surimi'], reperes: [BATONNET_POISSON] },

	/* — Aliments pratiques à l'unité — */
	{ phrases: ['boulette de viande', 'boulettes de viande'], any: ['boulette'], reperes: [BOULETTE] },
	{ any: ['falafel'], reperes: [FALAFEL] },
	{ any: ['nugget'], reperes: [NUGGET] },

	/* — Chocolat (tablette uniquement : jamais poudres / pâtes /
	     desserts chocolatés, barres) — */
	{ head: ['chocolat'], never: ['poudre', 'pâte', 'mousse', 'glace', 'boisson', 'crème', 'chaud', 'tartiner', 'granulé', 'barre'], reperes: [CARRE_CHOCO] },
	{ custom: looksLikeChocolateTablet, never: ['poudre', 'tartiner', 'barre'], reperes: [CARRE_CHOCO] },
	{ phrases: ['tablette chocolat', 'tablette de chocolat', 'tablette chocolat noir', 'tablette chocolat au lait', 'tablette chocolat blanc', 'tablette chocolat aux noisettes', 'tablette de chocolat noir', 'tablette de chocolat au lait', 'tablette de chocolat blanc', 'tablette de chocolat aux noisettes', 'tablettes de chocolat'], never: ['poudre', 'tartiner'], reperes: [CARRE_CHOCO] },

	/* — Matières grasses solides — */
	{ any: ['beurre'], never: ['cacahuète', 'cacao', 'karité', 'amande', 'noisette', 'cajou', 'tartiner'], reperes: [PORTION_BEURRE] },
	{ any: ['margarine'], never: ['poudre'], reperes: [PORTION_BEURRE] },

	/* — Tranches (après les règles plus spécifiques) — */
	{ all: ['fromage', 'tranche'], reperes: [TRANCHE] },
	{
		any: ['serrano', 'parma', 'parme', 'prosciutto', 'bayonne', 'kintoa'],
		phrases: ['jambon cru', 'jambon sec', 'pata negra'],
		reperes: [TRANCHE],
	},
	{ any: ['jambon'], reperes: [TRANCHE_BLANC] },
	{ phrases: ['blanc de poulet', 'blanc de dinde', 'blanc de volaille'], reperes: [TRANCHE_BLANC] },

	/* — Pain / baguette — */
	{ any: ['baguette'], reperes: [QUART_BAGUETTE, DEMI_BAGUETTE] },
	{ any: ['pain'], never: ['chocolat'], reperes: [TRANCHE] },

	/* — Cuillères (liquides et sauces) — */
	{ any: ['vinaigre'], reperes: [ML_SOUPLE] },
	{ phrases: ['jus de citron', 'jus de citron vert', 'jus de lime'], never: ['sirop'], reperes: [ML_CAFE, ML_SOUPLE] },
	{ phrases: ["sirop d'érable", 'sirop érable', "sirop d'agave", 'sirop agave'], never: ['verre'], reperes: [C_A_CAFE, C_A_SOUPLE] },
	{ any: ['huile'], reperes: [C_A_CAFE, C_A_SOUPLE] },
	{ any: ['miel'], reperes: [C_A_CAFE, C_A_SOUPLE] },
	{ any: ['sauce', 'ketchup', 'mayonnaise', 'moutarde', 'tapenade'], reperes: [C_A_CAFE, C_A_SOUPLE] },

	/* — Boissons — */
	{
		any: ['boisson', 'soda', 'cola', 'coca', 'limonade', 'sirop', 'jus', 'lait', 'thé', 'tea', 'eau'],
		// « laitue » n'est pas du lait, « poudre » / « riz » ≠ boisson liquide ;
		// « sirop d'érable / d'agave » → règle cuillères (au-dessus).
		never: ['poudre', 'laitue', 'riz'],
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

/** True si les mots consécutifs de `phrase` apparaissent dans les tokens du nom. */
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
	const k = normalize(kw);
	if (toks.includes(k)) return true;
	if (toks.includes(k + 's') || toks.includes(k + 'x')) return true;
	return k.length >= 4 && toks.some((t) => t.length > k.length && t.startsWith(k));
}

/* ————— État CRU / SEC vs CUIT dans le nom ————— */

const DRY_HINTS = ['cru', 'crue', 'crus', 'crues', 'sec', 'seche', 'secs', 'seches'];
const COOKED_HINTS = [
	'cuit', 'cuite', 'cuits', 'cuites',
	'bouilli', 'bouillie', 'bouillis', 'bouillies',
	'egoutte', 'egouttee', 'egouttees', 'egouttes',
	'precuit', 'precuite',
];

/** 'cooked' | 'dry' si le nom précise l'état, sinon null (on ne devine pas). */
function stateOf(name: string): 'cooked' | 'dry' | null {
	const toks = tokenize(name);
	if (COOKED_HINTS.some((h) => toks.includes(h)) || hasPhrase(toks, 'à l’eau')) return 'cooked';
	if (DRY_HINTS.some((h) => toks.includes(h))) return 'dry';
	return null;
}

/**
 * Repères G-FLUX applicables à un produit (nom tel qu'affiché).
 * Retourne une liste vide si aucun repère fiable ne correspond — on
 * n'invente rien, la feuille masquera simplement l'onglet.
 */
export function reperesForFood(name: string): readonly GFluxRepere[] {
	const toks = tokenize(name);
	if (toks.length === 0) return [];
	const st = stateOf(name);
	for (const rule of RULES) {
		if (rule.never?.some((w) => toks.includes(normalize(w)))) continue;
		if (rule.head && !rule.head.includes(toks[0] ?? '')) continue;
		const triggered =
			rule.custom?.(name) ||
			rule.phrases?.some((p) => hasPhrase(toks, p)) ||
			rule.any?.some((w) => matchWord(toks, w)) ||
			(!!rule.all?.length && rule.all.every((w) => matchWord(toks, w)));
		// Règle à head seul (ex. sucre) : le 1er mot EST le déclencheur.
		const headOnly = Boolean(rule.head) && !rule.phrases && !rule.any && !rule.all;
		if (!triggered && !headOnly) continue;
		// État cru/sec vs cuit requis : seulement si le nom le confirme.
		if (rule.state && st !== rule.state) continue;
		return rule.reperes;
	}
	return [];
}
