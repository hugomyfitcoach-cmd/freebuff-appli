/**
 * BILAN NUTRITIONNEL DU JOUR (Mission R5c) — calculs PURS, sans Svelte ni
 * Convex. Une seule source de vérité pour :
 *  - le repère fibres du jour (15 g pour 1 000 kcal, jamais moins de 25 g) ;
 *  - les totaux du jour (fibres, sucres, AGS + % des kcal, sel) ;
 *  - la couverture : part des kcal du jour provenant d'aliments dont la
 *    valeur est connue (jamais un 0 inventé pour un aliment sans référence) ;
 *  - les 2 principales sources de fibres ;
 *  - l'état d'affichage de la ligne compacte du Journal (seuils 80 / 50 %).
 *
 * Aucune valeur n'est inventée : une entrée sans référence (repas IA, saisie
 * rapide, recette non résoluble) laisse ses champs à `null` et ne compte pas
 * dans les totaux — elle ne compte pas non plus dans les kcal « couvertes ».
 */

/** Repère officiel : 15 g de fibres pour 1 000 kcal. */
export const FIBRES_G_PAR_1000_KCAL = 15;

/** Plancher du repère : jamais moins de 25 g par jour. */
export const FIBRES_REPERE_MIN_G = 25;

/** Couverture à partir de laquelle le total est considéré comme complet. */
export const COUVERTURE_COMPLETE_PCT = 80;

/** Couverture à partir de laquelle le total est un minimum (« au moins »). */
export const COUVERTURE_PARTIELLE_PCT = 50;

/** Nombre de sources de fibres renvoyées par le bilan. */
export const SOURCES_FIBRES_MAX = 2;

/** Une entrée du journal, valeurs POUR LA PORTION (pas pour 100 g). */
export type BilanJourAliment = {
	name: string;
	/** kcal réellement comptées dans le journal (snapshot de l'entrée). */
	kcal: number;
	/** `null` = valeur inconnue (aucune référence résoluble). */
	fibres: number | null;
	sucres: number | null;
	ags: number | null;
	sel: number | null;
};

/** Source de fibres affichée (« pain complet 15 g »). */
export type SourceFibres = { name: string; fibres: number };

/** Bilan complet d'une journée — renvoyé par `dayNutritionDetails`. */
export type BilanJourData = {
	/** Nombre d'aliments consommés ce jour-là. */
	aliments: number;
	/** kcal consommées (somme des entrées). */
	kcal: number;
	fibres: number | null;
	sucres: number | null;
	ags: number | null;
	/** Part des kcal apportée par les AGS (0–100), `null` si AGS inconnues. */
	agsPctKcal: number | null;
	sel: number | null;
	/** Couverture kcal (0–100), arrondie à l'entier. */
	couverture: number;
	/** Repère fibres du jour (g). */
	repere: number;
	/** 2 principales sources de fibres, décroissantes. */
	sourcesFibres: SourceFibres[];
};

/** Arrondi à une décimale, robuste aux artefacts binaires. */
function arrondi1(n: number): number {
	return Math.round(Number(n.toFixed(6)) * 10) / 10;
}

const estNombre = (n: number | null | undefined): n is number =>
	typeof n === 'number' && Number.isFinite(n);

/**
 * Repère fibres du jour : `max(25, arrondi(objectif kcal × 0,015))`.
 * L'objectif est celui AFFICHÉ en haut du Journal, jamais les kcal mangées.
 * 1 400 → 25 · 2 148 → 32 · 2 500 → 38.
 */
export function repereFibres(objectifKcal: number): number {
	const kcal = estNombre(objectifKcal) && objectifKcal > 0 ? objectifKcal : 0;
	return Math.max(FIBRES_REPERE_MIN_G, Math.round(kcal * (FIBRES_G_PAR_1000_KCAL / 1000)));
}

/** Somme des valeurs connues d'un nutriment (`null` si aucune n'est connue). */
function sommeConnue(
	aliments: readonly BilanJourAliment[],
	champ: 'fibres' | 'sucres' | 'ags' | 'sel'
): number | null {
	let total = 0;
	let connue = false;
	for (const a of aliments) {
		const v = a[champ];
		if (!estNombre(v)) continue;
		total += v;
		connue = true;
	}
	return connue ? arrondi1(total) : null;
}

