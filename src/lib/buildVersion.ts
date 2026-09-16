import { version } from '$app/environment';

/**
 * Empreinte du bundle frontend réellement exécuté par le navigateur.
 *
 * `version` ($app/environment) est un hash généré par SvelteKit à CHAQUE
 * build dont le code a changé : deux déploiements distincts ne partagent
 * jamais la même valeur, deux builds du même code la partagent.
 *
 * C'est le point d'ancrage de la détection d'obsolescence (voir
 * lib/swUpdate.ts) : la page envoie cette empreinte à /api/app/version
 * (en-tête `x-app-build`), le serveur la compare à celle du build déployé.
 * Toute différence = un nouveau frontend est en ligne → bandeau immédiat,
 * sans dépendre du cycle install/waiting du service worker.
 *
 * En dev, SvelteKit met un timestamp : client et SSR valent la même chose,
 * la comparaison reste donc neutre.
 */
export const BUILD_VERSION: string = version;
