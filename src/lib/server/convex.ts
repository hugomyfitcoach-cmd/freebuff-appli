import { ConvexClient } from 'convex/browser';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

/**
 * Client Convex unique côté serveur (BFF) : toute la lecture/écriture de
 * données passe par SvelteKit. Le navigateur n'appelle jamais Convex
 * directement — il ne connaît que des formulaires/actions de notre serveur,
 * qui ajoute le jeton de session (cookie HttpOnly).
 */
export const convex = new ConvexClient(PUBLIC_CONVEX_URL);

/** Délai maximal d'attente d'une requête Convex côté serveur (ms). */
export const CONVEX_DEADLINE_MS = 6000;

/**
 * Borne une promesse Convex côté serveur.
 *
 * `ConvexClient` (client browser) met ses requêtes en file tant que la
 * connexion n'est pas (re)établie : sur réseau mobile instable, la promesse
 * peut rester pendante indéfiniment — un loader SvelteKit qui l'attend fige
 * alors toute la navigation. Cette échéance garantit un état final en temps
 * fini : chaque appel dégrade vers SON propre repli (null / erreur 503)
 * au lieu de bloquer la page.
 */
export function withDeadline<T>(p: Promise<T>, ms: number = CONVEX_DEADLINE_MS): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('Convex ne répond pas à temps')), ms);
		p.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			}
		);
	});
}
