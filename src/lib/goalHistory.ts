/**
 * OBJECTIF CALORIQUE DATÉ — résolution depuis l'historique (module PUR).
 *
 * Règle métier : pour une date D, l'objectif applicable est celui de la
 * ligne d'historique avec la plus grande `effectiveFrom` ≤ D. Un changement
 * ne modifie JAMAIS rétroactivement les journées antérieures à sa date
 * d'effet (Europe/Paris).
 *
 * Pourquoi un module pur : la MÊME résolution sert au Journal (jour
 * consulté), à la Vision 360 (garde-fou 60 % par jour) et au CRM — une
 * seule définition, testable sans Convex, partagée client/serveur comme
 * vision360.ts / averages.ts.
 */

export type GoalHistoryRow = {
	/** Objectif calorique en kcal. */
	kcal: number;
	/** Date d'effet "yyyy-mm-dd" (première journée où cet objectif s'applique). */
	effectiveFrom: string;
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertISO(iso: string, label: string): void {
	if (!ISO_RE.test(iso)) throw new Error(`${label} doit être "yyyy-mm-dd" (reçu : ${iso}).`);
}

/** Comparateur : ordre chronologique sur effectiveFrom (les ex æquo gardent l'ordre d'arrivée). */
function byFrom(a: GoalHistoryRow, b: GoalHistoryRow): number {
	return a.effectiveFrom.localeCompare(b.effectiveFrom);
}

/**
 * Objectif calorique applicable à `dateISO` :
 *  - historique vide / date antérieure à la 1re ligne → `fallback`
 *    (l'objectif courant `clientGoals.kcal` — stratégie données antérieures :
 *    aucun faux historique inventé, l'objectif actuel est réputé avoir toujours
 *    été applicable jusqu'à la première modification horodatée) ;
 *  - sinon : la ligne de plus grande `effectiveFrom` ≤ dateISO.
 */
export function kcalGoalForDate(
	history: GoalHistoryRow[],
	dateISO: string,
	fallback: number
): number {
	assertISO(dateISO, 'dateISO');
	let best: GoalHistoryRow | null = null;
	for (const row of history) {
		assertISO(row.effectiveFrom, 'effectiveFrom');
		if (row.effectiveFrom <= dateISO) {
			if (!best || row.effectiveFrom >= best.effectiveFrom) best = row;
		}
	}
	return best ? best.kcal : fallback;
}

/** Objectifs applicables jour par jour (Vision 360 — 7 dates). */
export function kcalGoalsForDates(
	history: GoalHistoryRow[],
	dates: string[],
	fallback: number
): Map<string, number> {
	const out = new Map<string, number>();
	for (const d of dates) out.set(d, kcalGoalForDate(history, d, fallback));
	return out;
}

/** Au moins un changement d'objectif DANS la fenêtre (utile à l'UX Vision 360). */
export function hasChangeWithin(history: GoalHistoryRow[], startISO: string, endISO: string): boolean {
	return history.some((h) => h.effectiveFrom >= startISO && h.effectiveFrom <= endISO);
}

/**
 * Fusionne l'objectif "actuel" dans l'historique de lecture : si la dernière
 * ligne d'historique ne couvre pas l'objectif courant (`clientGoals.kcal`),
 * l'objectif actuel s'applique à partir d'aujourd'hui (sans créer de ligne) —
 * couvre le cas où la coach a modifié les macros sans toucher aux kcal, ou un
 * objectif posé avant la mise en place de l'historisation.
 */
export function withCurrentGoal(
	history: GoalHistoryRow[],
	currentKcal: number,
	todayISO: string
): GoalHistoryRow[] {
	const sorted = [...history].sort(byFrom);
	const last = sorted[sorted.length - 1];
	if (last && last.kcal === currentKcal) return sorted;
	// L'objectif courant devient effectif aujourd'hui (ligne virtuelle de lecture).
	return [...sorted.filter((h) => h.effectiveFrom !== todayISO || h.kcal !== currentKcal), { kcal: currentKcal, effectiveFrom: todayISO }].sort(byFrom);
}
