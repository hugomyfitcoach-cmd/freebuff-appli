/**
 * Polling léger des notifications cliente — la BASE est la source de vérité,
 * jamais le service worker ni le Web Push.
 *
 * PROBLÈME INITIAL : les badges (Accueil, menu, icône PWA) n'étaient calculés
 * qu'au chargement SSR. Une PWA laissée ouverte n'apprenait une action du
 * coach (message, retour publié, contenu partagé) qu'au prochain chargement
 * de page — et le Web Push, retardable de plusieurs minutes sur iOS en
 * arrière-plan, n'était de toute façon jamais lu par l'app.
 *
 * MAINTENANT : GET /api/client/notifications (no-store, sans donnée
 * personnelle au-delà des compteurs) est relu :
 * - à l'ouverture (démarrage du module) ;
 * - à chaque `visibilitychange` (retour au premier plan) ;
 * - à chaque `focus` et `pageshow` (bfcache iOS/Android) ;
 * - toutes les 25 s tant que l'app est VISIBLE (jamais en arrière-plan :
 *   le système gèle les timers, et au réveil visibilitychange rattrape).
 *
 * Garde anti-doublon : un seul appel à la fois (inflight coalescé) et jamais
 * plus d'une requête par 15 s — les trois événements de réveil se chevauchent.
 * Résultat partagé (module) : AppShell (badges Accueil/menu), l'icône PWA
 * (app badge) et toute future carte écoutent le même état, un seul appel
 * réseau par tick.
 */

export type NotificationCounts = {
	/** Retours de bilan publiés non consultés. */
	retours: number;
	/** Message du coach du jour non marqué « Vu ». */
	message: number;
	/** Contenus Drive partagés depuis la dernière visite de la section. */
	drive: number;
	total: number;
};

type Listener = (counts: NotificationCounts) => void;

const listeners = new Set<Listener>();

let counts: NotificationCounts | null = null;
let inflight: Promise<void> | null = null;
let lastFetchAt = 0;
let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

/** Intervalle du filet périodique quand l'app est visible. */
const POLL_MS = 25_000;
/** Garde anti-doublon : visibilitychange + focus + pageshow se chevauchent. */
const MIN_INTERVAL_MS = 15_000;

/** Derniers compteurs connus (null tant que le premier fetch n'a pas abouti). */
export function currentNotificationCounts(): NotificationCounts | null {
	return counts;
}

/** S'abonner aux compteurs (reçoit immédiatement l'état courant). */
export function onNotificationCounts(fn: Listener): () => void {
	listeners.add(fn);
	if (counts) fn(counts);
	return () => listeners.delete(fn);
}

function emit(): void {
	if (!counts) return;
	for (const fn of listeners) {
		try {
			fn(counts);
		} catch {
			/* un listener en échec ne bloque pas les autres */
		}
	}
}

async function fetchOnce(): Promise<void> {
	try {
		const r = await fetch('/api/client/notifications', {
			cache: 'no-store', // le compteur EST le signal : jamais depuis un cache
			signal: AbortSignal.timeout(8000),
		});
		if (r.status === 401) {
			// Session expirée / déconnexion : on arrête le polling proprement.
			stopPolling();
			return;
		}
		if (!r.ok) return; // erreur passagère : les compteurs courants restent
		const j = (await r.json()) as NotificationCounts;
		const next: NotificationCounts = {
			retours: Number(j.retours ?? 0),
			message: Number(j.message ?? 0),
			drive: Number(j.drive ?? 0),
			total: Number(j.total ?? 0),
		};
		const changed =
			!counts ||
			counts.retours !== next.retours ||
			counts.message !== next.message ||
			counts.drive !== next.drive;
		counts = next;
		if (changed) emit();
	} catch {
		/* réseau indisponible : on garde l'état courant, on réessaiera */
	}
}

/** Un tick : coalesce des appels simultanés + garde de 15 s. */
function tick(force = false): void {
	if (typeof document === 'undefined') return;
	if (document.hidden) return; // jamais en arrière-plan : au réveil, on checke
	if (inflight) return;
	if (!force && Date.now() - lastFetchAt < MIN_INTERVAL_MS) return;
	lastFetchAt = Date.now();
	inflight = fetchOnce().finally(() => {
		inflight = null;
	});
}

function stopPolling(): void {
	if (timer !== null) {
		clearInterval(timer);
		timer = null;
	}
	if (typeof document !== 'undefined') {
		document.removeEventListener('visibilitychange', onVisibility);
	}
	if (typeof window !== 'undefined') {
		window.removeEventListener('focus', onFocus);
		window.removeEventListener('pageshow', onPageShow);
	}
	started = false;
}

function onVisibility(): void {
	if (!document.hidden) tick(); // retour au premier plan → vérification immédiate
}
function onFocus(): void {
	tick();
}
function onPageShow(e: PageTransitionEvent): void {
	// persisted=true → page restaurée du bfcache : les timers ont vécu dans
	// le gel, tout état est potentiellement périmé → check forcé.
	tick(e.persisted);
}

/**
 * Démarre le polling (idempotent — appelé au montage AppShell côté cliente).
 * Aucun effet pour le coach : ses badges vivent dans son layout dédié.
 */
export function startNotificationPolling(): void {
	if (started || typeof window === 'undefined') return;
	started = true;
	tick(true);
	document.addEventListener('visibilitychange', onVisibility);
	window.addEventListener('focus', onFocus);
	window.addEventListener('pageshow', onPageShow);
	timer = setInterval(() => tick(), POLL_MS);
}

/** Force un rafraîchissement immédiat (ex. après un « Vu » local). */
export function refreshNotificationsNow(): void {
	tick(true);
}
