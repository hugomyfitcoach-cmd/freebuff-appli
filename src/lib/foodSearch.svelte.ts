/**
 * MOTEUR DE RECHERCHE ALIMENTAIRE RÉACTIF — source de vérité partagée.
 *
 * Utilisé par le CRM coach (fiche cliente → Journal → « Ajouter un aliment »,
 * et l'éditeur des plans de repas) avec EXACTEMENT les règles de la PWA
 * cliente (Journal /espace/journal) :
 *
 *  - deux sources STRICTEMENT séparées : Ciqual (ANSES, aliments de référence)
 *    en tête, produits Open Food Facts ensuite — jamais fusionnées ;
 *  - mêmes endpoints BFF que la cliente (`/api/foods/search`, `/api/foods/ciqual`)
 *    → même normalisation, même ranking (foodRanking), mêmes repères Ciqual
 *    (ex. « oeuf » → cru, dur, au plat) : à requête identique, résultats
 *    identiques côté cliente et côté coach ;
 *  - recherche réactive : debounce 300 ms après la frappe (règle PWA), seuil
 *    2 caractères, Enter = accélérateur (jamais obligatoire) ;
 *  - garde-fou anti-course : chaque frappe incrémente un compteur, une réponse
 *    ancienne ne peut JAMAIS remplacer les résultats d'une requête plus récente ;
 *  - pagination scroll infini (tranches de 25, `loadMore`), bloc Ciqual
 *    toujours hors pagination ;
 *  - contrat serveur PWA gardé : réponse `{ items, hasMore }` inattendue =
 *    ERREUR affichée (jamais une liste vide silencieuse).
 *
 * Module `.svelte.ts` : l'état est réactif (runes Svelte 5) et partagé avec le
 * template via `controller.state`. `ciqualToFood` reste pur (testable hors
 * composant).
 */
import { FRONTEND_API_VERSION } from '$lib/apiVersion';

/** Seuil minimal de caractères (règle PWA : aucune requête en dessous). */
export const FOOD_SEARCH_MIN_CHARS = 2;
/** Debounce après la dernière frappe (règle PWA, Journal cliente). */
export const FOOD_SEARCH_DEBOUNCE_MS = 300;

export type SearchFood = {
	_id: string;
	offId?: string;
	name: string;
	brand?: string;
	kcal100: number;
	carbs100: number;
	protein100: number;
	fat100: number;
	/** Garde-fou kcal↔macros : kcal OFF incohérentes, valeur recalculée affichée. */
	kcalRecalculated?: boolean;
	imageUrl?: string;
	/** Miniature miroir G-FLUX prête (copie OFF 100 px) — prioritaire sur imageUrl. */
	thumbUrl?: string;
	servingQty?: number;
	servingUnit?: string;
	/** Aliment personnel créé par le client (base « Créés par moi »). */
	custom?: boolean;
	/** Fiche de RÉFÉRENCE Ciqual (ANSES) — _id = libellé officiel exact. */
	ciqual?: boolean;
};

/** Fiche Ciqual brute renvoyée par le BFF `/api/foods/ciqual`. */
export type CiqualRaw = { label: string; kcal: number; protein?: number; carbs?: number; fat?: number };

/** Réponse paginée du BFF produits ({ items, hasMore } — tranches de 25). */
export type SearchPage = { items: SearchFood[]; hasMore: boolean };

/** État réactif exposé au template (mutable via les méthodes du contrôleur). */
export type FoodSearchState = {
	/** Requête courante (liée au champ). */
	q: string;
	/** Recherche en vol (loading discret : la liste existante reste affichée). */
	searching: boolean;
	error: string;
	/** Produits OFF classés (moteur PWA — ranking identique côté cliente). */
	products: SearchFood[];
	/** Fiches de référence Ciqual — bloc séparé, TOUJOURS au-dessus des produits. */
	ciqual: SearchFood[];
	/** Reste-t-il des produits au-delà de la tranche affichée ? */
	hasMore: boolean;
	/** Décalage serveur de la prochaine tranche. */
	nextOffset: number;
	/** Garde-fou : une seule requête « page suivante » en vol à la fois. */
	loadingMore: boolean;
	/** Indication « fais défiler » (PWA) — les écrans CRM peuvent l'ignorer. */
	showScrollHint: boolean;
};

export type FoodSearchController = {
	readonly state: FoodSearchState;
	/** À chaque frappe : debounce, seuil 2 caractères, reset propre si trop court. */
	setQuery(q: string): void;
	/** Accélérateur clavier (Enter) : lance immédiatement la recherche courante. */
	runNow(): void;
	/** Reset complet (ouverture du panneau, effacement) + annulation du timer. */
	clear(): void;
	/** Page suivante de produits OFF (scroll infini, +25 classés). */
	loadMore(): void;
	/** L'utilisateur a fait défiler : plus besoin de l'indication. */
	hideScrollHint(): void;
};

/** Fiche Ciqual → SearchFood (l'_id porté par les flux est le LIBELLÉ officiel
 *  exact ; à l'ajout, le serveur résout les valeurs — jamais le client). */
export function ciqualToFood(h: CiqualRaw): SearchFood {
	return {
		_id: h.label,
		name: h.label,
		kcal100: h.kcal,
		carbs100: h.carbs ?? 0,
		protein100: h.protein ?? 0,
		fat100: h.fat ?? 0,
		ciqual: true,
	};
}

