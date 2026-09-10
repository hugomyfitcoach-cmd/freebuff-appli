"use node";
/**
 * Client web-push chargé de façon facultative pour le runtime Convex
 * (`import { createRequire } from "node:module"`).
 *
 * Les clés VAPID vivent UNIQUEMENT dans les variables d'environnement Convex
 * (jamais dans le code ni côté navigateur) :
 *   npx convex env set VAPID_PUBLIC_KEY  '...' --prod
 *   npx convex env set VAPID_PRIVATE_KEY '...' --prod
 *   npx convex env set VAPID_SUBJECT     'mailto:contact@g-flux.fr' --prod
 *
 * Si le paquet ou les clés manquent ( environnement sans push), l'objet
 * `webpush` est null : le rappel 12 h continue de fonctionner en interne
 * (Accueil + badge) — le push n'est jamais une dépendance (§24).
 */
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);

type WebPushLike = {
	sendNotification: (
		subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
		payload?: string | null,
		options?: { TTL?: number; headers?: Record<string, string> }
	) => Promise<unknown>;
	setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
};

function loadWebPush(): WebPushLike | null {
	try {
		const mod = require_("web-push") as { default?: WebPushLike } & WebPushLike;
		const wp = (mod?.default ?? mod) as WebPushLike;
		const pub = process.env.VAPID_PUBLIC_KEY;
		const priv = process.env.VAPID_PRIVATE_KEY;
		if (!wp || typeof wp.sendNotification !== "function" || !pub || !priv) return null;
		wp.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@g-flux.fr", pub, priv);
		return wp;
	} catch {
		return null; // paquet absent dans l'environnement Convex : repli sans push
	}
}

export const webpush = loadWebPush();
