import { requireRole } from '$lib/server/session';

/**
 * ALIMENTS DE RÉFÉRENCE G-FLUX (Mission R3-ter) — page coach dédiée, à côté de
 * /recettes. Même vérification d'accès que /recettes (requireRole + redirection
 * « next »), restreinte au rôle coach : la cliente ne gère jamais ces fiches.
 */
export const load = async (event) => {
	const user = await requireRole(event, 'coach', { next: '/aliments-reference' });
	return { user };
};
