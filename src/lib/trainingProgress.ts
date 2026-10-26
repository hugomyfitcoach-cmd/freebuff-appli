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
 * Adhérence : séances « Réalisée » ÷ séances attendues non annulées.
 * Une séance réalisée compte IMMÉDIATEMENT, même si sa date prévue est
 * future (faite en avance) : elle entre au numérateur ET au dénominateur.
 * « Non réalisée » et « Manquée » restent au dénominateur sans être au
 * numérateur — elles comptent comme non faites.
 */
export function trainingAdherence(sessions: readonly SessionProgressLike[], todayISO: string): Adherence {
	const expected = sessions.filter(
		(s) => s.status !== 'cancelled' && (s.date < todayISO || trainingStatus(s, todayISO) === 'done')
	);
	const done = expected.filter((s) => trainingStatus(s, todayISO) === 'done');
	return {
		done: done.length,
		past: expected.length,
		percent: expected.length > 0 ? Math.round((done.length / expected.length) * 100) : null,
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

/* ═══════════ Séries d'une séance (coach — lecture seule) ═══════════ */

/** Champs utiles d'une ligne `trainingSetLogs` (snapshot d'historique). */
export type SetLogLike = {
	/** "yyyy-mm-dd" de la séance. */
	date: string;
	setOrder: number;
	exerciseId: string;
	exerciseName: string;
	/** "reps" | "time". */
	mode: string;
	reps?: number | null;
	weightKg?: number | null;
	durationSeconds?: number | null;
	/** Une ligne non validée (done === false) ne compte jamais. */
	done?: boolean;
};

export type LoggedSet = {
	setOrder: number;
	reps: number | null;
	weightKg: number | null;
	durationSeconds: number | null;
	mode: string;
};

export type SessionExercise = {
	exerciseId: string;
	/** Nom snapshot de la bibliothèque (affiché via displayExerciseName). */
	name: string;
	mode: string;
	sets: LoggedSet[];
	/** Volume (kg) = Σ reps × charge ; null si aucune série chargée. */
	volumeKg: number | null;
};

function fmtNumber(n: number): string {
	return String(Number.isInteger(n) ? n : Math.round(n * 10) / 10).replace('.', ',');
}

/** Une série affichée : « 10 × 32 kg », « 12 reps » ou « 45 s ». */
export function formatLoggedSet(set: {
	mode: string;
	reps?: number | null;
	weightKg?: number | null;
	durationSeconds?: number | null;
}): string {
	if (set.mode === 'time') return set.durationSeconds != null ? `${set.durationSeconds} s` : '—';
	const reps = set.reps != null ? String(set.reps) : '—';
	return set.weightKg != null ? `${reps} × ${fmtNumber(set.weightKg)} kg` : `${reps} reps`;
}

/**
 * Séries d'une séance regroupées PAR EXERCICE, dans l'ordre de prescription.
 * Tri explicite par setOrder : jamais l'ordre d'itération de la base.
 */
export function groupSessionSets(rows: readonly SetLogLike[]): SessionExercise[] {
	const by = new Map<string, SessionExercise>();
	for (const r of rows) {
		if (r.done === false) continue;
		const cur = by.get(r.exerciseId) ?? {
			exerciseId: r.exerciseId,
			name: r.exerciseName,
			mode: r.mode,
			sets: [],
			volumeKg: null,
		};
		cur.sets.push({
			setOrder: r.setOrder,
			reps: r.reps ?? null,
			weightKg: r.weightKg ?? null,
			durationSeconds: r.durationSeconds ?? null,
			mode: r.mode,
		});
		by.set(r.exerciseId, cur);
	}
	const out = [...by.values()];
	for (const e of out) {
		e.sets.sort((a, b) => a.setOrder - b.setOrder);
		let volume = 0;
		let weighted = false;
		for (const s of e.sets) {
			if (s.mode === 'time' || s.reps == null || s.weightKg == null) continue;
			volume += s.reps * s.weightKg;
			weighted = true;
		}
		e.volumeKg = weighted ? Math.round(volume * 10) / 10 : null;
	}
	return out.sort((a, b) => (a.sets[0]?.setOrder ?? 0) - (b.sets[0]?.setOrder ?? 0));
}

/* ═══════════ Charges & progression par exercice ═══════════ */

/** Unité d'affichage : charge (kg), répétitions (poids du corps) ou durée. */
export type ExerciseUnit = 'kg' | 'reps' | 's';

export type ExerciseProgression = {
	exerciseId: string;
	name: string;
	unit: ExerciseUnit;
	/** Nombre de séances distinctes où l'exercice a été travaillé. */
	sessions: number;
	/** Première séance (date) et valeur de départ dans l'unité. */
	startDate: string;
	startValue: number | null;
	/** Dernière séance (date) et valeur actuelle dans l'unité. */
	currentDate: string;
	currentValue: number | null;
	/** currentValue − startValue (null si l'une des deux manque). */
	delta: number | null;
};

function valueInUnit(row: SetLogLike, unit: ExerciseUnit): number | null {
	if (unit === 's') return row.durationSeconds ?? null;
	if (unit === 'kg') return row.weightKg ?? null;
	return row.reps ?? null;
}

/** Dernière valeur non nulle de la liste (ordre chronologique croissant). */
function latestValue(sorted: readonly SetLogLike[], unit: ExerciseUnit) {
	for (let i = sorted.length - 1; i >= 0; i--) {
		const value = valueInUnit(sorted[i], unit);
		if (value != null) return { date: sorted[i].date, value };
	}
	return null;
}

/** Dernière valeur non nulle de la PREMIÈRE séance (ordre croissant). */
function firstValue(sorted: readonly SetLogLike[], unit: ExerciseUnit) {
	const firstDate = sorted[0]?.date;
	let found: { date: string; value: number } | null = null;
	for (const r of sorted) {
		if (r.date !== firstDate) break;
		const value = valueInUnit(r, unit);
		if (value != null) found = { date: r.date, value };
	}
	return found;
}

/**
 * Charge de départ (première séance) et charge actuelle (dernière séance) de
 * chaque exercice travaillé, avec l'écart dans l'unité de l'exercice.
 * Poids du corps ou durée : l'écart porte sur les répétitions / les secondes.
 * Tri : exercices les plus récemment travaillés en premier.
 */
export function exerciseProgressions(rows: readonly SetLogLike[]): ExerciseProgression[] {
	const by = new Map<string, SetLogLike[]>();
	for (const r of rows) {
		if (r.done === false) continue;
		const list = by.get(r.exerciseId) ?? [];
		list.push(r);
		by.set(r.exerciseId, list);
	}
	const out: ExerciseProgression[] = [];
	for (const [exerciseId, list] of by) {
		const sorted = [...list].sort(
			(a, b) => a.date.localeCompare(b.date) || a.setOrder - b.setOrder
		);
		const head = sorted[0];
		const recent = sorted[sorted.length - 1];
		// Unité : durée si la dernière série est en temps, sinon charge si une
		// charge existe, sinon répétitions (poids du corps).
		const unit: ExerciseUnit = recent.mode === 'time' ? 's' : lastLoad(sorted) ? 'kg' : 'reps';
		const start = firstValue(sorted, unit);
		const current = latestValue(sorted, unit);
		out.push({
			exerciseId,
			name: head.exerciseName,
			unit,
			sessions: new Set(sorted.map((r) => r.date)).size,
			startDate: head.date,
			startValue: start?.value ?? null,
			currentDate: current?.date ?? head.date,
			currentValue: current?.value ?? null,
			delta:
				start != null && current != null
					? Math.round((current.value - start.value) * 10) / 10
					: null,
		});
	}
	return out.sort((a, b) => b.currentDate.localeCompare(a.currentDate) || a.name.localeCompare(b.name));
}

/** Écart affiché : « +4 kg », « ±0 kg », « -2 kg », « +2 reps », « +5 s ». */
export function progressionDeltaLabel(p: { unit: ExerciseUnit; delta: number | null }): string {
	if (p.delta == null) return '—';
	const suffix = p.unit === 's' ? ' s' : p.unit === 'reps' ? ' reps' : ' kg';
	const sign = p.delta > 0 ? '+' : p.delta < 0 ? '-' : '±';
	return `${sign}${fmtNumber(Math.abs(p.delta))}${suffix}`;
}
