import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { error, redirect } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';
import { convex } from './convex';
import { api } from '../../convex/_generated/api.js';
import { decryptToken, encryptToken } from './googleCrypto';
import { SESSION_COOKIE } from './session';

/**
 * OAuth Google Calendar pour le compte COACH (CRM G-Flux).
 *
 * Flow : /api/google/connect (coach) → consentement Google →
 * /api/google/callback (échange du code, chiffrement des tokens, stockage
 * Convex) → retour /admin?google=ok. Le refresh token ne quitte JAMAIS le
 * serveur : chiffré AES-256-GCM (GOOGLE_ENC_KEY) avant stockage, déchiffré
 * uniquement en mémoire au moment d'appeler l'API Google.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
/** Scopes demandés : lecture/écriture des événements + lecture freebusy. */
const SCOPES = [
	'https://www.googleapis.com/auth/calendar.events',
	'https://www.googleapis.com/auth/calendar.freebusy',
];
/** Access token Google : ~1 h — on le rafraîchit 2 min avant l'expiration. */
const TOKEN_EARLY_REFRESH_MS = 120_000;
const STATE_COOKIE = 'gflux_oauth_state';

const REDIRECT_PATH = '/api/google/callback';

function creds() {
	const clientId = env.GOOGLE_CLIENT_ID;
	const clientSecret = env.GOOGLE_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		error(500, 'OAuth Google non configuré : GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants.');
	}
	return { clientId, clientSecret };
}

/** URI de callback : explicite (GOOGLE_REDIRECT_URI) ou déduite de l'origine (Netlify / dev). */
export function redirectUri(origin: string): string {
	if (env.GOOGLE_REDIRECT_URI) return env.GOOGLE_REDIRECT_URI;
	return `${origin}${REDIRECT_PATH}`;
}

async function coachToken(cookies: Cookies): Promise<string | null> {
	const token = cookies.get(SESSION_COOKIE);
	if (!token) return null;
	const user = await convex.query(api.users.resolveSession, { sessionToken: token });
	return user && user.role === 'coach' ? token : null;
}

/* ── Cookie d'état anti-CSRF (valeur aléatoire signée HMAC, 10 min) ── */

function signState(random: string): string {
	return createHmac('sha256', env.GOOGLE_CLIENT_SECRET ?? 'gflux-dev-only').update(random).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/* ── Démarrage du flow ── */

/** Vérifie la session coach puis envoie vers Google avec un state signé. */
export async function startConnect(event: { cookies: Cookies; url: URL }): Promise<never> {
	const token = await coachToken(event.cookies);
	if (!token) error(403, 'Connexion Google Calendar réservée au coach (session requise).');
	const { clientId } = creds();
	const random = crypto.randomUUID().replace(/-/g, '');
	const state = `${random}.${signState(random)}`;
	event.cookies.set(STATE_COOKIE, state, {
		path: REDIRECT_PATH,
		httpOnly: true,
		sameSite: 'lax',
		secure: event.url.protocol === 'https:',
		maxAge: 600,
	});
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri(event.url.origin),
		response_type: 'code',
		scope: SCOPES.join(' '),
		access_type: 'offline',
		prompt: 'consent',
		include_granted_scopes: 'true',
		state,
	});
	redirect(302, `${AUTH_ENDPOINT}?${params}`);
}

/* ── Callback : échange du code contre les tokens ── */

export async function handleCallback(event: { cookies: Cookies; url: URL }): Promise<never> {
	const url = event.url;
	const backError = (message: string) =>
		redirect(303, `/admin?google=error&reason=${encodeURIComponent(message)}`);

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const err = url.searchParams.get('error');

	// Session coach toujours requise (le flow vit dans le navigateur du coach).
	const token = await coachToken(event.cookies);
	if (!token) throw backError('Session coach perdue pendant la connexion — reconnecte-toi puis réessaie.');

	if (err) throw backError(`Google a refusé l'autorisation (${err}).`);
	if (!code || !state) throw backError('Réponse Google incomplète (code/state manquant).');

	const cookieState = event.cookies.get(STATE_COOKIE);
	event.cookies.delete(STATE_COOKIE, { path: REDIRECT_PATH });
	if (!cookieState || !safeEqual(cookieState, state)) {
		throw backError('Vérification de sécurité OAuth échouée (state) — réessaie.');
	}

	const { clientId, clientSecret } = creds();
	const callbackUri = redirectUri(url.origin);

	let tokenRes: {
		access_token?: string;
		expires_in?: number;
		refresh_token?: string;
		scope?: string;
		error?: string;
	};
	try {
		const res = await fetch(TOKEN_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				code,
				client_id: clientId,
				client_secret: clientSecret,
				redirect_uri: callbackUri,
				grant_type: 'authorization_code',
			}),
		});
		tokenRes = await res.json();
	} catch {
		throw backError('Réseau indisponible vers Google — réessaie.');
	}
	if (!tokenRes.access_token) {
		throw backError(`Google a refusé l'échange du code (${tokenRes.error ?? 'réponse invalide'}).`);
	}
	// Sans refresh token, la connexion ne survivrait pas à l'heure — on exige prompt=consent.
	if (!tokenRes.refresh_token) {
		throw backError(
			'Aucun refresh token reçu — révoque l’accès de G-FLUX sur myaccount.google.com/permissions puis reconnecte-toi.'
		);
	}

	// Email du compte Google connecté (affichage CRM uniquement).
	let googleEmail = '';
	try {
		const res = await fetch(USERINFO_ENDPOINT, {
			headers: { Authorization: `Bearer ${tokenRes.access_token}` },
		});
		if (res.ok) {
			const info = await res.json();
			googleEmail = typeof info?.email === 'string' ? info.email : '';
		}
	} catch {
		// Info complémentaire : on continue sans email si Google ne répond pas.
	}

	// Stockage : refresh + access tokens chiffrés (AES-256-GCM), serveur uniquement.
	await convex.mutation(api.googleCalendar.upsertConnection, {
		sessionToken: token,
		email: googleEmail,
		encRefreshToken: encryptToken(tokenRes.refresh_token),
		encAccessToken: encryptToken(tokenRes.access_token),
		expiry: tokenRes.expires_in ? Date.now() + tokenRes.expires_in * 1000 : 0,
		scope: tokenRes.scope ?? SCOPES.join(' '),
	});

	redirect(303, '/admin?google=ok');
}

