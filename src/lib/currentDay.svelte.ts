/**
 * Source centrale de la DATE LOCALE COURANTE (PWA cliente).
 *
 * - `currentLocalDay()` renvoie la date locale de la cliente au format
 *   YYYY-MM-DD (jamais minuit UTC : on suit le fuseau du téléphone).
 * - Changement de journée géré SANS dépendre d'un simple timer :
 *   - timer jusqu'au prochain minuit local (si l'app reste ouverte) ;
 *   - re-vérification à chaque reprise (visibilitychange / focus / pageshow)
 *     car les timers sont tués en veille / arrière-plan ;
 *   - quand la date change, un événement `gflux:day-changed` est émis pour
 *     que les pages réagissent (Journal, Accueil, Cycle).
 *
 * Lecture réactive : lire `currentLocalDay()` dans un $derived / un $effect
 * re-évalue automatiquement au changement de jour.
 */

let day = $state(localDay());

function localDay(d: Date = new Date()): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Date locale courante (réactive). */
export function currentLocalDay(): string {
	return day;
}

/** Délai (ms) jusqu'au prochain minuit local. */
function nextMidnightDelay(): number {
	const now = new Date();
	const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
	return Math.max(1000, next.getTime() - now.getTime());
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