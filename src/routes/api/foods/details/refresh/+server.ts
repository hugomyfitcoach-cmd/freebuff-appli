import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, currentUser } from '$lib/server/session';

/**
 * Complétion des détails d'un aliment Open Food Facts DÉJÀ EN CACHE
 * (Mission R5b) — appelée au dépliage de la fiche nutritionnelle seulement.
 *
 * La règle « au plus une fois tous les 30 jours par aliment » est appliquée
 * côté Convex (`off.refreshOffDetails`, horodatage `detailsRefreshedAt`) :
 * les ouvertures suivantes ne font aucun appel réseau. Cette route ne bloque
 * jamais l'affichage (la fiche lit d'abord `foodDetails`), et ne renvoie
 * aucune donnée : une cliente relit la fiche après coup.
 *
 * Réservée aux clientes (comme le journal) ; le coach reçoit `refreshed:false`
 * sans erreur — sa fiche de planification reste lisible.
 */
export const POST: RequestHandler = async (event) => {
	const user = await currentUser(event);
	if (!user) return json({ refreshed: false }, { status: 401 });
	if (user.role !== 'client') return json({ refreshed: false });

	const token = event.cookies.get(SESSION_COOKIE);
	let body: { foodId?: unknown };
	try {
		body = (await event.request.json()) as { foodId?: unknown };
	} catch {
		return json({ refreshed: false }, { status: 400 });
	}
	const foodId = typeof body.foodId === 'string' ? body.foodId.trim() : '';
	if (!foodId) return json({ refreshed: false }, { status: 400 });

	try {
		await convex.action(api.off.refreshOffDetails, {
			sessionToken: token,
			foodId: foodId as never,
		});
		return json({ refreshed: true });
	} catch {
		// OFF indisponible / fiche disparue : la fiche affichée reste intacte.
		return json({ refreshed: false });
	}
};
