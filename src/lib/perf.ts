/**
 * Types partagés de la vue semaine « Performance » (carte Accueil + page
 * Performance). Structure identique à la query Convex `journal.getWeek`.
 */
export type PerfDay = {
	date: string;
	/** False = aucune entrée consommée ce jour — jamais un zéro inventé. */
	tracked: boolean;
	totals: { kcal: number; carbs: number; protein: number; fat: number };
};
export type PerfGoals = {
	kcal: number;
	carbs: number;
	protein: number;
	fat: number;
	maintenanceKcal?: number;
	/** Phase effective de la fiche (absente = perte de gras). */
	phase?: string;
};
export type PerfWeek = {
	start: string;
	end: string;
	goals: PerfGoals;
	days: PerfDay[];
	/**
	 * Sport de la semaine (kcal) du calibrage à l'origine de l'objectif en
	 * vigueur — null quand l'objectif a été saisi à la main ou quand ce sport
	 * vaut 0 (note « maintenance inclut déjà ton sport habituel » masquée).
	 */
	sportHabituelKcal: number | null;
};

/* ───────── Note « Ta maintenance inclut déjà ton sport habituel… » ─────────
   Décision PURE de la note affichée sous le déficit de la semaine (écran
   Performance) : elle ne s'affiche QUE si l'objectif en vigueur vient d'un
   calibrage dont le sport de la semaine est strictement positif. L'origine se
   lit sur le dernier instantané `calibrageSnapshots` appliqué, apparié à la
   ligne d'historique en vigueur par la même clé que l'historique coach :
   (date d'effet, objectif appliqué) — le dernier instantané de la clé gagne. */

/** Ligne d'historique d'objectif (`clientGoalHistory`). */
export type LigneObjectifVigueur = {
	/** Objectif calorique en kcal. */
	kcal: number;
	/** Date d'effet "yyyy-mm-dd". */
	effectiveFrom: string;
	/** Horodatage — départage les lignes d'une même date d'effet. */
	createdAt?: number;
};

/** Instantané de calibrage appliqué, réduit aux champs de la décision. */
export type InstantaneCalibrageVigueur = {
	/** Date d'effet "yyyy-mm-dd" de l'objectif appliqué par le calibrage. */
	effectiveFrom: string;
	/** Horodatage de l'instantané — le dernier gagne pour une même clé. */
	createdAt: number;
	/** Objectif calorique réellement appliqué (results.applique.kcal). */
	kcalApplique: number | null;
	/** Sport de la semaine du calibrage (results.sportSemaineKcal, kcal). */
	sportSemaineKcal: number | null;
};

/**
 * Sport de la semaine (kcal) du calibrage à l'origine de l'objectif en
 * VIGUEUR, ou null si la note ne doit pas s'afficher :
 *  - aucun objectif daté en vigueur (objectif antérieur à l'historisation) →
 *    réputé saisi à la main, comme dans l'historique coach ;
 *  - la ligne en vigueur n'est appariée à aucun instantané (saisie manuelle) ;
 *  - le calibrage en vigueur a un sport de la semaine à 0.
 */
export function sportHabituelObjectifEnVigueur(
	history: LigneObjectifVigueur[],
	instantanes: InstantaneCalibrageVigueur[],
	todayISO: string
): number | null {
	/* Ligne en vigueur aujourd'hui : plus grande date d'effet ≤ aujourd'hui
	   (les ex æquo se départagent au plus récent). */
	let ligne: LigneObjectifVigueur | null = null;
	for (const row of history) {
		if (row.effectiveFrom <= todayISO) {
			if (
				!ligne ||
				row.effectiveFrom > ligne.effectiveFrom ||
				(row.effectiveFrom === ligne.effectiveFrom && (row.createdAt ?? 0) >= (ligne.createdAt ?? 0))
			) {
				ligne = row;
			}
		}
	}
	if (!ligne) return null;
	/* Instantané appliqué de même (date d'effet, objectif) — le dernier gagne. */
	let snap: InstantaneCalibrageVigueur | null = null;
	for (const s of instantanes) {
		if (s.effectiveFrom === ligne.effectiveFrom && s.kcalApplique === ligne.kcal) {
			if (!snap || s.createdAt >= snap.createdAt) snap = s;
		}
	}
	if (!snap) return null;
	const sport = snap.sportSemaineKcal;
	if (typeof sport !== 'number' || !Number.isFinite(sport) || sport <= 0) return null;
	return sport;
}

/** Texte exact de la note (Y = sport de la semaine du calibrage, kcal). */
export function noteMaintenanceSport(sportSemaineKcal: number): string {
	return `Ta maintenance inclut déjà ton sport habituel (environ ${sportSemaineKcal.toLocaleString('fr-FR')} kcal par semaine).`;
}
