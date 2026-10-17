/**
 * Vidage des caches du service worker — connexion et déconnexion.
 *
 * Confidentialité : le cache d'app (CACHE, shell HTML par build) et le cache
 * d'images (IMG_CACHE) peuvent contenir des pages et des images d'une session
 * précédente. Ils sont vidés AVANT la soumission du formulaire de login/logout
 * (hook central dans routes/+layout.svelte), donc avant la redirection :
 *  - à la déconnexion : jamais de photo ni de page de la session qui se ferme ;
 *  - à la connexion : couvre une session expirée suivie d'une autre
 *    utilisatrice sur le même appareil.
 */

/** Tous les caches du worker sont nommés `gflux…` (CACHE = `gflux-<build>`,
 *  IMG_CACHE = `gflux-img-v1`) — le préfixe les vise sans en viser d'autres. */
const CACHE_PREFIX = 'gflux';

/** Durée maximale d'attente du vidage : la redirection ne reste JAMAIS
 *  suspendue sur un stockage lent (au pire, le worker repartira sur des
 *  caches vides à sa prochaine activation). */
const CLEAR_TIMEOUT_MS = 2000;

export async function clearAppCaches(): Promise<void> {
	if (typeof caches === 'undefined') return;
	const done = (async () => {
		const keys = await caches.keys();
		await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k).catch(() => {})));
	})();
	await Promise.race([done, new Promise((resolve) => setTimeout(resolve, CLEAR_TIMEOUT_MS))]);
}
