import { convex } from './convex';
import { api } from '../../convex/_generated/api.js';

/**
 * Rappels de progression (mensurations / photos) — garde « Me le rappeler
 * plus tard » (48 h) côté serveur.
 *
 * Il n'existe volontairement AUCUN cron push pour ces rappels : ils naissent de
 * l'ouverture de l'app (carte « À faire » de l'Accueil + badge de l'icône PWA,
 * calculés dans dashboard.getDashboard). Les fonctions ci-dessous servent aux
 * envois serveur qui accompagneraient ces rappels : pendant un report actif,
 * elles refusent l'envoi — la garde est relue côté Convex (progressionSnoozeState),
 * source de vérité identique au modèle du rappel RDV 12 h (convex/reminderPush.ts).
 * Les échéances réelles (15 jours / 1 mois) ne sont jamais modifiées par le report.
 *
 * `coachToken` = jeton de session coach (lecture gated coach, comme sendPushToUser).
 */

type SnoozeState = { measurementsSnoozeUntil?: number | null; photosSnoozeUntil?: number | null };

async function snoozeState(userId: string, coachToken: string | undefined | null): Promise<SnoozeState | null> {
	return (await convex.query(api.push.progressionSnoozeState, {
		sessionToken: coachToken ?? undefined,
		userId: userId as never,
	})) as SnoozeState | null;
}

/** Le rappel « mensurations » est-il silencieux (report actif) à cet instant ? */
export async function measurementsSnoozed(
	userId: string,
	coachToken: string | undefined | null,
	now = Date.now()
): Promise<boolean> {
	try {
		const s = await snoozeState(userId, coachToken);
		return (s?.measurementsSnoozeUntil ?? 0) > now;
	} catch {
		return false; // en cas d'indisponibilité, on ne coupe jamais par erreur.
	}
}

/** Le rappel « photos » est-il silencieux (report actif) à cet instant ? */
export async function photosSnoozed(
	userId: string,
	coachToken: string | undefined | null,
	now = Date.now()
): Promise<boolean> {
	try {
		const s = await snoozeState(userId, coachToken);
		return (s?.photosSnoozeUntil ?? 0) > now;
	} catch {
		return false;
	}
}

/**
 * Envoie une notification push liée à un rappel progression, sauf si la cliente
 * a posé un « Me le rappeler plus tard » encore actif pour ce rappel (48 h).
 * L'échec d'un push ne casse jamais l'appelant (même contrat que sendPushToUser).
 */
export async function sendProgressionPush(
	userId: string,
	payload: { title: string; body: string; url: string; tag?: string },
	reminder: 'mensurations' | 'photos',
	coachToken: string | undefined | null
): Promise<number> {
	const snoozed =
		reminder === 'mensurations'
			? await measurementsSnoozed(userId, coachToken)
			: await photosSnoozed(userId, coachToken);
	if (snoozed) return 0;
	const { sendPushToUser } = await import('./push.js');
	return sendPushToUser(userId, payload, coachToken);
}
