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

/**
 * Un champ éditable a-t-il le focus ? iOS peut alors décaler légitimement la
 * vue (le clavier amène le champ visible) : on ne la lui reprend pas.
 *
 * Détection locale, sans importer `keyboardViewport` (qui importe déjà ce
 * module) : même règle, aucune dépendance circulaire.
 */
function editableFocused(): boolean {
	if (typeof document === 'undefined') return false;
	const active = document.activeElement as
		| (Element & { disabled?: boolean; readOnly?: boolean; type?: string; isContentEditable?: boolean })
		| null;
	if (!active) return false;
	const g = globalThis as unknown as Record<string, unknown>;
	const Input = g.HTMLInputElement as (new () => object) | undefined;
	const TextArea = g.HTMLTextAreaElement as (new () => object) | undefined;
	const Select = g.HTMLSelectElement as (new () => object) | undefined;
	const HtmlElement = g.HTMLElement as (new () => object) | undefined;
	if (Input && active instanceof Input) {
		return (
			!active.disabled &&
			!active.readOnly &&
			!['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'hidden'].includes(
				String(active.type)
			)
		);
	}
	if (TextArea && active instanceof TextArea) return true;
	if (Select && active instanceof Select) return true;
	return Boolean(HtmlElement && active instanceof HtmlElement && active.isContentEditable);
}

/**
 * Le document est-il décalé alors qu'il est verrouillé ? (`scrollY = 62` mesuré
 * sur iPhone PWA : la barre d'état restait comptée dans le décalage, la couche
 * affichée glissait de 62 px et `elementFromPoint` ne touchait plus rien.)
 */
function documentOffset(): number {
	if (typeof window === 'undefined') return 0;
	const x = window.scrollX || 0;
	const y = window.scrollY || document.documentElement.scrollTop || 0;
	return x || y ? 1 : 0;
}

/** Ramène le document à zéro — une passe immédiate, une au tick suivant. */
function reassertDocumentZero(): void {
	if (!locked || locks === 0) return;
	/* Clavier légitime : ne jamais lutter contre iOS. */
	if (editableFocused()) return;
	if (!documentOffset()) return;
	window.scrollTo(0, 0);
}

/**
 * Maintien à zéro pendant TOUT le verrou (PWA-DECALAGE).
 *
 * iOS applique le décalage de la barre d'état EN DIFFÉRÉ, après `resize` et
 * `orientationchange` : corriger une seule fois, à l'instant de l'événement,
 * laissait la fenêtre défilée. On réaffirme donc à chaque événement ET au tick
 * suivant (`requestAnimationFrame`), tant que la page est verrouillée.
 */
function holdDocumentAtZero(): void {
	if (!locked || locks === 0) return;
	reassertDocumentZero();
	window.requestAnimationFrame(reassertDocumentZero);
}

let stopHold: (() => void) | null = null;

/** Abonne le verrou aux changements de viewport (rotation, clavier, décalage). */
function startHoldDocumentAtZero(): void {
	if (stopHold) return;
	/* Harnais de test minimal : pas d'écouteurs, la correction explicite reste. */
	if (typeof window.addEventListener !== 'function') return;
	const vv = window.visualViewport;
	window.addEventListener('resize', holdDocumentAtZero);
	window.addEventListener('orientationchange', holdDocumentAtZero);
	window.addEventListener('scroll', holdDocumentAtZero);
	vv?.addEventListener?.('resize', holdDocumentAtZero);
	vv?.addEventListener?.('scroll', holdDocumentAtZero);
	stopHold = () => {
		window.removeEventListener?.('resize', holdDocumentAtZero);
		window.removeEventListener?.('orientationchange', holdDocumentAtZero);
		window.removeEventListener?.('scroll', holdDocumentAtZero);
		vv?.removeEventListener?.('resize', holdDocumentAtZero);
		vv?.removeEventListener?.('scroll', holdDocumentAtZero);
		stopHold = null;
	};
}

/** Détache les écouteurs AVANT toute restauration de position. */
function stopHoldDocumentAtZero(): void {
	stopHold?.();
}

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
	/* PWA-DECALAGE : tant que le verrou tient, aucun décalage ne survit. */
	startHoldDocumentAtZero();
}

/**
 * RE-BASE DU VERROU APRÈS ROTATION (SCAN-ROTATION).
 *
 * Le body figé porte la position (`top: -y`) : le document lui-même doit
 * rester à `scrollY = 0`. Après une rotation, iOS peut y laisser une position
 * héritée de l'orientation précédente — la couche AFFICHÉE glisse alors par
 * rapport à la couche qui REÇOIT LES TOUCHES : le volet et sa croix semblent
 * inertes alors qu'ils sont toujours là. On réaffirme le verrou (jamais de
 * document défilable sous un volet) et on remet le document à zéro.
 *
 * Le décalage mémorisé est conservé : au déverrouillage, la position d'avant
 * l'ouverture est restaurée comme d'habitude.
 */
export function rebaseScrollLock(): void {
	if (!isBrowser() || !locked || locks === 0) return;
	const body = document.body;
	const html = document.documentElement;

	body.style.position = 'fixed';
	body.style.top = `-${locked.y}px`;
	body.style.left = '0';
	body.style.right = '0';
	body.style.width = '100%';
	body.style.overflow = 'hidden';
	html.style.overflow = 'hidden';

	/* Aucune autre couche ne doit défiler : la position du document est
	   entièrement portée par le body figé. La correction est réaffirmée au tick
	   suivant (iOS applique son décalage après l'événement). */
	startHoldDocumentAtZero();
	holdDocumentAtZero();
}

/** Rend le document défilable et restaure la position exacte d'avant le verrou. */
export function unlockScroll(): void {
	if (!isBrowser()) return;
	if (locks === 0) return;
	locks -= 1;
	if (locks > 0 || !locked) return;

	const state = locked;
	locked = null;
	/* Plus aucun maintien : la restauration de position ci-dessous est la
	   seule à décider où le document revient. */
	stopHoldDocumentAtZero();
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
		stopHoldDocumentAtZero();
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
