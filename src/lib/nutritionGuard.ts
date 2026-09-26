/**
 * Garde-fou kcal ↔ macros — produits Open Food Facts (OFF).
 *
 * Motivation : certaines fiches OFF portent des kcal incohérentes avec leurs
 * macros (faute de saisie, mauvaise unité…). Règle de correction, appliquée
 * UNIQUEMENT À LA LECTURE (recherche, scan, favoris, snapshot d'une entrée) :
 *
 *   kcal théoriques = protéines × 4 + glucides × 4 + lipides × 9  (/100 g)
 *
 * La valeur OFF n'est remplacée par la valeur théorique que si l'écart dépasse
 * À LA FOIS 25 % (relatif) ET 30 kcal / 100 g (absolu) — en dessous, l'écart
 * reste dans le bruit normal des bases nutritionnelles et on ne touche à rien.
 *
 * FAUX POSITIFS évités (le 4/4/9 naïf est trompeur pour ces familles) :
 * - fibres (2 kcal/g UE, hors « glucides ») : ajoutées au calcul quand la fiche
 *   les fournit — sinon psyllium, inuline, son… seraient « corrigés » à la baisse ;
 * - polyols (édulcorants 0–3 kcal/g, erythritol = 0) : comptés 2,4 kcal/g sous
 *   5 g/100 g ; au-delà, coefficient trop incertain → JAMAIS de recalcul auto ;
 * - alcool (7 kcal/g, absent du 4/4/9) : quand OFF fournit `alcohol_100g`
 *   (convention OFF : % vol), l'éthanol — source d'énergie dominante et précise
 *   — entre dans le calcul de cohérence ; sinon les boissons alcoolisées
 *   (reconnues au libellé) ne sont jamais recalculées automatiquement — les
 *   recettes culinaires (« sauce au vin »…) restent toutefois éligibles.
 *
 * La donnée OFF en base (`foods`) n'est JAMAIS modifiée : aucune écriture, aucune
 * migration ; les entrées déjà enregistrées ne sont jamais réécrites.
 *
 * Module PUR (aucune dépendance) : partagé par les fonctions Convex
 * (src/convex/*) et les composants Svelte (badge « Valeur recalculée »).
 */

export type GuardedNutrients = {
	kcal100: number;
	carbs100: number;
	protein100: number;
	fat100: number;
	/** Fibres /100 g (UE : ~2 kcal/g, hors « glucides ») — si OFF les fournit. */
	fiber100?: number;
	/** Polyols /100 g (édulcorants : 0–3 kcal/g, erythritol = 0) — si OFF les fournit. */
	polyols100?: number;
	/** Alcool /100 g — convention OFF : % vol (ex. vin 12,5). */
	alcohol100?: number;
};

/** Seuil relatif : l'écart doit dépasser 25 % des kcal OFF pour corriger. */
const KCAL_REL_GAP = 0.25;
/** Seuil absolu : l'écart doit dépasser 30 kcal / 100 g pour corriger. */
const KCAL_ABS_GAP = 30;

/** Petit util : garde les nombres finis strictement positifs, sinon 0. */
function pos(v: number | undefined): number {
	return typeof v === "number" && isFinite(v) && v > 0 ? v : 0;
}

/**
 * kcal théoriques /100 g déduites des macros.
 *
 * Base 4/4/9, affinée quand la fiche fournit les composés à coefficient
 * différent (sinon le 4/4/9 naïf crée de FAUX POSITIFS) :
 * - fibres : +2 kcal/g (règlement UE 1169/2011, comptées hors « glucides ») ;
 * - polyols : +2,4 kcal/g si < 5 g/100 g (au-delà, voir `kcalGuardExcluded`) ;
 * - alcool : +7 kcal/g — `alcohol100` suit la convention OFF (% vol), d'où la
 *   conversion ×0,789 g/mL (1° = ~0,789 g d'éthanol / 100 g).
 */
export function theoreticalKcal100(n: GuardedNutrients): number {
	let kcal = n.protein100 * 4 + n.carbs100 * 4 + n.fat100 * 9;
	const fiber = pos(n.fiber100);
	if (fiber > 0) kcal += fiber * 2;
	const polyols = pos(n.polyols100);
	if (polyols > 0 && polyols < 5) kcal += polyols * 2.4;
	const alcohol = pos(n.alcohol100);
	if (alcohol > 0) kcal += alcohol * 0.789 * 7;
	return kcal;
}

/**
 * Alcool exprimé en % vol dans le libellé (« Bière 5 % vol », « 12,5 % vol ») :
 * le pourcentage est une source d'énergie (7 kcal/g), pas un doute sur la fiche
 * — aucun recalcul automatique.
 */
const ALCOHOL_PCT_RE = /\d+(?:[.,]\d+)?\s*%\s*vol/i;

