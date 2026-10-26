/**
 * ÉTAT CUIT PAR DÉFAUT — REPAS IA uniquement (jamais la recherche générale).
 *
 * Sur une photo d'assiette, un féculent visible est quasi toujours SERVI CUIT
 * (personne ne photographie du riz cru dans son plat). Or les bases Ciqual/OFF
 * portent souvent les DEUX variantes (« Riz blanc, cru » 350 kcal vs « Riz
 * blanc, cuit » 155 kcal /100 g) : à libellé équivalent, le matching pouvait
 * associer l'assiette à la fiche CRUE et doubler les calories du Journal.
 *
 * Règle produit (constatée ici, testée dans tests/mission3.test.mjs) :
 *  - la RECHERCHE du matcher repas part de « <nom> cuit » pour les féculents ;
 *  - le classement BONUSSE la variante cuite (+0,10) et PÉNALISE la crue
 *    (−0,12) — uniquement quand la règle s'applique ;
 *  - une mention explicite « cru » / « sec » dans l'ingrédient (l'IA l'écrit
 *    quand la photo montre un aliment sec) neutralise tout : aucune réécriture.
 *
 * Ce module ne touche JAMAIS à la recherche alimentaire générale
 * (foodRanking / journal) : il est importé uniquement par le matching repas
 * (src/convex/mealMatch.ts) et le prompt Repas IA (MEAL_PROMPT).
 */

/** Bases de féculents concernées (tokens normalisés, cf. normalizeToken). */
const COOKED_BASES = new Set([
	'riz',
	'pate', // « pâtes » → 'pate' (règle pluriel)
	'pates',
	'semoule',
	'quinoa',
	'boulgour',
	'couscous',
	'nouille', // « nouilles » → 'nouille'
	'nouilles',
]);

/** Tokens qui signalent un aliment volontairement CRU / SEC : règle neutralisée. */
const RAW_MARKERS = new Set(['cru', 'crue', 'crus', 'crues', 'sec', 'seche', 'secs', 'seches']);

/** Tokens Ciqual/OFF qui signalent une fiche déjà CUITE (bonus). */
export const COOKED_MODE_TOKENS = new Set([
	'cuit',
	'cuite',
	'cuits',
	'cuites',
	'bouilli',
	'bouillie',
	'vapeur',
	'grille',
	'grillee',
	'roti',
	'rotie',
	'poelee',
	'etuve',
	'etuvee',
]);

