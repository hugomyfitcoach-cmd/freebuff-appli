/**
 * MÉCANISME CENTRAL DE PROPAGATION DES NOTIFICATIONS (cliente ET coach).
 *
 * LA BASE EST LA SOURCE DE VÉRITÉ — jamais le Web Push ni le service worker.
 * Tout passe par UN SEUL endpoint BFF (`GET /api/live`, jeton en cookie
 * HttpOnly — le navigateur ne parle jamais à Convex directement) :
 *
 * - cliente → compteurs { retours, message, drive, total } + delta
 *   d'événements { kind, label } depuis le dernier check ;
 * - coach   → badge CRM { notifications } + version du journal
 *   (toute augmentation = nouvelle notification → badge + revalidation).
 *
 * Rythme :
 * - 5 s au PREMIER PLAN (app visible) — le badge est donc vif sans multiplier
 *   inutilement les requêtes ;
 * - IMMÉDIAT au retour de focus / visibilité / pageshow (bfcache iOS) ;
 * - ARRIÈRE-PLAN : aucune requête (le système gèle les timers et le check au
 *   réveil rattrape) ;
 * - coalescing des checks simultanés + garde anti-tempête 3 s.
 *
 * Invalidation ciblée : un événement porteur (ex. `plan_assigned`) déclenche
 * un événement DOM `gflux:live-event` (détail = { kind, label }) que les pages
 * concernées écoutent pour se revalider — plus aucun contenu figé derrière un
 * refresh manuel. Les pages « de consultation » revalident aussi leur charge
 * (invalidateAll) quand un compteur change, sans perdre la saisie en cours.
 *
 * Héritage : le module expose l'API historique (onNotificationCounts,
 * refreshNotificationsNow, startNotificationPolling) consommée par AppShell
 * et l'espace cliente — un seul système pour tout, futures fonctionnalités
 * incluses : pour propager un nouveau flux, émettre côté Convex un
 * `recordClientEvent` (clientEvents) et écouter `gflux:live-event`.
 */

export type NotificationCounts = {
	/** Retours de bilan publiés non consultés (cliente). */
	retours: number;
	/** Message du coach du jour non marqué « Vu » (cliente). */
	message: number;
	/** Contenus Drive partagés depuis la dernière visite de la section (cliente). */
	drive: number;
	/** Somme des trois compteurs cliente. */
	total: number;
};

export type LiveEvent = { kind: string; label: string | null; createdAt: number };

type Listener = (counts: NotificationCounts) => void;
type CoachListener = (coach: { notifications: number; journalVersion: number }) => void;
type EventListener = (event: LiveEvent) => void;

const listeners = new Set<Listener>();
const coachListeners = new Set<CoachListener>();
const eventListeners = new Set<EventListener>();

let clientCounts: NotificationCounts | null = null;
let coachState: { notifications: number; journalVersion: number } | null = null;
let inflight: Promise<void> | null = null;
let lastFetchAt = 0;
let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
/** Version du signal journal coach connue du poller (détecte les deltas). */
let knownJournalVersion: number | null = null;
/** Timestamp (ms) du dernier check client — borne du delta ?since=. */
let lastClientCheckAt = 0;
/** Derniers événements vus (anti-rejeu des deltas déjà traités). */
let seenEventKeys = new Set<string>();

/** Intervalle du filet périodique quand l'app est visible (premier plan). */
const POLL_MS = 5_000;
/** Garde anti-tempête : visibilitychange + focus + pageshow se chevauchent. */
const MIN_INTERVAL_MS = 3_000;

/** Derniers compteurs cliente connus (null tant que le premier fetch n'a pas abouti). */
export function currentNotificationCounts(): NotificationCounts | null {
	return clientCounts;
}

/** Dernier état coach connu (null tant que le premier fetch n'a pas abouti). */
export function currentCoachState(): { notifications: number; journalVersion: number } | null {
	return coachState;
}

/** S'abonner aux compteurs cliente (reçoit immédiatement l'état courant). */
export function onNotificationCounts(fn: Listener): () => void {
	listeners.add(fn);
	if (clientCounts) fn(clientCounts);
	return () => listeners.delete(fn);
}

