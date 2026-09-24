/**
 * RÈGLE DE MOYENNE G-FLUX — UNE SEULE SOURCE pour calories et pas.
 *
 * La journée EN COURS est incomplète : elle ne doit JAMAIS influencer une
 * moyenne « 7 derniers jours ». Ancienne formule (fenêtre glissante incluant
 * aujourd'hui, J-6 → J0) remplacée par :
 *
 *   FENÊTRE      : 7 journées TERMINÉES = J-7 → J-1
 *                  (un jeudi : du jeudi précédent au mercredi terminé inclus)
 *   DÉNOMINATEUR : uniquement les journées avec données réellement renseignées
 *                  — une journée absente n'est JAMAIS comptée comme zéro.
 *
 * Module PUR (aucune dépendance, aucune I/O, aucun Date.now) : la date de
 * référence est toujours passée en argument — testable de façon déterministe,
 * y compris autour de minuit, et partagé client (Svelte) / serveur (Convex, BFF)
 * comme nutritionGuard. Toutes les comparaisons se font sur des clés ISO
 * "yyyy-mm-dd" locales, jamais sur des timestamps UTC : aucun décalage de
 * fuseau autour de minuit.
 */

export type TrackedPoint = {
	/** Date locale "yyyy-mm-dd" (clé du jour, jamais un timestamp UTC). */
	date: string;
	/** Valeur du jour — null/absent = journée sans saisie (≠ 0). */
	value: number | null;
};

export type AvgResult = {
	/** Moyenne arrondie à l'unité sur les jours renseignés — null si aucun. */
	avg: number | null;
	/** Nombre de journées RENSEIGNÉES de la fenêtre (dénominateur réel). */
	trackedDays: number;
	/** Les 7 clés ISO J-7 → J-1 de la fenêtre (du plus ancien au plus récent). */
	window: string[];
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Valide une clé ISO "yyyy-mm-dd" (aucune interprétation de fuseau). */
function assertISO(iso: string, label: string): void {
	if (!ISO_RE.test(iso)) {
		throw new Error(`${label} doit être une date ISO "yyyy-mm-dd" (reçu : ${iso}).`);
	}
}

/** Clé ISO décalée de `days` jours (pur, via Date midi local — anti-DST). */
export function shiftISO(iso: string, days: number): string {
	assertISO(iso, 'iso');
	const d = new Date(iso + 'T12:00:00');
	d.setDate(d.getDate() + days);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Les 7 journées TERMINÉES avant `todayISO` : J-7 → J-1.
 * Aujourd'hui n'apparaît JAMAIS dans la fenêtre.
 */
export function last7CompletedDays(todayISO: string): string[] {
	assertISO(todayISO, 'todayISO');
	const out: string[] = [];
	for (let i = 7; i >= 1; i--) out.push(shiftISO(todayISO, -i));
	return out;
}

/** Somme arrondie à l'unité ( même arrondi que le reste de l'app : Math.round). */
function roundAvg(sum: number, n: number): number {
	return Math.round(sum / n);
}

/**
 * Moyenne sur les 7 JOURNÉES TERMINÉES (J-7 → J-1) — la règle unique de l'app.
 *
 * `points` : les valeurs par jour du client (toutes dates confondues — la
 * fonction filtre elle-même sur la fenêtre). Une date sans point, ou avec
 * `value` null/undefined, est ABSENTE de données : elle n'entre ni au numérateur
 * ni au dénominateur. Une valeur 0 explicite (ex. 0 pas saisi) reste comptée.
 */
export function avgLast7Completed(points: TrackedPoint[], todayISO: string): AvgResult {
	const window = last7CompletedDays(todayISO);
	const byDay = new Map<string, number>();
	for (const p of points) {
		if (!p || !ISO_RE.test(p.date)) continue;
		if (p.value === null || p.value === undefined || !isFinite(p.value)) continue;
		byDay.set(p.date, p.value);
	}
	let sum = 0;
	let trackedDays = 0;
	for (const day of window) {
		const v = byDay.get(day);
		if (v === undefined) continue; // jour sans donnée ≠ 0
		sum += v;
		trackedDays += 1;
	}
	return {
		avg: trackedDays > 0 ? roundAvg(sum, trackedDays) : null,
		trackedDays,
		window,
	};
}
