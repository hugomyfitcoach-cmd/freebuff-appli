import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/session';

/**
 * Onboarding installation PWA — réservé aux clientes.
 *
 * Règle absolue : une PWA ouverte DEPUIS SON ICÔNE (standalone) ne voit
 * JAMAIS ce tutoriel, même après logout/re-login — le client-side refait
 * la vérification (défense en profondeur côté navigateur).
 */
export const load: PageServerLoad = async (event) => {
	const user = await requireRole(event, 'client', { next: '/espace' });

	// Toute cliente connectée peut consulter la page VOLONTAIREMENT (entrée
	// « Installer G-FLUX » du menu, nouvel appareil). Seul le DÉCLENCHEMENT
	// automatique post-connexion est conditionné au statut — géré par le
	// layout /espace (pwaInstallNeeded). Ici on ne bloque jamais.
	return { pwaInstallStatus: user.pwaInstallStatus ?? 'not_seen' };
};