/** Normalisation identique au matching repas (accents, pluriels, mots ≥ 3). */
function normalizeToken(s: string): string[] {
	return s
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		// Apostrophes droites et typographiques : séparateurs de mots
		// (« d’avoine » → « d » + « avoine », jamais « davoine »).
		.replace(/['\u2019]/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.split(' ')
		.filter((w) => w.length >= 3)
		.map((w) => (w.length >= 5 && w.endsWith('s') ? w.slice(0, -1) : w));
}

/**
 * L'ingrédient d'une photo de repas doit-il être recherché « cuit » ?
 * Retourne le terme de recherche enrichi (« Riz basmati cuit »), ou null si la
 * règle ne s'applique pas (ni féculent, ou cru/sec explicite).
 */
export function preferCookedForMeal(ingredientName: string): string | null {
	const name = (ingredientName ?? '').trim();
	if (name.length < 3) return null;
	const toks = normalizeToken(name);
	if (toks.length === 0) return null;
	if (!toks.some((w) => COOKED_BASES.has(w))) return null;
	// « Riz cru », « pâtes sèches »… : la photo/contexte dit déjà l'état.
	if (toks.some((w) => RAW_MARKERS.has(w))) return null;
	return `${name} cuit`;
}

/**
 * Ajustement de score d'un candidat (fiche Convex/Ciqual) quand la règle
 * « cuit par défaut » est active : +0,10 si la fiche est cuite, −0,12 si elle
 * est crue/sèche, 0 sinon (ou si la règle ne s'applique pas).
 */
export function cookedBonusFor(candidateName: string, wantCooked: boolean): number {
	if (!wantCooked) return 0;
	const toks = normalizeToken(candidateName);
	const isRaw = toks.some((w) => RAW_MARKERS.has(w));
	const isCooked = toks.some((w) => COOKED_MODE_TOKENS.has(w));
	if (isRaw) return -0.12;
	if (isCooked) return 0.1;
	return 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ÉTAT DE CUISSON PARTAGÉ — SOURCE UNIQUE (Mission R1-bis)
 *
 * Le classement de la recherche Ciqual (convex/ciqual.ts) et le badge affiché
 * sur les cartes Ciqual lisent le MÊME état, calculé ici et nulle part ailleurs.
 *
 * Détection : sur le nom Ciqual après normalisation (accents retirés,
 * minuscules, ponctuation → espace ; les formes féminines et plurielles sont
 * énumérées), mais JAMAIS sur le premier segment du libellé — celui qui précède
 * la première virgule nomme l'aliment (« Frites de pommes de terre, … »,
 * « Rôti de porc, … ») et son vocabulaire n'est pas un mode de cuisson
 * (Mission R1-quater). Un nom sans virgule n'a pas de queue : seul son premier
 * mot est neutralisé, le reste décrit l'état (« Oeuf cru » → « Cru »). Quand
 * plusieurs mentions de cuisson coexistent, la DERNIÈRE du nom gagne :
 * « Pomme de terre, rôtie/cuite au four » → « Au four ».
 *
 * Mentions de PRÉPARATION (« pour cuisson au four », « à cuire », « à poêler »,
 * « à réchauffer ») : elles décrivent un produit PAS ENCORE cuit. Elles ne
 * déclenchent donc jamais le badge du mode cité, mais l'état « À cuire »
 * (Mission R1-quater) : « Frites …, préfrites, pour cuisson au four » →
 * « À cuire ».
 *
 * Badge (une seule couleur neutre côté UI, quel que soit l'état) :
 *   cru → « Cru » · à cuire → « À cuire » · cuit à l'eau/bouilli → « Cuit à
 *   l'eau » · vapeur → « Vapeur » · au four/rôti → « Au four » · poêlé/sauté →
 *   « Poêlé » · grillé → « Grillé » · frit → « Frit » · appertisé/en conserve
 *   → « En conserve » · « cuit » seul → « Cuit » · aucune mention → aucun badge.
 *
 * Ordre de cuisson à l'intérieur d'une variété (Mission R1-bis) : cru →
 * cuit à l'eau/bouilli → vapeur → four → poêlé/sauté → frit ; puis les états
 * de conservation (appertisé), enfin « cuit » générique (trop vague pour
 * primer) et les fiches sans mention. « À cuire » se range avec « cru »
 * (produit pas encore cuit, Mission R1-quater).
 * ═══════════════════════════════════════════════════════════════════════════ */

export type CookingState =
	| 'cru'
	| 'acuire'
	| 'eau'
	| 'vapeur'
	| 'four'
	| 'grille'
	| 'poele'
	| 'frit'
	| 'conserve'
	| 'cuit'
	| 'neutre';

/** Les 11 valeurs de `CookingState` (source unique pour validation + formulaire). */
export const COOKING_STATE_VALUES: readonly CookingState[] = [
	'cru',
	'acuire',
	'eau',
	'vapeur',
	'four',
	'grille',
	'poele',
	'frit',
	'conserve',
	'cuit',
	'neutre',
];

/** Une valeur saisie est-elle un `CookingState` valide ? (validation serveur). */
export function isCookingState(value: unknown): value is CookingState {
	return typeof value === 'string' && (COOKING_STATE_VALUES as readonly string[]).includes(value);
}

/** Vocabulaire reconnu (tokens normalisés : accents retirés, minuscules). */
const COOKING_TOKENS: Record<string, CookingState> = {
	cru: 'cru', crue: 'cru', crus: 'cru', crues: 'cru',
	cuit: 'cuit', cuite: 'cuit', cuits: 'cuit', cuites: 'cuit',
	bouilli: 'eau', bouillie: 'eau', bouillis: 'eau', bouillies: 'eau',
	vapeur: 'vapeur',
	four: 'four', roti: 'four', rotie: 'four', rotis: 'four', roties: 'four',
	poele: 'poele', poelee: 'poele', poeles: 'poele', poelees: 'poele',
	saute: 'poele', sautee: 'poele', sautes: 'poele', sautees: 'poele',
	grille: 'grille', grillee: 'grille', grilles: 'grille', grillees: 'grille',
	frit: 'frit', frite: 'frit', frits: 'frit', frites: 'frit',
	appertise: 'conserve', appertisee: 'conserve', appertises: 'conserve', appertisees: 'conserve',
	conserve: 'conserve', conserves: 'conserve',
};

/** Rang de cuisson (ordre produit Mission R1-bis), partagé classement + UI. */
export function cookingRank(s: CookingState): number {
	switch (s) {
		case 'cru': return 0;
		case 'acuire': return 0; // produit pas encore cuit : rang du « cru »
		case 'eau': return 1;
		case 'vapeur': return 2;
		case 'four': return 3;
		case 'grille': return 4;
		case 'poele': return 5;
		case 'frit': return 6;
		case 'conserve': return 7;
		case 'cuit': return 8;
		default: return 9; // neutre : aucune mention
	}
}

/** Libellé du badge de cuisson (null = aucun badge). */
export function cookingBadge(s: CookingState): string | null {
	switch (s) {
		case 'cru': return 'Cru';
		case 'acuire': return 'À cuire';
		case 'eau': return "Cuit à l'eau";
		case 'vapeur': return 'Vapeur';
		case 'four': return 'Au four';
		case 'grille': return 'Grillé';
		case 'poele': return 'Poêlé';
		case 'frit': return 'Frit';
		case 'conserve': return 'En conserve';
		case 'cuit': return 'Cuit';
		default: return null;
	}
}

/**
 * Famille de cuisson : « cuit » seul couvre bouilli/cuit à l'eau (règle R1),
 * donc une recherche « cuit » accepte aussi une fiche « cuit à l'eau ».
 */
export function cookingFamily(s: CookingState): CookingState {
	return s === 'cuit' ? 'eau' : s;
}

/** Texte normalisé pour la détection (accents, casse, ponctuation). */
function cookingText(s: string): string {
	return s
		.replace(/œ/g, 'oe')
		.replace(/Œ/g, 'oe')
		.replace(/æ/g, 'ae')
		.replace(/Æ/g, 'ae')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		// Apostrophes droites et typographiques : séparateurs de mots
		// (« d’avoine » → « d » + « avoine », jamais « davoine »).
		.replace(/['\u2019]/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Mentions de cuisson d'un nom, dans l'ordre du nom. Les mentions de
 * PRÉPARATION (« pour cuisson au four », « à cuire », « à poêler », « à
 * réchauffer ») sont reconnues EN PREMIER et consomment le mode qu'elles
 * citent, pour qu'il ne devienne jamais un badge de cuisson. Puis les formes
 * composées (« cuit à l'eau », « au four », « en conserve ») avant leurs mots
 * isolés, pour que la dernière mention soit la bonne.
 */
const COOKING_MENTION = /\b(?:pour\s+cuisson(?:\s+(?:au|en|a\s+la|a\s+l|a|sur)\s+[a-z]+)?|a\s+(?:cuire|poeler|rechauffer)|cuit(?:e|s|es)?\s+a\s+l\s+eau|bouilli(?:e|s|es)?\s+a\s+l\s+eau|bouilli(?:e|s|es)?|cuit(?:e|s|es)?|cru(?:e|s|es)?|vapeur|au\s+four|four|roti(?:e|s|es)?|poele(?:e|s|es)?|saute(?:e|s|es)?|grille(?:e|s|es)?|frit(?:e|s|es)?|en\s+conserve|conserve(?:s)?|appertise(?:e|s|es)?)\b/g;

function classifyMention(m: string): CookingState {
	// Produit à préparer : « pour cuisson au four », « à cuire », « à poêler »…
	if (m.startsWith('pour') || m.startsWith('a ')) return 'acuire';
	if (m.startsWith('cuit') || m.startsWith('bouilli')) {
		return m.includes('eau') || m.startsWith('bouilli') ? 'eau' : 'cuit';
	}
	if (m.startsWith('cru')) return 'cru';
	if (m.startsWith('vapeur')) return 'vapeur';
	if (m.includes('four') || m.startsWith('roti')) return 'four';
	if (m.startsWith('poele') || m.startsWith('saute')) return 'poele';
	if (m.startsWith('grille')) return 'grille';
	if (m.startsWith('frit')) return 'frit';
	if (m.includes('conserve') || m.startsWith('appertise')) return 'conserve';
	return 'neutre';
}

/**
 * Nom privé de son PREMIER SEGMENT (Mission R1-quater) : « Frites de pommes
 * de terre, surgelées, préfrites, pour cuisson au four » → « surgelées,
 * préfrites, pour cuisson au four ». Le premier segment nomme l'aliment, son
 * vocabulaire n'est jamais un mode de cuisson. Un nom sans virgule n'a pas de
 * queue : seul son premier mot est neutralisé (« Oeuf cru » garde « cru »).
 */
function cookingDetailText(name: string): string {
	const comma = name.indexOf(',');
	if (comma !== -1) return name.slice(comma + 1);
	const text = cookingText(name);
	const i = text.indexOf(' ');
	return i === -1 ? '' : text.slice(i + 1);
}

/** État de cuisson d'un nom Ciqual (dernière mention du nom, « neutre » sinon). */
export function cookingStateOf(name: string): CookingState {
	const text = cookingText(cookingDetailText(name));
	let state: CookingState = 'neutre';
	for (const m of text.matchAll(COOKING_MENTION)) state = classifyMention(m[0]);
	return state;
}

/** Badge de cuisson d'un nom Ciqual (null = aucun badge). */
export function cookingBadgeOf(name: string): string | null {
	return cookingBadge(cookingStateOf(name));
}

/**
 * Précisions de PRÉPARATION retirées pour le regroupement par variété : elles
 * ne changent pas l'aliment (« sans peau », « préemballé », « surgelé »,
 * « appertisé », « égoutté », « sans sel ajouté », « préfrit »). Le badge de
 * cuisson, lui, reste calculé sur le nom complet (appertisé → « En conserve »).
 */
const PREP_MENTION = /\b(?:sans peau|sans sel ajoute(?:e|s|es)?|preemballe(?:e|s|es)?|surgele(?:e|s|es)?|prefrit(?:e|s|es)?|appertise(?:e|s|es)?|egoutte(?:e|s|es)?)\b/g;

/**
 * Variété d'un libellé Ciqual = nom normalisé SANS la mention de cuisson ni
 * les précisions de préparation (« Pâtes sèches, standard, cuites, sans sel
 * ajouté » → « pates seches standard »). Sert uniquement au regroupement.
 */
export function cookingVarietyOf(name: string): string {
	return cookingText(name)
		.replace(COOKING_MENTION, ' ')
		.replace(PREP_MENTION, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** État de cuisson d'un TOKEN normalisé (matching « tous les mots présents »). */
export function cookingStateOfToken(tok: string): CookingState | undefined {
	return COOKING_TOKENS[tok];
}
