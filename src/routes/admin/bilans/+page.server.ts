import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { addDaysISO, formatWeekLabel, lastClosedBilanWeekStart, localTodayISO } from '../../../convex/helpers';

type MissingWeek = { weekStart: string; weekLabel: string; clients: { userId: string; prenom: string; nom: string | null }[] };

/**
 * Repli tant que le backend Convex n'embarque pas bilansBoard.missingByWeek :
 * recalcule les manquants PAR SEMAINE côté SvelteKit, avec la même règle
 * d'éligibilité (cliente active, démarrée au plus tard le vendredi d'ouverture
 * de la fenêtre de bilan). Une fois le backend déployé, ce repli est ignoré.
 */
function missingByWeekFallback(
	board: { all?: { userId: string; weekStart: string; checkin: unknown }[] },
	clients: { user: { _id: string; prenom: string; nom: string | null; disabled: boolean; startDate: string | null; createdAt: number } }[]
): MissingWeek[] {
	// Bilans effectivement soumis, par semaine (les lignes sans checkin sont
	// les « manquants » de l'ancien calcul — jamais une soumission).
	const submittedByWeek = new Map<string, Set<string>>();
	for (const r of board.all ?? []) {
		if (!r.checkin) continue;
		const set = submittedByWeek.get(r.weekStart);
		if (set) set.add(r.userId);
		else submittedByWeek.set(r.weekStart, new Set([r.userId]));
	}
	const refWeek = lastClosedBilanWeekStart();
	const covered = [...new Set([...submittedByWeek.keys(), refWeek])].sort((a, b) => b.localeCompare(a));
	return covered.map((weekStart) => {
		const openFriday = addDaysISO(weekStart, 4); // vendredi d'ouverture de la fenêtre
		const submitted = submittedByWeek.get(weekStart) ?? new Set<string>();
		const list = clients
			.filter((c) => {
				if (c.user.disabled) return false;
				const startDate = c.user.startDate ?? localTodayISO(new Date(c.user.createdAt));
				return startDate <= openFriday && !submitted.has(c.user._id);
			})
			.map((c) => ({ userId: c.user._id, prenom: c.user.prenom, nom: c.user.nom }));
		list.sort((a, b) => a.prenom.localeCompare(b.prenom, 'fr'));
		return { weekStart, weekLabel: formatWeekLabel(weekStart), clients: list };
	});
}

/** Semaine ISO valide (lundi "yyyy-mm-dd") ou null. */
function parseWeek(raw: string | null): string | null {
	if (!raw) return null;
	return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'coach', { next: '/admin/bilans' });
	const token = event.cookies.get(SESSION_COOKIE);
	// Même moteur que le tableau de bord : bilansBoard (statuts dérivés, rien de stocké).
	const raw = await convex.query(api.coach.bilansBoard, { sessionToken: token });
	// Backend sans missingByWeek (ancien déploiement) → repli calculé ici.
	const board = 'missingByWeek' in (raw ?? {})
		? raw
		: await convex.query(api.coach.listClients, { sessionToken: token }).then((clients) => ({ ...raw, missingByWeek: missingByWeekFallback(raw, clients) }));
	// Semaine demandée (?week=yyyy-mm-dd) — sinon la plus récente disponible.
	const paramWeek = parseWeek(event.url.searchParams.get('week'));
	// Toutes les semaines couvertes : avec bilans OU avec manquants calculés.
	const weekStarts = [
		...(board.all as { weekStart: string }[]).map((r) => r.weekStart),
		...((board.missingByWeek ?? []) as { weekStart: string }[]).map((w) => w.weekStart),
	];
	const weeks = [...new Set(weekStarts)].sort((a, b) => b.localeCompare(a));
	return {
		board,
		weeks,
		selectedWeek: paramWeek && weeks.includes(paramWeek) ? paramWeek : (weeks[0] ?? board.missingWeek?.weekStart ?? null),
	};
};