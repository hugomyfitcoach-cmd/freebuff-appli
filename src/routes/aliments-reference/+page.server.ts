import { redirect } from '@sveltejs/kit';

/**
 * Ancienne adresse /aliments-reference (Mission R3-ter) : la page a rejoint
 * l'espace coach /admin/aliments-reference pour hériter du cadre CRM (menu de
 * gauche, en-tête, marges) et du contrôle d'accès coach. Redirection permanente
 * pour ne casser aucun lien existant.
 */
export const load = async () => {
	throw redirect(308, '/admin/aliments-reference');
};
