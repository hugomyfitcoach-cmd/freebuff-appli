/**
 * Garde-fou d'environnement pour les scripts E2E — OBLIGATOIRE avant toute
 * création ou modification de données (comptes jetables, mutations Convex...).
 *
 * ORIGINE DU BESOIN : les scripts E2E lisaient `PUBLIC_CONVEX_URL` dans
 * `.env.local` et postaient leurs créations de comptes DE TEST directement
 * sur le déploiement ciblé par cette variable. Comme `.env.local` pointe
 * (voulu pour le dev) vers la production `calm-jaguar-475`, des comptes
 * « E2E … » ont fini dans le vrai CRM coach. Le `BASE` (localhost) du
 * script ne protège PAS : les mutations partent du client Convex, pas du
 * serveur SvelteKit local.
 *
 * POLITIQUE (fail-closed) :
 *  - RÉFUSÉ : tout URL ressemblant à la production (`calm-jaguar-475`), AUCUNE
 *    exception ni override — aucun faux compte ne doit jamais atterrir dans
 *    le CRM réel, même en cas de variable positive locale ou de session agent.
 *  - ACCEPTÉ : backend local `convex dev` (http(s)://127.0.0.1:<port> ou
 *    http(s)://localhost:<port>) — données éphémères par construction.
 *  - ACCEPTÉ : Deploy Preview dédiée de PR (`barcode-lookup-pr-<n>.convex.cloud`),
 *    créée par scripts/deploy-preview.mjs avec une Preview Deploy Key.
 *  - ACCEPTÉ : uniquement si `E2E_TARGET_URL` est défini dans l'environnement
 *    ET correspond EXACTEMENT à l'URL cible — déclaration EXPLICITE volontaire
 *    de l'opérateur, jamais déduite d'un fallback silencieux.
 *  - Toute autre URL (prod « inconnue », backend non identifié, URL absente) :
 *    REFUS ÉXECUTÉ AVANT LE MOINDRE APPEL RÉSEAU.
 *
 * Aussi exporté pour `tests/e2e-env-guard.test.mjs` (logique pure).
 */

const PROD_MARK = 'calm-jaguar-475';

/** Un hostname/hôte de backend local — (127.0.0.1|localhost):<port>. */
const LOCAL_HOST_RE = /^127\.0\.0\.1$|^localhost$/;
/** Deploy Preview dédiée de PR — même préfixe que scripts/deploy-preview.mjs. */
const PREVIEW_HOST_RE = /^barcode-lookup-pr-\d+\.convex\.cloud$/;

export function classifyTarget(rawUrl, env = process.env) {
	const urlRaw = String(rawUrl ?? '').trim();
	if (!/^https?:\/\//i.test(urlRaw)) {
		return {
			ok: false,
			reason:
				urlRaw
					? 'URL Convex non http(s) ou invalide.'
					: 'URL Convex de test absente — aucune cible déclarée.',
		};
	}
	if (urlRaw.includes(PROD_MARK)) {
		return {
			ok: false,
			reason: `REFUS : l'URL ressemble à la PRODUCTION (${PROD_MARK}). Aucun compte de test ne doit y être créé.`,
		};
	}
	let parsed;
	try {
		parsed = new URL(urlRaw);
	} catch {
		return { ok: false, reason: 'URL Convex non http(s) ou invalide.' };
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		return { ok: false, reason: 'URL Convex non http(s) ou invalide.' };
	}
	if (LOCAL_HOST_RE.test(parsed.hostname)) {
		return { ok: true, kind: 'local', hostname: parsed.hostname };
	}
	const isHttp = parsed.protocol === 'http:';
	if (PREVIEW_HOST_RE.test(parsed.hostname) && !isHttp) {
		return { ok: true, kind: 'preview', hostname: parsed.hostname };
	}
	const declared = String(env.E2E_TARGET_URL ?? '').trim();
	if (declared && !declared.includes(PROD_MARK)) {
		const norm = (v) => String(v ?? '').trim().replace(/\/+$/, '').toLowerCase();
		if (norm(declared) === norm(urlRaw)) {
			return { ok: true, kind: 'declared', hostname: parsed.hostname };
		}
	}
	return {
		ok: false,
		reason:
			`REFUS : « ${parsed.hostname} » n'est pas identifié comme environnement de test isolé ` +
			`(attendu : backend local, preview dédiée barcode-lookup-pr-<n>, ou E2E_TARGET_URL égal à l'URL cible). ` +
			'Fix PUBLIC_CONVEX_URL sur un backend de test ou lance la preview de PR.',
	};
}

/**
 * Lève si `url` n'est pas un environnement de test isolé. À appeler APRÈS le
 * chargement de .env.local et AVANT tout client Convex / fetch / écriture.
 * log ? écrit la cible acceptée (kinds local/preview/declared).
 */
export function assertE2eTargetEnv(url, env = process.env, log = console.log) {
	const verdict = classifyTarget(url, env);
	if (verdict.hostname) {
		delete verdict.hostname;
	}
	if (!verdict.ok) {
		const msg = verdict.reason ?? 'URL invalide.';
		console.error(`⛔ [e2e-env] ${msg}`);
		process.exit(1); // never write to unknown targets
	}
	log(`✅ [e2e-env] environnement de test isolé (${verdict.kind ?? 'ok'}) — écritures autorisées sur ce déploiement uniquement.`);
	return verdict;
}
