/**
 * Module Dépense sportive — CATALOGUE CENTRALISÉ des sports + calcul.
 *
 * SOURCE UNIQUE des coefficients : ce module est le SEUL endroit du dépôt
 * qui connaît les MET (le frontend ne fait qu'afficher ce que le backend
 * calcule — jamais une table dispersée côté client).
 *
 * Sources des coefficients :
 * - `gflux_table`  : tableau G-FLUX coach (kcal/kg/heure) — conversion
 *   documentée MET ≈ kcal/kg/h ÷ 1,05 (1 MET ≈ 3,5 ml O₂/kg/min). Les
 *   valeurs intermédiaires « modérée » sont interpolées géométriquement
 *   entre les deux bornes G-FLUX (jamais inventées arbitrairement).
 * - `compendium`   : Compendium of Physical Activities (Ainsworth et al.) —
 *   valeurs MET standard par activité/intensité. Les quelques estimations
 *   (padel, HIIT) portent une note explicite ci-dessous.
 *
 * RÈGLE ANTI DOUBLE COMPTAGE : la marche quotidienne (pas, déplacements,
 * promenades) est déjà couverte par `dailySteps` + le niveau de marche du
 * calibrage — elle n'existe JAMAIS dans ce catalogue. Seule la marche
 * cardio volontaire (« Marche inclinée sur tapis ») est proposée.
 */

import { ConvexError } from "convex/values";

/** Version du catalogue — stockée sur chaque dépense (coefficientVersion). */
export const SPORT_CATALOG_VERSION = "1";

/** Intensités fermées côté cliente — le mot MET n'est JAMAIS affiché. */
export type SportIntensity = "legere" | "moderee" | "intense";
export const SPORT_INTENSITIES: SportIntensity[] = ["legere", "moderee", "intense"];
export const SPORT_INTENSITY_LABELS: Record<SportIntensity, string> = {
	legere: "Légère",
	moderee: "Modérée",
	intense: "Intense",
};

export type SportCoefficientSource = "gflux_table" | "compendium";

export type SportCatalogEntry = {
	/** Identifiant stable (slug) référencé par les dépenses. */
	id: string;
	name: string;
	category: string;
	/** MET par intensité — ou nombre fixe pour les activités sans intensité. */
	met: Partial<Record<SportIntensity, number>> | number;
	source: SportCoefficientSource;
	/** Note de traçabilité (estimation signalée, conversion…). */
	note?: string;
};

/** Catégories affichées dans l'ordre (ajout rapide → recherche → catégories). */
export const SPORT_CATEGORIES: { id: string; label: string }[] = [
	{ id: "musculation", label: "Musculation" },
	{ id: "cardio", label: "Cardio & salle" },
	{ id: "eau", label: "Natation & eau" },
	{ id: "collectifs", label: "Cours & douceurs" },
	{ id: "hiit", label: "HIIT & circuits" },
	{ id: "raquette", label: "Sports de raquette" },
	{ id: "equipe", label: "Sports collectifs" },
	{ id: "glisse", label: "Glisse & hiver" },
	{ id: "autres", label: "Autres" },
];

/**
 * Catalogue V1 — sans Marche / Marche rapide / Promenade / Balade (déjà
 * comptées par les pas) et sans Randonnée (validé : exclue en V1, approche
 * conservatrice anti double comptage).
 */
