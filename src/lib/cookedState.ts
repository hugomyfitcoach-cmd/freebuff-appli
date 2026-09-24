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
