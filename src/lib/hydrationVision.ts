/**
 * HYDRATATION — helpers partagés app cliente + CRM coach.
 * Une seule source de vérité : les lignes `hydrationEntries(userId, date, ml)`
 * agrégées par jour. Ces fonctions produisent les récaps affichés :
 *
 * — `summarizeDays` : totals par date + % de l'objectif + drapeaux métier
 *   (`noData` = aucun enregistrement ≠ 0 ml ; jamais un jour sans saisie
 *   présenté comme « objectif non atteint »).
 * — `avgWindow` : moyenne sur une fenêtre de N JOURNÉES COMPLÈTES (J-N → J-1),
 *   la journée en cours n'y entre jamais — même règle que `avgLast7Completed`
 *   (pas/poids) et la Vision 360 CRM.
 *
 * Grands principes métier reconduits couches par couches :
 * 1. une occurrence = une prise réelle (ml) ;
 * 2. un jour sans enregistrement ≠ un jour « sous objectif » ;
 * 3. tout est recalculé à la demande (aucune table dérivée, aucun cache métier).
 */

export type HydrationEntryRow = { date: string; ml: number };

export type HydrationDay = {
  date: string;
  /** Total volontairement undefined : un jour absent = aucune saisie. */
  totalMl?: number;
  /** NOMBRE de prises enregistrées (≥ 1 désigne un jour avec des données). */
  entries?: number;
};

export function shiftISO(date: string, deltaDays: number): string {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Date du jour au fuseau Europe/Paris (même helper que la Vision 360). */
export function parisTodayISO(): string {
  const parts = new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
}

/** Fenêtre des N DERNIÈRES JOURNÉES COMPLÈTES (J-N → J-1), de la plus ancienne à hier. */
export function windowDaysCompleted(todayISO: string, n = 7): string[] {
  const out: string[] = [];
  for (let i = n; i >= 1; i--) out.push(shiftISO(todayISO, -i));
  return out;
}

export type SummarizedDay = {
  date: string;
  /** Total ml du jour, null = aucun enregistrement (≠ 0). */
  totalMl: number | null;
  /** Nombre de prises enregistrées, 0 si aucune. */
  entries: number;
  /** True si aucune saisie — distingué de « objectif non atteint » côté UI. */
  noData: boolean;
  /** % de l'objectif, null si aucune donnée. */
  percent: number | null;
  /** Objectif jour atteint (total ≥ objectif) — false si aucune donnée. */
  goalMet: boolean;
};

/**
 * Récap par jour : total, nombre de prises, % et atteinte.
 * `byDate` = agrégats déjà fusionnés par l'appelant ([date, {ml, entries}]).
 */
export function summarize(
  fromDates: string[],
  byDate: Map<string, { ml: number; entries: number }>,
  goalMl: number,
): SummarizedDay[] {
  return fromDates.map((date) => {
    const hit = byDate.get(date);
    const totalMl = hit ? hit.ml : null;
    const entries = hit ? hit.entries : 0;
    const noData = hit === undefined;
    return {
      date,
      totalMl,
      entries,
      noData,			percent:
			noData || goalMl <= 0 ? null : Math.round((totalMl! / goalMl) * 100),
			goalMet: !noData && (totalMl ?? 0) >= goalMl,
    };
  });
}

/**
 * Moyenne des N journées complètes — jours sans saisie exclus (jamais 0 ml),
 * même sémantique que avgLast7Completed. Retourne null si toute la fenêtre
 * est vide (aucun plan à montrer).
 */
export function avgWindow(days: SummarizedDay[]): number | null {
  const withData = days.filter((d) => !d.noData);
  if (withData.length === 0) return null;
  return Math.round(
    withData.reduce((s, d) => s + (d.totalMl ?? 0), 0) / withData.length,
  );
}

/** Agrège les lignes brutes par date : { ml, entries }. */
export function aggregateByDate(
  rows: HydrationEntryRow[],
): Map<string, { ml: number; entries: number }> {
  const m = new Map<string, { ml: number; entries: number }>();
  for (const r of rows) {
    const prev = m.get(r.date) ?? { ml: 0, entries: 0 };
    m.set(r.date, { ml: prev.ml + r.ml, entries: prev.entries + 1 });
  }
  return m;
}
