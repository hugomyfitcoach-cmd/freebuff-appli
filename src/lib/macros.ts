/**
 * Macros — Aperçu compact de la carte « Calories » de l'Accueil.
 *
 * 100 % lecture : les données viennent de la SEMAINE DU JOURNAL déjà chargée
 * par l'Accueil (fetch existant /api/journal/week → query Convex existante
 * journal.getWeek) — jour courant = `totals`, objectifs = `goals`.
 * Aucune nouvelle source de vérité, aucun calcul nutritionnel : on affiche
 * exactement ce que le Journal affiche (mêmes totaux consommés, mêmes
 * objectifs coach).
 */

/** Ordre et codes couleur G-FLUX (identiques au Journal alimentaire). */
export const MACRO_DEFS = [
	{ key: 'carbs', label: 'Glucides', color: '#ec4899' },
	{ key: 'protein', label: 'Protéines', color: '#3b82f6' },
	{ key: 'fat', label: 'Lipides', color: '#f97316' },
] as const;

export type MacroKey = (typeof MACRO_DEFS)[number]['key'];

/** Macros consommées du jour (totaux Journal, un seul objet, jamais null). */
export type MacroTotals = { carbs: number; protein: number; fat: number };
/** Objectifs macros de la cliente (valeur absente = objectif non configuré). */
export type MacroGoals = { carbs?: number | null; protein?: number | null; fat?: number | null };

/** Format d'affichage : entier, espace fine insécable française (ex. « 1 024 »). */
export function fmtMacro(n: number): string {
	return Math.round(n).toLocaleString('fr-FR');
}

/**
 * Un indicateur du rangée de mini-rings, prêt à afficher.
 * `percent` n'est JAMAIS plafonné (le dépassement reste lisible) ;
 * c'est le rendu du ring qui borne visuellement son arc à 100 %.
 */
export type MacroRing = {
	key: MacroKey;
	label: string;
	color: string;
	/** Consommé (g), arrondi pour l'affichage. */
	eaten: number;
	/** Objectif (g) — null = objectif non configuré (affiché sans cible). */
	goal: number | null;
	/** eaten/goal en % (0 si pas d'objectif ou objectif ≤ 0) — jamais plafonné. */
	percent: number;
};

/** Construit les 3 mini-rings (Glucides | Protéines | Lipides) dans l'ordre du Journal. */
export function macroRings(totals: MacroTotals, goals: MacroGoals | null | undefined): MacroRing[] {
	return MACRO_DEFS.map((def) => {
		const eaten = Math.max(0, Math.round(totals[def.key] ?? 0));
		const raw = goals?.[def.key];
		const goal = typeof raw === 'number' && isFinite(raw) && raw > 0 ? Math.round(raw) : null;
		return {
			key: def.key,
			label: def.label,
			color: def.color,
			eaten,
			goal,
			percent: goal !== null ? (eaten / goal) * 100 : 0,
		};
	});
}

/** Trace de l'anneau SVG (rayon 10 — viewBox 24). */
export const MACRO_RING_CIRCUMFERENCE = 2 * Math.PI * 10;

/** Offset SVG pour un pourcentage quelconque : l'arc affiché est borné à 100 %. */
export function macroRingDashOffset(percent: number): number {
	const fill = Math.max(0, Math.min(100, percent));
	return MACRO_RING_CIRCUMFERENCE * (1 - fill / 100);
}

/**
 * État de la ligne macros (chargement async non bloquant, même pattern que
 * les cartes Performance / Dépense sportive de l'Accueil) :
 * - `loading`  : réponse pas encore là → squelette discret, rien d'inventé ;
 * - `ready`    : rings affichés (objectifs présents ou non) ;
 * - `unavailable` : fetch en erreur → la ligne disparaît, la carte reste celle d'avant.
 */
export type MacroLineState =
	| { kind: 'loading' }
	| { kind: 'ready'; rings: MacroRing[] }
	| { kind: 'unavailable' };