export const SPORT_CATALOG: SportCatalogEntry[] = [
	// ── Musculation — tableau G-FLUX (récréative 2,2 · intensive 4,4 kcal/kg/h →
	//    MET 2,1 · 4,2 ; « modérée » interpolée ≈ 3,0) ──
	{
		id: "musculation",
		name: "Musculation",
		category: "musculation",
		met: { legere: 2.1, moderee: 3.0, intense: 4.2 },
		source: "gflux_table",
		note: "G-FLUX 2,2/4,4 kcal/kg/h ÷ 1,05 ; modérée = interpolation géométrique",
	},
	// ── Cardio & salle — Compendium (Marche inclinée = séance cardio VOLONTAIRE) ──
	{
		id: "marche-inclinee-tapis",
		name: "Marche inclinée sur tapis",
		category: "cardio",
		met: { legere: 4.3, moderee: 5.3, intense: 6.3 },
		source: "compendium",
		note: "Marche rapide → montée ; effort cardio volontaire ≠ marche quotidienne",
	},
	{
		id: "course-tapis",
		name: "Course (tapis)",
		category: "cardio",
		met: { legere: 6.0, moderee: 8.3, intense: 9.8 },
		source: "compendium",
	},
	{
		id: "velo-exterieur",
		name: "Vélo (extérieur)",
		category: "cardio",
		met: { legere: 3.5, moderee: 6.8, intense: 10.0 },
		source: "compendium",
	},
	{
		id: "velo-indoor",
		name: "Vélo indoor / spinning",
		category: "cardio",
		met: { legere: 4.5, moderee: 7.0, intense: 9.5 },
		source: "compendium",
	},
	{
		id: "elliptique",
		name: "Elliptique",
		category: "cardio",
		met: { legere: 4.5, moderee: 5.0, intense: 6.5 },
		source: "compendium",
	},
	{
		id: "rameur",
		name: "Rameur",
		category: "cardio",
		met: { legere: 4.0, moderee: 7.0, intense: 8.5 },
		source: "compendium",
	},
	{
		id: "escalier",
		name: "StairMaster / escalier",
		category: "cardio",
		met: { legere: 4.5, moderee: 7.0, intense: 9.0 },
		source: "compendium",
	},
	// ── Natation & eau ──
	{
		id: "natation",
		name: "Natation",
		category: "eau",
		met: { legere: 5.8, moderee: 7.0, intense: 9.8 },
		source: "compendium",
	},
	{
		id: "aquagym",
		name: "Aquagym",
		category: "eau",
		met: 4.0,
		source: "compendium",
	},
	// ── Cours & douceurs ──
	{
		id: "pilates",
		name: "Pilates",
		category: "collectifs",
		met: { legere: 2.5, moderee: 3.8, intense: 4.5 },
		source: "compendium",
	},
	{
		id: "yoga",
		name: "Yoga",
		category: "collectifs",
		met: { legere: 2.5, moderee: 3.0, intense: 4.0 },
		source: "compendium",
	},
	{
		id: "danse",
		name: "Danse",
		category: "collectifs",
		met: { legere: 3.5, moderee: 5.0, intense: 7.3 },
		source: "compendium",
	},
	// ── HIIT & circuits ──
	{
		id: "hiit",
		name: "HIIT",
		category: "hiit",
		met: { legere: 6.0, moderee: 7.5, intense: 9.0 },
		source: "compendium",
		note: "Estimation HIIT — variable selon format et récupérations",
	},
	{
		id: "circuit-training",
		name: "Circuit training",
		category: "hiit",
		met: { legere: 4.5, moderee: 6.0, intense: 8.0 },
		source: "compendium",
	},
	{
		id: "cross-training",
		name: "Cross training",
		category: "hiit",
		met: { legere: 5.0, moderee: 6.5, intense: 8.0 },
		source: "compendium",
	},
	// ── Sports de raquette ──
	{
		id: "tennis",
		name: "Tennis",
		category: "raquette",
		met: { legere: 5.0, moderee: 6.5, intense: 8.0 },
		source: "compendium",
		note: "Double (léger) → simple (intense)",
	},
	{
		id: "padel",
		name: "Padel",
		category: "raquette",
		met: { legere: 4.5, moderee: 5.5, intense: 7.0 },
		source: "compendium",
		note: "Estimation entre badminton et tennis (absent du Compendium 2011)",
	},
	{
		id: "badminton",
		name: "Badminton",
		category: "raquette",
		met: { legere: 4.5, moderee: 5.0, intense: 5.5 },
		source: "compendium",
	},
	// ── Sports collectifs ──
	{
		id: "football",
		name: "Football",
		category: "equipe",
		met: { legere: 5.5, moderee: 7.0, intense: 10.0 },
		source: "compendium",
	},
	{
		id: "basket",
		name: "Basket",
		category: "equipe",
		met: { legere: 4.5, moderee: 6.0, intense: 8.0 },
		source: "compendium",
	},
	// ── Glisse & hiver ──
	{
		id: "ski",
		name: "Ski",
		category: "glisse",
		met: { legere: 4.5, moderee: 6.0, intense: 8.0 },
		source: "compendium",
	},
	// ── Autres ──
	{
		id: "corde-a-sauter",
		name: "Corde à sauter",
		category: "autres",
		met: { legere: 8.8, moderee: 11.8, intense: 12.3 },
		source: "compendium",
	},
];

