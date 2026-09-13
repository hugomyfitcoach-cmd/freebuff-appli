import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { FRONTEND_API_VERSION } from '$lib/apiVersion';

/**
 * Version du contrat API — détection d'obsolescence PWA.
 *
 * Public et sans donnée personnelle : une ancienne PWA posée sur N'IMPORTE
 * quelle page (y compris /connexion) doit pouvoir savoir qu'une nouvelle
 * version existe.
 *
 * Au premier appel après un déploiement backend, aligne `meta.api` sur la
 * version de ce déploiement (idempotent). Compare ensuite avec la version
 * compilée dans le frontend (FRONTEND_API_VERSION) :
 *
 * Réponse : `{ backendApiVersion, frontendApiVersion, compatible, requiresUpdate }`
 * - `compatible: false` → le frontend doit être rechargé (bandeau +
 *   bouton « Actualiser maintenant », même mécanique que le Refresh).
 *
 * Aucune donnée personnelle, aucun cookie requis : réponse mise en cache
 * très courte pour éviter de marteler Convex (les clientes ouvrent l'app
 * souvent, la détection doit rester quasi temps réel après un deploy).
 */
export const GET: RequestHandler = async () => {
	let backendApiVersion = FRONTEND_API_VERSION; // repli sûr : jamais « incompatible » par erreur réseau
	try {
		backendApiVersion = await convex.action(api.appVersion.ensureAppVersion, {});
	} catch {
		// Convex indisponible : on répond « compatible » (pas de fausse alerte).
	}
	const compatible = backendApiVersion === FRONTEND_API_VERSION;
	return json(
		{ backendApiVersion, frontendApiVersion: FRONTEND_API_VERSION, compatible, requiresUpdate: !compatible },
		{ headers: { 'cache-control': 'public, max-age=15' } }
	);
};
