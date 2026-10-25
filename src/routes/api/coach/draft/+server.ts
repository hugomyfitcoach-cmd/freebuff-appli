import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { draftErrorCause, DRAFT_CAUSE_TIMEOUT } from '$lib/coachDraftError.js';

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
 * Cause lisible en cas d'échec — constante issue du module pur
 * `coachDraftError` (jamais un message de fournisseur ni un contenu client).
 * La cause précise est déduite de `aiUsageLog.failReason`, tracée par l'action.
 */
const DRAFT_ERROR = draftErrorCause(null);

/** Délai dépassé, côté BFF : l'appel a rendu la main avant la réponse. */
const DRAFT_SLOW = DRAFT_CAUSE_TIMEOUT;

/** Message quand le kill switch est actif. */
const DRAFT_DISABLED = draftErrorCause('AI_COACH_DRAFT_DISABLED');

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

	// Instant du lancement : seules les causes tracées APRÈS ce point sont
	// prises en compte (aucun échec antérieur ne fuit dans le bandeau).
	const startedAt = Date.now();

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
		if (timedOut) return json({ error: DRAFT_SLOW }, { status: 504 });

		// CAUSE EXPLICITE (M5) — raison courte déjà tracée par l'action dans
		// `aiUsageLog.failReason`, traduite en libellé constant. Une cause
		// illisible ou absente retombe sur « Erreur inattendue ».
		let failReason: string | null = null;
		try {
			const last = await withTimeout(
				convex.query(api.coachDraft.lastDraftFailure, { sessionToken: token, since: startedAt }),
				5_000
			);
			failReason = typeof last === 'string' ? last : null;
		} catch {
			// Lecture de la cause impossible : le message reste générique.
		}
		return json({ error: draftErrorCause(failReason) }, { status: 502 });
	}
};
