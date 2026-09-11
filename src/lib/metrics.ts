/**
 * Métriques corporelles (poids + mensurations) — helpers PARTAGÉS cliente.
 *
 * Sert à la mise à jour OPTIMISTE de l'UI dans « Ma progression » :
 * dès la validation d'une saisie, la nouvelle valeur est appliquée
 * localement (historique, courbe, carte, Accueil) sans attendre la
 * réponse du serveur, qui revalide ensuite silencieusement (même
 * source de vérité : api.metrics via /api/metrics).
 */

export type Measurement = {
	_id: string;
	date: string;
	weightKg?: number;
	neckCm?: number;
	waistCm?: number;
	hipCm?: number;
};

/** Métrique modifiable : poids ou l'une des trois mensurations. */
export type MetricKey = 'weightKg' | 'neckCm' | 'waistCm' | 'hipCm';

/** Instantané des données Progression (même forme que GET /api/metrics). */
export type MetricsSnapshot = {
	heightCm: number | null;
	measurements: Measurement[];
	bodyFat: { date: string; value: number }[];
};

const CM_PER_INCH = 2.54;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * US Navy femme — formule en pouces (1 in = 2,54 cm), garde-fou 2–70 %.
 * Copie CLIENT de usNavyBodyFat (src/convex/metrics.ts — source de vérité) :
 * elle sert uniquement à l'affichage optimiste d'un point de masse grasse
 * juste après une saisie, le serveur restant autoritaire à la revalidation.
 */
export function usNavyBodyFatClient(
	waistCm: number,
	hipCm: number,
	neckCm: number,
	heightCm: number
): number | null {
	const toIn = (cm: number) => cm / CM_PER_INCH;
	const w = toIn(waistCm);
	const h = toIn(hipCm);
	const n = toIn(neckCm);
	const ht = toIn(heightCm);
	if (!(w + h > n) || !(ht > 0)) return null;
	const pct = 163.205 * Math.log10(w + h - n) - 97.684 * Math.log10(ht) - 78.387;
	return isFinite(pct) && pct >= 2 && pct <= 70 ? round1(pct) : null;
}

/** Historique masse grasse dérivé des relevés (un point par relevé complet). */
export function deriveBodyFatSeries(
	rows: Measurement[],
	heightCm: number | null
): { date: string; value: number }[] {
	if (heightCm === null) return [];
	const out: { date: string; value: number }[] = [];
	for (const m of rows) {
		if (m.waistCm === undefined || m.hipCm === undefined || m.neckCm === undefined) continue;
		const v = usNavyBodyFatClient(m.waistCm, m.hipCm, m.neckCm, heightCm);
		if (v !== null) out.push({ date: m.date, value: v });
	}
	return out.sort((a, b) => a.date.localeCompare(b.date));
}

const METRIC_FIELDS: MetricKey[] = ['weightKg', 'neckCm', 'waistCm', 'hipCm'];

function hasNoMetric(m: Measurement): boolean {
	return METRIC_FIELDS.every((k) => m[k] === undefined);
}

/**
 * Applique localement une prise de mesures (optimiste) : une ligne par date,
 * les champs déjà saisis ce jour-là sont conservés — exactement la sémantique
 * de api.metrics.upsert. Ligne triée par date pour rester cohérente avec la
 * source serveur.
 */
export function upsertMetricRow(
	rows: Measurement[],
	date: string,
	patch: Partial<Record<MetricKey, number>>
): Measurement[] {
	const idx = rows.findIndex((m) => m.date === date);
	const next =
		idx === -1
			? [...rows, { _id: `local-${date}-${Date.now()}`, date, ...patch }]
			: rows.map((m, i) => (i === idx ? { ...m, ...patch } : m));
	return next.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Efface localement UNE métrique d'une date (optimiste) : si le jour n'a plus
 * aucune mesure, la ligne disparaît — même sémantique que api.metrics.deleteOne.
 */
export function clearMetricField(rows: Measurement[], date: string, metric: MetricKey): Measurement[] {
	return rows
		.map((m) => (m.date === date ? { ...m, [metric]: undefined } : m))
		.filter((m) => m.date !== date || !hasNoMetric(m));
}

/** Recalcule la série masse grasse d'un instantané après modification locale. */
export function withDerivedBodyFat(snap: MetricsSnapshot): MetricsSnapshot {
	return { ...snap, bodyFat: deriveBodyFatSeries(snap.measurements, snap.heightCm) };
}
