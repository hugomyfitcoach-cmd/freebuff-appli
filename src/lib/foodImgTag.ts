/**
 * Marquage des URLs d'images ALIMENTAIRES — seul critère de cache du service
 * worker pour le storage Convex.
 *
 * PROBLÈME : les vignettes alimentaires (copies miroir G-FLUX, photos des
 * aliments « Créés par moi ») et les photos PRIVÉES (progression, profil)
 * partagent exactement la même forme d'URL Convex : `/api/storage/<id>` sur
 * `*.convex.cloud|site`. Sans marqueur, le service worker ne peut pas les
 * distinguer et mettait tout le monde en cache.
 *
 * RÈGLE : une URL de stockage Convex n'est cachable QUE si elle porte le
 * marqueur `gflux-food=1`, apposé ici même à l'endroit où l'URL alimentaire
 * est produite (Convex). Toute URL sans marqueur (photos de progression, de
 * profil, médias coach, fichiers du Drive…) n'est jamais interceptée ni
 * mise en cache. Même un ancien cache est purgé à l'activation du worker.
 */

/** Nom du paramètre de marqueur (query string). */
export const FOOD_IMG_TAG = 'gflux-food';

/**
 * Marque une URL d'image ALIMENTAIRE comme cachable par le service worker.
 * Renvoie `undefined` pour une URL absente — les appels restent en une ligne.
 */
export function tagFoodImgUrl(url: string | null | undefined): string | undefined {
	if (!url) return undefined;
	return `${url}${url.includes('?') ? '&' : '?'}${FOOD_IMG_TAG}=1`;
}

/** L'URL porte-t-elle le marqueur « vignette alimentaire » ? */
export function isFoodImgTagged(url: URL): boolean {
	return url.searchParams.get(FOOD_IMG_TAG) === '1';
}

/**
 * URL du storage Convex (`/api/storage/<id>`) — forme commune aux vignettes
 * alimentaires ET aux photos privées : seul le marqueur les distingue.
 */
export function isConvexStorageUrl(url: URL): boolean {
	return /\.convex\.(cloud|site)$/i.test(url.hostname) && url.pathname.startsWith('/api/storage/');
}
