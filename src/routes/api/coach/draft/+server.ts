import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

/**
 * PRÉPARATION D'UN BROUILLON DE RETOUR — BFF, coach uniquement.
 *
 *   POST { checkinId }  →  { text }
 *
 * Le navigateur ne parle jamais à Convex ni à un fournisseur IA : cette route
 * ajoute le jeton de session (cookie HttpOnly) et appelle l'action
 * `coachDraft.generate`, qui lit le contexte du bilan, construit le prompt et
 * interroge le fournisseur générique (`fake` en M1).
 *
 * GARDE-FOUS :
 *  - `requireRole coach` : une autre session est renvoyée vers son espace ;
 *  - arrêt d'urgence `AI_COACH_DRAFT_DISABLED` (lu côté Convex) : refus AVANT
 *    tout appel, le bouton est déjà masqué côté interface ;
 *  - timeout de 40 s : l'appel rend la main, jamais un chargement infini ;
 *  - erreurs sobres et génériques : aucun message technique, aucun détail
 *    Convex/fournisseur, aucun identifiant dans la réponse. Le texte déjà
 *    présent dans le champ n'est jamais concerné — la route ne fait que
 *    renvoyer une proposition, aucune écriture.
 */

/** Délai maximal de préparation d'un brouillon (ms). */
const DRAFT_TIMEOUT_MS = 40_000;

/**
 * Message unique côté coach en cas d'échec — sobre, sans détail technique,
 * et explicite sur la suite : le coach écrit à la main comme avant.
 */
const DRAFT_ERROR =
	"Le brouillon n'a pas pu être préparé. Tu peux écrire ton retour à la main comme avant, ou réessayer dans un instant.";

/** Délai dépassé : même message clair, même repli manuel. */
const DRAFT_SLOW =
	"La préparation a pris trop de temps et a été interrompue. Tu peux écrire ton retour à la main comme avant, ou réessayer.";

/** Message quand le kill switch est actif. */
const DRAFT_DISABLED = 'La préparation de brouillon est momentanément désactivée.';

/** Borne une promesse sans laisser de minuteur actif derrière elle. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('draft-timeout')), ms);
		p.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);

	let checkinId = '';
	try {
		const body = (await event.request.json()) as { checkinId?: unknown };
		checkinId = typeof body.checkinId === 'string' ? body.checkinId.trim() : '';
	} catch {
		return json({ error: 'Bilan introuvable.' }, { status: 400 });
	}
	if (!checkinId) {
		return json({ error: 'Bilan introuvable.' }, { status: 400 });
	}

	try {
		// Kill switch vérifié AVANT l'appel : la route refuse, même si le
		// bouton a été affiché avant l'activation de la variable.
		const status = await withTimeout(
			convex.query(api.coachDraft.status, { sessionToken: token }),
			DRAFT_TIMEOUT_MS
		);
		if (!status?.enabled) {
			return json({ error: DRAFT_DISABLED }, { status: 503 });
		}

		const text = await withTimeout(
			convex.action(api.coachDraft.generate, {
				sessionToken: token,
				checkinId: checkinId as never,
			}),
			DRAFT_TIMEOUT_MS
		);

		if (typeof text !== 'string' || !text.trim()) {
			console.error('[coach-draft] réponse vide du fournisseur');
			return json({ error: DRAFT_ERROR }, { status: 502 });
		}

		return json({ text: text.trim() });
	} catch (e) {
		// Cause réelle dans les logs serveur uniquement ; le coach ne voit
		// jamais de stack, de code Convex ni de message de fournisseur.
		console.error('[coach-draft] échec de la préparation', e instanceof Error ? e.message : e);
		const timedOut = e instanceof Error && e.message === 'draft-timeout';
		return json({ error: timedOut ? DRAFT_SLOW : DRAFT_ERROR }, { status: timedOut ? 504 : 502 });
	}
};
