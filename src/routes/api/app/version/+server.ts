import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { FRONTEND_API_VERSION } from '$lib/apiVersion';
import { BUILD_VERSION } from '$lib/buildVersion';

/**
 * Version déployée — détection d'obsolescence PWA (temps réel).
 *
 * Public et sans donnée personnelle : une ancienne PWA posée sur N'IMPORTE
 * quelle page (y compris /connexion) doit pouvoir savoir qu'une nouvelle
 * version existe.
 *
 * DEUX niveaux de détection :
 *
 * 1. Empreinte de bundle (principal) : le client envoie la version SvelteKit
 *    du bundle qu'il exécute (en-tête `x-app-build`, valeur de
 *    `$app/environment` — hash régénéré à chaque build dont le code change).
 *    Si elle diffère de celle du build DÉPLOYÉ (même module compilé côté
 *    serveur), un nouveau frontend est en ligne → `buildOutdated: true`.
 *    Fonctionne pour TOUT déploiement, même sans changement de contrat API :
 *    une PWA ouverte depuis des jours est détectée immédiatement.
 *
 * 2. Contrat API backend (historique) : `ensureAppVersion` aligne `meta.api`
 *    sur la version du déploiement backend ; si elle diffère de
 *    FRONTEND_API_VERSION compilée ici, `requiresUpdate: true` (contrat
 *    périmé → écran vide silencieux possible, incident du 13/09/2026).
 *
 * Réponse : `{ build, backendApiVersion, frontendApiVersion, compatible, requiresUpdate }`
 * - `buildOutdated` OU `requiresUpdate` → bandeau « Une nouvelle version de
 *   G-FLUX est disponible » + bouton « Actualiser maintenant ».
 *
 * ⚠️ `cache-control: no-store` : ce endpoint est le signal de détection lui-
 * même. Avant (public, max-age=15) il pouvait être servi depuis le cache CDN
 * Netlify ou disque du navigateur (notamment sur iOS après des heures en
 * arrière-plan) → ancienne empreinte → détection inefficace. La réponse est
 * publique et sans donnée personnelle, le coût du no-store est négligeable.
 */
export const GET: RequestHandler = async (event) => {
	// Empreinte envoyée par la page qui tourne (absente : vieux client ou
	// appel direct — on ne peut rien conclure, on reste discret).
	const clientBuild = event.request.headers.get('x-app-build');
	const buildOutdated = clientBuild !== null && clientBuild !== BUILD_VERSION;

	let backendApiVersion = FRONTEND_API_VERSION; // repli sûr : jamais « incompatible » par erreur réseau
	try {
		backendApiVersion = await convex.action(api.appVersion.ensureAppVersion, {});
	} catch {
		// Convex indisponible : on répond « compatible » (pas de fausse alerte).
	}
	const compatible = backendApiVersion === FRONTEND_API_VERSION;
	return json(
		{
			build: BUILD_VERSION,
			backendApiVersion,
			frontendApiVersion: FRONTEND_API_VERSION,
			compatible,
			requiresUpdate: !compatible,
			buildOutdated,
			updateNeeded: !compatible || buildOutdated,
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
