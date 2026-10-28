/**
 * VERROU DE DÉFILEMENT PARTAGÉ (Mission R5c-quinquies).
 *
 * Constat : sur iPhone/Safari, `body { overflow: hidden }` ne bloque PAS le
 * document. Le défilement du Journal se fait sur le document lui-même
 * (`window.scrollY` — même source que `navMemory`), et WebKit continue de le
 * faire défiler (geste sur `html`, rebond élastique) même quand le body est
 * marqué `overflow: hidden`.
 *
 * Technique fiable, la même pour TOUS les volets de l'app : figer le body en
 * `position: fixed` à sa position courante (`top: -scrollY`), ce qui retire
 * toute hauteur défilable au document, puis restaurer les styles et la
 * position EXACTE au déverrouillage. Un compteur de verrous gère les volets
 * superposés : le premier verrouille, le dernier libère.
 *
 * Aucun effet de bord hors des styles inline `body` / `html` : les valeurs
 * d'origine sont mémorisées puis rendues telles quelles.
 */

type BodyStyle = {
	position: string;
	top: string;
	left: string;
	right: string;
	width: string;
	overflow: string;
	paddingRight: string;
};

type LockedState = {
	/** Position du document au moment du verrou (restaurée au déverrouillage). */
	y: number;
	body: BodyStyle;
	htmlOverflow: string;
};

let locks = 0;
let locked: LockedState | null = null;

const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';

/** Position de défilement réellement visible (celle d'avant le verrou si figé). */
export function currentScrollY(): number {
	if (typeof window === 'undefined') return 0;
	if (locked) return locked.y;
	return window.scrollY || document.documentElement.scrollTop || 0;
}

/** Nombre de verrous actifs (0 = document défilable). */
export function scrollLockCount(): number {
	return locks;
}

/** Fige le document à sa position courante. Idempotent par appel. */
export function lockScroll(): void {
	if (!isBrowser()) return;
	locks += 1;
	if (locks > 1 || locked) return;

	const body = document.body;
	const html = document.documentElement;
	const y = window.scrollY || html.scrollTop || 0;
	/* Barre de défilement desktop : sa disparition ne doit pas décaler la page. */
	const scrollbar = Math.max(0, window.innerWidth - html.clientWidth);

	locked = {
		y,
		htmlOverflow: html.style.overflow,
		body: {
			position: body.style.position,
			top: body.style.top,
			left: body.style.left,
			right: body.style.right,
			width: body.style.width,
			overflow: body.style.overflow,
			paddingRight: body.style.paddingRight,
		},
	};

	body.style.position = 'fixed';
	body.style.top = `-${y}px`;
	body.style.left = '0';
	body.style.right = '0';
	body.style.width = '100%';
	body.style.overflow = 'hidden';
	if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
	/* Ceinture et bretelles : html ne doit rien avoir à faire défiler non plus. */
	html.style.overflow = 'hidden';
}

/** Rend le document défilable et restaure la position exacte d'avant le verrou. */
export function unlockScroll(): void {
	if (!isBrowser()) return;
	if (locks === 0) return;
	locks -= 1;
	if (locks > 0 || !locked) return;

	const state = locked;
	locked = null;
	const body = document.body;
	body.style.position = state.body.position;
	body.style.top = state.body.top;
	body.style.left = state.body.left;
	body.style.right = state.body.right;
	body.style.width = state.body.width;
	body.style.overflow = state.body.overflow;
	body.style.paddingRight = state.body.paddingRight;
	document.documentElement.style.overflow = state.htmlOverflow;

	/* Le document retrouve sa hauteur : on remet la position d'avant le volet.
	   Deux passes (immédiate + frame suivante) car WebKit recalcule le layout
	   du body `position: fixed` juste après la restauration. */
	window.scrollTo(0, state.y);
	window.requestAnimationFrame(() => window.scrollTo(0, state.y));
}

/** Remise à zéro complète (démontage brutal, tests) — sans animation. */
export function resetScrollLock(): void {
	locks = 0;
	if (locked) {
		const state = locked;
		locked = null;
		const body = document.body;
		body.style.position = state.body.position;
		body.style.top = state.body.top;
		body.style.left = state.body.left;
		body.style.right = state.body.right;
		body.style.width = state.body.width;
		body.style.overflow = state.body.overflow;
		body.style.paddingRight = state.body.paddingRight;
		document.documentElement.style.overflow = state.htmlOverflow;
		window.scrollTo(0, state.y);
	}
}