/**
 * Crée un contrôleur de recherche réactive. À appeler à l'initialisation du
 * composant (jamais au niveau module : l'état est réactif).
 */
export function createFoodSearch(): FoodSearchController {
	const state = $state<FoodSearchState>({
		q: '',
		searching: false,
		error: '',
		products: [],
		ciqual: [],
		hasMore: false,
		nextOffset: 0,
		loadingMore: false,
		showScrollHint: false,
	});

	let timer: ReturnType<typeof setTimeout> | undefined;
	/** Compteur anti-course : seule la DERNIÈRE requête lancée peut écrire l'état. */
	let seq = 0;

	function clearTimer() {
		if (timer) {
			clearTimeout(timer);
			timer = undefined;
		}
	}

	function resetResults() {
		state.products = [];
		state.ciqual = [];
		state.hasMore = false;
		state.nextOffset = 0;
		state.showScrollHint = false;
	}

	/** Recherche effective (produits PWA + Ciqual, en parallèle). */
	async function run(q: string) {
		// Même règle que la PWA : en dessous de 2 caractères, pas de requête.
		if (q.length < FOOD_SEARCH_MIN_CHARS) return;
		clearTimer();
		const req = ++seq;
		state.q = q;
		state.searching = true;
		state.error = '';
		state.showScrollHint = false;
		// Contrat PWA : réponse { items, hasMore } obligatoire — un payload
		// inattendu est une ERREUR affichée, jamais une liste vide silencieuse.
		const off = fetch(`/api/foods/search?q=${encodeURIComponent(q)}&v=${FRONTEND_API_VERSION}`, {
			signal: AbortSignal.timeout(15_000),
		})
			.then(async (r) => {
				const j = await r.json();
				if (j.error) throw new Error(j.error);
				if (!Array.isArray(j.items)) throw new Error('Recherche momentanément indisponible — réessaie dans un instant.');
				return j as SearchPage;
			});
		// Échec Ciqual silencieux : pas de grosse section vide, les produits
		// OFF restent affichés (règle PWA).
		const ciq = fetch(`/api/foods/ciqual?q=${encodeURIComponent(q)}`)
			.then(async (r) => {
				const j = await r.json();
				return j.error ? [] : (j as CiqualRaw[]).map(ciqualToFood);
			})
			.catch(() => [] as SearchFood[]);
		let page: SearchPage;
		try {
			page = await off;
		} catch (e) {
			// Contrat PWA : l'erreur est affichée, résultats vidés — sauf si une
			// recherche plus récente a déjà pris la main (anti-course).
			if (req === seq) {
				state.error = e instanceof Error ? e.message : String(e);
				state.products = [];
				state.ciqual = [];
				state.hasMore = false;
				state.nextOffset = 0;
				state.showScrollHint = false;
				state.searching = false;
				state.loadingMore = false;
			}
			return;
		}
		const ciqual = await ciq;
		// Garde-fou anti-course : une recherche plus récente a pris la main →
		// cette réponse est jetée (elle n'écrase jamais les résultats affichés).
		if (req !== seq) return;
		state.products = page.items;
		state.hasMore = !!page.hasMore;
		state.nextOffset = page.items.length ? 25 : 0;
		state.showScrollHint = state.hasMore;
		state.ciqual = ciqual;
		state.searching = false;
		state.loadingMore = false;
	}

	function setQuery(q: string) {
		state.q = q;
		clearTimer();
		const t = q.trim();
		if (t.length < FOOD_SEARCH_MIN_CHARS) {
			// Trop court : écran nettoyé immédiatement, aucune requête réseau,
			// et toute réponse encore en vol est invalidée.
			seq++;
			resetResults();
			state.error = '';
			state.searching = false;
			state.loadingMore = false;
			return;
		}
		// Frappe en cours : les résultats restent visibles (pas de flash),
		// le loading discret s'affiche pendant le debounce + la requête.
		state.searching = true;
		timer = setTimeout(() => void run(t), FOOD_SEARCH_DEBOUNCE_MS);
	}

	function runNow() {
		clearTimer();
		void run(state.q.trim());
	}

	function clear() {
		clearTimer();
		seq++; // invalide toute réponse en vol
		state.q = '';
		state.error = '';
		resetResults();
		state.searching = false;
		state.loadingMore = false;
	}

	async function loadMore() {
		const q = state.q.trim();
		if (state.loadingMore || !state.hasMore || q.length < FOOD_SEARCH_MIN_CHARS) return;
		state.showScrollHint = false; // l'utilisateur a fait défiler
		state.loadingMore = true;
		const req = seq; // la pagination appartient à la recherche courante
		try {
			const r = await fetch(`/api/foods/search?q=${encodeURIComponent(q)}&offset=${state.nextOffset}&limit=25`);
			const j = await r.json();
			if (req !== seq) return; // nouvelle recherche entre-temps : jeté
			if (!j.error) {
				const items = (j.items ?? []) as SearchFood[];
				const seen = new Set(state.products.map((f) => f._id));
				state.products = [...state.products, ...items.filter((f) => !seen.has(f._id))];
				state.hasMore = !!j.hasMore;
				state.nextOffset += 25;
			}
		} catch {
			// réseau indisponible : on réessayera au prochain déclenchement
		} finally {
			if (req === seq) state.loadingMore = false;
		}
	}

	function hideScrollHint() {
		state.showScrollHint = false;
	}

	return { state, setQuery, runNow, clear, loadMore, hideScrollHint };
}