/**
 * Mots-clés « boisson alcoolisée / vinaigre » reconnus dans le libellé (quand
 * OFF ne fournit pas `alcohol_100g`) : glucides fermentés partis dans
 * l'éthanol (ou l'acide acétique ≈ 5 kcal/g des vinaigres) → le 4/4/9 ne
 * s'applique pas. Inclut les principales appellations/cépages (« Bordeaux »,
 * « Chablis », « Merlot »…) dont le libellé ne contient ni « vin » ni degré.
 * Les recettes (« Sauce au vin », « Poulet au cidre », « Biscuits apéritif »,
 * « Chips saveur bière »…) sont neutralisées par NON_ALCOHOL_WORDS, de même
 * que « sans alcool », « ginger beer »… Assemblée depuis une simple liste de
 * mots (aucun backslash échappé) et appliquée à un libellé normalisé — voir
 * `wordsToRegex`.
 */
const ALCOHOL_WORDS = [
	"vins?|wines?|beers?|ales?|bieres?|bi[eè]res?|cidres?|cider|poir[eé] bouch[eé]|hydromel",
	"champagne|cr[eé]mants?|cava|prosecco|porto|marsala|mad[eè]re|sangria|vermouth|martini|kir|spritz",
	"whisk(y|ie)s?|bourbons?|scotch|vodkas?|gins?|rums?|rhums?|tequilas?|me[zs]cals?|absinthe",
	"sakes?|mirin|mijiu|shaoxing|sojus?",
	"pastis|ricard|ouzo|arak|grappa|aperol|picon|suze|byrrh|dubonnet",
	"liqueurs?|chartreuse|cointreau|grand marnier|b[eé]n[eé]dictine",
	"kirsch|calvados|armagnac|cognac|pineau|ratafia|macvin|pommeau|eaux? de vie|vin cuit",
	"grog|punch|planter|mojito|margarita|cosmopolitan|daiquiri|negroni",
	"vinaigres?|vin aigre|vinagre|vinegars?|aceto|balsamique",
	"ap[eé]ritifs?|digestifs?|hard seltzer|boisson alcoolis[eé]e|alcools?",
	// appellations & cépages : libellés sans le mot « vin » ni degré
	"bordeaux|bourgognes?|beaujolais|chablis|m[ée]doc|sancerre|chianti|rioja",
	"chardonnay|merlot|cabernets?|gamay|grenache|syrah|sauvignons?|muscadets?|chenins?|muscat|pinots?|riesling|gewurztraminer|c[ôo]tes du rh[ôo]ne|ros[ée]",
];

/**
 * Neutralise la détection par mots quand elle désigne en réalité une RECETTE
 * (« Sauce au vin », « Poulet au cidre », « Moules à la bière », « Gâteau au
 * rhum », « Biscuits apéritif », « Chips saveur bière »…) : le mot alcool y
 * est un ingrédient et les kcal restent dominées par les macros — ces produits
 * DOIVENT rester éligibles au garde-fou. Marqueurs : terme culinaire, tournure
 * « au/aux/à la » (ingrédient), « saveur/goût/arôme/parfum », « sans alcool »,
 * « ginger beer/ale »…
 */
const NON_ALCOHOL_WORDS = [
	"sans alcool",
	"ginger beer|root beer|ginger ale",
	"sauces?|au|aux|a la|à la|in|with",
	"saveurs?|go[ûu]ts?|ar[ôo]mes?|parfums?",
	"biscuits?|crackers?|chips?|sachets?|bretzels?|pretzels?|tortillas?|gressins?",
	"poulet|porc|bœuf|boeuf|coq|moules?|canard|lapin|agneau|volaille|chevreuil|foie|carbonnade",
	"g[âa]teaux?|tartes?|babas?|confits?|terrines?|risotto|paella|marinades?|marin[ée]",
];

/**
 * Regex « mot isolé » sur un libellé normalisé (séparateurs → espaces).
 * On évite `\b`, silencieusement faux après les lettres accentuées
 * (« bouchée » : é n'est pas un caractère de mot en JS) — le padding par
 * espaces est sans ambiguïté. Le libellé est réduit à des mots simples :
 * apostrophes, traits d'union et ponctuation deviennent des séparateurs.
 */
function wordsToRegex(words: string[]): RegExp {
	return new RegExp(` (?:${words.join("|")}) `, "i");
}

/** Libellé normalisé pour la détection par mots : minuscules, séparateurs → espaces. */
function normalizedWords(name: string): string {
	return ` ${name.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim()} `;
}

const ALCOHOL_NAME_RE = wordsToRegex(ALCOHOL_WORDS);
const NON_ALCOHOL_NAME_RE = wordsToRegex(NON_ALCOHOL_WORDS);

