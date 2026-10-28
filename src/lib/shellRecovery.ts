/**
 * Filet de sécurité « page sans feuille de style » (PWA installée, Android).
 *
 * INCIDENT DU 28/10/2026 : à l'ouverture, la page s'affichait SANS CSS (police
 * serif, blocs empilés, anneaux de macros pleine largeur), et fermer/rouvrir
 * l'app corrigeait. Un document peut réclamer les fichiers d'un build que
 * Netlify ne sert plus (un déploiement ne sert QUE ses propres fichiers) —
 * `/_app/immutable/...css` répond alors 404, le navigateur n'applique aucune
 * feuille et rien ne le signale.
 *
 * Réaction : UN rechargement automatique de la page, qui repart sur le
 * document et les fichiers du build en ligne. Trois garde-fous :
 *  - anti-boucle : au plus MAX_AUTO_RELOADS rechargements par session, jamais
 *    à moins de MIN_RELOAD_GAP_MS d'intervalle (un déploiement réellement
 *    cassé ne fait donc pas clignoter l'app) ;
 *  - aucune perte de saisie : si un volet (rôle dialog / aria-modal) est
 *    ouvert ou qu'un champ est en cours d'édition, le rechargement est
 *    REPORTÉ et n'a lieu qu'à la navigation suivante (flushDeferredReload) ;
 *  - détection non intrusive : aucune requête réseau supplémentaire — on
 *    regarde les feuilles du document et l'événement `vite:preloadError`
 *    (module de route introuvable).
 *
 * Module volontairement SANS import `$app/*` : il est testable tel quel
 * (tests/mission-pwa-shell-recovery.test.mjs charge ce fichier dans Chromium).
 */

/** Clé sessionStorage du garde-fou anti-boucle (par onglet/session d'app). */
const RELOAD_KEY = 'gflux-shell-reload';
/** Deux rechargements automatiques maximum par session : au-delà, on laisse
 *  l'utilisatrice recharger elle-même (le déploiement est sans doute cassé). */
const MAX_AUTO_RELOADS = 2;
/** Intervalle minimal entre deux rechargements automatiques. */
const MIN_RELOAD_GAP_MS = 15_000;
/** Feuille de style versionnée par le build (SvelteKit/Vite). */
const BUILD_STYLESHEET_RE = /\/_app\/immutable\/.*\.css$/;
/** Délai de grâce après `load` : une feuille encore en vol n'est pas un échec. */
const CSS_CHECK_DELAY_MS = 300;

type ReloadGuard = { count: number; at: number };

export type ShellRecoveryOptions = {
	/** Empreinte du build exécuté (`BUILD_VERSION`) — pour le diagnostic. */
	build: string;
	/** Rechargement (injectable pour les tests). */
	reload?: () => void;
	/** Stockage du garde-fou (injectable pour les tests). */
	storage?: Storage;
};

let started = false;
let deferred = false;
let currentBuild = 'dev';
let doReload: () => void = () => location.reload();
let guardStorage: Storage | null = null;
/** Rechargements tentés sans stockage disponible (garde-fou mémoire). */
let attempts = 0;

