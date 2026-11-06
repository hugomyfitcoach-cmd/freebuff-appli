/**
 * Rapports d'incident CSS (table `appIncidents`) — normalisation CÔTÉ BFF.
 *
 * La route `/api/app/incident` reçoit un `navigator.sendBeacon` émis par la
 * garde autonome de `app.html`. Le corps est du texte libre par nature : tout
 * ce qui part vers Convex est donc reconstruit ici dans une liste FERMÉE
 * (énumérations, motifs, longueurs), jamais relayé tel quel. La mutation
 * `appVersion.recordIncident` applique les mêmes bornes de son côté (un appel
 * direct de la mutation contourne le BFF : elle ne doit rien accepter d'autre).
 */

/** Plafond de lecture du corps (4 Ko) — appliqué sans croire Content-Length. */
export const INCIDENT_BODY_LIMIT = 4096;

/** Nombre maximal de feuilles CSS décrites dans un rapport. */
export const INCIDENT_STYLE_MAX = 30;

/** Nombre maximal de noms de caches retenus (motif `^gflux-[a-z0-9-]+$`). */
export const INCIDENT_CACHE_MAX = 10;

/** Longueur maximale du user agent conservé (tronqué, jamais refusé). */
export const INCIDENT_UA_MAX = 300;

export type IncidentAction = 'reload' | 'repair' | 'banner' | 'deferred';

export type IncidentWitness = 'missing' | 'present';

/** État observé d'une feuille CSS — remplace le nombre de règles brut. */
export type IncidentSheetState = 'missing' | 'blocked' | 'empty' | 'loaded';

export type IncidentStyle = { path: string; state: IncidentSheetState };

export type IncidentReport = {
	build: string;
	witness: IncidentWitness;
	styles: IncidentStyle[];
	controller: boolean;
	caches: string[];
	userAgent: string;
	action: IncidentAction;
};

const ACTIONS: readonly IncidentAction[] = ['reload', 'repair', 'banner', 'deferred'];
const WITNESSES: readonly IncidentWitness[] = ['missing', 'present'];

const BUILD_RE = /^[\w.-]{0,64}$/;
const CACHE_RE = /^gflux-[a-z0-9-]+$/;
const SHEET_PATH_RE = /^\/_app\/immutable\/[\w./-]{1,200}\.css$/;
/** Charset fermé du user agent (aucun caractère hors de cette liste). */
const UA_RE = /^[\w\s.()/;:+-]*$/;

export function isIncidentAction(value: unknown): value is IncidentAction {
	return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

export function isIncidentWitness(value: unknown): value is IncidentWitness {
	return typeof value === 'string' && (WITNESSES as readonly string[]).includes(value);
}

export function isIncidentSheetState(value: unknown): value is IncidentSheetState {
	return value === 'missing' || value === 'blocked' || value === 'empty' || value === 'loaded';
}

export function isIncidentBuild(value: unknown): value is string {
	return typeof value === 'string' && BUILD_RE.test(value);
}

export function isIncidentCacheName(value: unknown): value is string {
	return typeof value === 'string' && CACHE_RE.test(value);
}

/** Nettoie un user agent : charset fermé puis troncature à 300 caractères. */
export function sanitizeUserAgent(value: unknown): string {
	const raw = typeof value === 'string' ? value : '';
	return raw.slice(0, INCIDENT_UA_MAX).replace(/[^\w\s.()/;:+-]/g, '').slice(0, INCIDENT_UA_MAX);
}

/** État d'une feuille CSS déduit de ce que la garde a pu observer. */
export function sheetStateOf(sheetNull: unknown, rules: unknown): IncidentSheetState {
	if (sheetNull === true) return 'missing';
	if (typeof rules !== 'number' || !Number.isFinite(rules)) return 'blocked';
	if (!Number.isInteger(rules) || rules < 0) return 'blocked';
	return rules === 0 ? 'empty' : 'loaded';
}

/**
 * Lit le corps de la requête en s'arrêtant net au-delà de `limit` octets.
 * `null` = corps trop gros (→ 413) ; la taille annoncée par Content-Length
 * n'est qu'un raccourci, jamais une garantie (sendBeacon peut l'omettre).
 */
export async function readCappedText(
	source: { headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null },
	limit: number = INCIDENT_BODY_LIMIT
): Promise<string | null> {
	const declared = Number(source.headers.get('content-length') ?? Number.NaN);
	if (Number.isFinite(declared) && declared > limit) return null;
	if (!source.body) return '';
	const reader = source.body.getReader();
	const decoder = new TextDecoder();
	let total = 0;
	let text = '';
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) {
				await reader.cancel().catch(() => {});
				return null;
			}
			text += decoder.decode(value, { stream: true });
		}
		return text + decoder.decode();
	} finally {
		try {
			reader.releaseLock();
		} catch {
			/* flux déjà libéré : rien à faire */
		}
	}
}

/**
 * Reconstruit un rapport dans la liste fermée attendue par Convex.
 * `null` = rapport refusé (action inconnue ou corps non objet) → 400.
 * Les entrées hors motifs (feuille, cache, empreinte) sont écartées, jamais
 * relayées : aucun texte libre ne franchit cette frontière.
 */
export function normalizeIncident(raw: unknown): IncidentReport | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const data = raw as Record<string, unknown>;
	if (!isIncidentAction(data.action)) return null;
	const rawStyles = Array.isArray(data.styles) ? data.styles : [];
	const styles: IncidentStyle[] = [];
	for (const entry of rawStyles) {
		if (!entry || typeof entry !== 'object') continue;
		const s = entry as Record<string, unknown>;
		if (typeof s.path !== 'string' || !SHEET_PATH_RE.test(s.path)) continue;
		styles.push({ path: s.path, state: sheetStateOf(s.sheetNull, s.rules) });
		if (styles.length >= INCIDENT_STYLE_MAX) break;
	}
	const rawCaches = Array.isArray(data.caches) ? data.caches : [];
	const caches = rawCaches.filter(isIncidentCacheName).slice(0, INCIDENT_CACHE_MAX);
	return {
		build: isIncidentBuild(data.build) ? data.build : '',
		witness: isIncidentWitness(data.witness) ? data.witness : 'missing',
		styles,
		controller: data.controller === true,
		caches,
		userAgent: sanitizeUserAgent(data.userAgent),
		action: data.action,
	};
}
