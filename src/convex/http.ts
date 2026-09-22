import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { seedPreviewHttp } from "./previewSeed";

/**
 * Routes HTTP publiques du Convex deployment.
 *
 * ⚠️ PREVIEW uniquement en pratique : la seule route actuelle sert au seed
 * de secours des données de test (sans effet en prod : le verrou interne
 * refuse tout déploiement de production). Si un jour des webhooks de
 * production doivent exister, ils s'ajoutent ici.
 */
const http = httpRouter();

/** Prévol CORS minimal (l'appelant réel est un script serveur, pas un navigateur). */
const preflight = httpAction(async () => {
	return new Response(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		},
	});
});

http.route({ path: "/seedPreview", method: "POST", handler: seedPreviewHttp });
http.route({ path: "/seedPreview", method: "OPTIONS", handler: preflight });

export default http;
