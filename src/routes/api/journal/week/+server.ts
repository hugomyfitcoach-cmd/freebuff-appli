import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Semaine du Journal (lundi → dimanche) pour la carte « Performance » de
 * l'Accueil et la page Performance. Lecture pure des données déjà enregistrées
 * : aucun recalcul, aucune écriture. ?start = lundi ISO "yyyy-mm-dd"
 * (date locale de la cliente) ; défaut = semaine courante côté serveur.
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/performance' });
	const token = event.cookies.get(SESSION_COOKIE);
	const start = event.url.searchParams.get('start') ?? '';
	try {
		const week = await convex.query(api.journal.getWeek, {
			sessionToken: token,
			start: /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : toLocalISO(new Date()),
		});
		return json(week);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

function toLocalISO(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${dd}`;
}
