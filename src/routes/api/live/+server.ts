import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '$lib/convex-api';
import { SESSION_COOKIE, currentUser } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Signal UNIFIÉ du mécanisme central de propagation (cliente ET coach).
 *
 * Un seul endpoint pour tout le système de notifications :
 * - cliente → compteurs { retours, message, drive, total } + delta
 *   d'événements { kind, label } depuis `since` (ex. plan assigné → les pages
 *   concernées sont revalidées automatiquement) ;
 * - coach   → badge CRM { notifications } + version du journal
 *   (toute augmentation = nouvelle notification → badge + revalidation).
 *
 * Consommé par lib/notificationPoll.ts : 5 s au premier plan, immédiat au
 * retour de focus/visibilité, silencieux en arrière-plan. `cache: no-store`
 * des deux côtés (le compteur EST le signal). 401 = session absente → le
 * poller s'arrête proprement (déconnexion) — requireRole ne convient pas ici
 * car il redirigerait (303) au lieu de répondre 401.
 */
export const GET: RequestHandler = async (event) => {
	const token = event.cookies.get(SESSION_COOKIE);
	const user = token ? await currentUser(event) : null;
	if (!user) {
		return json({ error: 'Non authentifié' }, { status: 401 });
	}
	try {
		const since = Number(event.url.searchParams.get('since') ?? 0) || 0;
		if (user.role === 'client') {
			const [counts, events] = await Promise.all([
				convex.query(api.dashboard.notificationCounts, { sessionToken: token }),
				since
					? convex.query(api.notifications.newClientEvents, { sessionToken: token, since }).catch(() => [])
					: Promise.resolve([]),
			]);
			return json(
				{
					role: 'client' as const,
					retours: counts.retours,
					message: counts.message,
					drive: counts.drive,
					total: counts.total,
					events,
				},
				{ headers: { 'cache-control': 'no-store' } }
			);
		}
		if (user.role === 'coach') {
			const [badge, journal] = await Promise.all([
				convex.query(api.notifications.unreadCount, { sessionToken: token }),
				since
					? convex.query(api.notifications.seenCoachEventsVersion, { sessionToken: token }).catch(() => null)
					: Promise.resolve(null),
			]);
			return json(
				{ role: 'coach' as const, notifications: badge, journalVersion: journal?.version ?? null },
				{ headers: { 'cache-control': 'no-store' } }
			);
		}
		return json({ error: 'Rôle inconnu' }, { status: 400 });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
