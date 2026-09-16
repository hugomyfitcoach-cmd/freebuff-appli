/**
 * Mises à jour de la PWA — force-refresh propre et détection d'obsolescence.
 *
 * Contexte (incident du 13/09) : une PWA laissée ouverte peut servir un
 * ANCIEN bundle frontend après un déploiement, pendant que le backend
 * (Convex) tourne déjà sur la nouvelle version. Un changement de contrat
 * API produit alors un écran vide silencieux.
 *
 * Fonctionnement :
 * - `watchSwUpdates()` : écoute en continu `updatefound` sur le service
 *   worker. Dès qu'une nouvelle version est téléchargée en attente, on
 *   notifie l'UI (bandeau « Une nouvelle version de G-FLUX est disponible »).
 * - `forceAppUpdate()` : le bouton Refresh et le bouton « Actualiser
 *   maintenant » appellent la même mécanique :
 *     1. `reg.update()` → vérification réseau immédiate d'un nouveau SW ;
 *     2. si un worker est en attente → `postMessage SKIP_WAITING` → il
 *        s'active tout de suite (pas d'attente de fermeture des onglets) ;
 *     3. on attend `navigator.serviceWorker.controller` change (= le
 *        nouveau worker contrôle la page) ;
 *     4. `location.reload()` → la nouvelle version est servie et visible.
 * - AUCUNE suppression de session, localStorage ou données clientes.
 *   Seul le cache applicatif du SW est invalide par le nouveau worker lui-
 *   même (nom de cache par build `gflux-${version}`) — on ne vide jamais
 *   aveuglément les caches.
 *
 * Enregistrement unique : `registerServiceWorker()` (lib/push.ts) appelle
 * `attachUpdateWatcher` après l'inscription du worker.
 */
import { BUILD_VERSION } from './buildVersion';

export type UpdateState = {
	/** Nouvelle version SW téléchargée et en attente d'activation. */
	updateReady: boolean;
	/** Mise à jour en cours d'application (force-refresh). */
	updating: boolean;
	/** Backend incompatible avec ce bundle (détection /api/app/version). */
	compatOutdated: boolean;
	/** Nouveau frontend déployé : l'empreinte du bundle distant diffère de
	 *  celle de la page qui tourne (détecté à l'ouverture, à chaque retour au
	 *  premier plan, au focus et périodiquement — voir checkAppVersion). */
	buildOutdated: boolean;
};

type Listener = (state: UpdateState) => void;

const listeners = new Set<Listener>();

let updateReady = false;
let updating = false;
let compatOutdated = false;
let buildOutdated = false;

function emit() {
	const snapshot: UpdateState = { updateReady, updating, compatOutdated, buildOutdated };
	for (const fn of listeners) {
		try {
			fn(snapshot);
		} catch {
			/* un listener en échec ne bloque pas les autres */
		}
	}
}

/** S'abonner aux changements d'état de mise à jour (retourne un désabonnement). */
export function onUpdateState(fn: Listener): () => void {
	listeners.add(fn);
	fn({ updateReady, updating, compatOutdated, buildOutdated });
	return () => listeners.delete(fn);
}

/**
 * Message envoyé au nouveau service worker pour qu'il s'active immédiatement.
 * (Le worker actuel ignore `SKIP_WAITING` hors `install`/`waiting` — voir
 * service-worker.ts.)
 */
const SKIP_WAITING = { type: 'SKIP_WAITING' } as const;

/**
 * Attends que le nouveau service worker prenne le contrôle de la page, puis
 * résous. Résous immédiatement si la page n'est pas contrôlée (premier
 * lancement — le reload suffit) ou après un délai de sécurité (le reload se
 * fait quand même, `location.reload()` re-négocie tout).
 */
function waitForControl(timeoutMs = 8000): Promise<void> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve();
	if (!navigator.serviceWorker.controller) return Promise.resolve();
	return new Promise((resolve) => {
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			navigator.serviceWorker.removeEventListener('controllerchange', finish);
			resolve();
		};
		navigator.serviceWorker.addEventListener('controllerchange', finish);
		setTimeout(finish, timeoutMs);
	});
}

