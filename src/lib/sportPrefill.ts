/**
 * Pré-remplissage du profil sportif habituel depuis la réponse « sport » du
 * formulaire de démarrage — module PUR (testable sans écran, sans Convex).
 *
 * DIAGNOSTIC DE FORMAT (source unique des questions : `lib/onboarding.ts`) :
 *  - `sport` (« Tu pratiques du sport actuellement ? ») : CHOIX STRUCTURÉ (oui/non) ;
 *  - `sportsDetail` (« Quel(s) sport(s) ? ») : TEXTE LIBRE ;
 *  - `sportFrequency` (« Fréquence par semaine ? ») : CHOIX STRUCTURÉ (1× à 5×+) ;
 *  - intensité et durée : ABSENTES du formulaire.
 *
 * RÈGLE DE LA MISSION : rien n'est interprété depuis du texte libre. Une
 * réponse n'est traitée que si chaque champ présent est un CODE de choix du
 * questionnaire et si l'activité se résout sur le catalogue par correspondance
 * EXACTE (id ou libellé, insensible casse/accents) — sinon la réponse reste
 * affichée telle quelle à côté du profil (comportement actuel) et AUCUN
 * pré-remplissage n'est proposé. Rien n'est enregistré sans validation de la
 * coach : `prefillProfilSportif` ne produit qu'une proposition en mémoire.
 *
 * Correspondances les plus proches du catalogue existant quand la réponse est
 * structurée :
 *  - activité   → l'entrée du catalogue dont l'id ou le libellé correspond
 *                 exactement (jamais devinée) ;
 *  - intensité  → le premier choix du barème de l'activité (défaut du catalogue,
 *                 identique au changement d'activité du CRM) ;
 *  - séances/sem → le code de fréquence (1x…5x, « 5× et + » → 5), défaut 2 ;
 *  - durée      → 60 minutes (défaut de la liste du CRM).
 */

import type { SeanceHabituelle } from './calibrageFiche';
import {
	getSportEntry,
	SPORT_CATALOG,
	SPORT_CHOIX_DOUCES,
	SPORT_CHOIX_MUSCULATION,
	SPORT_ZONES_CARDIO
} from '../convex/sportCatalog';

/** Réponse « sport » du formulaire de démarrage (table `intakes`). */
export type ReponseSportDemarrage = {
	sport: string | number | null;
	sportsDetail: string | number | null;
	sportFrequency: string | number | null;
};

/**
 * Format diagnostiqué de la réponse :
 *  - `absente`      : aucune réponse « sport » ;
 *  - `structuree`   : que des codes de choix reconnus (activité résolue ou absente) ;
 *  - `texte-libre`  : au moins une saisie libre non résoluble sans interprétation.
 */
export type FormatReponseSport = 'absente' | 'structuree' | 'texte-libre';

export type DiagnosticReponseSport = {
	format: FormatReponseSport;
	/** Activité résolue sur le catalogue (null = absente ou non résolue, jamais devinée). */
	activiteId: string | null;
	/** Séances par semaine déduites du code de fréquence (null = absent). */
	seancesParSemaine: number | null;
};

/** Codes de choix du questionnaire (valeurs réellement stockées). */
const SPORT_CODES = new Set(['oui', 'non']);
const FREQUENCE_VERS_SEANCES: Record<string, number> = { '1x': 1, '2x': 2, '3x': 3, '4x': 4, '5x': 5 };

/** Défauts de la liste « Profil sportif habituel » du CRM (`ajouterSeance`). */
const DUREE_DEFAUT_MINUTES = 60;
const SEANCES_DEFAUT = 2;

/** Texte normalisé : minuscules, sans espaces superflus ni accents. */
function normalise(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ');
}

function champ(v: string | number | null | undefined): string {
	if (v === null || v === undefined) return '';
	return String(v).trim();
}

/**
 * Résolution CATALOGUE par correspondance exacte uniquement (id ou libellé) —
 * aucune recherche floue, aucune interprétation de texte libre.
 */
export function resoudreActiviteCatalogue(texte: string): string | null {
	const cible = normalise(texte);
	if (!cible) return null;
	const parId = getSportEntry(cible);
	if (parId) return parId.id;
	for (const entry of SPORT_CATALOG) {
		if (normalise(entry.id) === cible || normalise(entry.name) === cible) return entry.id;
	}
	return null;
}

/** Diagnostic de format de la réponse « sport » du démarrage. */
export function diagnostiquerReponseSport(rep: ReponseSportDemarrage): DiagnosticReponseSport {
	const sport = champ(rep?.sport);
	const detail = champ(rep?.sportsDetail);
	const frequence = champ(rep?.sportFrequency);

	if (!sport && !detail && !frequence) {
		return { format: 'absente', activiteId: null, seancesParSemaine: null };
	}

	const sportOk = !sport || SPORT_CODES.has(sport);
	const frequenceOk = !frequence || frequence in FREQUENCE_VERS_SEANCES;
	/* L'activité est un code structuré seulement si elle est absente ou si elle
	   se résout sur le catalogue PAR CORRESPONDANCE EXACTE — sinon c'est du
	   texte libre et rien n'est interprété. */
	const activiteId = detail ? resoudreActiviteCatalogue(detail) : null;
	const detailOk = !detail || activiteId !== null;

	if (sportOk && frequenceOk && detailOk) {
		return {
			format: 'structuree',
			activiteId,
			seancesParSemaine: frequence ? FREQUENCE_VERS_SEANCES[frequence] : null
		};
	}
	return { format: 'texte-libre', activiteId: null, seancesParSemaine: null };
}

/** Choix d'intensité par défaut du barème d'une activité (premier choix du catalogue). */
export function choixDefautPourActivite(activiteId: string): string | null {
	const entry = getSportEntry(activiteId);
	if (!entry) return null;
	if (entry.bareme === 'musculation') return SPORT_CHOIX_MUSCULATION[0]?.id ?? null;
	if (entry.bareme === 'douce') return SPORT_CHOIX_DOUCES[0]?.id ?? null;
	return SPORT_ZONES_CARDIO[0]?.id ?? null;
}

/**
 * Proposition de profil sportif habituel — null quand rien ne peut être
 * pré-rempli sans interprétation :
 *  - réponse absente ou en texte libre (affichage tel quel uniquement) ;
 *  - réponse « sport = non » (aucune séance) ;
 *  - aucune activité résolue sur le catalogue (jamais devinée).
 * Sinon : une séance (activité, intensité du barème, séances/sem, durée).
 * La coach valide ensuite via « Appliquer à la fiche » — rien n'est écrit ici.
 */
export function prefillProfilSportif(rep: ReponseSportDemarrage): SeanceHabituelle[] | null {
	const diag = diagnostiquerReponseSport(rep);
	if (diag.format !== 'structuree') return null;
	if (champ(rep?.sport) === 'non') return null;
	if (!diag.activiteId) return null;
	const choix = choixDefautPourActivite(diag.activiteId);
	if (!choix) return null;
	return [
		{
			activiteId: diag.activiteId,
			seancesParSemaine: diag.seancesParSemaine ?? SEANCES_DEFAUT,
			dureeMinutes: DUREE_DEFAUT_MINUTES,
			choix
		}
	];
}
