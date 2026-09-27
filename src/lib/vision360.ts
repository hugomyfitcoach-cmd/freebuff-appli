/**
 * VISION 360 — PHOTO LIVE AU MOMENT DE LA CONSULTATION (module PUR).
 *
 * RÈGLE MÉTIER CENTRALE : la Vision 360 n'est JAMAIS figée à la date
 * d'envoi du bilan. Le questionnaire reste figé ; les données ci-dessous
 * sont recalculées à CHAQUE consultation sur une fenêtre de
 *
 *   7 DERNIÈRES JOURNÉES CALENDAIRES COMPLÈTES (J-7 → J-1)
 *
 * — des journées CIVILES (00:00 → 23:59:59) terminées, pas une fenêtre
 * glissante de 168 h, et la journée en cours est TOUJOURS exclue (ses
 * calories, pas et activités sont encore partiels). Consulté dimanche :
 * dimanche précédent → samedi. Consulté lundi : lundi précédent →
 * dimanche terminé.
 *
 * FUSEAU DE RÉFÉRENCE : Europe/Paris — via Intl.DateTimeFormat (ICU du
 * runtime, gère été/hiver), JAMAIS un `new Date()` serveur naïf ni une
 * soustraction d'heures UTC. La conversion timestamp → "yyyy-mm-dd"
 * s'appuie sur le calendrier parisien ; les comparaisons ultérieures se
 * font sur les clés ISO (aucun décalage autour de minuit).
 *
 * Module PUR : aucune I/O, aucun accès base, aucun Date.now() implicite —
 * l'instant de consultation est toujours passé en argument. Partagé
 * CLIENT (Svelte) / SERVEUR (Convex, BFF) : une seule définition de la
 * fenêtre, une seule définition d'une journée alimentaire exploitable —
 * calories et protéines ne peuvent pas diverger.
 */

/* ───────────────────────── Fenêtre temporelle ───────────────────────── */

export const VISION360_TIMEZONE = 'Europe/Paris';
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Formatter réutilisé (Intl est coûteux à instancier). */
const parisPartsFmt = new Intl.DateTimeFormat('en-CA', {
	timeZone: VISION360_TIMEZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
});

/**
 * Date locale "yyyy-mm-dd" DANS LE FUSEAU DE RÉFÉRENCE pour l'instant
 * `ms` — la clé calendaire de la journée parisienne en cours.
 */
export function parisTodayISO(ms: number = Date.now()): string {
	const parts = parisPartsFmt.formatToParts(new Date(ms));
	const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	return `${g('year')}-${g('month')}-${g('day')}`;
}

function assertISO(iso: string, label: string): void {
	if (!ISO_RE.test(iso)) throw new Error(`${label} doit être "yyyy-mm-dd" (reçu : ${iso}).`);
}

/**
 * Clé ISO décalée de `days` jours (pur — passe par midi local, robuste aux
 * transitions d'heure ; les clés ISO restent des clés, pas des instants).
 */
