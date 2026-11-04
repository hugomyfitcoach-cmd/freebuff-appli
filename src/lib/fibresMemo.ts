/**
 * MÉMOIRE DE SESSION DES FIBRES (mission FIBRES-INSTANT)
 *
 * Le bilan nutritionnel du jour (fibres, repère, sources) arrive par une
 * requête dédiée, en parallèle du journal. Sans mémoire, une journée déjà
 * vue réaffichait « — » le temps de cette requête (≈ 0,5 s sur iPhone).
 *
 * Ce module garde le DERNIER RÉSULTAT CONNU par journée affichée, lu de
 * façon SYNCHRONE : la carte Fibres est peinte dans la même image que les
 * kcal et les macros, puis la réponse en cours remplace la valeur sans
 * clignotement.
 *
 * Deux couches, aucune n'est obligatoire :
 *  - `hot` : mémoire du module — survit aux navigations SPA (retour sur le
 *    Journal, changement d'onglet, revient sur une journée déjà vue) ;
 *  - `sessionStorage` : même périmètre que la session de l'onglet — survit à
 *    un rechargement de la PWA. Indisponible (navigation privée stricte,
 *    quota, SSR) : la couche chaude suffit, jamais d'erreur remontée.
 *
 * Aucun calcul, aucune donnée inventée : ce module ne fait que restituer un
 * résultat déjà calculé par le serveur, remplacé à la première réponse.
 */

import type { BilanJourData } from './bilanJour';

/** Clé sessionStorage — un seul blob JSON, purgé à la fin de la session. */
const STORAGE_KEY = 'gflux:fibres:v1';

/** Journées gardées (les plus récemment écrites). Une réponse de bilan est
 *  petite ; la borne évite seulement une croissance sans fin sur une très
 *  longue session (calendrier parcouru jour par jour). */
const MAX_JOURS = 21;

/** Couche CHAUDE — lue sans toucher au stockage une fois chargée. */
let hot: Record<string, BilanJourData> | null = null;

/** `sessionStorage` du navigateur, ou `null` (SSR, navigation privée). */
function stockage(): Storage | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		/* Accès refusé (cookies bloqués) : la mémoire du module suffit. */
		return null;
	}
}

/** Charge la couche chaude (une seule fois) depuis la session si besoin. */
function memoire(): Record<string, BilanJourData> {
	if (hot) return hot;
	hot = {};
	const s = stockage();
	if (!s) return hot;
	try {
		const brut = s.getItem(STORAGE_KEY);
		if (!brut) return hot;
		const parsed = JSON.parse(brut) as unknown;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			hot = parsed as Record<string, BilanJourData>;
		}
	} catch {
		/* Blob corrompu ou stockage indisponible : mémoire vide, jamais d'erreur. */
	}
	return hot;
}

/** Écrit la couche chaude et la session (bornée), sans jamais lever. */
function enregistrer(map: Record<string, BilanJourData>) {
	hot = map;
	const s = stockage();
	if (!s) return;
	try {
		s.setItem(STORAGE_KEY, JSON.stringify(map));
	} catch {
		/* Quota atteint : la couche chaude porte la session en cours. */
	}
}

/** Ne garde que les `MAX_JOURS` clés les plus récemment écrites. */
function borner(map: Record<string, BilanJourData>): Record<string, BilanJourData> {
	const cles = Object.keys(map);
	if (cles.length <= MAX_JOURS) return map;
	const gardees: Record<string, BilanJourData> = {};
	for (const k of cles.slice(cles.length - MAX_JOURS)) gardees[k] = map[k];
	return gardees;
}

/** Clé de la carte Fibres de l'espace CLIENTE — une par journée affichée. */
export function cleFibresJour(date: string): string {
	return `cliente:${date}`;
}

/** Clé de la carte Fibres du journal COACH — une par cliente × journée. */
export function cleFibresCoachJour(userId: string, date: string): string {
	return `coach:${userId}:${date}`;
}

/** Purge la mémoire — appelée à la connexion : aucune fibre de la session
 *  précédente ne peut réapparaître pour un autre compte dans le même onglet. */
export function viderMemoFibres(): void {
	hot = {};
	try {
		stockage()?.removeItem(STORAGE_KEY);
	} catch {
		/* Stockage indisponible : la couche chaude est déjà vide. */
	}
}

/** Dernier résultat fibres connu pour cette clé (`null` = jamais vu). */
export function memoFibres(cle: string): BilanJourData | null {
	const map = memoire();
	const data = map[cle];
	return data && typeof data === 'object' ? data : null;
}

/** Mémorise un résultat fibres réellement reçu du serveur. */
export function memoriserFibres(cle: string, data: BilanJourData): void {
	/* Jamais côté serveur : la mémoire du module y est partagée entre toutes
	   les requêtes, une valeur ne doit jamais passer d'une cliente à l'autre. */
	if (typeof window === 'undefined') return;
	if (!data || typeof data !== 'object') return;
	const map = memoire();
	/* Réécrire la clé la replace en fin d'ordre (les plus récentes gardées). */
	delete map[cle];
	map[cle] = data;
	enregistrer(borner(map));
}
