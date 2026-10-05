/**
 * ALIMENTS FRÉQUENTS INTELLIGENTS — score personnel, simple et explicable.
 *
 * Module PUR (aucune dépendance Convex, aucun réseau) : partagé par la query
 * Convex (journal.freqFoods) et testable hors Convex (npm test) — même
 * discipline que src/lib/mealFusion.ts.
 *
 * FORMULE (par aliment, à partir de l'historique Journal de LA cliente) :
 *
 *   score = ln(1 + consommations)            ← fréquence (8× > 1×, toujours)
 *         + 0.5 × exp(-jours depuis dernier) ← récence (hier ≈ 0.46, ~0 loin)
 *         + bonus repas courant              ← contexte (céréales au petit-déj)
 *
 * - Aucun machine learning, aucune donnée externe : uniquement l'historique
 *   déjà en base (diaryEntries), lu côté serveur.
 * - L'IDENTITÉ EXACTE est conservée : la clé intègre la source
 *   (produit OFF importé / fiche perso / CIQUAL) + l'id stable — un produit
 *   emballé précis n'est JAMAIS remplacé par une fiche générique.
 * - Tie-break déterministe : count ↓, lastMs ↓, key ↑ (liste stable).
 */

/** Contexte du repas courant (mêmes valeurs que le Journal). */
export type MealKind = 'petit-dej' | 'dejeuner' | 'diner' | 'collation';

/** Entrée normalisée reçue du serveur (une consommation = une entrée). */
export type FreqEntry = {
	/** Identité stable : "f:<foodId>" (OFF importé) | "c:<customFoodId>" (perso) | "q:<ciqualLabel>" (CIQUAL). */
	key: string;
	/** Repas de la consommation (petit-dej / dejeuner / diner / collation). */
	meal?: string;
	/** Horodatage de l'entrée Journal (ms). */
	createdAtMs: number;
};

/** Bonus de contexte repas — petit et volontairement lisible.
 *  Petit-déj : céréales, fromage blanc, fruits, pain… Déjeuner/dîner : protéines, féculents, poissons…
 *  Collation : fruits, oléagineux, produits sucrés légers. */
export const MEAL_AFFINITIES: Record<MealKind, string[]> = {
	'petit-dej': [
		'cereales', 'granola', 'muesli', 'flocon', 'avoine', 'pain', 'brioche', 'conflaure',
		'corn', 'flake',
		'yaourt', 'fromage', 'blanc', 'lait', 'beurre', 'confiture', 'miel', 'nutella',
		'banane', 'pomme', 'fraise', 'fruit', 'jus', 'cafe', 'the', 'oeuf', 'pancakes', 'crepe',
	],
	dejeuner: [
		'poulet', 'riz', 'pate', 'quinoa', 'boulgour', 'dinde', 'boeuf', 'steak', 'poisson',
		'maquereau', 'saumon', 'thon', 'cabillaud', 'legume', 'courgette', 'brocoli', 'carotte',
		'salade', 'tomate', 'haricot', 'lentil', 'soup', 'potage', 'houmous', 'fromage',
	],
	diner: [
		'poisson', 'maquereau', 'saumon', 'thon', 'cabillaud', 'colin', 'soupe', 'potage',
		'legume', 'salade', 'courgette', 'poireau', 'veloute', 'omelette', 'oeuf', 'fromage',
		'yaourt', 'fromage', 'blanc', 'tofu', 'volaille', 'poulet', 'riz', 'pate',
	],
	collation: [
		'fruit', 'pomme', 'banane', 'amande', 'noix', 'cacahue', 'oleagine', 'yaourt',
		'fromage', 'blanc', 'skyr', 'barre', 'chocolat', 'compote', 'gateau', 'biscuit', 'smoothie',
	],
};

/** Poids explicables de la formule (un seul endroit, documenté). */
export const FREQ_WEIGHTS = {
	/** Fréquence : ln(1+count) — croissante mais amortie (10× ≈ 2.40, 1× ≈ 0.69). */
	frequency: 1,
	/** Récence : 0.5 × exp(-jours) — bonus doux qui s'efface en ~1 semaine. */
	recency: 0.5,
	/** Contexte repas : +0.35 si l'aliment colle au repas en cours. */
	mealBonus: 0.35,
	/** Demi-vie du bonus récence (jours). */
	recencyHalfLifeDays: 7,
} as const;

/** Tokenisation « significative » d'un nom (même esprit que foodText). */
function nameTokens(name: string): string[] {
	return name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.split(' ')
		.filter((w) => w.length >= 4)
		.map((w) => (w.length >= 5 && w.endsWith('s') ? w.slice(0, -1) : w));
}

/** Bonus de contexte : l'aliment colle-t-il au repas en cours ? */
export function mealAffinityBonus(name: string, meal: MealKind | undefined): number {
	if (!meal || !MEAL_AFFINITIES[meal]) return 0;
	const wanted = new Set(MEAL_AFFINITIES[meal]);
	return nameTokens(name).some((w) => wanted.has(w)) ? FREQ_WEIGHTS.mealBonus : 0;
}

/** Clé d'identité stable — préfixe source + id. Exporté pour cohérence
 *  serveur/client (jamais de collision f:/c:/q:). */
export function foodFrequencyKey(kind: 'food' | 'custom' | 'ciqual', id: string): string {
	const prefix = kind === 'food' ? 'f:' : kind === 'custom' ? 'c:' : 'q:';
	return `${prefix}${id}`;
}

/** Statistiques apprises pour UN aliment (retournées à l'appelant). */
export type FreqStats = { count: number; lastMs: number };

/** Score d'un aliment. nowMs injecté (pureté + tests déterministes). */
export function frequencyScore(
	name: string,
	stats: FreqStats,
	opts: { nowMs: number; currentMeal?: MealKind }
): number {
	const days = Math.max(0, (opts.nowMs - stats.lastMs) / 86_400_000);
	const recency = FREQ_WEIGHTS.recency * Math.exp(-days / FREQ_WEIGHTS.recencyHalfLifeDays);
	return FREQ_WEIGHTS.frequency * Math.log(1 + stats.count) + recency + mealAffinityBonus(name, opts.currentMeal);
}

/**
 * Classe les aliments du plus « habituel » au moins habituel.
 *
 * Entrée : les consommations normalisées + le NOM APPRIS par clé (le nom
 * sert au bonus repas ; il vient de l'entrée la plus récente). Sortie :
 * liste de clés ordonnées par score avec leurs stats — l'appelant résout
 * ensuite les identités (docs foods/customFoods/CIQUAL) dans son contexte.
 */
export function rankFrequentFoods(
	entries: FreqEntry[],
	namesByKey: Map<string, string>,
	opts: { nowMs: number; currentMeal?: MealKind }
): { key: string; score: number; stats: FreqStats }[] {
	const statsByKey = new Map<string, FreqStats>();
	for (const e of entries) {
		const s = statsByKey.get(e.key);
		if (!s) {
			statsByKey.set(e.key, { count: 1, lastMs: e.createdAtMs });
			continue;
		}
		s.count += 1;
		if (e.createdAtMs > s.lastMs) s.lastMs = e.createdAtMs;
	}
	const out: { key: string; score: number; stats: FreqStats }[] = [];
	for (const [key, stats] of statsByKey) {
		const name = namesByKey.get(key) ?? '';
		out.push({ key, stats, score: frequencyScore(name, stats, opts) });
	}
	out.sort((a, b) => b.score - a.score || b.stats.count - a.stats.count || b.stats.lastMs - a.stats.lastMs || a.key.localeCompare(b.key));
	return out;
}
