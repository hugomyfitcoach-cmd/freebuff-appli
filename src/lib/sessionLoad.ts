/**
 * Chargement de séance — résilient et fini (PWA iPhone / réseau mobile).
 *
 * Racine de l'incident : `SessionRunner` attendait `fetch(...)` SANS timeout ;
 * un hang transport (socket morte après reprise arrière-plan iOS, flux HTTP/2
 * bloqué au CDN, cold-start serverless) laissait l'écran sur
 * « Chargement de la séance… » indéfiniment, sans erreur ni sortie.
 *
 * Contrat (garanti par les tests) :
 * - timeout ~15 s par tentative (AbortController — la requête abandonnée ne
 *   pend jamais) ;
 * - EXACTEMENT 1 retry automatique sur transport (timeout / réseau / réponse
 *   illisible) — jamais plus, jamais infini ;
 * - l'état final arrive toujours en temps fini : succès, erreur applicative
 *   (JSON {error}) ou échec définitif (message utilisateur) ;
 * - annulation externe au démontage : aucun setState après unmount ;
 * - aucun secret, aucune stack technique : les messages pour l'utilisatrice
 *   restent lisibles, la cause technique reste dans les logs serveur.
 */

/** Délai avant abandon d'une tentative (ms). */
export const SESSION_LOAD_TIMEOUT_MS = 15_000;

/** Erreur transport (timeout, réseau, réponse illisible) — 1 retry autorisé. */
export class TransportError extends Error {
	constructor(message = 'Réponse non reçue à temps') {
		super(message);
		this.name = 'TransportError';
	}
}

/** Message affiché à l'utilisatrice quand le chargement échoue définitivement. */
export const SESSION_LOAD_ERROR_MESSAGE =
	'Impossible de charger ta séance pour le moment. Vérifie ta connexion puis réessaie.';

/** Garde-fou : maximum absolu de tentatives (1 initiale + 1 retry). */
export const MAX_ATTEMPTS = 2;

/** Résultat normalisé remis au composant via setState (une écriture par issue). */
export type LoadState =
	| { kind: 'success'; data: unknown }
	| { kind: 'appError'; message: string }
	| { kind: 'transportError'; message: string };

/**
 * Charge la séance planifiée `scheduledId` depuis le BFF `/api/training/session/[id]`.
 *
 * - `setState` : une seule écriture par issue (succès / erreur) — le composant
 *   pose data/err/loading à partir de ce résultat unique ;
 * - `signal` : annulation externe (démontage) — l'état n'est plus touché ;
 * - Jette `TransportError` (message utilisateur) si les deux tentatives échouent ;
 * - ne JAMAIS jeter pour une erreur applicative : elle est retournée via setState.
 */
export async function loadScheduledSession(
	scheduledId: string,
	opts: {
		baseUrl?: string;
		timeoutMs?: number;
		fetchFn?: typeof fetch;
		signal?: AbortSignal;
		setState?: (s: LoadState) => void;
	} = {}
): Promise<void> {
	const baseUrl = opts.baseUrl ?? '';
	const timeoutMs = opts.timeoutMs ?? SESSION_LOAD_TIMEOUT_MS;
	const doFetch = opts.fetchFn ?? fetch;
	const external = opts.signal ?? new AbortController().signal;
	const setState = opts.setState ?? (() => {});

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		if (external.aborted) throw new DOMException('Aborted', 'AbortError');
		try {
			const res = await attemptFetch(baseUrl, scheduledId, timeoutMs, doFetch, external);
			if (external.aborted) throw new DOMException('Aborted', 'AbortError');
			// Le parse peut échouer (HTML d'erreur du CDN, corps vide) OU PENDRE
			// (corps jamais terminé) : timeout dessus aussi — transport réessayable.
			const j = await readJsonWithTimeout(res, timeoutMs);
			if (external.aborted) throw new DOMException('Aborted', 'AbortError');
			if (j === null) throw new TransportError();
			if (j && typeof j === 'object' && 'error' in j) {
				// Erreur applicative (404 « Séance introuvable », auth expirée…) :
				// claire, DÉFINITIVE — pas de retry, message Convex lisible si fourni.
				const msg =
					typeof (j as { error?: unknown }).error === 'string' && (j as { error: string }).error
						? (j as { error: string }).error
						: SESSION_LOAD_ERROR_MESSAGE;
				setState({ kind: 'appError', message: msg });
				return;
			}
			setState({ kind: 'success', data: j });
			return;
		} catch (e) {
			// Démontage (abort externe) : sortir immédiatement, sans toucher l'état.
			if (external.aborted || (e instanceof DOMException && e.name === 'AbortError' && !isTransportAbort(e))) {
				throw e;
			}
			// Dernière tentative : échec définitif → message utilisateur.
			if (attempt === MAX_ATTEMPTS) {
				throw new TransportError(SESSION_LOAD_ERROR_MESSAGE);
			}
			// Sinon : boucle → retry unique.
		}
	}
	// Inatteignable (MAX_ATTEMPTS ≥ 1) — garde-fou pour TypeScript.
	throw new TransportError(SESSION_LOAD_ERROR_MESSAGE);
}

/** Lit le corps JSON avec son propre garde-fou — un corps qui ne se termine jamais est un transport. */
async function readJsonWithTimeout(res: Response, ms: number): Promise<unknown | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			res.json().catch(() => null),
			new Promise<null>((resolve) => {
				timer = setTimeout(() => resolve(null), ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/** L'abort provient-il de NOTRE timer / réseau (réessayable) ? */
function isTransportAbort(e: DOMException): boolean {
	// TransportError est posé comme `reason` par le timer de attemptFetch.
	return e instanceof TransportError || e?.cause instanceof TransportError;
}

/** Une tentative : fetch avec timeout propre ; abort externe re-throw tel quel. */
async function attemptFetch(
	baseUrl: string,
	scheduledId: string,
	timeoutMs: number,
	doFetch: typeof fetch,
	external: AbortSignal
): Promise<Response> {
	const ac = new AbortController();
	const onAbort = () => ac.abort(external.reason);
	if (external.aborted) ac.abort(external.reason);
	external.addEventListener('abort', onAbort, { once: true });
	// Le timer pose TransportError comme raison : distinguable d'un abort externe.
	const timer = setTimeout(() => ac.abort(new TransportError()), timeoutMs);
	try {
		return await doFetch(`${baseUrl}/api/training/session/${encodeURIComponent(scheduledId)}`, {
			headers: { accept: 'application/json' },
			cache: 'no-store',
			credentials: 'same-origin',
			signal: ac.signal,
		});
	} catch (e) {
		if (external.aborted) throw e; // démontage : tel quel
		if (e instanceof DOMException && e.name === 'AbortError') {
			// Raison = notre timer ? → transport réessayable. Sinon abort inconnu → idem.
			throw new TransportError();
		}
		// TypeError réseau, etc. → transport réessayable.
		throw e instanceof TransportError ? e : new TransportError();
	} finally {
		clearTimeout(timer);
		external.removeEventListener('abort', onAbort);
	}
}
