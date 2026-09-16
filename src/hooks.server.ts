import type { Handle } from '@sveltejs/kit';

/**
 * En-têtes de cache des documents HTML (SSR).
 *
 * ROOT CAUSE corrigée : sans règle explicite, l'HTML principal pouvait
 * rester bloqué côté CDN/navigateur et l'app redémarrer sur un shell
 * périmé des heures/jours après un déploiement. Un document SSR (contenu
 * dynamique, session cookie) ne doit JAMAIS être servi sans revalidation :
 *
 * - `no-cache` : le navigateur et le CDN peuvent stocker, mais doivent
 *   REVALIDATER à chaque utilisation (ETag/304) — pas de coût réseau
 *   inutile, mais jamais de page périmée ;
 * - `max-age=0` et `must-revalidate` : mêmes interdits renforcés pour les
 *   caches intermédiaires ;
 * - `private` : la page contient l'état de session (cookie) — jamais de
 *   cache partagé.
 *
 * Les assets `/​_app/immutable/*` (hashés dans le nom de fichier) restent
 * cachés immutables via netlify.toml : le build SvelteKit y référence
 * toujours des empreintes fraîches, ils n'ont aucun besoin de revalidation.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	const type = response.headers.get('content-type') ?? '';
	if (type.startsWith('text/html')) {
		response.headers.set('cache-control', 'private, no-cache, max-age=0, must-revalidate');
	}
	return response;
};
