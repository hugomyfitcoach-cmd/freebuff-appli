import type { PageServerLoad } from './$types';

// Le layout /espace a déjà vérifié la session (requireRole) — on ne refait
// jamais cette requête Convex ici : navigation d'onglet plus rapide.
// Les données (poids, mensurations, masse grasse) sont chargées côté client
// via /api/metrics (même source que le CRM).
export const load: PageServerLoad = async () => {
	return {};
};