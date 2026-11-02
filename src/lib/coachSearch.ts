/**
 * Recherche cliente du tableau de bord coach (liste déroulante sous la barre).
 *
 * Filtre PUR sur la liste `clients` déjà chargée par la page : aucune requête,
 * aucun accès supplémentaire — mêmes critères que le champ de la « Vue rapide »
 * (nom complet + email, insensible à la casse). Le plafond évite une liste
 * déroulante qui déborde de l'écran.
 */
export type CoachSearchClient = {
	user: { prenom: string; nom?: string | null; email: string };
};

export function searchCoachClients<T extends CoachSearchClient>(
	clients: readonly T[],
	query: string,
	limit = 6
): T[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	return clients
		.filter((c) => {
			const name = c.user.nom ? `${c.user.prenom} ${c.user.nom}` : c.user.prenom;
			return `${name} ${c.user.email}`.toLowerCase().includes(q);
		})
		.slice(0, limit);
}
