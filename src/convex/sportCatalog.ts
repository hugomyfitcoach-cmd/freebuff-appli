/**
 * Module Dépense sportive — CATALOGUE CENTRALISÉ des sports + calcul.
 *
 * SOURCE UNIQUE des coefficients : ce module est le SEUL endroit du dépôt qui
 * connaît les coûts du sport, et il les tient du module de calibrage
 * (`../lib/calibrage`, le même que `$lib/calibrage`) — donc du BARÈME G-FLUX :
 *
 *   musculation récréative 2,2 kcal/kg/h · musculation intensive 4,4 ·
 *   séance du programme G-FLUX 3,3 · cardio par zone :
 *   moins de 130 BPM 3,8 · 130–150 BPM 5,5 · 150–160 BPM 6,6 ·
 *   160–180 BPM 7,7 · plus de 180 BPM 8,8 (plafond).
 *
 * Le choix de zone cardio (`sous-130` … `plus-180`) porte l'intensité
 * RESSENTIE équivalente, pour les activités sans cardiofréquencemètre.
 *
 * MET dérivé (MET-minutes du CRM) : MET = kcal/kg/h ÷ 1,05 — conversion
 * documentée du tableau coach (1 MET ≈ 3,5 ml O₂/kg/min ≈ 1,05 kcal/kg/h).
 *
 * VERSION 2 : les NOUVELLES saisies passent au barème (coefficientVersion
 * « 2 », coût horaire stocké sur la ligne). Les lignes déjà enregistrées
 * (v1 = MET du Compendium par intensité) restent recalculées par leur propre
 * modèle (`depenseLegacyMet`) — AUCUNE entrée existante n'est recalculée.
 *
 * RÈGLE ANTI DOUBLE COMPTAGE : la marche quotidienne (pas, déplacements,
 * promenades) est déjà couverte par `dailySteps` + le niveau de marche du
 * calibrage — elle n'existe JAMAIS dans ce catalogue. Seule la marche
 * cardio volontaire (« Marche inclinée sur tapis ») est proposée.
 */

import { ConvexError } from "convex/values";
import {
	BANDES_CARDIO,
	COUT_SPORT,
	INTENSITES_MUSCULATION,
	ZONES_CARDIO_IDS,
	coutSportif,
	depenseSeanceKcal,
	zoneCardioParId,
} from "../lib/calibrage";

/** Version du catalogue — stockée sur chaque dépense (coefficientVersion). */
export const SPORT_CATALOG_VERSION = "2";
/** Version des lignes dont la dépense reste au modèle MET du Compendium. */
export const SPORT_CATALOG_VERSION_LEGACY = "1";
/** Conversion documentée : kcal/kg/h ≈ MET × 1,05 (MET ≈ 3,5 ml O₂/kg/min). */
export const KCAL_PAR_H_PAR_MET = 1.05;

export type SportCoefficientSource = "gflux_table" | "compendium";

/**
 * Barème appliqué à une activité :
 *  - `musculation` : choix récréative (2,2) / intensive (4,4) ;
 *  - `cardio` : choix de zone (`sous-130` … `plus-180`) ou intensité ressentie.
 */
export type SportBareme = "musculation" | "cardio";

