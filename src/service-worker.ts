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
/** Cache dédié aux vignettes alimentaires — STABLE entre les builds : une
 *  image déjà vue reste servie instantanément après un déploiement. Contient
 *  les copies miroir G-FLUX (storage Convex) et les miniatures OFF utilisées
 *  en repli. SWR : lecture instantanée + rafraîchissement en arrière-plan. */
const IMG_CACHE = 'gflux-img-v1';
/** Plafond d'entrées du cache d'images (les plus anciennes sont retirées). */
const IMG_CACHE_MAX = 600;

const ASSETS = [...build, ...files];

/** Hôtes d'images alimentaires (miniatures OFF utilisées en repli miroir). */
const IMG_HOSTS = ['images.openfoodfacts.org', 'static.openfoodfacts.org', 'world.openfoodfacts.org'];
const IMG_RE = /\.(png|jpe?g|webp|avif|gif)(\?.*)?$/i;
/** Copie miroir G-FLUX : storage Convex (URL stable /api/storage/<id>). */
const CONVEX_HOST_RE = /\.convex\.(cloud|site)$/i;

function isFoodImage(url: URL): boolean {
	return IMG_HOSTS.includes(url.hostname) && IMG_RE.test(url.pathname);
}

function isMirrorImage(url: URL): boolean {
	return CONVEX_HOST_RE.test(url.hostname) && url.pathname.startsWith('/api/storage/');
}

/** Plafonne le cache d'images (supprime les entrées les plus anciennes). */
async function trimImageCache(cache: Cache): Promise<void> {
	const keys = await cache.keys();
	if (keys.length <= IMG_CACHE_MAX) return;
	for (const req of keys.slice(0, keys.length - IMG_CACHE_MAX)) {
		await cache.delete(req).catch(() => {});
	}
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

/* ── Activation immédiate d'une nouvelle version ──
 * Le client (lib/swUpdate.ts : forceAppUpdate) envoie SKIP_WAITING au worker
 * en attente ; il saute la phase « waiting » et prend le contrôle sans attendre
 * la fermeture des onglets — le reload déclenché ensuite par la page sert la
 * nouvelle version immédiatement. Aucun cache client (localStorage, session)
 * n'est effacé ici : seul le cache applicatif change de nom par build. Le
 * cache d'images (IMG_CACHE) est VOLONTAIREMENT préservé entre les builds :
 * les vignettes déjà vues restent instantanées après un déploiement. */
self.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
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

/* ── Vignettes alimentaires (miroir G-FLUX + repli OFF) : stale-while-
      revalidate — instantané depuis le cache puis mise à jour en arrière-
      plan ; ne casse jamais une nouvelle image, survit aux builds. ── */
self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	const url = new URL(event.request.url);
	if (isFoodImage(url) || isMirrorImage(url)) {
		event.respondWith(
			caches.match(event.request).then((cached) => {
				const network = fetch(event.request)
					.then((res) => {
						const type = res.headers.get('content-type') ?? '';
						if (res.ok && type.startsWith('image/')) {
							const clone = res.clone();
							caches
								.open(IMG_CACHE)
								.then((c) => c.put(event.request, clone).then(() => trimImageCache(c)));
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
			fetch(event.request)
				.then((res) => {
					// HTML frais obtenu : on rafraîchit l'entrée de repli hors-ligne.
					// Sans ça, l'HTML caché ne servait qu'en cas d'échec réseau et
					// pouvait rester sur une TRÈS vieille version (l'app shell
					// redonné après des jours hors-ligne serait périmé).
					if (res.ok) {
						const copy = res.clone();
						caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
					}
					return res;
				})
				.catch(() => caches.match(event.request).then((r) => r || caches.match('/')))
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