/**
 * Force l'application vers la dernière version disponible.
 * Voir la doc d'en-tête : SW update → SKIP_WAITING → controllerchange → reload.
 */
export async function forceAppUpdate(): Promise<void> {
	if (updating || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
		// Pas de SW (dev, navigateur exotique) : reload simple — même effet.
		if (typeof location !== 'undefined') location.reload();
		return;
	}
	updating = true;
	emit();
	try {
		const reg = await navigator.serviceWorker.getRegistration();
		if (reg) {
			// 1) Vérification réseau immédiate (au cas où aucun check n'a tourné).
			try {
				await reg.update();
			} catch {
				/* offline : le reload ci-dessous reste sans risque */
			}
			// 2) Nouvelle version en attente → activation immédiate.
			const waiting = reg.waiting ?? (reg.installing && reg.installing.state === 'installed' ? reg.installing : null);
			if (waiting && waiting !== navigator.serviceWorker.controller) {
				waiting.postMessage(SKIP_WAITING);
			}
			// 3) Le nouveau worker prend le contrôle de la page.
			await waitForControl();
		}
	} finally {
		updating = false;
		updateReady = false;
		emit();
		// 4) Rechargement complet : le shell + les chunks de la nouvelle
		//    version sont servis, l'état applicatif repart propre.
		if (typeof location !== 'undefined') location.reload();
	}
}

/**
 * Branche l'écoute des mises à jour sur une registration existante.
 * Appelé par `registerServiceWorker()` après la première inscription.
 */
export function attachUpdateWatcher(reg: ServiceWorkerRegistration): void {
	// Un worker en attente déjà présent au moment de l'inscription (l'app
	// vient de démarrer alors qu'un déploiement a eu lieu en arrière-plan).
	if (reg.waiting && navigator.serviceWorker.controller) {
		updateReady = true;
		emit();
	}
	reg.addEventListener('updatefound', () => {
		const installing = reg.installing;
		if (!installing) return;
		installing.addEventListener('statechange', () => {
			// « installed » = téléchargé et prêt : tant que la page est déjà
			// contrôlée, c'est une mise à jour en attente (pas la 1ʳᵉ install).
			if (installing.state === 'installed' && navigator.serviceWorker.controller) {
				updateReady = true;
				emit();
			}
		});
	});
}

/** Petit module d'échec partagé : renvoie le message à afficher à l'utilisatrice. */
export function updateErrorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/* ───── Détection de mise à jour (build + compat backend) ─────
 * PROBLÈME INITIAL : la détection reposait uniquement sur le service worker
 * (updatefound) et sur /api/app/version SANS no-store — une PWA ouverte
 * depuis des heures/jours ne voyait JAMAIS le bandeau (incident du 13/09
 * et « clientes restées plusieurs jours sur l'ancienne version »).
 *
 * MAINTENANT : à chaque ouverture, retour au premier plan
 * (visibilitychange), focus, pageshow (cache bfcache iOS/Android), et une
 * fois par minute au maximum si l'app reste ouverte, on interroge
 * /api/app/version avec `cache: 'no-store'` et l'empreinte de build de la
 * page (en-tête `x-app-build`). Le serveur répond `buildOutdated` dès qu'un
 * nouveau frontend est déployé — sans dépendre du cycle SW — et
 * `requiresUpdate` si le contrat API a changé. Dès détection :
 * - le bandeau existant s'affiche immédiatement ;
 * - `registration.update()` est lancé EN PARALLÈLE pour télécharger le
 *   nouveau SW tout de suite (il n'attendra plus « updatefound » spontané).
 *
 * Garde anti-doublon : un seul appel réseau à la fois (inflight partagé),
 * et jamais plus d'une fois par 60 s (les événements se chevauchent au
 * réveil de l'app : visibilitychange + focus + pageshow). Aucun risque de
 * marteler le serveur, aucun risque de perdre une saisie : on ne touche
 * qu'à l'état du bandeau et au service worker, jamais au DOM ni aux
 * formulaires. */

