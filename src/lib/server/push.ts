import { env } from '$env/dynamic/private';
import webpush from 'web-push';
import { convex } from './convex';
import { api } from '../../convex/_generated/api.js';

/**
 * Notifications push Web — envoi côté serveur SvelteKit.
 *
 * La clé privée VAPID vit uniquement ici (variables d'environnement), jamais
 * dans Convex ni dans le navigateur. Si les clés ne sont pas configurées
 * (environnement sans push), l'envoi est simplement ignoré — le badge interne
 * de l'application continue de fonctionner, c'est un repli par conception.
 */

type PushSub = { endpoint: string; p256dh: string; auth: string };

function vapidConfigured(): boolean {
	return !!env.VAPID_PUBLIC_KEY && !!env.VAPID_PRIVATE_KEY;
}

/** Payload d'une notification : titre, corps, destination, regroupement. */
export type PushPayload = {
	title: string;
	body: string;
	url: string;
	tag?: string;
};

/**
 * Envoie une notification push à tous les appareils abonnés d'une cliente.
 * `coachToken` = jeton de session coach (le serveur lit les abonnements avec).
 * Les endpoints morts (404/410) sont retirés pour ne jamais réessayer.
 * N'échoue jamais : l'échec d'un push ne doit pas casser la publication.
 */
export async function sendPushToUser(
	userId: string,
	payload: PushPayload,
	coachToken: string | undefined | null
): Promise<number> {
	if (!vapidConfigured() || !coachToken) return 0;
	webpush.setVapidDetails(
		env.VAPID_SUBJECT || 'mailto:contact@g-flux.fr',
		env.VAPID_PUBLIC_KEY as string,
		env.VAPID_PRIVATE_KEY as string
	);
	let subs: PushSub[] = [];
	try {
		subs = await convex.query(api.push.subscriptionsFor, {
			sessionToken: coachToken,
			userId: userId as never,
		});
	} catch {
		return 0; // session coach expirée ou données inaccessibles : on ignore.
	}
	if (subs.length === 0) return 0;

	const body = JSON.stringify(payload);
	let sent = 0;
	for (const sub of subs) {
		try {
			await webpush.sendNotification(
				{
					endpoint: sub.endpoint,
					keys: { p256dh: sub.p256dh, auth: sub.auth },
				},
				body,
				{ TTL: 60 * 60 * 24 } // 24 h : pas de notification périmée
			);
			sent++;
		} catch (e) {
			// 404/410 = abonnement supprimé côté push service → nettoyage.
			const code = (e as { statusCode?: number }).statusCode;
			if (code === 404 || code === 410) {
				try {
					await convex.mutation(api.push.removeEndpoint, {
						sessionToken: coachToken,
						endpoint: sub.endpoint,
					});
				} catch {
					/* silencieux */
				}
			}
		}
	}
	return sent;
}