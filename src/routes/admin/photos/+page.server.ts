import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '$lib/convex-api';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

/**
 * Page Photos (CRM) — timeline permanente des dépôts de photos clientes.
 * Lecture seule : les dépôts EXISTANTS de la table `progressPhotos` sont
 * renvoyés dès la mise en place, du plus récent au plus ancien ; chaque
 * nouveau dépôt remonte automatiquement en haut. Aucun état « consulté ».
 */
export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'coach', { next: '/admin/photos' });
	const token = event.cookies.get(SESSION_COOKIE);
	// Repli gracieux (même pattern que le badge notifications) : tant que la
	// fonction Convex `photos.coachTimeline` n'est pas poussée sur le backend
	// (`npx convex push`), la page reste utilisable avec une liste vide.
	const deposits = await convex.query(api.photos.coachTimeline, { sessionToken: token }).catch(() => []);
	return { deposits };
};
