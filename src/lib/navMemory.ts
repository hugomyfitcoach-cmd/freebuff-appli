/**
 * Mémoire de navigation cliente — onglets Accueil / Journal / Progression.
 *
 * - Horodatage des préchargements : les données préchargées (cache SvelteKit)
 *   sont réutilisées immédiatement au tap → affichage instantané, puis
 *   revalidées silencieusement UNIQUEMENT quand elles ont plus de TTL
 *   (jamais de refetch à chaque changement d'onglet).
 * - Positions de scroll : restaurées au retour sur un onglet déjà visité.
 * - Petit cache JSON (ex. métriques Progression) : rendu instantané même si
 *   la page a été démontée — même source que le fetch, jamais inventé.
 */

const boot = Date.now();
const visitedAt: Record<string, boolean> = {};
const lastSyncAt: Record<string, number> = {};
const scrollAt: Record<string, number> = {};
const dataCache: Record<string, unknown> = {};

/** Session « chaude » (>= 10 s) : évite de revalider juste après un refresh. */
export function appWarm(): boolean {
	return Date.now() - boot > 10_000;
}

/** Marque la route comme fraîchement synchronisée. */
export function noteSync(route: string) {
	lastSyncAt[route] = Date.now();
}

/** Vrai au premier montage de la route dans cette session (pas de revalidation
 *  nécessaire : la donnée vient d'être chargée par la navigation / le serveur). */
export function firstVisit(route: string): boolean {
	if (visitedAt[route]) return false;
	visitedAt[route] = true;
	return true;
}

/** Vrai si la donnée de la route a moins de `ttl` ms. */
export function isFresh(route: string, ttl = 30_000): boolean {
	return Date.now() - (lastSyncAt[route] ?? 0) < ttl;
}

export function saveScroll(route: string) {
	if (typeof window !== 'undefined') scrollAt[route] = window.scrollY;
}

export function restoreScroll(route: string): number {
	return scrollAt[route] ?? 0;
}

export function cacheGet<T>(key: string): T | undefined {
	return dataCache[key] as T | undefined;
}

export function cacheSet(key: string, value: unknown) {
	dataCache[key] = value;
}