/* ── Utilisation : access token frais + appel API Calendar ── */

type Connection = {
	email: string;
	scope: string;
	encRefreshToken: string;
	encAccessToken: string | null;
	expiry: number | null;
};

/** Access token valide pour le coach connecté (rafraîchi si nécessaire), ou null. */
export async function getAccessToken(sessionToken: string): Promise<string | null> {
	const row = (await convex.query(api.googleCalendar.secrets, { sessionToken })) as Connection | null;
	if (!row) return null;
	return accessTokenFromRow(row, sessionToken);
}

/**
 * Access token depuis les blobs chiffrés (coach cible connu sans session coach,
 * ex. moteur de disponibilité côté cliente). Le cache d'access token reste
 * attaché au COMPTE Google du coach, pas à la session courante.
 */
export async function getAccessTokenForCoachId(
	coachId: string,
	sessionToken: string | null
): Promise<string | null> {
	// Session du BFF (coach ou cliente rattachée) : la requête publique vérifie
	// elle-même que ce coach lui est bien rattaché avant de renvoyer les blobs.
	const row = (await convex.query(api.googleCalendar.secretsForClientOfCoach, {
		sessionToken: sessionToken ?? undefined,
		coachId: coachId as never,
	})) as (Connection & { coachId: string }) | null;
	if (!row) return null;
	return accessTokenFromRow(row, null, row.coachId);
}

async function accessTokenFromRow(
	row: Connection,
	sessionToken: string | null,
	coachIdForCache?: string
): Promise<string | null> {
	if (row.encAccessToken && row.expiry && row.expiry - TOKEN_EARLY_REFRESH_MS > Date.now()) {
		return decryptToken(row.encAccessToken);
	}
	const { clientId, clientSecret } = creds();
	const res = await fetch(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: decryptToken(row.encRefreshToken),
			grant_type: 'refresh_token',
		}),
	});
	const json = await res.json();
	if (!res.ok || !json?.access_token) return null;
	const encAccessToken = encryptToken(json.access_token);
	const expiry = Date.now() + (json.expires_in ?? 3600) * 1000;
	// On persiste le nouvel access token chiffré (le refresh token reste inchangé).
	try {
		if (sessionToken) {
			// Session coach : mise à jour directe. Session cliente (réservation) :
			// updateAccess exige le rôle coach → repli sur updateAccessForCoach,
			// qui accepte une cliente rattachée à ce coach.
			await convex
				.mutation(api.googleCalendar.updateAccess, { sessionToken, encAccessToken, expiry })
				.catch(() =>
					convex.mutation(api.googleCalendar.updateAccessForCoach, {
						sessionToken: sessionToken ?? undefined,
						coachId: coachIdForCache as never,
						encAccessToken,
						expiry,
					})
				)
				.catch(() => null);
		} else if (coachIdForCache) {
			await convex
				.mutation(api.googleCalendar.updateAccessForCoach, {
					sessionToken: undefined,
					coachId: coachIdForCache as never,
					encAccessToken,
					expiry,
				})
				.catch(() => null);
		}
	} catch {
		/* cache non persisté : le token reste utilisable pour cet appel */
	}
	return json.access_token as string;
}

/** Appel authentifié à l'API Calendar (v3) avec access token frais. */
export async function googleCalendarFetch(
	sessionToken: string,
	path: string,
	init: RequestInit = {}
): Promise<Response> {
	const accessToken = await getAccessToken(sessionToken);
	if (!accessToken) error(400, 'Google Calendar non connecté — reconnecte le compte dans le CRM.');
	return fetch(`${CALENDAR_API}${path}`, {
		...init,
		headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
	});
}

/** Appel Calendar depuis un contexte SANS session coach (ex. réservation cliente). */
export async function googleCalendarFetchForCoachId(
	coachId: string,
	path: string,
	init: RequestInit = {},
	sessionToken: string | null = null
): Promise<Response | null> {
	try {
		const accessToken = await getAccessTokenForCoachId(coachId, sessionToken);
		if (!accessToken) return null;
		return await fetch(`${CALENDAR_API}${path}`, {
			...init,
			headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
		});
	} catch {
		return null; // Google indisponible : jamais bloquant pour une réservation
	}
}