/** Activité sans intensité (MET fixe) ? */
export function sportHasIntensity(entry: SportCatalogEntry): boolean {
	return typeof entry.met !== "number";
}

/** Terme recherché → message pédagogique marche (jamais de Marche standard). */
export const WALKING_BLOCKED_RE =
	/march(e|er|es|ons|ez|ent)|promenade|promener|balade|ballade|randonn/i;
/** IDs sanctionnés EXCLUS du blocage : la marche INCLINÉE sur tapis est une
 *  vraie séance cardio VOLONTAIRE (jamais de la marche quotidienne) — c'est la
 *  seule suggestion proposée quand la cliente cherche « marche ». */
const WALKING_SANCTIONED_RE = /^marche-inclinee(-.*)?$/;
/**
 * Garde-fou anti double comptage : vrai si l'identifiant désigne une marche
 * QUOTIDIENNE (marche, marche rapide, promenade, balade, randonnée…) — mais
 * JAMAIS la séance cardio volontaire du tapis incliné, sanctionnée elle.
 */
export function isDailyWalkingBlocked(activityId: string): boolean {
	if (WALKING_SANCTIONED_RE.test(activityId)) return false;
	return WALKING_BLOCKED_RE.test(activityId);
}
export const WALKING_PEDAGOGY_MESSAGE =
	"La marche quotidienne est déjà prise en compte dans ton suivi. Tes pas et déplacements habituels ne doivent pas être ajoutés ici.";
/** Seule suggestion si recherche « marche » : la séance cardio volontaire. */
export const WALKING_SUGGESTION_ID = "marche-inclinee-tapis";

/* ── Résolution & calcul (backend uniquement) ── */

export function getSportEntry(activityId: string): SportCatalogEntry | null {
	return SPORT_CATALOG.find((a) => a.id === activityId) ?? null;
}

function requireSportEntry(activityId: string): SportCatalogEntry {
	const entry = getSportEntry(activityId);
	if (!entry) throw new ConvexError("Activité inconnue.");
	return entry;
}

function metOf(entry: SportCatalogEntry, intensity?: string): number {
	if (typeof entry.met === "number") return entry.met;
	const key = (intensity ?? "moderee") as SportIntensity;
	const met = entry.met[key];
	if (met == null) throw new ConvexError("Intensité invalide pour cette activité.");
	return met;
}

/** Clamp durée (1–600 min) — même borne haute que les séances G-FLUX. */
export function clampSportDuration(minutes: number): number {
	if (!Number.isFinite(minutes)) throw new ConvexError("Durée invalide.");
	return Math.round(Math.min(Math.max(minutes, 1), 600));
}

export type SportEstimation = {
	activityId: string;
	activityNameSnapshot: string;
	metValue: number;
	coefficientSource: SportCoefficientSource;
	coefficientVersion: string;
	/** kcal estimées — absent si aucune pesée connue (jamais de poids inventé). */
	estimatedCalories?: number;
	metMinutes: number;
};

/**
 * Calcul unique de la dépense : MET × poids × durée/60 (kcal) + MET-minutes.
 * `weightKg` absent → estimatedCalories absent (repère impossible sans
 * poids), les MET-minutes restent stockées (volume indépendant du poids).
 */
export function estimateSportActivity(args: {
	activityId: string;
	intensity?: string;
	durationMinutes: number;
	weightKg?: number | null;
}): SportEstimation {
	const entry = requireSportEntry(args.activityId);
	const minutes = clampSportDuration(args.durationMinutes);
	const metValue = metOf(entry, args.intensity);
	const metMinutes = Math.round(metValue * minutes);
	const out: SportEstimation = {
		activityId: entry.id,
		activityNameSnapshot: entry.name,
		metValue,
		coefficientSource: entry.source,
		coefficientVersion: SPORT_CATALOG_VERSION,
		metMinutes,
	};
	if (args.weightKg != null && args.weightKg > 0) {
		out.estimatedCalories = Math.round(metValue * args.weightKg * (minutes / 60));
	}
	return out;
}

/**
 * MET de référence d'une SÉANCE G-FLUX terminée (musculation) — intensité
 * modérée du tableau G-FLUX (validé en audit). L'estimation reste un repère :
 * la dépense réelle est déjà couverte par le calibrage.
 */
export const GFLUX_SESSION_ACTIVITY_ID = "musculation";
export const GFLUX_SESSION_INTENSITY: SportIntensity = "moderee";
