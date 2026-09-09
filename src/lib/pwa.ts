/**
 * Détection PWA — CAPABILITY-FIRST.
 *
 * Règles du produit :
 * - standalone détecté → G-FLUX est installée sur CET appareil → jamais de
 *   tutoriel d'installation (même après logout/re-login) ;
 * - navigateur classique → on ne sait PAS si une icône existe : on demande
 *   simplement à la cliente (écran « G-FLUX déjà installée ? ») ;
 * - Android : beforeinstallprompt = installation native prioritaire ;
 * - jamais de numéro de version Android codé en dur : les différences viennent
 *   du navigateur, pas de l'OS. feature detection > browser detection.
 */

/** G-FLUX tourne-t-elle comme app installée (depuis l'icône) ? */
export function isStandalone(): boolean {
	if (typeof window === 'undefined') return false;
	const nav = navigator as Navigator & { standalone?: boolean };
	// iOS Safari expose navigator.standalone en mode app installée.
	if (nav.standalone === true) return true;
	return window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export type Platform = 'ios' | 'android';

/** Plateforme probable — pré-sélection uniquement, le choix humain reste possible. */
export function detectPlatform(): Platform | null {
	if (typeof navigator === 'undefined') return null;
	const ua = navigator.userAgent;
	if (/iPhone|iPod|iPad/i.test(ua)) return 'ios';
	// iPadOS 13+ se présente comme Macintosh mais reste tactile.
	if (/Macintosh/i.test(ua) && 'ontouchend' in document) return 'ios';
	if (/Android/i.test(ua)) return 'android';
	return null;
}

export type MobileBrowser = 'safari' | 'chrome-ios' | 'chrome' | 'samsung' | 'firefox' | 'edge' | 'inapp' | 'other';

/**
 * Navigateur reconnu — sert uniquement à ADAPTER LES TEXTES du tutoriel,
 * jamais à décider si l'app est installée.
 * « inapp » = webview intégrée (WhatsApp, Instagram, Messenger, Gmail…) :
 * les capacités d'installation y sont absentes → instruction « ouvre dans
 * Safari/Chrome » au lieu d'étapes impossibles.
 */
export function detectBrowser(): MobileBrowser {
	if (typeof navigator === 'undefined') return 'other';
	const ua = navigator.userAgent;
	// Webviews intégrées (avant les détections de navigateurs) : FB/Messenger,
	// Instagram, WhatsApp, Gmail, et le fallback générique FBAV.
	if (/FBAV|FB_IAB|FBAN|Messenger|Instagram|WhatsApp/i.test(ua)) return 'inapp';
	if (/GSA|gmail/i.test(ua)) return 'inapp';
	if (/CriOS/i.test(ua)) return 'chrome-ios';
	if (/FxiOS/i.test(ua)) return 'firefox';
	if (/EdgiOS|EdgA/i.test(ua)) return 'edge';
	if (/SamsungBrowser/i.test(ua)) return 'samsung';
	if (/Chrome|Chromium/i.test(ua)) return 'chrome';
	if (/Safari/i.test(ua)) return 'safari';
	return 'other';
}

/** Navigateur Android avec installation native possible (Chromium). */
export function isChromiumAndroid(): boolean {
	const p = detectPlatform();
	const b = detectBrowser();
	return p === 'android' && (b === 'chrome' || b === 'edge' || b === 'samsung');
}

/* ───── beforeinstallprompt (Android / Chromium) ───── */

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferredPrompt: BIPEvent | null = null;
const listeners = new Set<(available: boolean) => void>();

if (typeof window !== 'undefined') {
	window.addEventListener('beforeinstallprompt', (e) => {
		e.preventDefault();
		deferredPrompt = e as BIPEvent;
		for (const fn of listeners) fn(true);
	});
	window.addEventListener('appinstalled', () => {
		deferredPrompt = null;
		for (const fn of listeners) fn(false);
	});
}

/** L'installation native Android est-elle disponible maintenant ? */
export function canNativeInstall(): boolean {
	return deferredPrompt !== null;
}

/** S'abonner aux changements de disponibilité du prompt natif. */
export function onNativeInstallChange(fn: (available: boolean) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

/** Déclenche le prompt natif. Résout `accepted` / `dismissed` / `unavailable`. */
export async function promptNativeInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
	if (!deferredPrompt) return 'unavailable';
	try {
		await deferredPrompt.prompt();
		const { outcome } = await deferredPrompt.userChoice;
		deferredPrompt = null;
		return outcome === 'accepted' ? 'accepted' : 'dismissed';
	} catch {
		return 'unavailable';
	}
}

/**
 * Statut local (cet appareil) : mémoire de session pour ne pas re-demander
 * en boucle dans le même onglet — le statut serveur reste la source
 * inter-appareils, la détection locale reste prioritaire (nouveau téléphone).
 */
const SEEN_KEY = 'gflux-pwa-onboarding-seen';
export function markOnboardingSeenLocally(): void {
	try {
		sessionStorage.setItem(SEEN_KEY, '1');
	} catch {
		/* stockage indisponible : aucun impact */
	}
}
export function wasOnboardingSeenLocally(): boolean {
	try {
		return sessionStorage.getItem(SEEN_KEY) === '1';
	} catch {
		return false;
	}
}
