/**
 * Phases nutritionnelles — module PUR, sans aucune dépendance.
 *
 * Importable tel quel côté SvelteKit (`$lib/phase`), côté Convex
 * (`"../lib/phase"`) et par le formulaire coach : une seule définition de la
 * phase effective et de la cohérence objectif / maintenance, jamais recopiée.
 *
 * Trois phases :
 *  - `perte_gras` (défaut historique, absent en base) : objectif < maintenance ;
 *  - `maintenance` : objectif à ±5 % de la maintenance ;
 *  - `surplus` : objectif > maintenance, au plus +20 %.
 *
 * `clientGoals.phase` est OPTIONNEL : son absence vaut `perte_gras`, aucune
 * migration n'est nécessaire pour les fiches existantes.
 */

export type Phase = 'perte_gras' | 'maintenance' | 'surplus';

/** Les trois phases, dans l'ordre d'affichage. */
export const PHASES = ['perte_gras', 'maintenance', 'surplus'] as const;

/** Libellés affichés (badges, sélecteur, messages). */
export const PHASE_LIBELLES: Record<Phase, string> = {
	perte_gras: 'Perte de gras',
	maintenance: 'Maintenance',
	surplus: 'Surplus'
};

/** Tolérance de la phase maintenance, en pour cent de part et d'autre. */
export const TOLERANCE_MAINTENANCE_PCT = 5;

/** Plafond du surplus, en pour cent au-dessus de la maintenance. */
export const SURPLUS_MAX_PCT = 20;

/** Vrai si la valeur est une phase connue (garde de lecture). */
export function estPhase(valeur: unknown): valeur is Phase {
	return valeur === 'perte_gras' || valeur === 'maintenance' || valeur === 'surplus';
}

/**
 * Phase effective d'objectifs : absente (ou valeur inconnue d'une donnée
 * ancienne) → `perte_gras`. Aucune écriture, aucune migration.
 */
export function phaseEffective(goals?: unknown): Phase {
	const valeur =
		goals && typeof goals === 'object' ? (goals as { phase?: unknown }).phase : undefined;
	return estPhase(valeur) ? valeur : 'perte_gras';
}

/**
 * Phase d'un calibrage (`mode` du module `lib/calibrage`) → phase stockée sur
 * les objectifs. Déficit (ou absent) → perte de gras.
 */
export function phaseDepuisMode(
	mode?: 'deficit' | 'maintenance' | 'surplus' | null
): Phase {
	if (mode === 'maintenance' || mode === 'surplus') return mode;
	return 'perte_gras';
}

/** Arrondi kcal d'une borne (les bornes affichées et comparées sont entières). */
function borne(valeur: number): number {
	return Math.round(valeur);
}

/**
 * Valide la cohérence entre la phase, l'objectif calorique et la maintenance.
 * Retourne `null` si l'objectif convient à la phase, sinon un message d'erreur
 * en français, adapté à la phase.
 *
 * Sans maintenance connue, aucune cohérence n'est vérifiable : `null` (la
 * maintenance reste facultative — son absence ne rend pas l'objectif invalide).
 *
 * Règles (bornes incluses sauf mention) :
 *  - perte_gras : kcal < maintenance ;
 *  - maintenance : maintenance −5 % ≤ kcal ≤ maintenance +5 % ;
 *  - surplus : maintenance < kcal ≤ maintenance +20 %.
 */
export function validerObjectifPhase(
	phase: Phase | string | null | undefined,
	kcal: number,
	maintenanceKcal?: number | null
): string | null {
	if (maintenanceKcal === undefined || maintenanceKcal === null) return null;
	if (!Number.isFinite(maintenanceKcal) || maintenanceKcal <= 0) {
		return 'Maintenance invalide : un nombre positif est attendu.';
	}
	if (!Number.isFinite(kcal)) {
		return 'Objectif calorique invalide : un nombre fini est attendu.';
	}

	const maintenance = borne(maintenanceKcal);
	const objectif = borne(kcal);

	if (phase === 'maintenance') {
		const bas = borne(maintenance * (1 - TOLERANCE_MAINTENANCE_PCT / 100));
		const haut = borne(maintenance * (1 + TOLERANCE_MAINTENANCE_PCT / 100));
		if (objectif < bas || objectif > haut) {
			return `Objectif incohérent avec la phase « Maintenance » : il doit rester entre ${bas} et ${haut} kcal (±${TOLERANCE_MAINTENANCE_PCT} % autour de la maintenance de ${maintenance} kcal).`;
		}
		return null;
	}

	if (phase === 'surplus') {
		if (objectif <= maintenance) {
			return `Objectif incohérent avec la phase « Surplus » : il doit rester supérieur à la maintenance (${maintenance} kcal).`;
		}
		const haut = borne(maintenance * (1 + SURPLUS_MAX_PCT / 100));
		if (objectif > haut) {
			return `Objectif incohérent avec la phase « Surplus » : au plus ${SURPLUS_MAX_PCT} % au-dessus de la maintenance (${haut} kcal maximum).`;
		}
		return null;
	}

	if (phase === 'perte_gras') {
		if (objectif >= maintenance) {
			return `Objectif incohérent avec la phase « Perte de gras » : il doit rester inférieur à la maintenance (${maintenance} kcal).`;
		}
		return null;
	}

	return `Phase inconnue : « perte_gras », « maintenance » ou « surplus » attendu (reçu « ${String(phase)} »).`;
}