let compatWatchStarted = false;
let inflight: Promise<void> | null = null;
let lastCheckAt = 0;
/** Anti-doublon : visibilitychange + focus + pageshow se déclenchent
 *  ensemble au réveil — un seul appel réseau par minute suffit. */
const MIN_CHECK_INTERVAL_MS = 60_000;
/** Filet périodique si l'app reste ouverte des heures au premier plan. */
const PERIODIC_CHECK_MS = 60_000;

/** Vérifie le serveur : nouveau build déployé ? Contrat API périmé ? */
async function checkCompatOnce(): Promise<void> {
	try {
		const r = await fetch('/api/app/version', {
			cache: 'no-store', // jamais depuis le cache HTTP/CDN — c'est LE signal
			headers: { 'x-app-build': BUILD_VERSION },
			signal: AbortSignal.timeout(5000),
		});
		if (!r.ok) return;
		const j = (await r.json()) as {
			requiresUpdate?: boolean;
			buildOutdated?: boolean;
		};
		// Empreinte absente du backend déployé (ancien serveur) : pas de faux
		// positif — seule la compat backend reste alors utilisée.
		const buildDiff = j.buildOutdated === true;
		const compat = j.requiresUpdate === true;
		if (buildDiff !== buildOutdated || compat !== compatOutdated) {
			buildOutdated = buildDiff;
			compatOutdated = compat;
			emit();
		}
		// Nouveau build détecté → on télécharge le nouveau service worker
		// TOUT DE SUITE, en parallèle du bandeau. L'utilisatrice clique quand
		// elle veut, mais la mise à jour est déjà prête.
		if ((buildDiff || compat) && updateReady === false) {
			void navigator.serviceWorker?.getRegistration().then((reg) => reg?.update().catch(() => {}));
		}
	} catch {
		/* réseau indisponible : le statut courant reste affiché */
	}
}

/**
 * Vérification avec anti-doublon : coalesce des appels simultanés et
 * garde-fou de 60 s. Force=true court-circuite le garde-fou (au démarrage).
 */
function checkAppVersion(force = false): void {
	if (typeof window === 'undefined') return;
	if (document.hidden) return; // inutile en arrière-plan : au réveil, on checke
	if (inflight) return;
	if (!force && Date.now() - lastCheckAt < MIN_CHECK_INTERVAL_MS) return;
	lastCheckAt = Date.now();
	inflight = checkCompatOnce().finally(() => {
		inflight = null;
	});
}

/**
 * Démarre la veille (idempotent — appelé au montage AppShell).
 * Déclencheurs : ouverture, visibilitychange (retour au premier plan),
 * focus, pageshow (bfcache), + filet périodique toutes les minutes.
 */
export function startCompatWatch(): void {
	if (compatWatchStarted || typeof window === 'undefined') return;
	compatWatchStarted = true;
	checkAppVersion(true);
	document.addEventListener('visibilitychange', () => checkAppVersion());
	window.addEventListener('focus', () => checkAppVersion());
	window.addEventListener('pageshow', (e) => {
		// persisted=true → page restaurée depuis le cache bfcache (iOS/Android,
		// navigations arrière/avant) : tout état de veille est donc périmé.
		checkAppVersion(e.persisted);
	});
	setInterval(() => checkAppVersion(), PERIODIC_CHECK_MS);
}

/** Ce bundle est-il devenu incompatible avec le backend déployé ? */
export function isCompatOutdated(): boolean {
	return compatOutdated;
}

/** Un nouveau frontend est-il déployé (empreinte différente) ? */
export function isBuildOutdated(): boolean {
	return buildOutdated;
}

/** Mise à jour disponible : SW en attente OU backend OU build incompatible. */
export function needsAppUpdate(): boolean {
	return updateReady || compatOutdated || buildOutdated;
}
