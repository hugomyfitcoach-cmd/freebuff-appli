import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

function toLocalISO(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${dd}`;
}

function mondayISO(d: Date): string {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	const day = x.getDay();
	x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
	return toLocalISO(x);
}

/**
 * Page « Performance » : semaine en cours par défaut (lundi → dimanche),
 * navigation semaine précédente / suivante côté client via /api/journal/week.
 * Lecture pure du journal — aucune écriture, aucun recalcul.
 */
export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'client', { next: '/espace/performance' });
	const token = event.cookies.get(SESSION_COOKIE);
	const today = toLocalISO(new Date());
	const week = await convex.query(api.journal.getWeek, { sessionToken: token, start: mondayISO(new Date()) });
	return { today, week };
};
