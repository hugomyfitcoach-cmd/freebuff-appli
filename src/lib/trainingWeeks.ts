/**
 * ENTRAÎNEMENT — vue par semaine de la fiche cliente (coach).
 *
 * Regroupement CALENDAIRE sur le programme assigné : semaine 1 = les 7 jours
 * qui suivent `startDate`, etc. Aucun statut n'est recalculé ici : les badges
 * d'une séance viennent de `trainingStatus` (src/lib/trainingProgress.ts).
 * Aucune donnée n'est stockée : tout se déduit des dates et de `todayISO`
 * (fuseau métier Europe/Paris).
 */
import { trainingStatus } from './trainingProgress';

export type WeekSessionLike = {
	_id: string;
	/** Date de l'occurrence "yyyy-mm-dd". */
	date: string;
	status: string;
	skippedAt?: number | null;
};

export type TrainingWeek<T extends WeekSessionLike> = {
	/** 1-based, dans l'ordre du programme. */
	index: number;
	start: string;
	end: string;
	/** « 10–16 oct. » (ou « 27 sept. – 3 oct. » à cheval sur deux mois). */
	label: string;
	/** La semaine qui contient aujourd'hui (mise en évidence, dépliée). */
	isCurrent: boolean;
	/** Séances de la semaine, triées par date. */
	sessions: T[];
	/** Séances « Réalisée » de la semaine (badge du pli). */
	done: number;
};

const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Ajoute n jours à une date ISO (arithmétique UTC, insensible à l'heure d'été). */
export function addDaysISO(iso: string, days: number): string {
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return iso;
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Nombre de jours calendaires de `from` à `to` (négatif si `to` est avant). */
export function daysBetweenISO(from: string, to: string): number {
	const [y1, m1, d1] = from.split('-').map(Number);
	const [y2, m2, d2] = to.split('-').map(Number);
	if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return 0;
	return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** « 10–16 oct. » — même mois abrégé, sinon « 27 sept. – 3 oct. ». */
export function weekLabel(startISO: string, endISO: string): string {
	const [, m1, d1] = startISO.split('-').map(Number);
	const [, m2, d2] = endISO.split('-').map(Number);
	if (!m1 || !d1 || !m2 || !d2) return `${startISO} → ${endISO}`;
	if (m1 === m2) return `${d1}–${d2} ${MONTHS_SHORT[m1 - 1]}`;
	return `${d1} ${MONTHS_SHORT[m1 - 1]} – ${d2} ${MONTHS_SHORT[m2 - 1]}`;
}

/** Nombre de semaines calendaires couvertes par le programme (1 minimum). */
export function programWeekCount(startDate: string, endDate: string): number {
	const days = daysBetweenISO(startDate, endDate);
	if (!Number.isFinite(days) || days < 0) return 1;
	return Math.floor(days / 7) + 1;
}

/**
 * Une ligne par semaine du programme (bornée à `endDate`), séances triées par
 * date. La semaine en cours est marquée `isCurrent` — c'est elle qui s'ouvre
 * par défaut dans l'onglet Entraînement.
 */
export function groupSessionsByWeek<T extends WeekSessionLike>(
	sessions: readonly T[],
	startDate: string,
	endDate: string,
	todayISO: string
): TrainingWeek<T>[] {
	if (!startDate || !endDate || endDate < startDate) return [];
	const weeks: TrainingWeek<T>[] = [];
	const total = programWeekCount(startDate, endDate);
	for (let i = 0; i < total; i++) {
		const start = addDaysISO(startDate, i * 7);
		// La dernière semaine s'arrête à la fin du programme (jamais au-delà).
		const rawEnd = addDaysISO(start, 6);
		const end = rawEnd > endDate ? endDate : rawEnd;
		const rows = sessions.filter((s) => s.date >= start && s.date <= end).sort((a, b) => a.date.localeCompare(b.date));
		weeks.push({
			index: i + 1,
			start,
			end,
			label: weekLabel(start, end),
			isCurrent: todayISO >= start && todayISO <= end,
			sessions: rows,
			done: rows.filter((s) => trainingStatus(s, todayISO) === 'done').length,
		});
	}
	return weeks;
}

/** Semaine à déplier par défaut : la semaine en cours, sinon la première. */
export function defaultOpenWeekIndex(weeks: readonly TrainingWeek<WeekSessionLike>[]): number | null {
	if (weeks.length === 0) return null;
	return (weeks.find((w) => w.isCurrent) ?? weeks[0]).index;
}

export type ProgramEndTone = 'warn' | 'calm' | 'over';

/**
 * « Se termine dans N jours » — orange (warn) à 5 jours ou moins, « Terminé »
 * une fois la date de fin passée.
 */
export function programEndBadge(endDate: string, todayISO: string): { label: string; tone: ProgramEndTone } {
	const days = daysBetweenISO(todayISO, endDate);
	if (days < 0) return { label: 'Terminé', tone: 'over' };
	if (days === 0) return { label: "Se termine aujourd'hui", tone: 'warn' };
	if (days === 1) return { label: 'Se termine dans 1 jour', tone: 'warn' };
	return { label: `Se termine dans ${days} jours`, tone: days <= 5 ? 'warn' : 'calm' };
}

/**
 * Durée réelle d'une séance (min) — la MÊME que celle vue par la cliente :
 * durée enregistrée/corrigée par elle si elle existe, sinon chronométrée
 * (completedAt − startedAt). null si aucune information.
 */
export function sessionDurationMin(s: {
	durationMin?: number | null;
	startedAt?: number | null;
	completedAt?: number | null;
}): number | null {
	if (s.durationMin != null && s.durationMin > 0) return Math.round(s.durationMin);
	if (s.startedAt == null || s.completedAt == null || s.completedAt <= s.startedAt) return null;
	return Math.max(1, Math.round((s.completedAt - s.startedAt) / 60000));
}