export type SportCatalogEntry = {
	/** Identifiant stable (slug) référencé par les dépenses. */
	id: string;
	name: string;
	category: string;
	/** Barème de l'activité (détermine les choix proposés). */
	bareme: SportBareme;
	/** Note de traçabilité (activité volontaire, estimation signalée…). */
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
 *
 * Toutes les activités hors musculation relèvent du barème cardio (zones) :
 * ce sont des activités CARDIO ou MIXTES, dont le coût dépend de l'intensité
 * réellement tenue — pas d'une table par sport.
 */
export const SPORT_CATALOG: SportCatalogEntry[] = [
	{ id: "musculation", name: "Musculation", category: "musculation", bareme: "musculation" },
	// ── Cardio & salle (Marche inclinée = séance cardio VOLONTAIRE) ──
	{
		id: "marche-inclinee-tapis",
		name: "Marche inclinée sur tapis",
		category: "cardio",
		bareme: "cardio",
		note: "Séance cardio volontaire ≠ marche quotidienne (déjà couverte par les pas)",
	},
	{ id: "course-tapis", name: "Course (tapis)", category: "cardio", bareme: "cardio" },
	{ id: "velo-exterieur", name: "Vélo (extérieur)", category: "cardio", bareme: "cardio" },
	{ id: "velo-indoor", name: "Vélo indoor / spinning", category: "cardio", bareme: "cardio" },
	{ id: "elliptique", name: "Elliptique", category: "cardio", bareme: "cardio" },
	{ id: "rameur", name: "Rameur", category: "cardio", bareme: "cardio" },
	{ id: "escalier", name: "StairMaster / escalier", category: "cardio", bareme: "cardio" },
	// ── Natation & eau ──
	{ id: "natation", name: "Natation", category: "eau", bareme: "cardio" },
	{ id: "aquagym", name: "Aquagym", category: "eau", bareme: "cardio" },
	// ── Cours & douceurs ──
	{ id: "pilates", name: "Pilates", category: "collectifs", bareme: "cardio" },
	{ id: "yoga", name: "Yoga", category: "collectifs", bareme: "cardio" },
	{ id: "danse", name: "Danse", category: "collectifs", bareme: "cardio" },
	// ── HIIT & circuits ──
	{ id: "hiit", name: "HIIT", category: "hiit", bareme: "cardio" },
	{ id: "circuit-training", name: "Circuit training", category: "hiit", bareme: "cardio" },
	{ id: "cross-training", name: "Cross training", category: "hiit", bareme: "cardio" },
	// ── Sports de raquette ──
	{ id: "tennis", name: "Tennis", category: "raquette", bareme: "cardio" },
	{ id: "padel", name: "Padel", category: "raquette", bareme: "cardio" },
	{ id: "badminton", name: "Badminton", category: "raquette", bareme: "cardio" },
	// ── Sports collectifs ──
	{ id: "football", name: "Football", category: "equipe", bareme: "cardio" },
	{ id: "basket", name: "Basket", category: "equipe", bareme: "cardio" },
	// ── Glisse & hiver ──
	{ id: "ski", name: "Ski", category: "glisse", bareme: "cardio" },
	// ── Autres ──
	{ id: "corde-a-sauter", name: "Corde à sauter", category: "autres", bareme: "cardio" },
];

/** Choix de musculation (saisie manuelle) — coûts du barème affichés. */
export const SPORT_CHOIX_MUSCULATION: { id: string; label: string; hint: string }[] = [
	{
		id: INTENSITES_MUSCULATION[0],
		label: "Récréative",
		hint: `${COUT_SPORT.musculationRecreative} kcal/kg/h`,
	},
	{
		id: INTENSITES_MUSCULATION[1],
		label: "Intensive",
		hint: `${COUT_SPORT.musculationIntensive} kcal/kg/h`,
	},
];

/**
 * Zones cardio proposées à la saisie : libellé = intensité RESSENTIE, `hint` =
 * plage de fréquence cardiaque et coût horaire du barème (le mot MET n'est
 * JAMAIS affiché côté cliente).
 */
export const SPORT_ZONES_CARDIO: { id: string; label: string; hint: string }[] = BANDES_CARDIO.map(
	(z) => ({
		id: z.id,
		label: z.intensite,
		hint: `${z.libelle} · ${z.defaut} kcal/kg/h`,
	})
);

/** Choix de la séance G-FLUX automatique (trainingClient). */
export const GFLUX_SESSION_CHOIX = "gflux";
/** Activité de catalogue utilisée comme PORTEUR de la séance G-FLUX. */
export const GFLUX_SESSION_ACTIVITY_ID = "musculation";

/**
 * Libellés des intensités/zones, v1 ET v2 — les lignes enregistrées gardent
 * leur libellé même après bascule du catalogue.
 */
export const SPORT_INTENSITY_LABELS: Record<string, string> = {
	// v1 — lignes existantes (MET du Compendium par intensité)
	legere: "Légère",
	moderee: "Modérée",
	intense: "Intense",
	// v2 — musculation à la main
	recreative: "Récréative",
	intensive: "Intensive",
	// v2 — séances G-FLUX créées automatiquement
	gflux: "Séance G-FLUX",
	// v2 — zones cardio (intensité ressentie)
	...Object.fromEntries(BANDES_CARDIO.map((z) => [z.id, z.intensite])),
};

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

/** Identifiants de choix acceptés pour une activité (zone ou intensité). */
export function choixValides(entry: SportCatalogEntry): string[] {
	return entry.bareme === "musculation"
		? [...INTENSITES_MUSCULATION]
		: [...ZONES_CARDIO_IDS];
}

/** MET signé pour les MET-minutes : MET = kcal/kg/h ÷ 1,05 (2 décimales). */
function metDeKcalKgH(coefficientKcalKgH: number): number {
	return Math.round((coefficientKcalKgH / KCAL_PAR_H_PAR_MET) * 100) / 100;
}

export type CoutSportifResolu = {
	/** Coût horaire du barème (kcal/kg/heure). */
	coefficientKcalKgH: number;
	/** MET dérivé (MET-minutes du CRM). */
	metValue: number;
	/** Libellé lisible de la règle appliquée. */
	libelle: string;
};

/**
 * Coût horaire d'une activité + de son choix (barème G-FLUX, v2). Un choix
 * absent ou hors barème est REFUSÉ (jamais de zone implicite silencieuse).
 */
export function resolveSportCoefficient(activityId: string, choix?: string | null): CoutSportifResolu {
	const entry = requireSportEntry(activityId);
	if (choix === undefined || choix === null || choix === "") {
		throw new ConvexError("Zone ou intensité requise pour cette activité.");
	}
	if (!choixValides(entry).includes(choix)) {
		throw new ConvexError("Zone ou intensité invalide pour cette activité.");
	}
	if (entry.bareme === "musculation") {
		const cout = coutSportif({
			sport: "musculation",
			intensite: choix === INTENSITES_MUSCULATION[1] ? "intensive" : "recreative",
		});
		return {
			coefficientKcalKgH: cout.coefficientKcalKgH,
			metValue: metDeKcalKgH(cout.coefficientKcalKgH),
			libelle: cout.libelle,
		};
	}
	const zone = zoneCardioParId(choix);
	return {
		coefficientKcalKgH: zone.defaut,
		metValue: metDeKcalKgH(zone.defaut),
		libelle: `Cardio ${zone.libelle} (${zone.intensite}) · ${zone.defaut} kcal/kg/h`,
	};
}

/** Clamp durée (1–600 min) — même borne haute que les séances G-FLUX. */
export function clampSportDuration(minutes: number): number {
	if (!Number.isFinite(minutes)) throw new ConvexError("Durée invalide.");
	return Math.round(Math.min(Math.max(minutes, 1), 600));
}

export type SportEstimation = {
	activityId: string;
	activityNameSnapshot: string;
	/** Choix recopié tel quel sur la ligne (zone cardio, intensité, gflux). */
	intensity: string;
	metValue: number;
	/** Coût horaire du barème (kcal/kg/heure) — absent des lignes v1. */
	coutHoraireKcalKgH?: number;
	coefficientSource: SportCoefficientSource;
	coefficientVersion: string;
	/** kcal estimées — absentes si aucune pesée connue (jamais de poids inventé). */
	estimatedCalories?: number;
	metMinutes: number;
};

/** Dépense (kcal) du barème : coût horaire × poids × durée. */
function caloriesBareme(
	coefficientKcalKgH: number,
	minutes: number,
	weightKg?: number | null
): number | undefined {
	if (weightKg == null || weightKg <= 0) return undefined;
	return depenseSeanceKcal({ coefficientKcalKgH, poidsKg: weightKg, heures: minutes / 60 });
}

/**
 * Calcul unique d'une NOUVELLE dépense (barème v2) : coût horaire (kcal/kg/h)
 * × poids × durée + MET-minutes dérivés. `weightKg` absent → estimatedCalories
 * absentes (repère impossible sans poids) ; les MET-minutes restent stockées.
 */
export function estimateSportActivity(args: {
	activityId: string;
	intensity?: string | null;
	durationMinutes: number;
	weightKg?: number | null;
}): SportEstimation {
	const entry = requireSportEntry(args.activityId);
	const minutes = clampSportDuration(args.durationMinutes);
	const cout = resolveSportCoefficient(args.activityId, args.intensity);
	const estimatedCalories = caloriesBareme(cout.coefficientKcalKgH, minutes, args.weightKg);
	return {
		activityId: entry.id,
		activityNameSnapshot: entry.name,
		intensity: String(args.intensity),
		metValue: cout.metValue,
		coutHoraireKcalKgH: cout.coefficientKcalKgH,
		coefficientSource: "gflux_table",
		coefficientVersion: SPORT_CATALOG_VERSION,
		metMinutes: Math.round(cout.metValue * minutes),
		...(estimatedCalories !== undefined ? { estimatedCalories } : {}),
	};
}

/**
 * Dépense d'une SÉANCE G-FLUX terminée (créée automatiquement par
 * trainingClient) : barème G-FLUX 3,3 kcal/kg/heure, quelle que soit
 * l'intensité ressentie de la musculation à la main.
 */
export function estimateGfluxSportActivity(args: {
	durationMinutes: number;
	weightKg?: number | null;
}): SportEstimation {
	const minutes = clampSportDuration(args.durationMinutes);
	const coefficient = COUT_SPORT.seanceGflux;
	const estimatedCalories = caloriesBareme(coefficient, minutes, args.weightKg);
	const entry = requireSportEntry(GFLUX_SESSION_ACTIVITY_ID);
	return {
		activityId: entry.id,
		activityNameSnapshot: entry.name,
		intensity: GFLUX_SESSION_CHOIX,
		metValue: metDeKcalKgH(coefficient),
		coutHoraireKcalKgH: coefficient,
		coefficientSource: "gflux_table",
		coefficientVersion: SPORT_CATALOG_VERSION,
		metMinutes: Math.round(metDeKcalKgH(coefficient) * minutes),
		...(estimatedCalories !== undefined ? { estimatedCalories } : {}),
	};
}

/**
 * Recalcul d'une ligne V1 (MET du Compendium) : `metValue` et
 * `coefficientSource` de la ligne sont RÉUTILISÉS tels quels — seul le volume
 * (durée, poids gelé) bouge. Aucune bascule de barème sur l'historique.
 */
export function depenseLegacyMet(args: {
	metValue: number;
	durationMinutes: number;
	weightKg?: number | null;
}): { metMinutes: number; estimatedCalories?: number } {
	const minutes = clampSportDuration(args.durationMinutes);
	const metMinutes = Math.round(args.metValue * minutes);
	if (args.weightKg == null || args.weightKg <= 0) return { metMinutes };
	return {
		metMinutes,
		estimatedCalories: Math.round(args.metValue * args.weightKg * (minutes / 60)),
	};
}
