import { redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { convex } from './convex';
import { api } from '../../convex/_generated/api.js';

export const SESSION_COOKIE = 'gflux_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 jours

/* ═══════ FACTURATION AUTONOMIE — décision d'accès centralisée (V1) ═══════
 * L'accès est DÉRIVÉ côté Convex (src/convex/billing.ts → canAccessApp) :
 * coaching = inclus ; autonomy = complimentary / abonnement Stripe valide /
 * grâce de 5 jours après échec. Aucun état dupliqué, décision recalculée
 * à chaque requête (la grâce est comparée à l'heure ACTUELLE côté serveur). */

/** Décision d'accès calculée côté serveur — même vocabulaire que billing.ts. */
export type AccessDecision = 'allow' | 'allow_with_payment_warning' | 'block';

/** Abonnement Stripe (état dérivé, exposé à l'UI facturation/paramètres). */
export type BillingSubscription = {
	status: string | null;
	cancelAtPeriodEnd: boolean;
	/** Fin de période payée (ms UTC) — « prendra fin le … » / prochaine échéance. */
	currentPeriodEnd: number | null;
	/** Fin de grâce (ms UTC) — non null ⇒ bannière paiement à régulariser. */
	graceUntil: number | null;
	/** Price Stripe souscrit (price_… TEST en preview) — mappé monthly/yearly par le BFF. */
	priceId: string | null;
};

/** État de facturation DÉRIVÉ (canAccessApp côté Convex) — jamais stocké ailleurs. */
export type BillingAccess = {
	decision: AccessDecision;
	coachingMode: 'coaching' | 'autonomy';
	billingAccessOverride: 'complimentary' | null;
	subscription: BillingSubscription | null;
};

export type SessionUser = {
	_id: string;
	email: string;
	role: 'coach' | 'client';
	prenom: string;
	/** Statut onboarding installation PWA ("not_seen" par défaut) — survit au logout. */
	pwaInstallStatus: 'not_seen' | 'skipped' | 'tutorial_completed' | 'installed_confirmed';
	/** MODE AUTONOMIE ("coaching" par défaut — champ absent = coaching). */
	coachingMode: 'coaching' | 'autonomy';
	/** Accès offert par le coach — indépendant de Stripe. */
	billingAccessOverride: 'complimentary' | null;
	/** État de facturation dérivé (canAccessApp côté Convex). */
	billing: BillingAccess;
};

type ResolveResult = {
	_id: string;
	email: string;
	role: 'coach' | 'client';
	prenom: string;
	pwaInstallStatus?: 'not_seen' | 'skipped' | 'tutorial_completed' | 'installed_confirmed';
	coachingMode?: 'coaching' | 'autonomy';
	billingAccessOverride?: 'complimentary' | null;
	/** État d'accès dérivé (canAccessApp) — exposé par resolveSession (V1 facturation). */
	billing?: BillingAccess | null;
} | null;

async function resolve(token: string | undefined): Promise<SessionUser | null> {
	if (!token) return null;
	const u = (await convex.query(api.users.resolveSession, {
		sessionToken: token,
	})) as ResolveResult;
	if (!u) return null;
	return {
		_id: u._id,
		email: u.email,
		role: u.role,
		prenom: u.prenom,
		pwaInstallStatus: u.pwaInstallStatus ?? 'not_seen',
		// MODE AUTONOMIE — repli sûr : session sans champ = coaching.
		coachingMode: u.coachingMode ?? 'coaching',
		// FACTURATION — replis sûrs alignés sur billing.ts : si l'état dérivé
		// n'est pas exposé (déploiement ancien), on retombe sur le comportement
		// pré-V1 (allow), jamais sur un blocage injustifié.
		billingAccessOverride: u.billingAccessOverride ?? null,
		billing: u.billing ?? {
			decision: 'allow' as AccessDecision,
			coachingMode: (u.coachingMode ?? 'coaching') as 'coaching' | 'autonomy',
			billingAccessOverride: u.billingAccessOverride ?? null,
			subscription: null,
		},
	};
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

/**
 * FACTURATION — garde serveur de l'espace cliente protégé.
 * Exige une cliente dont l'accès dérivé (canAccessApp) n'est PAS « block » :
 * coaching / complimentary / abonnement actif-trialing / grâce non expirée
 * passent ; une cliente bloquée est redirigée vers /espace/facturation
 * (paywall). La décision vient de la base, recalculée à chaque requête —
 * rien à contourner en tapant une URL interne. Les routes qui restent
 * accessibles à une cliente bloquée (facturation, logout) n'appellent pas
 * ce garde. Le coach n'est jamais concerné (requireRole 'client').
 */
export async function requireClientAccess(event: RequestEvent, opts?: { next?: string }): Promise<SessionUser> {
	const user = await requireRole(event, 'client', opts);
	if (user.billing.decision === 'block') {
		throw redirect(303, '/espace/facturation');
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
