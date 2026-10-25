/**
 * ENTRAÎNEMENT (coach) — statuts, adhérence et dernière charge CALCULÉS.
 *
 * Une seule source de vérité, partagée par la requête Convex (Vision 360) et
 * l'onglet Entraînement de la fiche cliente. Rien de tout cela n'est stocké :
 * le statut d'une occurrence se déduit de `status` + `skippedAt` + de la date
 * du jour (fuseau métier Europe/Paris).
 *
 *  - « Réalisée »     : status completed SANS skippedAt
 *  - « Non réalisée » : status completed AVEC skippedAt (déclarée par la cliente)
 *  - « Manquée »      : status planned et date passée (avant aujourd'hui)
 *  - « Prévue »       : status planned, aujourd'hui ou plus tard
 *  - « Annulée »      : status cancelled
 *
 * Adhérence = « Réalisée » ÷ séances passées hors annulées. « Non réalisée »
 * et « Manquée » comptent donc comme non faites.
 */

export type TrainingStatusKey = 'done' | 'notDone' | 'missed' | 'planned' | 'cancelled';

export const TRAINING_STATUS_LABELS: Record<TrainingStatusKey, string> = {
	done: 'Réalisée',
	notDone: 'Non réalisée',
	missed: 'Manquée',
	planned: 'Prévue',
	cancelled: 'Annulée',
};

export type SessionProgressLike = {
	status: string;
	/** "yyyy-mm-dd" (date planifiée de l'occurrence). */
	date: string;
	skippedAt?: number | null;
	startedAt?: number | null;
};

/** Date du jour "yyyy-mm-dd" au fuseau Europe/Paris (jamais l'horloge UTC brute). */
export function parisTodayISO(now: Date = new Date()): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Paris',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(now);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Statut affiché d'une occurrence planifiée — calculé, jamais stocké. */
export function trainingStatus(session: SessionProgressLike, todayISO: string): TrainingStatusKey {
	if (session.status === 'cancelled') return 'cancelled';
	if (session.status === 'completed') return session.skippedAt != null ? 'notDone' : 'done';
	// Reste : status planned (ou inconnu) → manquée si la date est passée.
	return session.date < todayISO ? 'missed' : 'planned';
}

export type Adherence = {
	/** Séances « Réalisée » parmi les séances passées. */
	done: number;
	/** Séances passées hors annulées (dénominateur). */
	past: number;
	/** Pourcentage arrondi, null si aucune séance passée. */
	percent: number | null;
};

/**
 * Adhérence : séances « Réalisée » ÷ séances passées non annulées.
 * « Non réalisée » et « Manquée » sont bien présentes au dénominateur sans
 * être au numérateur — elles comptent comme non faites.
 */
export function trainingAdherence(sessions: readonly SessionProgressLike[], todayISO: string): Adherence {
	const past = sessions.filter((s) => s.status !== 'cancelled' && s.date < todayISO);
	const done = past.filter((s) => trainingStatus(s, todayISO) === 'done');
	return {
		done: done.length,
		past: past.length,
		percent: past.length > 0 ? Math.round((done.length / past.length) * 100) : null,
	};
}

/* ── Dernière charge par exercice ── */

export type LoadLike = {
	date: string;
	setOrder: number;
	weightKg?: number | null;
};

/**
 * Tri explicite du plus récent au plus ancien : par DATE puis par setOrder.
 * Ne dépend jamais de l'ordre d'itération renvoyé par la base.
 */
export function orderByRecency<T extends LoadLike>(rows: readonly T[]): T[] {
	return [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.setOrder - a.setOrder);
}

/** Dernière charge : série la plus récente (date puis setOrder) portant une charge. */
export function lastLoad<T extends LoadLike>(rows: readonly T[]): T | null {
	return orderByRecency(rows).find((r) => r.weightKg != null) ?? null;
}
