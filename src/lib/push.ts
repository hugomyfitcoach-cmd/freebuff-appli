import { dev } from '$app/environment';
import { base } from '$app/paths';

/**
 * Notifications push Web côté cliente.
 *
 * Tout est géré ici, de manière non bloquante : le service worker et
 * l'abonnement ne sont actifs qu'en production (SvelteKit ne sert pas de
 * service worker en dev) et uniquement si le navigateur le permet. Le badge
 * interne de l'application fonctionne avec ou sans push — le push est un
 * supplément, jamais une dépendance.
 */

/** Le navigateur peut-il faire du push ? (production + API disponibles) */
export function pushSupported(): boolean {
	return !dev && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Enregistre le service worker (idempotent). */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
	try {
		return await navigator.serviceWorker.register(`${base}/service-worker.js`);
	} catch {
		return null;
	}
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
	const padding = '='.repeat((4 - (base64.length % 4)) % 4);
	const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

async function vapidKey(): Promise<Uint8Array | null> {
	try {
		const r = await fetch('/api/push/vapid');
		if (!r.ok) return null;
		const { publicKey } = (await r.json()) as { publicKey?: string };
		return publicKey ? urlBase64ToUint8Array(publicKey) : null;
	} catch {
		return null;
	}
}

/** Abonnement actuel du navigateur (ou null). */
export async function currentSubscription(): Promise<PushSubscription | null> {
	const reg = await registerServiceWorker();
	if (!reg) return null;
	try {
		return await reg.pushManager.getSubscription();
	} catch {
		return null;
	}
}

/**
 * S'abonne au push et enregistre l'abonnement côté serveur.
 * Retourne true si l'abonnement est en place et enregistré.
 */
export async function subscribeToPush(): Promise<boolean> {
	if (!pushSupported()) return false;
	const reg = await registerServiceWorker();
	if (!reg) return false;
	let sub = await currentSubscription();
	if (!sub) {
		const key = await vapidKey();
		if (!key) return false; // push non configuré côté serveur : repli badge interne.
		try {
			sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as unknown as BufferSource });
		} catch {
			return false;
		}
	}
	const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
	if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
	try {
		const r = await fetch('/api/push/subscribe', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				endpoint: json.endpoint,
				keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
			}),
		});
		return r.ok;
	} catch {
		return false;
	}
}

/** Désabonnement complet : serveur + push service. */
export async function unsubscribeFromPush(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
	try {
		const reg = await navigator.serviceWorker.getRegistration();
		const sub = await reg?.pushManager.getSubscription();
		if (sub) {
			const json = sub.toJSON() as { endpoint?: string };
			if (json.endpoint) {
				await fetch('/api/push/unsubscribe', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ endpoint: json.endpoint }),
				}).catch(() => {});
			}
			await sub.unsubscribe().catch(() => {});
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Surveille `pushsubscriptionchange` : l'abonnement a changé (révoqué ou
 * renouvelé par le push service). On nettoie l'ancien côté serveur, puis on
 * ré-abonne si la permission est toujours accordée.
 */	export function watchPushSubscriptionChange(): void {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
	navigator.serviceWorker.ready
		.then((reg) => {
			// `pushsubscriptionchange` se déclenche sur l'enregistrement du service
			// worker (renouvellement du push service ou permission révoquée).
			reg.addEventListener('pushsubscriptionchange', (event) => {
				const old = (event as unknown as { oldSubscription?: PushSubscription | null }).oldSubscription;
				if (old) {
					const json = old.toJSON() as { endpoint?: string };
					if (json.endpoint) {
						fetch('/api/push/unsubscribe', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ endpoint: json.endpoint }),
						}).catch(() => {});
					}
				}
				if (Notification.permission === 'granted') {
					void subscribeToPush();
				}
			});
		})
		.catch(() => {});
}