import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Vue complète d'une séance planifiée (exercices, séries, dernières perfs).
 *
 * OBSERVABILITÉ (mission « Chargement de la séance… ») : chaque étape est
 * tracée avec un `requestId` court (requête reçue, auth OK, appel Convex
 * démarré/terminé + durée, réponse envoyée + durée totale, erreur éventuelle).
 * AUCUNE donnée personnelle dans les logs : ids techniques, statut, durées.
 *
 * ANTI-HANG : l'appel Convex est borné par un `Promise.race` (CONVEX_TIMEOUT_MS).
 * Une requête BFF ne peut JAMAIS rester suspendue indéfiniment — si Convex ne
 * répond pas à temps, le BFF répond 502 JSON (le client affiche alors son
 * écran d'erreur + « Réessayer ») et la promesse Convex est laissée à son sort
 * (aucun fuite utile : le runtime serverless termine la fonction avec la
 * réponse ; le client Convex rejette de son côté en tâche de fond).
 */

/** Durée max de l'appel Convex (ms) — au-delà : 502 immédiat, jamais de pend. */
const CONVEX_TIMEOUT_MS = 20_000;

/** Log structuré discret — une ligne, préfixe stable, rien de sensible. */
function log(step: string, rid: string, extra: Record<string, unknown> = {}): void {
	console.log(`[training-session][${rid}] ${step}`, extra);
}

/** Appel Convex borné : rejette si la fonction ne répond pas à temps. */
function withTimeout<T>(p: Promise<T>, ms: number, rid: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`Convex timeout après ${ms}ms [${rid}]`)), ms);
	});
	return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export const GET: RequestHandler = async (event) => {
	const rid = Math.random().toString(36).slice(2, 10);
	const t0 = Date.now();
	try {
		await requireRole(event, 'client', { next: '/espace/entrainement' });
		const token = event.cookies.get(SESSION_COOKIE);
		const id = event.params.id;
		if (!id) {
			log('bad-request', rid, { ms: Date.now() - t0 });
			return json({ error: 'Séance introuvable.' }, { status: 400 });
		}
		log('auth-ok', rid, { ms: Date.now() - t0 });
		try {
			log('convex-start', rid);
			const tConvex = Date.now();
			const res = await withTimeout(
				convex.query(api.trainingClient.scheduledSession, {
					sessionToken: token,
					scheduledId: id as never,
				}),
				CONVEX_TIMEOUT_MS,
				rid
			);
			log('convex-end', rid, { convexMs: Date.now() - tConvex });
			log('respond', rid, { status: 200, totalMs: Date.now() - t0 });
			// diagRid : corrélation client ↔ logs fonction (retrouvable dans
			// Netlify UI par recherche du rid) — retiré avec l'instrumentation.
			return json({ ...res, diagRid: rid });
		} catch (e) {
			const msg = errMsg(e);
			const isTimeout = /timeout/i.test(msg);
			log('convex-error', rid, { ms: Date.now() - t0, isTimeout, error: msg });
			// Timeout → 502 (transport réessayable côté client) ; erreur métier
			// Convex (séance introuvable, session expirée…) → 404 lisible.
			return json({ error: msg }, { status: isTimeout ? 502 : 404 });
		}
	} catch (e) {
		// requireRole peut jeter un redirect (non connecté / mauvais rôle) : on
		// le laisse passer — tout le reste est un échec serveur tracé.
		if (e && typeof e === 'object' && 'status' in e && 'location' in e) throw e;
		log('error', rid, { ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
		return json({ error: 'Erreur inattendue.' }, { status: 500 });
	}
};

/**
 * Fin de séance — même parcours depuis le mode libre ou le guidé.
 * `skipped: true` = « Je n'ai pas réalisé cette séance » (clôture sans dépense).
 * `reopen: true` = réouverture d'une séance terminée par erreur (completed →
 * planned, séries conservées, dépense neutralisée — jamais de doublon).
 */
export const POST: RequestHandler = async (event) => {
	const rid = Math.random().toString(36).slice(2, 10);
	const t0 = Date.now();
	try {
		await requireRole(event, 'client', { next: '/espace/entrainement' });
		const token = event.cookies.get(SESSION_COOKIE);
		const id = event.params.id;
		if (!id) {
			log('bad-request POST', rid, { ms: Date.now() - t0 });
			return json({ error: 'Séance introuvable.' }, { status: 400 });
		}
	try {
		const body = await event.request.json();
		log('convex-start POST', rid);
		const tConvex = Date.now();
		if (body.reopen === true) {
			// Réouverture d'une séance terminée par erreur : completed → planned,
			// séries conservées, dépense sportive liée neutralisée (aucun doublon).
			const reopened = await withTimeout(
				convex.mutation(api.trainingClient.reopenSession, {
					sessionToken: token,
					scheduledId: id as never,
				}),
				CONVEX_TIMEOUT_MS,
				rid
			);
			log('respond POST', rid, { status: 200, totalMs: Date.now() - t0, reopen: true });
			// accumulatedMin : temps réellement travaillé avant l'erreur — le
			// front l'ajoutera à la nouvelle fenêtre au moment de re-terminer.
			return json({ ok: true, reopened: true, startedAt: Date.now(), accumulatedMin: reopened?.accumulatedMin ?? 0 });
		}
		await withTimeout(
			convex.mutation(api.trainingClient.completeSession, {
				sessionToken: token,
				scheduledId: id as never,
				...(body.durationMin !== undefined ? { durationMin: Number(body.durationMin) } : {}),
				...(body.difficulty !== undefined ? { difficulty: Number(body.difficulty) } : {}),
				...(body.note !== undefined ? { note: String(body.note) } : {}),
				...(body.skipped === true ? { skipped: true } : {}),
			}),
			CONVEX_TIMEOUT_MS,
			rid
		);
		log('convex-end POST', rid, { convexMs: Date.now() - tConvex });
		log('respond POST', rid, { status: 200, totalMs: Date.now() - t0 });
		return json({ ok: true });
	} catch (e) {
			const msg = errMsg(e);
			const isTimeout = /timeout/i.test(msg);
			log('convex-error POST', rid, { ms: Date.now() - t0, isTimeout, error: msg });
			return json({ error: msg }, { status: isTimeout ? 502 : 400 });
		}
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e && 'location' in e) throw e;
		log('error POST', rid, { ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
		return json({ error: 'Erreur inattendue.' }, { status: 500 });
	}
};

/**
 * Corrige la durée d'une séance terminée — la dépense sportive existante est
 * mise à jour (jamais dupliquée).
 */
export const PATCH: RequestHandler = async (event) => {
	const rid = Math.random().toString(36).slice(2, 10);
	const t0 = Date.now();
	try {
		await requireRole(event, 'client', { next: '/espace/entrainement' });
		const token = event.cookies.get(SESSION_COOKIE);
		const id = event.params.id;
		if (!id) {
			log('bad-request PATCH', rid, { ms: Date.now() - t0 });
			return json({ error: 'Séance introuvable.' }, { status: 400 });
		}
		try {
			const body = await event.request.json();
			log('convex-start PATCH', rid);
			const tConvex = Date.now();
			await withTimeout(
				convex.mutation(api.trainingClient.updateSessionDuration, {
					sessionToken: token,
					scheduledId: id as never,
					durationMin: Number(body.durationMin),
				}),
				CONVEX_TIMEOUT_MS,
				rid
			);
			log('convex-end PATCH', rid, { convexMs: Date.now() - tConvex });
			log('respond PATCH', rid, { status: 200, totalMs: Date.now() - t0 });
			return json({ ok: true });
		} catch (e) {
			const msg = errMsg(e);
			const isTimeout = /timeout/i.test(msg);
			log('convex-error PATCH', rid, { ms: Date.now() - t0, isTimeout, error: msg });
			return json({ error: msg }, { status: isTimeout ? 502 : 400 });
		}
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e && 'location' in e) throw e;
		log('error PATCH', rid, { ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
		return json({ error: 'Erreur inattendue.' }, { status: 500 });
	}
};
