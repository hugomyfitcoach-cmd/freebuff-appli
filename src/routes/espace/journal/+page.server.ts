import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE } from '$lib/server/session';

function toLocalISO(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${dd}`;
}

export const load: PageServerLoad = async (event) => {
	// Le layout /espace a déjà vérifié la session (requireRole) — on ne refait
	// jamais cette requête Convex ici : navigation d'onglet plus rapide.
	const token = event.cookies.get(SESSION_COOKIE);
	const today = toLocalISO(new Date());
	const day = await convex.query(api.journal.getDay, { sessionToken: token, date: today });
	return { today, day };
};