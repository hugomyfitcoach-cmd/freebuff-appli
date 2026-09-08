import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

/** Semaine ISO valide (lundi "yyyy-mm-dd") ou null. */
function parseWeek(raw: string | null): string | null {
	if (!raw) return null;
	return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'coach', { next: '/admin/bilans' });
	const token = event.cookies.get(SESSION_COOKIE);
	// Même moteur que le tableau de bord : bilansBoard (statuts dérivés, rien de stocké).
	const board = await convex.query(api.coach.bilansBoard, { sessionToken: token });
	// Semaine demandée (?week=yyyy-mm-dd) — sinon la plus récente disponible.
	const paramWeek = parseWeek(event.url.searchParams.get('week'));
	const weeks = [...new Set((board.all as { weekStart: string }[]).map((r) => r.weekStart))].sort((a, b) => b.localeCompare(a));
	return {
		board,
		weeks,
		selectedWeek: paramWeek && weeks.includes(paramWeek) ? paramWeek : (weeks[0] ?? board.missingWeek?.weekStart ?? null),
	};
};