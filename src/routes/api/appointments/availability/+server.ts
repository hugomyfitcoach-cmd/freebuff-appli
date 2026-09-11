import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '$lib/convex-api';
import { SESSION_COOKIE } from '$lib/server/session';
import { AvailabilityError, computeAvailability } from '$lib/server/availability';

/**
 * MOTEUR DE DISPONIBILITÉ (§9) — STRICT.
 *
 * GET /api/appointments/availability?date=yyyy-mm-dd[&type=Suivi][&days=N]
 *
 * créneaux = plages autorisées (disponibilités coach)
 *          − événements Google Calendar (freebusy, compte du coach)
 *          − rendez-vous G-FLUX existants (toutes clientes)
 *          − buffers 5 min avant / 5 min après chaque RDV
 *
 * La durée dépend du TYPE sélectionné : Suivi 15 min, Démarrage 60 min —
 * la durée COMPLÈTE doit tenir libre (buffers compris). Le calcul est refait
 * À CHAQUE APPEL : disponibilités coach + RDV G-FLUX + freebusy Google lus en
 * direct, jamais servis depuis un cache ni un fallback approximatif.
 *
 * STRICT : si le freebusy Google ne peut pas être lu (compte non connecté,
 * réseau, token expiré), la requête échoue avec une erreur explicite — aucun
 * créneau approximatif n'est jamais renvoyé.
 *
 * `excludeId` / `excludeIds` : replanification — le RDV déplacé ne bloque
 * pas lui-même.
 */
export const GET: RequestHandler = async (event) => {
	const token = event.cookies.get(SESSION_COOKIE);
	if (!token) return json({ error: 'Session requise.' }, { status: 401 });
	try {
		const me = await convex.query(api.users.resolveSession, { sessionToken: token });
		if (!me) return json({ error: 'Session invalide.' }, { status: 401 });

		const url = event.url;
		const kind = url.searchParams.get('type') ?? 'Suivi';
		// Replanification : le RDV déplacé ne se bloque pas lui-même
		// (`excludeId` seul ou liste `excludeIds`).
		const excludeId = url.searchParams.get('excludeId');
		const excludeIds = [
			...(url.searchParams.get('excludeIds') ?? '').split(',').filter(Boolean),
			...(excludeId ? [excludeId] : []),
		];

		// Cliente : coach rattaché. Coach : lui-même.
		let coachId: string | null;
		if (me.role === 'coach') {
			coachId = me._id;
		} else {
			coachId = await convex.query(api.appointments.myCoachId, { sessionToken: token });
			if (!coachId) return json({ error: 'Ton coach n\'est pas encore rattaché à ton compte.' }, { status: 400 });
		}

		// Un paramètre date = fenêtre partant de ce jour ; sinon fenêtre
		// glissante. 1 à 14 jours.
		const requestedDays = Math.min(
			Math.max(Number(url.searchParams.get('days') ?? '1'), 1),
			14
		);
		const date = url.searchParams.get('date');

		const result = await computeAvailability({
			sessionToken: token,
			viewerIsCoach: me.role === 'coach',
			coachId,
			date,
			days: requestedDays,
			kind,
			excludeIds,
		});
		return json(result);
	} catch (e) {
		if (e instanceof AvailabilityError) {
			return json({ error: e.message, code: e.code }, { status: 503 });
		}
		return json({ error: e instanceof Error ? e.message : 'Erreur inconnue' }, { status: 400 });
	}
};