/** Un volet ou une saisie en cours ? (le rechargement attendrait la suite) */
export function blockingUiOpen(doc: Document = document): boolean {
	if (doc.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return true;
	const el = doc.activeElement as HTMLElement | null;
	if (!el) return false;
	const tag = el.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/** Une feuille de style du build n'a pas pu être chargée (fichier absent). */
export function missingBuildStylesheet(doc: Document = document): boolean {
	const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')) as HTMLLinkElement[];
	const buildLinks = links.filter((l) => {
		try {
			return BUILD_STYLESHEET_RE.test(new URL(l.href, doc.baseURI).pathname);
		} catch {
			return false;
		}
	});
	// Aucune feuille versionnée dans le document (CSS inliné, page nue) : rien
	// à vérifier — on ne déclenche jamais un rechargement « au cas où ».
	if (buildLinks.length === 0) return false;
	// Un fichier CSS absent (404, page HTML servie à la place, réseau coupé sur
	// un fichier non mis en cache) donne une feuille VIDE : Chromium crée bien
	// l'objet `sheet` mais sans aucune règle — c'est le seul signal fiable
	// (mesuré sur Chromium `Pixel 7` : sheet défini, cssRules.length = 0).
	return buildLinks.some((l) => {
		try {
			return l.sheet !== null && l.sheet.cssRules.length === 0;
		} catch {
			return false; // feuille illisible (autre origine) : on ne conclut rien
		}
	});
}

function readGuard(storage: Storage): ReloadGuard {
	try {
		const raw = storage.getItem(RELOAD_KEY);
		const parsed = raw ? (JSON.parse(raw) as Partial<ReloadGuard>) : null;
		return { count: Number(parsed?.count ?? 0) || 0, at: Number(parsed?.at ?? 0) || 0 };
	} catch {
		return { count: 0, at: 0 };
	}
}

function writeGuard(storage: Storage, guard: ReloadGuard): void {
	try {
		storage.setItem(RELOAD_KEY, JSON.stringify(guard));
	} catch {
		/* sessionStorage indisponible (mode privé strict) : le rechargement
		   reste borné par le compteur en mémoire de la page suivante */
	}
}

/**
 * Recharge la page UNE fois si un fichier de l'app manque, ou reporte le
 * rechargement à la prochaine navigation quand une saisie est en cours.
 */
export function requestShellReload(): boolean {
	if (typeof window === 'undefined') return false;
	if (blockingUiOpen()) {
		deferred = true;
		return false;
	}
	const storage = guardStorage ?? safeSessionStorage();
	if (storage) {
		const guard = readGuard(storage);
		if (guard.count >= MAX_AUTO_RELOADS) return false;
		if (Date.now() - guard.at < MIN_RELOAD_GAP_MS) return false;
		writeGuard(storage, { count: guard.count + 1, at: Date.now() });
	} else {
		if (attempts >= MAX_AUTO_RELOADS) return false;
		attempts += 1;
	}
	deferred = false;
	doReload();
	return true;
}

function safeSessionStorage(): Storage | null {
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

/** Rechargement reporté (volet/saisie ouverte) → exécuté à la navigation suivante. */
export function flushDeferredShellReload(): void {
	if (!deferred) return;
	deferred = false;
	requestShellReload();
}

/** État du report (tests / diagnostic). */
export function isShellReloadDeferred(): boolean {
	return deferred;
}

/**
 * Branche la surveillance du shell (idempotent — appelé au montage du layout
 * racine). Couvre les deux symptômes observables d'un fichier de build
 * disparu : feuille de style absente, module de route impossible à charger.
 */
export function installShellRecovery(opts: ShellRecoveryOptions): void {
	if (started || typeof window === 'undefined') return;
	started = true;
	currentBuild = opts.build;
	guardStorage = opts.storage ?? safeSessionStorage();
	if (opts.reload) doReload = opts.reload;

	// Module JS d'une route introuvable après déploiement : SvelteKit/Vite
	// signale l'échec de préchargement. Un seul rechargement, jamais en boucle.
	window.addEventListener('vite:preloadError', () => {
		requestShellReload();
	});

	const check = () => {
		if (missingBuildStylesheet()) requestShellReload();
	};
	// Après `load` : une feuille encore en cours de téléchargement n'est pas
	// un fichier manquant (faux positif = rechargement inutile).
	if (document.readyState === 'complete') {
		setTimeout(check, CSS_CHECK_DELAY_MS);
	} else {
		window.addEventListener('load', () => setTimeout(check, CSS_CHECK_DELAY_MS), { once: true });
	}
	// Retour depuis le cache bfcache (réouverture de la PWA sur Android) : le
	// document peut avoir été restauré tel quel, avec ses ressources d'origine.
	window.addEventListener('pageshow', (e) => {
		if (e.persisted) setTimeout(check, CSS_CHECK_DELAY_MS);
	});
}

/** Empreinte surveillée (diagnostic). */
export function shellRecoveryBuild(): string {
	return currentBuild;
}