/** S'abonner au badge coach temps réel (reçoit immédiatement l'état courant). */
export function onCoachState(fn: CoachListener): () => void {
	coachListeners.add(fn);
	if (coachState) fn(coachState);
	return () => coachListeners.delete(fn);
}

/** S'abonner aux événements porteurs (ex. plan assigné) côté cliente. */
export function onLiveEvent(fn: EventListener): () => void {
	eventListeners.add(fn);
	return () => eventListeners.delete(fn);
}

function emitCounts(): void {
	if (!clientCounts) return;
	for (const fn of listeners) {
		try {
			fn(clientCounts);
		} catch {
			/* un listener en échec ne bloque pas les autres */
		}
	}
}

function emitCoach(): void {
	if (!coachState) return;
	for (const fn of coachListeners) {
		try {
			fn(coachState);
		} catch {
			/* silencieux */
		}
	}
}

/** Disperse un événement porteur aux listeners + au DOM (pages concernées). */
function emitLiveEvent(ev: LiveEvent): void {
	for (const fn of eventListeners) {
		try {
			fn(ev);
		} catch {
			/* silencieux */
		}
	}
	if (typeof document !== 'undefined') {
		document.dispatchEvent(
			new CustomEvent('gflux:live-event', { detail: { kind: ev.kind, label: ev.label } })
		);
	}
}

async function fetchOnce(): Promise<void> {
	try {
		const since = lastClientCheckAt ? encodeURIComponent(String(lastClientCheckAt)) : '0';
		const r = await fetch(`/api/live?since=${since}`, {
			cache: 'no-store', // le compteur EST le signal : jamais depuis un cache
			signal: AbortSignal.timeout(8000),
		});
		if (r.status === 401) {
			// Session expirée / déconnexion : on arrête le polling proprement.
			stopPolling();
			return;
		}
		if (!r.ok) return; // erreur passagère : les états courants restent
		const j = await r.json();
		lastClientCheckAt = Date.now();

		if (j.role === 'client') {
			const next: NotificationCounts = {
				retours: Number(j.retours ?? 0),
				message: Number(j.message ?? 0),
				drive: Number(j.drive ?? 0),
				total: Number(j.total ?? 0),
			};
			const changed =
				!clientCounts ||
				clientCounts.retours !== next.retours ||
				clientCounts.message !== next.message ||
				clientCounts.drive !== next.drive;
			clientCounts = next;
			if (changed) emitCounts();
			// Événements porteurs (delta) : seulement ceux jamais vus.
			const events: LiveEvent[] = Array.isArray(j.events) ? j.events : [];
			for (const ev of events) {
				const key = `${ev.kind}:${ev.createdAt}`;
				if (seenEventKeys.has(key)) continue;
				seenEventKeys.add(key);
				emitLiveEvent({ kind: String(ev.kind), label: ev.label ?? null, createdAt: Number(ev.createdAt) });
			}
			if (seenEventKeys.size > 200) seenEventKeys = new Set([...seenEventKeys].slice(-100));
		} else if (j.role === 'coach') {
			const badge = Number(j.notifications ?? 0);
			const version = j.journalVersion == null ? knownJournalVersion : Number(j.journalVersion);
			const changed =
				!coachState ||
				coachState.notifications !== badge ||
				(version != null && knownJournalVersion != null && version !== knownJournalVersion);
			const prevVersion = knownJournalVersion;
			knownJournalVersion = version;
			coachState = { notifications: badge, journalVersion: version ?? 0 };
			if (changed || (version != null && prevVersion != null && version > prevVersion)) emitCoach();
		}
	} catch {
		/* réseau indisponible : on garde l'état courant, on réessaiera */
	}
}

/** Un tick : coalesce des appels simultanés + garde de 3 s. */
function tick(force = false): void {
	if (typeof document === 'undefined') return;
	if (document.hidden) return; // arrière-plan : rien — le réveil rattrape
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
	// persisted=true → page restaurée du bfcache : tout état est périmé → forcé.
	tick(e.persisted);
}

/**
 * Démarre le polling (idempotent — appelé au montage AppShell). Sert aux deux
 * rôles : la cliente et le coach partagent le MÊME mécanisme central.
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
