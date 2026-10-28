/**
 * AFFICHAGE SELON LA PHASE — module PUR, sans dépendance Svelte ni Convex.
 *
 * Une seule source pour les trois écrans qui parlaient encore de déficit
 * partout (Journal, Performance, Accueil) : la phase vient TOUJOURS de
 * `clientGoals.phase` via `phaseEffective`, jamais d'un recalcul à partir des
 * chiffres (objectif vs maintenance).
 *
 * Règle absolue : en `perte_gras` (défaut historique), les valeurs et les tons
 * sont STRICTEMENT ceux d'avant — filet de sécurité, marqueur d'objectif,
 * rouge au-delà de la maintenance. En `maintenance` et `surplus`, une seule
 * cible : l'objectif ; aucun filet, aucun marqueur, jamais de rouge.
 */

import { phaseEffective, type Phase } from './phase';

/** Ton visuel d'une jauge calorique. */
export type TonJauge = 'brand' | 'neutre' | 'warn' | 'danger';

/** Au-delà de quel dépassement le ton quitte le neutre (10 %). */
export const DEPASSEMENT_NEUTRE_PCT = 10;

export type EtatJauge = {
	/** Échelle et cible de la barre (kcal). */
	cibleKcal: number;
	/** Zone « filet de sécurité » objectif → maintenance (perte de gras uniquement). */
	filetActif: boolean;
	/** Marqueur vertical de l'objectif (perte de gras uniquement). */
	marqueurObjectif: boolean;
	/** Le total dépasse la cible. */
	depasse: boolean;
	/** Le total dépasse la maintenance (perte de gras uniquement). */
	depasseMaintenance: boolean;
	/** Kcal au-delà de la cible, telles qu'affichées (« dépassé de … »). */
	depassementKcal: number;
	/** Ton : le rouge n'existe qu'en perte de gras. */
	ton: TonJauge;
};

/**
 * État d'affichage de la jauge calorique d'un jour.
 *
 * - `perte_gras` : cible = maintenance (si > objectif, zone de filet comprise),
 *   sinon objectif ; tons vert → orange → rouge, dépannage affiché par
 *   rapport à la maintenance quand elle est franchie (comportement historique).
 * - `maintenance` / `surplus` : cible = objectif uniquement. Le dépassement est
 *   neutre jusqu'à +10 %, orange (sobre) au-delà, jamais rouge.
 */
export function etatJauge(
	phase: Phase | string | null | undefined,
	entree: { total: number; objectifKcal: number; maintenanceKcal?: number | null }
): EtatJauge {
	const total = Number.isFinite(entree.total) ? entree.total : 0;
	const objectif = Number.isFinite(entree.objectifKcal) ? entree.objectifKcal : 0;
	const maintenanceBrute =
		typeof entree.maintenanceKcal === 'number' && Number.isFinite(entree.maintenanceKcal)
			? entree.maintenanceKcal
			: null;

	if (phase === 'perte_gras' || phase === undefined || phase === null) {
		// Comportement historique, à l'identique : le filet n'existe que si la
		// maintenance est au-dessus de l'objectif.
		const maintenance = maintenanceBrute !== null && maintenanceBrute > objectif ? maintenanceBrute : null;
		const depasse = total > objectif;
		const depasseMaintenance = maintenance !== null && total > maintenance;
		return {
			cibleKcal: maintenance ?? objectif,
			filetActif: maintenance !== null,
			marqueurObjectif: maintenance !== null,
			depasse,
			depasseMaintenance,
			depassementKcal: depasseMaintenance ? total - (maintenance as number) : depasse ? total - objectif : 0,
			ton: depasseMaintenance ? 'danger' : depasse ? 'warn' : 'brand'
		};
	}

	// Maintenance et surplus : une seule cible, l'objectif. Aucun filet, aucun
	// marqueur, aucun rouge — un dépassement reste une information neutre.
	const depasse = total > objectif;
	const tolerance = objectif > 0 ? objectif * (1 + DEPASSEMENT_NEUTRE_PCT / 100) : objectif;
	return {
		cibleKcal: objectif,
		filetActif: false,
		marqueurObjectif: false,
		depasse,
		depasseMaintenance: false,
		depassementKcal: depasse ? total - objectif : 0,
		ton: depasse ? (total <= tolerance ? 'neutre' : 'warn') : 'brand'
	};
}

/** Libellé court de la phase affiché sous la jauge — rien en perte de gras. */
export function libellePhaseJauge(phase: Phase): string | null {
	if (phase === 'maintenance') return 'Phase : maintenance';
	if (phase === 'surplus') return 'Phase : surplus';
	return null;
}

/** Phase effective d'objectifs exposés par l'API (`goals.phase`). */
export function phaseDesObjectifs(goals?: unknown): Phase {
	return phaseEffective(goals);
}

/**
 * Solde cumulé de la semaine par rapport à la maintenance :
 * mangé − maintenance × jours renseignés (positif = au-dessus).
 * `null` sans maintenance connue ou sans jour renseigné.
 */
export function soldeMaintenance(
	entree: { mangeKcal: number; jours: number; maintenanceKcal?: number | null }
): number | null {
	const maintenance =
		typeof entree.maintenanceKcal === 'number' && Number.isFinite(entree.maintenanceKcal) && entree.maintenanceKcal > 0
			? entree.maintenanceKcal
			: null;
	if (maintenance === null || entree.jours <= 0) return null;
	return Math.round(entree.mangeKcal - maintenance * entree.jours);
}

/** Kg estimés à partir d'un solde kcal (7 700 kcal = 1 kg). */
export function kgDepuisKcal(kcal: number): number {
	return Math.round((kcal / 7700) * 100) / 100;
}
