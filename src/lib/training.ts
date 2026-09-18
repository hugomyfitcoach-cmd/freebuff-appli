/**
 * Module Entraînement — types et helpers partagés (CRM coach).
 *
 * Résumé de prescription compact (aperçu sous le nom d'un exercice dans la
 * colonne centrale, à la VirtuaGym) : « 3 × 8–12 · 70 kg · RIR 2 · 90 s ».
 * Les exercices en mode temps affichent « 3 × 60 s · 30 s repos ».
 */

export type TrainingSetView = {
	_id: string;
	order: number;
	repsMin?: number;
	repsMax?: number;
	targetWeight?: number;
	targetRir?: number;
	restSeconds?: number;
	durationSeconds?: number;
};

export type SessionExerciseView = {
	_id: string;
	order: number;
	mode: 'reps' | 'time';
	tempo?: string;
	coachNote?: string;
	techniqueNote?: string;
	exercise: {
		_id: string;
		gfluxExerciseId: string;
		name: string;
		muscleGroup?: string;
		bodyPart?: string;
		equipment?: string;
		mediaUrl?: string;
		thumbnailUrl?: string;
		sourceMediaUrl?: string;
		posterUrl?: string;
		animationUrl?: string;
		instructions?: string[];
	} | null;
	sets: TrainingSetView[];
};

export type SessionView = {
	_id: string;
	name: string;
	order: number;
	exercises: SessionExerciseView[];
};

export type ProgramView = {
	_id: string;
	name: string;
	description?: string;
	goal?: string;
	goalLabel?: string;
	level?: string;
	levelLabel?: string;
	sessionsPerWeek?: number;
	imageStorageId?: string;
	imageUrl?: string;
	createdAt: number;
	updatedAt: number;
};

/** Ligne de la liste des programmes (page Programmes). */
export type ProgramRow = ProgramView & { sessionCount: number };

/** Libellé compact d'une série (colonne centrale + fiche). */
export function setSummary(s: TrainingSetView, mode: 'reps' | 'time'): string {
	if (mode === 'time') {
		const parts: string[] = [];
		if (s.durationSeconds) parts.push(`${s.durationSeconds} s`);
		if (s.restSeconds) parts.push(`repos ${s.restSeconds} s`);
		return parts.join(' · ') || '—';
	}
	const parts: string[] = [];
	if (s.repsMin != null && s.repsMax != null && s.repsMin !== s.repsMax) parts.push(`${s.repsMin}–${s.repsMax}`);
	else if (s.repsMin != null) parts.push(`${s.repsMin}`);
	else if (s.repsMax != null) parts.push(`≤ ${s.repsMax}`);
	if (s.targetWeight != null) parts.push(`${fmtNum(s.targetWeight)} kg`);
	if (s.targetRir != null) parts.push(`RIR ${s.targetRir}`);
	if (s.restSeconds != null) parts.push(`${s.restSeconds} s`);
	return parts.join(' · ') || '—';
}

/** Aperçu compact sous le nom d'un exercice (colonne centrale). */
export function exercisePreview(e: SessionExerciseView): string {
	const n = e.sets.length;
	if (n === 0) return e.mode === 'time' ? 'Aucune série' : 'Aucune série';
	const first = e.sets[0];
	const rest = first.restSeconds;
	const head =
		e.mode === 'time'
			? `${n} × ${first.durationSeconds ?? '?'} s`
			: `${n} × ${setSummary({ ...first, restSeconds: undefined }, 'reps')}`;
	return rest != null ? `${head} · ${rest} s` : head;
}

/** "8-12" → { repsMin: 8, repsMax: 12 } · "10" → { repsMin: 10, repsMax: 10 }. */
export function parseRepsField(raw: string): { repsMin: number | null; repsMax: number | null } | null {
	const t = raw.trim().replace(/\s/g, '');
	if (!t) return null;
	const m = t.match(/^(\d{1,3})(?:[-–](\d{1,3}))?$/);
	if (!m) return null;
	const a = Number(m[1]);
	const b = m[2] ? Number(m[2]) : a;
	if (a < 1 || b < 1 || a > 100 || b > 100 || b < a) return null;
	return { repsMin: a, repsMax: b };
}

/** Affiche la plage de reps d'une série (« 8–12 » ou « 10 »). */
export function repsLabel(s: TrainingSetView): string {
	if (s.repsMin != null && s.repsMax != null && s.repsMin !== s.repsMax) return `${s.repsMin}–${s.repsMax}`;
	if (s.repsMin != null) return String(s.repsMin);
	if (s.repsMax != null) return String(s.repsMax);
	return '';
}

function fmtNum(n: number): string {
	return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}