/**
 * Édulcorants INTENSES (stévia, sucralose, aspartame, Pure Via, Canderel,
 * « édulcorant de table »…) : une fiche qui EST l'édulcorant porte des
 * macros ≈ nulles et des kcal de comprimé/poudre (tablette 0–50 kcal/100 g)
 * — le 4/4/9 y « recalcule » une valeur déjà sans objet. Jamais de recalcul
 * automatique pour ces produits QUAND LA FICHE EST L'ÉDULCORANT LUI-MÊME
 * (kcal100 ≤ 50) : un aliment réel qui cite l'édulcorant dans son nom
 * (« yaourt stévia », « boisson au sucralose ») reste éligible au garde-fou.
 * Le polyol érythritol est déjà couvert par la règle polyols ≥ 5 g/100 g.
 */
const SWEETENER_NAME_RE = wordsToRegex([
	// ⚠️ `normalizedWords` ne déaccentue pas (convention du module) : les
	// formes accentuées sont listées explicitement à côté des brutes.
	"edulcorants?",
	"édulcorants?",
	"stevias?",
	"stévias?",
	"rebaudiosides?",
	"sucraloses?",
	"aspartames?",
	"acesulfame",
	"saccharines?",
	"saccharin",
	"thaumatines?",
	"cyclamates?",
	"neotame",
	"advantame",
	// marques / noms commerciaux usuels
	"canderel",
	"pure via",
	"purevia",
	"tagatesse",
	"hermesetas",
	"natreen",
	"splenda",
]);

/**
 * Produits exclus du recalcul AUTOMATIQUE — le 4/4/9 ne peut pas recomposer
 * leurs kcal de façon fiable :
 * - polyols ≥ 5 g/100 g (coefficient réel entre 0 et 3 kcal/g : erythritol 0,
 *   maltitol 2,4… l'écart deviendrait une fausse correction) ;
 * - édulcorants intenses reconnus au libellé (stévia, sucralose, aspartame,
 *   Pure Via, Canderel…) quand la fiche est l'édulcorant lui-même
 *   (kcal100 ≤ 50) : macros ≈ nulles, le recalcul n'a pas d'objet ;
 * - boissons alcoolisées et vinaigres reconnus au libellé quand OFF ne fournit
 *   PAS `alcohol_100g` (glucides convertis en éthanol/acide, énergie
 *   introuvable sans le degré). Avec le champ alcool fourni, le calcul de
 *   cohérence inclut l'éthanol et tourne normalement (voir `theoreticalKcal100`).
 * Les fibres et petits polyols ne sont PAS une exclusion : ils entrent dans le
 * calcul (voir `theoreticalKcal100`).
 */
export function kcalGuardExcluded(n: GuardedNutrients & { name?: string }): boolean {
	if (pos(n.polyols100) >= 5) return true;
	const name = n.name?.trim();
	// Édulcorants intenses : uniquement la fiche édulcorant elle-même
	// (kcal de tablette ≤ 50/100 g) — jamais un aliment classique citant
	// l'édulcorant, qui reste corrigeable si ses macros contredisent ses kcal.
	if (name && n.kcal100 <= 50 && SWEETENER_NAME_RE.test(normalizedWords(name))) return true;
	if (name && pos(n.alcohol100) <= 0) {
		const norm = normalizedWords(name);
		if (!NON_ALCOHOL_NAME_RE.test(norm) && (ALCOHOL_NAME_RE.test(norm) || ALCOHOL_PCT_RE.test(name))) {
			return true;
		}
	}
	return false;
}

/**
 * L'écart kcal OFF ↔ macros justifie-t-il une correction (25 % ET 30 kcal) ?
 * `name` (optionnel) sert à repérer les produits où le 4/4/9 est trompeur
 * (boissons alcoolisées sans champ alcool OFF) : jamais recalculés.
 */
export function kcalNeedsRecalc(n: GuardedNutrients & { name?: string }): boolean {
	// Donnée absurde ou absente (0/négative/NaN) : on ne « corrige » jamais.
	if (!isFinite(n.kcal100) || n.kcal100 <= 0) return false;
	const theo = theoreticalKcal100(n);
	if (!isFinite(theo) || theo <= 0) return false;
	// Familles où le 4/4/9 est trompeur : aucune correction automatique.
	if (kcalGuardExcluded(n)) return false;
	const gap = Math.abs(theo - n.kcal100);
	return gap > KCAL_ABS_GAP && gap > n.kcal100 * KCAL_REL_GAP;
}

/** kcal à afficher/tracker : OFF si cohérentes, sinon théoriques (arrondies). */
export function guardedKcal100(n: GuardedNutrients & { name?: string }): number {
	return kcalNeedsRecalc(n) ? Math.round(theoreticalKcal100(n)) : n.kcal100;
}

/** Applique le garde-fou à une fiche (LECTURE) : kcal100 corrigées + flag d'affichage. */
export function applyKcalGuard<T extends GuardedNutrients & { name?: string }>(food: T): T & { kcalRecalculated: boolean } {
	return { ...food, kcal100: guardedKcal100(food), kcalRecalculated: kcalNeedsRecalc(food) };
}
