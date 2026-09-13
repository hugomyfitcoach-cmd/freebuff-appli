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

export type UpdateState = {
	/** Nouvelle version SW téléchargée et en attente d'activation. */
	updateReady: boolean;
	/** Mise à jour en cours d'application (force-refresh). */
	updating: boolean;
	/** Backend incompatible avec ce bundle (détection /api/app/version). */
	compatOutdated: boolean;
};

type Listener = (state: UpdateState) => void;

const listeners = new Set<Listener>();

let updateReady = false;
let updating = false;
let compatOutdated = false;

function emit() {
	const snapshot: UpdateState = { updateReady, updating, compatOutdated };
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
	fn({ updateReady, updating, compatOutdated });
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

/* ───── Compatibilité frontend / backend ─────
 * Après un déploiement backend, un bundle frontend plus ancien peut parler un
 * contrat périmé. On interroge /api/app/version (public, sans donnée
 * personnelle) : au démarrage, à chaque retour dans l'app et toutes les
 * 5 minutes. Résultat partagé (module) : le bandeau de AppShell ET les
 * boutons Refresh (y compris celui du Journal plein écran) consultent le
 * même état — un seul appel réseau à la fois, jamais de martelage. */

let compatWatchStarted = false;

async function checkCompatOnce(): Promise<void> {
	try {
		const r = await fetch('/api/app/version', { signal: AbortSignal.timeout(5000) });
		const j = (await r.json()) as { requiresUpdate?: boolean };
		const outdated = j.requiresUpdate === true;
		if (outdated !== compatOutdated) {
			compatOutdated = outdated;
			emit();
		}
	} catch {
		/* réseau indisponible : le statut courant reste affiché */
	}
}

/** Démarre la veille de compatibilité (idempotent — appelé au montage AppShell). */
export function startCompatWatch(): void {
	if (compatWatchStarted || typeof window === 'undefined') return;
	compatWatchStarted = true;
	void checkCompatOnce();
	setInterval(() => {
		if (!document.hidden) void checkCompatOnce();
	}, 5 * 60 * 1000);
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) void checkCompatOnce();
	});
}

/** Ce bundle est-il devenu incompatible avec le backend déployé ? */
export function isCompatOutdated(): boolean {
	return compatOutdated;
}

/** Mise à jour disponible : SW en attente OU backend incompatible. */
export function needsAppUpdate(): boolean {
	return updateReady || compatOutdated;
}
