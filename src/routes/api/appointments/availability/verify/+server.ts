import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '$lib/convex-api';
import { SESSION_COOKIE } from '$lib/server/session';
import { AvailabilityError, verifySlotServer } from '$lib/server/availability';
import { SLOT_TAKEN_MESSAGE } from '$lib/appointments';

/**
 * VÉRIFICATION FINALE D'UN CRÉNEAU — 2e passe serveur avant réservation.
 *
 * GET /api/appointments/availability/verify?date=yyyy-mm-dd&time=HH:mm&type=Suivi[&excludeId=…]
 *
 * Refait le contrôle complet à l'instant de l'appel (le MÊME calcul strict
 * que l'affichage des créneaux) :
 *   1. disponibilités coach (le créneau entier tient dans une plage ouverte) ;
 *   2. les rendez-vous G-FLUX déjà réservés (toutes clientes) ;
 *   3. les événements Google Calendar (freebusy du compte du coach) ;
 *   4. les buffers 5 min avant / après ;
 *   5. la durée complète du rendez-vous, jamais dans le passé.
 *
 * Appelé par le client juste avant le clic final « Réserver » ET en amont
 * de chaque création/replanification côté BFF. Si le créneau vient d'être
 * pris → HTTP 409 + code `slot_taken` + message exact, SANS rien créer :
 * le client affiche le message et recharge immédiatement les disponibilités.
 *
 * STRICT : Google illisible (non connecté, réseau, token) → HTTP 503 avec
 * code `google_unavailable` / `google_not_connected` — jamais de validation
 * approximative.
 */
export const GET: RequestHandler = async (event) => {
	const token = event.cookies.get(SESSION_COOKIE);
	if (!token) return json({ error: 'Session requise.' }, { status: 401 });
	try {
		const me = await convex.query(api.users.resolveSession, { sessionToken: token });
		if (!me) return json({ error: 'Session invalide.' }, { status: 401 });

		const url = event.url;
		const date = url.searchParams.get('date') ?? '';
		const time = url.searchParams.get('time') ?? '';
		const kind = url.searchParams.get('type') ?? 'Suivi';
		const excludeIds = (url.searchParams.get('excludeIds') ?? '')
			.split(',')
			.filter(Boolean);
		const excludeId = url.searchParams.get('excludeId');
		if (excludeId && !excludeIds.includes(excludeId)) excludeIds.push(excludeId);

		// Cliente : coach rattaché. Coach : lui-même.
		let coachId: string;
		if (me.role === 'coach') {
			coachId = me._id;
		} else {
			const resolved = await convex.query(api.appointments.myCoachId, { sessionToken: token });
			if (!resolved) {
				return json({ error: 'Ton coach n\'est pas encore rattaché à ton compte.' }, { status: 400 });
			}
			coachId = resolved;
		}

		const check = await verifySlotServer({
			sessionToken: token,
			coachId,
			date,
			time,
			kind,
			excludeIds,
		});
		if (check.ok) {
			return json({ ok: true, durationMin: check.durationMin, bufferMin: check.bufferMin });
		}
		// Refus — le client ne doit jamais envoyer le POST/PATCH derrière.
		return json(
			{
				ok: false,
				code: check.reason === 'overlap_gflux' || check.reason === 'overlap_google' ? 'slot_taken' : check.reason,
				message: SLOT_TAKEN_MESSAGE,
				durationMin: check.durationMin,
				bufferMin: check.bufferMin,
			},
			{ status: 409 }
		);
	} catch (e) {
		if (e instanceof AvailabilityError) {
			return json({ ok: false, error: e.message, code: e.code }, { status: 503 });
		}
		return json({ ok: false, error: e instanceof Error ? e.message : 'Erreur inconnue' }, { status: 400 });
	}
};
