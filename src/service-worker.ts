/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker';
import { isConvexStorageUrl, isFoodImgTagged } from './lib/foodImgTag';

/**
 * Service worker G-Flux : notifications push Web + cache de l'application.
 * - `push` → affiche la notification (titre/corps/icône/lien de destination) ;
 * - `notificationclick` → ouvre la bonne page (Accueil / Mes bilans) ;
 * - cache statique de l'app (shell) pour un démarrage hors-ligne fiable.
 */

/** Préfixe des caches de BUILD. Nom unique par build (donc invalidé à chaque
 *  déploiement) et distinct du cache d'images, stable, qui a son propre nom. */
const BUILD_CACHE_PREFIX = 'gflux-app-';
const CACHE = `${BUILD_CACHE_PREFIX}${version}`;
/** Cache dédié aux vignettes alimentaires — STABLE entre les builds : une
 *  image déjà vue reste servie instantanément après un déploiement. Contient
 *  les copies miroir G-FLUX (storage Convex) et les miniatures OFF utilisées
 *  en repli. SWR : lecture instantanée + rafraîchissement en arrière-plan.
 *  CONFIDENTIALITÉ : uniquement des vignettes ALIMENTAIRES — les photos de
 *  progression et de profil (même forme d'URL /api/storage/) sont exclues
 *  par le marqueur gflux-food (voir lib/foodImgTag.ts). */
const IMG_CACHE = 'gflux-img-v1';
/** Plafond d'entrées du cache d'images (les plus anciennes sont retirées). */
const IMG_CACHE_MAX = 600;

/** Limite de patience réseau des requêtes interceptées (ms). */
const FETCH_TIMEOUT_MS = 5000;

/**
 * `fetch` PLAFONNÉ : sur iOS, une socket bloquée (reprise d'arrière-plan,
 * réseau coupé puis rétabli, flux HTTP/2 coincé) peut laisser une requête
 * pendre PLUSIEURS MINUTES — exactement l'écran blanc de 4-5 min au
 * lancement de la PWA et les navigations figées. Au-delà du délai, la
 * requête est considérée perdue et le repli prévu s'exécute.
 *
 * NB : pas d'`AbortController` ici — passer un `init` à fetch() recréerait
 * la Request, ce qui est interdit pour les requêtes `navigate` sur certains
 * moteurs. Une simple course contre la montre est compatible partout.
 */
function fetchBounded(request: Request, ms = FETCH_TIMEOUT_MS): Promise<Response> {
	return Promise.race([
		fetch(request),
		new Promise<Response>((_, reject) => {
			setTimeout(() => reject(new Error('Réseau sans réponse')), ms);
		}),
	]);
}

/** Polices auto-hébergées (Lato, static/fonts/) : DOIVENT être dans le
 *  précache — sinon, hors ligne (mode avion iPhone), l'app retombe sur la
 *  police système. Elles sont déjà couvertes via `files` (contenu de
 *  static/) ; cette liste explicite rend le précache vérifiable et robuste
 *  à un futur changement de stratégie. */
const FONTS = [
	'/fonts/lato-400-latin.woff2',
	'/fonts/lato-400-latin-ext.woff2',
	'/fonts/lato-700-latin.woff2',
	'/fonts/lato-700-latin-ext.woff2',
	'/fonts/lato-900-latin.woff2',
	'/fonts/lato-900-latin-ext.woff2'
];

const ASSETS = [...build, ...files, ...FONTS.filter((f) => !files.includes(f))];

/** Hôtes d'images alimentaires (miniatures OFF utilisées en repli miroir). */
const IMG_HOSTS = ['images.openfoodfacts.org', 'static.openfoodfacts.org', 'world.openfoodfacts.org'];
const IMG_RE = /\.(png|jpe?g|webp|avif|gif)(\?.*)?$/i;
function isFoodImage(url: URL): boolean {
	return IMG_HOSTS.includes(url.hostname) && IMG_RE.test(url.pathname);
}

/**
 * Copie miroir G-FLUX : storage Convex (URL stable /api/storage/<id>) —
 * UNIQUEMENT si l'URL porte le marqueur « vignette alimentaire » (gflux-food).
 * Les photos de progression et de profil ont exactement la même forme d'URL :
 * sans marqueur, elles ne sont ni interceptées ni mises en cache.
 */
function isMirrorImage(url: URL): boolean {
	return isConvexStorageUrl(url) && isFoodImgTagged(url);
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
	event.waitUntil(activateBuild());
});

/**
 * Bascule vers le nouveau build — SANS casser les pages encore ouvertes.
 *
 * INCIDENT DU 28/10/2026 (Android, PWA installée) : page affichée SANS feuille
 * de style (serif, blocs empilés, anneaux pleine largeur) à l'ouverture.
 * Cause : ce worker prenait le contrôle immédiatement (skipWaiting) puis
 * supprimait TOUS les autres caches. Une page encore ouverte sur le build
 * précédent réclamait ses fichiers `/_app/immutable/*` : absents du cache
 * (purgé) ET absents de Netlify (un déploiement ne sert que ses propres
 * fichiers) → CSS 404 → page nue. Fermer/rouvrir servait le nouveau build
 * d'où l'impression d'un bug intermittent.
 *
 * Désormais : le cache du build PRÉCÉDENT est CONSERVÉ jusqu'à la bascule
 * complète (= jusqu'au déploiement suivant). `caches.keys()` est ordonné par
 * création : le dernier cache de build autre que le courant est le précédent.
 */
