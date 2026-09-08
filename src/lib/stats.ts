import type { Doc } from '../convex/_generated/dataModel.js';

export type Checkin = Doc<'checkins'>;

export type SeriePoint = {
	weekStart: string;
	label: string;
	motivation: number | null;
	adherence: string | null;
	evolution: string | null;
	pas: string | null;
	feedback?: string;
	status: 'nouveau' | 'retour_envoye';
};

/** Bilans triés du plus ancien au plus récent, sous forme compacte pour les graphiques. */
export function series(checkins: Checkin[]): SeriePoint[] {
	const a = [...checkins].sort((x, y) => x.weekStart.localeCompare(y.weekStart));
	return a.map((c) => ({
		weekStart: c.weekStart,
		label: c.weekLabel,
		motivation: typeof c.answers.motivation === 'number' ? c.answers.motivation : null,
		adherence: typeof c.answers.adherence === 'string' ? c.answers.adherence : null,
		evolution: typeof c.answers.evolution === 'string' ? c.answers.evolution : null,
		pas: typeof c.answers.pas === 'string' ? c.answers.pas : null,
		feedback: c.feedback,
		status: c.status,
	}));
}

export function avgMotivation(points: SeriePoint[]): number | null {
	const vals = points.map((p) => p.motivation).filter((v): v is number => v !== null);
	if (vals.length === 0) return null;
	return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10;
}

export function lastMotivation(points: SeriePoint[]): number | null {
	const last = [...points].reverse().find((p) => p.motivation !== null);
	return last?.motivation ?? null;
}

export function countAdherence(points: SeriePoint[], value: string): number {
	return points.filter((p) => p.adherence === value).length;
}

export function victories(checkins: Checkin[]): Array<{ weekLabel: string; text: string }> {
	return checkins
		.filter((c) => typeof c.answers.victoire === 'string' && c.answers.victoire.trim().length > 0)
		.sort((a, b) => b.weekStart.localeCompare(a.weekStart))
		.map((c) => ({ weekLabel: c.weekLabel, text: c.answers.victoire as string }));
}

/** Rappels mensurations / photos déclarés par le client (semaine par semaine). */
export function trackingWeeks(checkins: Checkin[]) {
	const out: Array<{ weekLabel: string; mensurations: boolean; photos: boolean }> = [];
	for (const c of [...checkins].sort((a, b) => b.weekStart.localeCompare(a.weekStart))) {
		out.push({
			weekLabel: c.weekLabel,
			mensurations: c.answers.mensurations === 'oui',
			photos: c.answers.photos === 'oui',
		});
	}
	return out;
}

export const MOTIVATION_COLOR = (v: number) =>
	v <= 2 ? '#ff4444' : v === 3 ? '#f0c000' : '#1db954';

/** Libellés courts de légende. */	export const ADHERENCE_LABEL: Record<string, string> = {
		oui: 'Oui',
		partiel: 'Partiel',
		non: 'Non',
	};
