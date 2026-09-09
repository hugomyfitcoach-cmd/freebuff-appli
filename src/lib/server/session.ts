import { redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { convex } from './convex';
import { api } from '../../convex/_generated/api.js';

export const SESSION_COOKIE = 'gflux_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 jours

export type SessionUser = {
	_id: string;
	email: string;
	role: 'coach' | 'client';
	prenom: string;
	/** Statut onboarding installation PWA ("not_seen" par défaut) — survit au logout. */
	pwaInstallStatus: 'not_seen' | 'skipped' | 'tutorial_completed' | 'installed_confirmed';
};

type ResolveResult = {
	_id: string;
	email: string;
	role: 'coach' | 'client';
	prenom: string;
	pwaInstallStatus?: 'not_seen' | 'skipped' | 'tutorial_completed' | 'installed_confirmed';
} | null;

async function resolve(token: string | undefined): Promise<SessionUser | null> {
	if (!token) return null;
	const u = (await convex.query(api.users.resolveSession, {
		sessionToken: token,
	})) as ResolveResult;
	if (!u) return null;
	return { ...u, pwaInstallStatus: u.pwaInstallStatus ?? 'not_seen' };
}

/** Récupère l'utilisateur connecté (cookie) ou null. */
export async function currentUser(event: RequestEvent): Promise<SessionUser | null> {
	return resolve(event.cookies.get(SESSION_COOKIE));
}

type CookieCtx = Pick<RequestEvent, 'cookies' | 'url'>;

function safeNext(raw: string | null | undefined): string | null {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
	return raw;
}

export type Role = 'coach' | 'client';

/**
 * Exige un utilisateur connecté — sinon redirection vers la connexion
 * (avec retour prévu `next`). Renvoie l'utilisateur.
 */
export async function requireUser(event: RequestEvent, opts?: { next?: string }): Promise<SessionUser> {
	const user = await currentUser(event);
	if (!user) {
		const next = safeNext(opts?.next ?? event.url.pathname + event.url.search);
		throw redirect(303, `/connexion${next ? `?next=${encodeURIComponent(next)}` : ''}`);
	}
	return user;
}

/** Exige un rôle précis. */
export async function requireRole(
	event: RequestEvent,
	role: Role | Role[],
	opts?: { next?: string }
): Promise<SessionUser> {
	const user = await requireUser(event, opts);
	const roles = Array.isArray(role) ? role : [role];
	if (!roles.includes(user.role)) {
		// Connecté mais mauvais espace → renvoie vers le bon.
		throw redirect(303, user.role === 'coach' ? '/admin' : '/espace');
	}
	return user;
}

export function setSessionCookie(event: CookieCtx, token: string): void {
	event.cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: event.url.protocol === 'https:',
		maxAge: SESSION_MAX_AGE,
	});
}

export function clearSessionCookie(event: CookieCtx): void {
	event.cookies.delete(SESSION_COOKIE, { path: '/' });
}
