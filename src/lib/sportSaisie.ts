/**
 * SAISIES NUMÉRIQUES du formulaire « Dépense sportive » (ajout / modification
 * d'une activité) — NORMALISATION UNIQUE.
 *
 * Bug de prod (HOTFIX-SPORT) : les champs numériques (FC moyenne, durée libre)
 * sont liés à <input type="number"> — Svelte renvoie alors un NOMBRE, alors
 * que le code appelait .trim() / .replace() comme sur du texte, puis envoyait
 * une valeur mal typée à Convex (« n(q).trim is not a function »).
 *
 * Règle : TOUTE saisie numérique (texte OU nombre) passe par `nombreSaisi`
 * (→ nombre fini, ou valeur absente si vide) avant tout calcul et tout envoi.
 * Aucune formule de calcul ni schéma n'est modifié ici : ce module ne fait
 * que lire et normaliser les saisies du formulaire.
 */
import { BPM_MAX, BPM_MIN } from './calibrage';
import { userErrMsg } from './errors';

/** Durée libre (minutes) — mêmes bornes que clampSportDuration côté serveur. */
export const DUREE_MIN = 1;
export const DUREE_MAX = 600;

export const ERREUR_DUREE = `Indique une durée entre ${DUREE_MIN} et ${DUREE_MAX} minutes pour enregistrer.`;
/** FC optionnelle, mêmes bornes que le barème et la validation serveur. */
export const ERREUR_BPM = `La fréquence cardiaque doit être comprise entre ${BPM_MIN} et ${BPM_MAX} BPM, ou laissée vide.`;
export const ERREUR_GENERIQUE = 'Une erreur est survenue. Réessaie dans un instant.';

/**
 * LA fonction de normalisation des saisies numériques : texte OU nombre →
 * nombre fini, ou valeur absente (null) si la saisie est vide ou illisible.
 */
export function nombreSaisi(v: string | number | null | undefined): number | null {
	if (v === null || v === undefined) return null;
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	const texte = v.trim().replace(',', '.').trim();
	if (texte === '') return null;
	const n = Number(texte);
	return Number.isFinite(n) ? n : null;
}

/** Une saisie est-elle renseignée (même illisible) ? */
export function champRenseigne(v: string | number | null | undefined): boolean {
	if (v === null || v === undefined) return false;
	return String(v).trim() !== '';
}

export type BpmValide = { ok: true; bpm: number | null } | { ok: false; erreur: string };

/**
 * FC moyenne (optionnelle) : absente → null ; renseignée → nombre dans les
 * bornes du barème, sinon message clair (jamais une valeur écartée en silence).
 */
export function validerBpm(v: string | number | null | undefined): BpmValide {
	if (!champRenseigne(v)) return { ok: true, bpm: null };
	const n = nombreSaisi(v);
	if (n === null || n < BPM_MIN || n > BPM_MAX) return { ok: false, erreur: ERREUR_BPM };
	return { ok: true, bpm: n };
}

export type DureeValide = { ok: true; dureeMinutes: number } | { ok: false; erreur: string };

/** Durée (minutes) : 1 à 600, normalisée puis arrondie — sinon message clair. */
export function validerDuree(v: string | number | null | undefined): DureeValide {
	const n = nombreSaisi(v);
	if (n === null || n < DUREE_MIN || n > DUREE_MAX) return { ok: false, erreur: ERREUR_DUREE };
	return { ok: true, dureeMinutes: Math.round(n) };
}

export type SaisieSport = { dureeMinutes: number; bpmMoyen: number | null };

/**
 * Validation complète du formulaire avant envoi : la durée est obligatoire
 * (1 à 600 min), la FC reste optionnelle (40 à 240 BPM). Renvoie les valeurs
 * NORMALISÉES (nombres finis) prêtes pour le payload, ou un message clair.
 */
export function validerSaisieSport(input: {
	dureeMinutes: string | number | null | undefined;
	bpmMoyen: string | number | null | undefined;
}): { ok: true; saisie: SaisieSport } | { ok: false; erreur: string } {
	const duree = validerDuree(input.dureeMinutes);
	if (!duree.ok) return duree;
	const bpm = validerBpm(input.bpmMoyen);
	if (!bpm.ok) return bpm;
	return { ok: true, saisie: { dureeMinutes: duree.dureeMinutes, bpmMoyen: bpm.bpm } };
}

/**
 * Message destiné à la cliente : jamais un message technique (TypeError,
 * « x.trim is not a function », « … is undefined »…). Les messages serveur
 * déjà lisibles (ConvexError métier) restent affichés tels quels.
 */
export function messageErreurSport(e: unknown, fallback: string = ERREUR_GENERIQUE): string {
	const msg = userErrMsg(e, fallback);
	return /is not a function|is undefined|cannot read|undefined is not/i.test(msg) ? fallback : msg;
}
