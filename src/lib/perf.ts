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
export type PerfGoals = { kcal: number; carbs: number; protein: number; fat: number; maintenanceKcal?: number };
export type PerfWeek = {
	start: string;
	end: string;
	goals: PerfGoals;
	days: PerfDay[];
};
