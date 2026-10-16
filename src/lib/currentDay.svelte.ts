/**
 * Source centrale de la date courante G-FLUX (Europe/Paris, PWA cliente).
 *
 * - `currentLocalDay()` renvoie la date du calendrier Europe/Paris au format
 *   YYYY-MM-DD (jamais minuit UTC ; le fuseau IANA gère été/hiver).
 * - Changement de journée géré SANS dépendre d'un simple timer :
 *   - timer jusqu'au prochain minuit Europe/Paris (si l'app reste ouverte) ;
 *   - re-vérification à chaque reprise (visibilitychange / focus / pageshow)
 *     car les timers sont tués en veille / arrière-plan ;
 *   - quand la date change, un événement `gflux:day-changed` est émis pour
 *     que les pages réagissent (Journal, Pas, Hydratation, Accueil, Cycle).
 *
 * Lecture réactive : lire `currentLocalDay()` dans un $derived / un $effect
 * re-évalue automatiquement au changement de jour.
 */

import { nextParisMidnightUtcMs, parisTodayISO } from '$lib/vision360';
let day = $state(parisTodayISO());

function localDay(d: Date = new Date()): string {
	return parisTodayISO(d.getTime());
}

/** Date locale courante (réactive). */
export function currentLocalDay(): string {
	return day;
}

/** Délai jusqu'au prochain minuit Europe/Paris (23 ou 25 h lors du DST). */
function nextMidnightDelay(): number {
	return Math.max(1000, nextParisMidnightUtcMs() - Date.now());
}

let timer: ReturnType<typeof setTimeout> | undefined;

function refresh() {
	const d = localDay();
	if (d !== day) {
		day = d;
		document.dispatchEvent(new CustomEvent('gflux:day-changed'));
	}
}

function schedule() {
	clearTimeout(timer);
	timer = setTimeout(() => {
		refresh();
		schedule();
	}, nextMidnightDelay());
}

if (typeof window !== 'undefined') {
	/* Timers tués en veille / arrière-plan → on re-vérifie à chaque reprise. */
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			refresh();
			schedule();
		}
	});
	window.addEventListener('focus', () => {
		refresh();
		schedule();
	});
	window.addEventListener('pageshow', () => {
		refresh();
		schedule();
	});
	schedule();
}

/* Aide au test sans attendre minuit (console dev uniquement — aucun bouton UI). */
if (typeof window !== 'undefined') {
	(window as unknown as Record<string, unknown>).__gfluxSetLocalDay = (iso: string) => {
		day = iso;
		document.dispatchEvent(new CustomEvent('gflux:day-changed'));
	};
}