export function shiftISO(iso: string, days: number): string {
	assertISO(iso, 'iso');
	const d = new Date(iso + 'T12:00:00');
	d.setDate(d.getDate() + days);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type VisionWindow = {
	/** Les 7 clés ISO J-7 → J-1, du plus ancien au plus récent. */
	days: string[];
	/**Premier jour analysé (= days[0], inclusif). */
	start: string;
	/** Dernier jour analysé (= days[6], inclusif) — hier. */
	end: string;
	/** Le jour de consultation (toujours EXCLU de la fenêtre). */
	today: string;
};

/**
 * Les 7 DERNIÈRES JOURNÉES CALENDAIRES COMPLÈTES avant `todayISO`.
 * todayISO = la clé parisienne du jour de consultation (`parisTodayISO(ms)`).
 * La journée en cours n'apparaît JAMAIS dans la fenêtre.
 */
export function visionWindow(todayISO: string): VisionWindow {
	assertISO(todayISO, 'todayISO');
	const days = last7CompletedDays(todayISO);
	return { days, start: days[0], end: days[6], today: todayISO };
}

/** Les 7 journées TERMINÉES avant `todayISO` (J-7 → J-1). */
export function last7CompletedDays(todayISO: string): string[] {
	assertISO(todayISO, 'todayISO');
	const out: string[] = [];
	for (let i = 7; i >= 1; i--) out.push(shiftISO(todayISO, -i));
	return out;
}

/* ────────────────────── Journées alimentaires exploitables ────────────────────── */

/** Plancher du seuil d'exploitabilité (kcal) — règle de référence de la mission. */
export const EXPLOITABLE_FLOOR_KCAL = 800;
/** Part de l'objectif calorique déclenchant le doute de complétude (60 %). */
export const EXPLOITABLE_GOAL_RATIO = 0.6;

/**
 * SEUIL D'EXPLOITABILITÉ = max(800 kcal, 60 % de l'objectif calorique).
 *
 * Une journée dont le total est SOUS ce seuil est considérée comme
 * POTENTIELLEMENT INCOMPLÈTE (tracking oublié — ex. petit-déj + déjeuner
 * sans dîner) et est exclue des moyennes calories ET protéines de la
 * Vision 360. Le Journal reste intact : rien n'est supprimé ni modifié —
 * la donnée est seulement écartée du calcul de moyenne.
 */
export function exploitabilityThresholdKcal(goalKcal: number | null | undefined): number {
	if (goalKcal == null || !isFinite(goalKcal) || goalKcal <= 0) return EXPLOITABLE_FLOOR_KCAL;
	return Math.max(EXPLOITABLE_FLOOR_KCAL, Math.round(goalKcal * EXPLOITABLE_GOAL_RATIO));
}

/** Journée exploitables? (total ≥ seuil). Une absence (null) n'est PAS une journée partielle. */
export function isExploitableDay(totalKcal: number | null, goalKcal: number | null | undefined): boolean {
	if (totalKcal == null || !isFinite(totalKcal)) return false;
	return totalKcal >= exploitabilityThresholdKcal(goalKcal);
}

export type DayFoodTotals = {
	date: string;
	/** Total kcal du jour — null = AUCUNE donnée ce jour-là (≠ 0). */
	kcal: number | null;
	/** Protéines du jour (g) — null = aucune donnée. */
	protein: number | null;
};

export type Exploitability = {
	/** Jours avec données (≥ 1 entrée), exploitables ou non. */
	daysWithData: number;
	/** Jours exploitables (au-dessus du seuil) — dénominateur des moyennes. */
	exploitableDays: number;
	/** Jours partiellement renseignés EXCLUS des moyennes. */
	partialDays: number;
	/** Jours sans aucune donnée (absence ≠ 0 ≠ partiel). */
	absentDays: number;
};

/** Comptage des 4 catégories de journées sur la fenêtre. */
export function foodDayBreakdown(
	totals: Map<string, { kcal: number | null; protein: number | null }>,
	days: string[],
	goalKcal: number | null | undefined
): Exploitability {
	let daysWithData = 0;
	let exploitableDays = 0;
	let partialDays = 0;
	let absentDays = 0;
	for (const d of days) {
		const t = totals.get(d);
		if (!t || t.kcal == null || !isFinite(t.kcal)) {
			absentDays += 1;
			continue;
		}
		daysWithData += 1;
		if (t.kcal >= exploitabilityThresholdKcal(goalKcal)) exploitableDays += 1;
		else partialDays += 1;
	}
	return { daysWithData, exploitableDays, partialDays, absentDays };
}

export type FoodAverages = {
	/** Moyenne kcal sur les SEULS jours exploitables — null si aucun. */
	kcalAvg: number | null;
	/** Moyenne protéines sur EXACTEMENT les mêmes jours exploitables. */
	proteinAvg: number | null;
	/** 4 catégories de journées (voir foodDayBreakdown). */
	breakdown: Exploitability;
};

/**
 * MOYENNES ALIMENTAIRES VISION 360 — calories ET protéines sur EXACTEMENT
 * les MÊMES journées exploitables (une seule définition d'une journée
 * complète : si une journée est exclue des calories, elle l'est aussi des
 * protéines — ses protéines seraient artificiellement basses aussi).
 */
export function foodAverages(
	totals: Map<string, { kcal: number | null; protein: number | null }>,
	days: string[],
	goalKcal: number | null | undefined
): FoodAverages {
	const breakdown = foodDayBreakdown(totals, days, goalKcal);
	let kcalSum = 0;
	let proteinSum = 0;
	for (const d of days) {
		const t = totals.get(d);
		if (!t || t.kcal == null || !isFinite(t.kcal)) continue;
		if (t.kcal < exploitabilityThresholdKcal(goalKcal)) continue; // partiel → exclu des deux
		kcalSum += t.kcal;
		if (t.protein != null && isFinite(t.protein)) proteinSum += t.protein;
	}
	const n = breakdown.exploitableDays;
	return {
		kcalAvg: n > 0 ? Math.round(kcalSum / n) : null,
		proteinAvg: n > 0 ? Math.round((proteinSum / n) * 10) / 10 : null,
		breakdown,
	};
}

/* ────────────────────────────── PAS ────────────────────────────── */

export type StepsAverages = {
	/** Moyenne sur les SEULS jours renseignés — null si aucun. */
	avg: number | null;
	/** X/7 journées renseignées (une absence n'est jamais un 0). */
	trackedDays: number;
	/** Série alignée sur la fenêtre : count = null si aucune saisie. */
	series: { date: string; count: number | null }[];
};

/**
 * Pas — moyenne sur les jours renseignés uniquement. Une VRAIE valeur 0
 * (saisie explicite) reste comptée : c'est une donnée, pas une absence.
 */
export function stepsAverages(
	rows: { date: string; count: number | null }[],
	days: string[]
): StepsAverages {
	const byDay = new Map<string, number | null>();
	for (const r of rows) byDay.set(r.date, r.count);
	const series = days.map((date) => ({ date, count: byDay.get(date) ?? null }));
	let sum = 0;
	let trackedDays = 0;
	for (const d of series) {
		if (d.count === null || !isFinite(d.count)) continue;
		sum += d.count;
		trackedDays += 1;
	}
	return { avg: trackedDays > 0 ? Math.round(sum / trackedDays) : null, trackedDays, series };
}

/* ───────────────────────────── POIDS ───────────────────────────── */

export type WeightPoint = { date: string; weightKg: number };

export type WeightVision = {
	/** Moyenne des pesées RÉELLES de la période — null si aucune pesée. */
	avg: number | null;
	/** Nombre de pesées sur la période. */
	count: number;
	/** Dernière pesée (chronologiquement la plus récente) de la période. */
	last: { date: string; weightKg: number } | null;
	/** Dernière pesée de la période précédente (J-14 → J-8). */
	prevLast: { date: string; weightKg: number } | null;
	/** Delta last − prevLast (arrondi 0,1) — null si incomparable. */
	delta: number | null;
};

/**
 * POIDS — les DEUX informations demandées :
 *  1. moyenne des pesées réellement enregistrées pendant la période
 *     (une journée sans pesée n'entre simplement pas dans la moyenne —
 *     jamais un 0 kg inventé) ;
 *  2. dernière pesée de la période VS dernière pesée de la période
 *     précédente (J-14 → J-8 = les 7 journées immédiatement avant la
 *     fenêtre courante), delta signé — "comparaison indisponible" propre
 *     si l'une des deux périodes n'a aucune pesée.
 */
export function weightVision(rows: WeightPoint[], days: string[]): WeightVision {
	const start = days[0];
	const end = days[6];
	// Période précédente : les 7 journées immédiatement avant la fenêtre
	// courante = J-14 → J-8 (start−7 → start−1).
	const prevStart = shiftISO(start, -7);
	const prevEnd = shiftISO(start, -1);
	// Tri défensif par DATE : « dernière pesée » = date la plus récente,
	// jamais la dernière ligne saisie (une pesée rétrodatée reste à sa place).
	const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
	const inCur = sorted.filter((r) => r.date >= start && r.date <= end);
	const inPrev = sorted.filter((r) => r.date >= prevStart && r.date <= prevEnd);
	const avg = inCur.length > 0 ? inCur.reduce((s, r) => s + r.weightKg, 0) / inCur.length : null;
	const last = inCur.length > 0 ? inCur[inCur.length - 1] : null;
	const prevLast = inPrev.length > 0 ? inPrev[inPrev.length - 1] : null;
	// Double arrondi (0,01 puis 0,1) : évite l'artefact flottant où une
	// moyenne exactement x,x5 retombe en dessous (60,75 → 60,7 au lieu de 60,8).
	const round10 = (n: number) => Math.round(Math.round(n * 100) / 100 * 10) / 10;
	return {
		avg: avg !== null ? round10(avg) : null,
		count: inCur.length,
		last: last ? { date: last.date, weightKg: last.weightKg } : null,
		prevLast: prevLast ? { date: prevLast.date, weightKg: prevLast.weightKg } : null,
		delta: last && prevLast ? Math.round((last.weightKg - prevLast.weightKg) * 10) / 10 : null,
	};
}

/* ──────────────────────── DÉPENSE SPORTIVE ──────────────────────── */

export type SportDayInput = {
	date: string;
	durationMinutes: number;
	/** "manual" | "gflux_training" (schéma sportActivities). */
	source?: string;
	estimatedCalories?: number | null;
	metMinutes?: number | null;
};

export type SportVision = {
	activities: number;
	durationMin: number;
	kcal: number;
	metMinutes: number;
	manualCount: number;
	trainingCount: number;
};

/** Somme des activités appartenant STRICTEMENT aux 7 journées complètes. */
export function sportVision(rows: SportDayInput[], days: string[]): SportVision {
	const daySet = new Set(days);
	const out: SportVision = {
		activities: 0,
		durationMin: 0,
		kcal: 0,
		metMinutes: 0,
		manualCount: 0,
		trainingCount: 0,
	};
	for (const r of rows) {
		if (!daySet.has(r.date)) continue;
		out.activities += 1;
		out.durationMin += r.durationMinutes;
		out.kcal += r.estimatedCalories ?? 0;
		out.metMinutes += r.metMinutes ?? 0;
		if (r.source === 'gflux_training') out.trainingCount += 1;
		else out.manualCount += 1;
	}
	out.durationMin = Math.round(out.durationMin);
	out.kcal = Math.round(out.kcal);
	out.metMinutes = Math.round(out.metMinutes);
	return out;
}

/* ──────────────────────────── MENSURATIONS ──────────────────────────── */

export type MensurationPoint = {
	date: string;
	weightKg?: number;
	neckCm?: number;
	waistCm?: number;
	hipCm?: number;
};

export type MensurationCompare = {
	/** Date du relevé le plus récent. */
	date: string;
	/** Date du relevé précédent — null si aucun. */
	prevDate: string | null;
	/** Jour(s) d'écart entre les deux relevés — null si pas de précédent. */
	daysAgo: number | null;
	waistCm: number | null;
	hipCm: number | null;
	neckCm: number | null;
	deltas: { waistCm: number | null; hipCm: number | null; neckCm: number | null };
};

/**
 * MENSURATIONS — PAS de fenêtre J-7 → J-1 : dernier relevé disponible VS
 * relevé immédiatement précédent, AU MOMENT de la consultation. Delta par
 * MESURE : une mesure absente dans l'un des relevés n'invente jamais de
 * delta (affichée seule, sans comparaison).
 */
export function mensurationsVision(rows: MensurationPoint[]): MensurationCompare | null {
	const mens = [...rows]
		.filter((m) => m.waistCm !== undefined || m.hipCm !== undefined || m.neckCm !== undefined)
		.sort((a, b) => a.date.localeCompare(b.date));
	if (mens.length === 0) return null;
	const latest = mens[mens.length - 1];
	const prev = mens.length > 1 ? mens[mens.length - 2] : null;
	const prevDate = prev?.date ?? null;
	const daysAgo = prevDate
		? Math.round((new Date(latest.date + 'T12:00:00').getTime() - new Date(prevDate + 'T12:00:00').getTime()) / 86400000)
		: null;
	const deltaOf = (key: 'waistCm' | 'hipCm' | 'neckCm'): number | null => {
		const cur = latest[key];
		if (cur === undefined) return null;
		// Dernière valeur connue de CETTE mesure avant le dernier relevé
		// (peut être un relevé plus ancien que le relevé "précédent").
		for (let i = mens.length - 2; i >= 0; i--) {
			const v = mens[i][key];
			if (v !== undefined) return Math.round((cur - v) * 10) / 10;
		}
		return null;
	};
	return {
		date: latest.date,
		prevDate,
		daysAgo,
		waistCm: latest.waistCm ?? null,
		hipCm: latest.hipCm ?? null,
		neckCm: latest.neckCm ?? null,
		deltas: { waistCm: deltaOf('waistCm'), hipCm: deltaOf('hipCm'), neckCm: deltaOf('neckCm') },
	};
}

/* ─────────────────────────── Formatage dates ─────────────────────────── */

/** "2026-09-26" → "26 sept." (sans année) — discret, pour les repères. */
export function fmtDateShort(iso: string): string {
	assertISO(iso, 'iso');
	const d = new Date(iso + 'T12:00:00');
	return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** "2026-09-26" → "26 sept. 2025" — avec année. */
export function fmtDateLong(iso: string): string {
	assertISO(iso, 'iso');
	const d = new Date(iso + 'T12:00:00');
	return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
