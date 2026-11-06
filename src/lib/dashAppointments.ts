/**
 * Carte « rendez-vous restants » du tableau de bord coach (/admin).
 *
 * Logique PURE : aucun accès réseau, aucune horloge implicite (`nowMs` est
 * fourni par l'appelant) — la carte se réévalue donc chaque minute côté
 * navigateur sans recharger quoi que ce soit.
 *
 * Convention d'heure IDENTIQUE à la page Rendez-vous : `date` est une clé de
 * jour LOCALE (yyyy-mm-dd, `toISO`) et `time` une heure murale « HH:MM » du
 * planning (même interprétation que `rdvStartMs` / `isToday`).
 */
import { kindRule, rdvStartMs, toISO } from './appointments';

/** RDV tel que renvoyé par GET /api/appointments (champs utiles à la carte). */
export type DashRdv = {
	_id: string;
	date: string;
	time: string;
	endTime?: string | null;
	kind?: string | null;
	clientName?: string | null;
};

/**
 * Fin réelle d'un rendez-vous : début + durée.
 * La durée vient de l'horaire de fin du RDV (durée réelle du créneau) ; à
 * défaut — ancien rendez-vous sans `endTime` — du barème de son type.
 */
export function rdvEndMs(r: DashRdv): number {
	const start = rdvStartMs(r);
	const end = r.endTime ? new Date(`${r.date}T${r.endTime}:00`).getTime() : NaN;
	if (Number.isFinite(end) && end > start) return end;
	return start + kindRule(r.kind ?? 'Suivi').durationMin * 60_000;
}

/**
 * Libellé accordé de la carte, le nombre restant étant affiché à part :
 * « 1 rendez-vous restant » au singulier, « 0 » et « 2+ » rendez-vous restants.
 */
export function rdvRestantsLabel(count: number): string {
	return count === 1 ? 'rendez-vous restant' : 'rendez-vous restants';
}

export type DayAgenda<T extends DashRdv> = {
	/** RDV du jour, triés par heure de début. */
	today: T[];
	/** RDV du jour pas encore TERMINÉS (début + durée > maintenant), triés. */
	remaining: T[];
	/** RDV en cours à l'instant `nowMs` (le premier s'il y en a plusieurs). */
	inProgress: T | null;
	/** Prochain RDV pas encore commencé. */
	next: T | null;
};

/**
 * État de la journée à l'instant `nowMs` :
 *  - `remaining` = rendez-vous d'aujourd'hui pas encore terminés ;
 *  - `inProgress` = celui dont le créneau contient `nowMs` ;
 *  - `next` = le premier dont le début est encore à venir.
 */
export function dayAgenda<T extends DashRdv>(items: readonly T[], nowMs: number): DayAgenda<T> {
	const todayKey = toISO(new Date(nowMs));
	const today = items
		.filter((r) => r.date === todayKey)
		.slice()
		.sort((a, b) => a.time.localeCompare(b.time));
	const remaining = today.filter((r) => rdvEndMs(r) > nowMs);
	return {
		today,
		remaining,
		inProgress: remaining.find((r) => rdvStartMs(r) <= nowMs) ?? null,
		next: remaining.find((r) => rdvStartMs(r) > nowMs) ?? null,
	};
}