async function activateBuild(): Promise<void> {
	const keys = await caches.keys();
	// Rien à voir avec le build courant ni avec le cache d'images stable.
	const stale = keys.filter((k) => k !== CACHE && k !== IMG_CACHE);
	// Version précédente : la plus récemment créée des caches de build.
	const previous = stale.filter((k) => k.startsWith(BUILD_CACHE_PREFIX)).slice(-1);
	await Promise.all(stale.filter((k) => !previous.includes(k)).map((k) => caches.delete(k)));
	await purgePrivateImages();
	await self.clients.claim();
}

/**
 * Purge de confidentialité à l'activation : les anciens builds mettaient TOUT
 * le storage Convex en cache, y compris les photos de progression et de profil
 * (même forme d'URL /api/storage/ que les vignettes alimentaires). Toute
 * entrée de stockage NON marquée « alimentaire » est retirée ; les vignettes
 * OFF et les vignettes marquées restent (SWR inchangé).
 */
async function purgePrivateImages(): Promise<void> {
	const cache = await caches.open(IMG_CACHE);
	for (const req of await cache.keys()) {
		const url = new URL(req.url);
		if (isConvexStorageUrl(url) && !isFoodImgTagged(url)) {
			await cache.delete(req).catch(() => {});
		}
	}
}

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

/* ── Repli HTML hors-ligne : le build courant, sinon page d'erreur ── */

/**
 * L'HTML de repli correspond-il au build de CE service worker ?
 * L'empreinte `app-build` (meta du root layout) vaut `version` ici — les deux
 * sont le même hash de build SvelteKit (kit.version.name). Une page d'un
 * autre build n'est JAMAIS servie depuis le cache.
 */
async function htmlMatchesBuild(res: Response): Promise<boolean> {
	try {
		const html = await res.text();
		const m = html.match(/<meta\s+name="app-build"\s+content="([^"]*)"/);
		return !!m && m[1] === version;
	} catch {
		return false;
	}
}

/** Page d'erreur hors-ligne — jumelle de src/routes/+error.svelte : message
 *  clair + « Réessayer » (jamais un écran blanc, jamais un shell périmé). */
const ERROR_PAGE_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Oups — G-Flux</title>
<style>
	/* Lato auto-hébergée : servie par le SW depuis le précache, donc la page
	   d'erreur garde la typographie de l'app même hors ligne. */
	@font-face { font-family: 'Lato'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/lato-400-latin.woff2') format('woff2'); }
	@font-face { font-family: 'Lato'; font-style: normal; font-weight: 700; font-display: swap; src: url('/fonts/lato-700-latin.woff2') format('woff2'); }
	@font-face { font-family: 'Lato'; font-style: normal; font-weight: 900; font-display: swap; src: url('/fonts/lato-900-latin.woff2') format('woff2'); }
	body { margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center; background: #ffffff; color: #0F1512; font-family: 'Lato', system-ui, sans-serif; }
	.wrap { width: 100%; max-width: 28rem; padding: 1.5rem; text-align: center; display: flex; flex-direction: column; gap: 1rem; align-items: center; }
	.brand { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #66716B; }
	h1 { margin: 0; font-size: 22px; font-weight: 900; line-height: 1.2; letter-spacing: -0.02em; }
	p { margin: 0; font-size: 14px; line-height: 1.6; color: #66716B; }
	button { border: 0; border-radius: 9999px; background: #1DB954; color: #ffffff; padding: 0.75rem 1.75rem; font-size: 15px; font-weight: 700; cursor: pointer; }
	button:active { transform: scale(0.97); }
</style>
</head>
<body>
	<div class="wrap">
		<p class="brand">G-Flux</p>
		<h1>Impossible de charger cette page</h1>
		<p>Pas de connexion internet. Vérifie ton réseau puis réessaie.</p>
		<button type="button" onclick="location.reload()">Réessayer</button>
	</div>
</body>
</html>`;

function appErrorResponse(): Response {
	return new Response(ERROR_PAGE_HTML, {
		status: 503,
		headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
	});
}

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
			fetchBounded(event.request)
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
				// Réseau absent, lent ou bloqué : la copie de repli (rafraîchie à
				// chaque navigation réussie ; '/' est le dernier filet) n'est servie
				// QUE si son HTML correspond au build de CE worker — jamais un
				// shell périmé. Sinon : page d'erreur propre avec « Réessayer ».
				.catch(async () => {
					try {
						// Repli lu UNIQUEMENT dans le cache de CE build : le cache du
						// build précédent (conservé pour ses fichiers _app/immutable)
						// contient un HTML d'une autre version, qui ne doit jamais
						// masquer la copie valide du build courant.
						const cache = await caches.open(CACHE);
						const cached = (await cache.match(event.request)) || (await cache.match('/'));
						if (cached && (await htmlMatchesBuild(cached.clone()))) return cached;
					} catch {
						/* cache illisible : page d'erreur propre */
					}
					return appErrorResponse();
				})
		);
		return;
	}
	event.respondWith(
		// `caches.match` interroge TOUS les caches : le build courant d'abord,
		// puis celui du build précédent (conservé à l'activation) — une page
		// encore ouverte sur l'ancienne version retrouve ainsi son CSS et ses
		// modules, que Netlify ne sert plus.
		caches.match(event.request).then((cached) => {
			if (cached) return cached;
			return fetchBounded(event.request)
				.then((res) => {
					if (res.ok && ASSETS.includes(url.pathname)) {
						const clone = res.clone();
						caches.open(CACHE).then((c) => c.put(event.request, clone));
					}
					return res;
				})
				// Réseau lent/coupé : échec rapide et propre — la page garde ses
				// replis (API client / état d'erreur « Réessayer ») au lieu
				// d'attendre une réponse qui ne viendra jamais.
				.catch(() => Response.error());
		})
	);
});