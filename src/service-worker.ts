/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker';

/**
 * Service worker G-Flux : notifications push Web + cache de l'application.
 * - `push` → affiche la notification (titre/corps/icône/lien de destination) ;
 * - `notificationclick` → ouvre la bonne page (Accueil / Mes bilans) ;
 * - cache statique de l'app (shell) pour un démarrage hors-ligne fiable.
 */

// Nom unique par build : un nouveau déploiement invalide l'ancien cache.
const CACHE = `gflux-${version}`;
/** Cache dédié aux vignettes alimentaires Open Food Facts (SWR : lecture
 *  instantanée + rafraîchissement en arrière-plan, jamais de cache cassant). */
const IMG_CACHE = `gflux-img-${version}`;

const ASSETS = [...build, ...files];

/** Hôtes d'images alimentaires (vignettes OFF déjà optimisées). */
const IMG_HOSTS = ['images.openfoodfacts.org', 'static.openfoodfacts.org', 'world.openfoodfacts.org'];
const IMG_RE = /\.(png|jpe?g|webp|avif|gif)(\?.*)?$/i;

function isFoodImage(url: URL): boolean {
	return IMG_HOSTS.includes(url.hostname) && IMG_RE.test(url.pathname);
}

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((c) => c.addAll(ASSETS))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

/* ── Push : notification du message du coach / retour de bilan ── */
self.addEventListener('push', (event) => {
	let payload: { title?: string; body?: string; url?: string; tag?: string } = {};
	try {
		payload = event.data ? event.data.json() : {};
	} catch {
		/* corps non-JSON : on affiche une notification générique */
	}
	const title = payload.title ?? 'G-Flux';
	const options: NotificationOptions = {
		body: payload.body ?? '',
		icon: '/icons/icon-192.png',
		badge: '/icons/icon-192.png',
		data: { url: payload.url ?? '/espace' },
		...(payload.tag ? { tag: payload.tag, renotify: true } : {}),
	};
	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = event.notification.data?.url ?? '/espace';
	event.waitUntil(
		self.clients
			.matchAll({ type: 'window', includeUncontrolled: true })
			.then((list) => {
				for (const client of list) {
					if ('focus' in client) {
						client.navigate(url).catch(() => {});
						return client.focus();
					}
				}
				return self.clients.openWindow(url);
			})
	);
});

/* ── Images alimentaires OFF : stale-while-revalidate (instantané puis
      mise à jour en arrière-plan — ne casse jamais une nouvelle image). ── */
self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	const url = new URL(event.request.url);
	if (isFoodImage(url)) {
		event.respondWith(
			caches.match(event.request).then((cached) => {
				const network = fetch(event.request)
					.then((res) => {
						if (res.ok) {
							const clone = res.clone();
							caches.open(IMG_CACHE).then((c) => c.put(event.request, clone));
						}
						return res;
					})
					.catch(() => cached);
				return cached ?? network;
			})
		);
		return;
	}
	if (url.origin !== self.location.origin) return;
	// Données/API : jamais mises en cache (sessions + réponses privées).
	if (event.request.url.includes('/api/')) return;
	if (event.request.mode === 'navigate') {
		event.respondWith(
			fetch(event.request).catch(() => caches.match(event.request).then((r) => r || caches.match('/')))
		);
		return;
	}
	event.respondWith(
		caches.match(event.request).then((cached) => {
			if (cached) return cached;
			return fetch(event.request).then((res) => {
				if (res.ok && ASSETS.includes(url.pathname)) {
					const clone = res.clone();
					caches.open(CACHE).then((c) => c.put(event.request, clone));
				}
				return res;
			});
		})
	);
});