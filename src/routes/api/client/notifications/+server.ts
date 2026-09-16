import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, currentUser } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Compteurs de notifications de la cliente — SOURCE DE VÉRITÉ = LA BASE.
 *
 * Consommé par le polling léger de la PWA (lib/notificationPoll.ts) :
 * - à l'ouverture, à chaque retour au premier plan (visibilitychange, focus,
 *   pageshow) et toutes les 25 s tant que l'app est visible ;
 * - `cache: no-store` des deux côtés (le fetch ET la réponse) : jamais de
 *   compteur périmé servi depuis un cache ;
 * - 401 = session absente/expirée → le polling s'arrête proprement côté
 *   client (déconnexion en cours). On n'utilise PAS requireRole ici : il
 *   redirigerait (303) vers /connexion et le fetch suivrait la redirection
 *   au lieu de recevoir le 401 attendu par le poller.
 *
 * Le Web Push reste un canal d'alerte SUPPLÉMENTAIRE : si iOS retarde la
 * notification système, l'information est déjà ici, dans la base — la PWA
 * l'affiche dès qu'elle relit ce compteur (immédiat au retour au premier plan).
 */
export const GET: RequestHandler = async (event) => {
	const token = event.cookies.get(SESSION_COOKIE);
	const user = token ? await currentUser(event) : null;
	if (!user || user.role !== 'client') {
		return json({ error: 'Non authentifié' }, { status: 401 });
	}
	try {
		const counts = await convex.query(api.dashboard.notificationCounts, { sessionToken: token });
		return json(counts, { headers: { 'cache-control': 'no-store' } });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