/**
 * Couverture kcal (0–100) : part des kcal du jour portée par des aliments
 * dont la valeur est connue (pondérée par les kcal de chaque entrée).
 * Un aliment sans référence — repas IA, saisie rapide, recette non résoluble
 * — pèse dans le total mais jamais dans la part couverte.
 */
export function couvertureKcal(aliments: readonly BilanJourAliment[]): number {
	let kcalTotal = 0;
	let kcalCouvertes = 0;
	for (const a of aliments) {
		if (!estNombre(a.kcal) || a.kcal <= 0) continue;
		kcalTotal += a.kcal;
		// La valeur connue qui compte pour la couverture est celle des fibres :
		// c'est elle que la ligne du Journal affiche (les sources qui ne
		// publient pas les fibres rendraient un total trompeur).
		if (estNombre(a.fibres)) kcalCouvertes += a.kcal;
	}
	if (kcalTotal <= 0) return 0;
	return Math.min(100, Math.max(0, Math.round((kcalCouvertes / kcalTotal) * 100)));
}

/** Bilan du jour à partir des entrées résolues et de l'objectif kcal affiché. */
export function bilanJour(
	aliments: readonly BilanJourAliment[],
	objectifKcal: number
): BilanJourData {
	const kcal = Math.round(aliments.reduce((s, a) => s + (estNombre(a.kcal) ? a.kcal : 0), 0));
	const fibres = sommeConnue(aliments, 'fibres');
	const ags = sommeConnue(aliments, 'ags');
	const sourcesFibres = aliments
		.filter((a): a is BilanJourAliment & { fibres: number } => estNombre(a.fibres) && a.fibres > 0)
		.sort((a, b) => b.fibres - a.fibres)
		.slice(0, SOURCES_FIBRES_MAX)
		.map((a) => ({ name: a.name, fibres: arrondi1(a.fibres) }));

	return {
		aliments: aliments.length,
		kcal,
		fibres,
		sucres: sommeConnue(aliments, 'sucres'),
		ags,
		agsPctKcal: ags !== null && kcal > 0 ? Math.round((ags / kcal) * 100) : null,
		sel: sommeConnue(aliments, 'sel'),
		couverture: couvertureKcal(aliments),
		repere: repereFibres(objectifKcal),
		sourcesFibres
	};
}

/** Niveau de couverture — jamais de rouge, seulement trois états sobres. */
export type NiveauCouverture = 'complete' | 'partielle' | 'insuffisante';

/** 85 % → complete · 65 % → partielle · 40 % → insuffisante. */
export function niveauCouverture(couverture: number): NiveauCouverture {
	if (!estNombre(couverture)) return 'insuffisante';
	if (couverture >= COUVERTURE_COMPLETE_PCT) return 'complete';
	if (couverture >= COUVERTURE_PARTIELLE_PCT) return 'partielle';
	return 'insuffisante';
}

/** État d'affichage de la ligne « Fibres » du Journal et du bloc du volet. */
export type EtatFibres = {
	niveau: NiveauCouverture;
	mention: 'exact' | 'au-moins' | 'insuffisant';
	/** Valeur affichée (g) — `null` quand les données sont insuffisantes. */
	valeur: number | null;
	/** Une jauge est-elle affichée ? Jamais sous 50 % de couverture. */
	jauge: boolean;
	/** Remplissage de la jauge (0–100, part du repère). */
	pct: number;
};

/**
 * États d'affichage demandés :
 *  - ≥ 80 % : valeur exacte, jauge verte ;
 *  - 50–80 % : « au moins X g », jauge grise, données incomplètes ;
 *  - < 50 % : « pas assez de données », aucune jauge.
 */
export function etatFibres(
	fibres: number | null,
	repere: number,
	couverture: number
): EtatFibres {
	const niveau = niveauCouverture(couverture);
	if (!estNombre(fibres) || niveau === 'insuffisante') {
		return { niveau: 'insuffisante', mention: 'insuffisant', valeur: null, jauge: false, pct: 0 };
	}
	const cible = estNombre(repere) && repere > 0 ? repere : FIBRES_REPERE_MIN_G;
	return {
		niveau,
		mention: niveau === 'partielle' ? 'au-moins' : 'exact',
		valeur: fibres,
		jauge: true,
		pct: Math.min(100, Math.max(0, (fibres / cible) * 100))
	};
}
