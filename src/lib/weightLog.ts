/**
 * Saisie du poids depuis l'Accueil (feuille rapide) — MÊME mécanisme que
 * « Ma progression » : POST /api/metrics → api.metrics.upsert (une ligne par
 * date, bornes serveur identiques), et même instantané partagé pour que la
 * nouvelle valeur apparaisse sans attendre la revalidation serveur.
 * Aucune logique métier ni table supplémentaire ici.
 */
import { cacheGet, cacheSet, getSharedMetrics, setSharedMetrics } from './navMemory';
import { upsertMetricRow, withDerivedBodyFat, type MetricsSnapshot } from './metrics';

/** Route de l'instantané « Ma progression » (cache de navigation + partagé). */
export const PROGRESSION_ROUTE = '/espace/progression';

/** Bornes identiques à api.metrics.upsert (src/convex/metrics.ts). */
export const WEIGHT_MIN_KG = 30;
export const WEIGHT_MAX_KG = 350;

/** Lit une saisie décimale (virgule ou point). `undefined` si vide ou invalide. */
export function parseWeightKg(raw: string): number | undefined {
	const t = raw.trim().replace(',', '.');
	if (t === '') return undefined;
	const n = Number(t);
	return Number.isFinite(n) ? n : undefined;
}

/** Message d'erreur de validation, ou `null` si la valeur est acceptable. */
export function checkWeightKg(kg: number | undefined): string | null {
	if (kg === undefined) return 'Saisis ton poids en kg.';
	if (kg < WEIGHT_MIN_KG || kg > WEIGHT_MAX_KG) {
		return `Le poids doit être entre ${WEIGHT_MIN_KG} et ${WEIGHT_MAX_KG} kg.`;
	}
	return null;
}

/** Enregistre la pesée du jour via l'endpoint existant (upsert par date). */
export async function saveWeightKg(date: string, weightKg: number): Promise<void> {
	const r = await fetch('/api/metrics', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ date, weightKg }),
	});
	const j = (await r.json().catch(() => null)) as { error?: string } | null;
	if (!r.ok || !j || j.error) throw new Error(j?.error ?? 'Enregistrement impossible, réessaie.');
}

/**
 * Pose la pesée dans l'instantané « Ma progression » (cache + partagé), même
 * règle que la page Progression (fusion par date, masse grasse recalculée).
 * Retourne `null` si aucun instantané n'existe encore : la page chargera alors
 * les données serveur à sa prochaine ouverture.
 */
export function applyWeightLocally(weightKg: number, date: string): MetricsSnapshot | null {
	const snap = cacheGet<MetricsSnapshot>(PROGRESSION_ROUTE) ?? getSharedMetrics();
	if (!snap) return null;
	const next = withDerivedBodyFat({
		heightCm: snap.heightCm,
		measurements: upsertMetricRow(snap.measurements, date, { weightKg }),
		bodyFat: snap.bodyFat,
	});
	cacheSet(PROGRESSION_ROUTE, next);
	setSharedMetrics(next);
	return next;
}
