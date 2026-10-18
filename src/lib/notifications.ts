/**
 * Notifications coach (CRM) — libellés, icônes et couleur côté client.
 * Miroir des littéraux de `coachNotifKind` (src/convex/schema.ts) : toute
 * nouvelle valeur doit être déclarée des deux côtés (liste fermée).
 */

export type CoachNotifKind =
	| 'nouveau_poids'
	| 'nouvelles_mesures'
	| 'nouvelles_photos'
	| 'bilan_envoye'
	| 'plan_assigned'
	| 'rdv_pris'
	| 'rdv_annule'
	| 'rdv_replanifie'
	| 'onboarding_termine'
	| 'inactivite';

/** Section de la Vision 360 ouverte par chaque type d'événement. */
const SECTION_BY_KIND: Record<CoachNotifKind, string> = {
	nouveau_poids: 'corps',
	nouvelles_mesures: 'corps',
	nouvelles_photos: 'photos',
	bilan_envoye: 'bilans',
	plan_assigned: 'plan',
	rdv_pris: 'rdv',
	rdv_annule: 'rdv',
	rdv_replanifie: 'rdv',
	onboarding_termine: 'demarrage',
	inactivite: 'apercu',
};

/** Libellé court de l'événement (le titre de la notification). */
const LABEL_BY_KIND: Record<CoachNotifKind, string> = {
	nouveau_poids: 'Nouveau poids',
	nouvelles_mesures: 'Nouvelles mensurations',
	nouvelles_photos: 'Nouvelles photos',
	bilan_envoye: 'Bilan hebdo envoyé',
	plan_assigned: 'Plan de repas assigné',
	rdv_pris: 'Rendez-vous pris',
	rdv_annule: 'Rendez-vous annulé',
	rdv_replanifie: 'Rendez-vous replanifié',
	onboarding_termine: 'Formulaire de démarrage complété',
	inactivite: 'Aucune connexion depuis 4 jours',
};

/** Icône Lucide (registre Icon.svelte) + couleur Tailwind de l'accent. */
const STYLE_BY_KIND: Record<CoachNotifKind, { icon: string; text: string; bg: string }> = {
	nouveau_poids: { icon: 'scale', text: 'text-brand-dark', bg: 'bg-brand-light' },
	nouvelles_mesures: { icon: 'ruler', text: 'text-brand-dark', bg: 'bg-brand-light' },
	nouvelles_photos: { icon: 'camera', text: 'text-brand-dark', bg: 'bg-brand-light' },
	bilan_envoye: { icon: 'clipboardCheck', text: 'text-brand-dark', bg: 'bg-brand-light' },
	plan_assigned: { icon: 'utensils', text: 'text-brand-dark', bg: 'bg-brand-light' },
	rdv_pris: { icon: 'calendarCheck', text: 'text-brand-dark', bg: 'bg-brand-light' },
	rdv_annule: { icon: 'calendarX', text: 'text-danger', bg: 'bg-danger-light' },
	rdv_replanifie: { icon: 'calendarClock', text: 'text-warn', bg: 'bg-warn-light' },
	onboarding_termine: { icon: 'rocket', text: 'text-brand-dark', bg: 'bg-brand-light' },
	inactivite: { icon: 'bellOff', text: 'text-warn', bg: 'bg-warn-light' },
};

/** URL du Vision 360 de la cliente, ouvert directement sur la bonne section. */
export function notifLink(userId: string, kind: CoachNotifKind): string {
	const section = SECTION_BY_KIND[kind] ?? 'apercu';
	return `/admin?client=${encodeURIComponent(userId)}&section=${section}`;
}

export function notifLabel(kind: CoachNotifKind): string {
	return LABEL_BY_KIND[kind] ?? kind;
}

export function notifStyle(kind: CoachNotifKind): { icon: string; text: string; bg: string } {
	return STYLE_BY_KIND[kind] ?? { icon: 'bell', text: 'text-mist', bg: 'bg-line' };
}

/* ── Tendance des notifications « Nouveau poids » (module PUR) ──
   La tendance compare la nouvelle pesée à la pesée chronologiquement
   PRÉCÉDENTE de la cliente — par dates effectives, jamais par ordre
   d'affichage des notifications. */

export type WeightTrend = 'down' | 'flat' | 'up' | 'first';

/** Parse une valeur kg (« 62,4 » / "62.4" / 62.4) — null si inexploitable. */
const toKg = (v: string | number | null | undefined): number | null => {
	if (v == null) return null;
	const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
	return isFinite(n) ? n : null;
};

/**
 * Tendance FACTUELLE : poids inférieur → 'down' (flèche verte), identique →
 * 'flat' (flèche grise), supérieur → 'up' (flèche orange). Sans pesée
 * précédente (première pesée / historique absent) → 'first' (neutre).
 */
export function weightTrend(
	poids: string | number | null | undefined,
	poidsPrecedent: string | number | null | undefined
): WeightTrend {
	const cur = toKg(poids);
	const prev = toKg(poidsPrecedent);
	if (cur === null || prev === null) return 'first';
	if (cur < prev) return 'down';
	if (cur > prev) return 'up';
	return 'flat';
}

/** Pastille/icône de la tendance (mêmes jetons UI que les notifications). */
export function weightTrendUi(trend: WeightTrend): { icon: string; tile: string } {
	if (trend === 'down') return { icon: 'trendingDown', tile: 'bg-brand-light text-brand-deep' };
	if (trend === 'up') return { icon: 'trendingUp', tile: 'bg-warn-light text-warn' };
	if (trend === 'flat') return { icon: 'minus', tile: 'bg-soft text-mist' };
	return { icon: 'scale', tile: 'bg-soft text-mist' };
}

/**
 * Pesée chronologiquement PRÉCÉDENTE d'une date (strictement antérieure) :
 * tri par DATE effective des pesées, jamais par ordre d'insertion — une
 * pesée rétrodatée reste à sa place. Les lignes sans poids sont ignorées.
 * Null = historique absent (première pesée).
 */
export function previousWeighInKg(
	rows: { date: string; weightKg?: number | null }[],
	date: string
): number | null {
	const sorted = rows
		.filter((r) => r.weightKg != null && isFinite(r.weightKg) && r.date < date)
		.sort((a, b) => a.date.localeCompare(b.date));
	if (sorted.length === 0) return null;
	return sorted[sorted.length - 1].weightKg as number;
}

/** « Aujourd'hui 14:32 » / « hier 09:05 » / « ven. 5 sept. 18:40 ». */
export function fmtNotifDate(ts: number): string {
	const d = new Date(ts);
	const now = new Date();
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	if (ts >= startOfToday) return `aujourd'hui ${time}`;
	if (ts >= startOfToday - 86400000) return `hier ${time}`;
	const day = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
	return `${day} ${time}`;
}
