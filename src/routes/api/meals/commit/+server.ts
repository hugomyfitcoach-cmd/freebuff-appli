import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import type { Id } from '../../../../convex/_generated/dataModel.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * « Ajouter au Journal » d'un repas analysé — N composants en UNE requête.
 *
 * Chaque composant conserve son identité de match (foodId / customFoodId /
 * ciqualLabel) ou son statut « Estimation IA » (valeurs /100 g transmises
 * telles quelles, source: 'ai_estimation'). Le backend rejoue EXACTEMENT les
 * mêmes règles que l'ajout unitaire du Journal (mutation journal.addEntry) :
 * snapshots serveur, garde-fou kcal↔macros, planned si date future.
 *
 * `requestId` (généré par la PWA) rend la mutation idempotente : un
 * double-clic ou un retry réseau ne crée jamais le repas deux fois.
 * Les erreurs techniques (Convex, réseau…) sont masquées derrière un message
 * utilisateur neutre — la cause réelle reste dans les logs serveur.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = (await event.request.json()) as {
			date?: unknown;
			meal?: unknown;
			components?: unknown;
			clientDate?: unknown;
			requestId?: unknown;
		};
		if (!Array.isArray(body.components) || body.components.length === 0) {
			return json({ error: 'Aucun composant à ajouter.' }, { status: 400 });
		}
		const components = body.components.slice(0, 12).map((raw) => {
			const c = (raw ?? {}) as Record<string, unknown>;
			const id = (k: 'foodId' | 'customFoodId'): string | undefined => {
				const v = c[k];
				return typeof v === 'string' && v.length > 0 ? v : undefined;
			};
			const n = (v: unknown): number | undefined => {
				const x = typeof v === 'number' ? v : Number(v);
				return isFinite(x) && x >= 0 ? x : undefined;
			};
			return {
				foodId: id('foodId') as Id<'foods'> | undefined,
				customFoodId: id('customFoodId') as Id<'customFoods'> | undefined,
				ciqualLabel: typeof c.ciqualLabel === 'string' && c.ciqualLabel ? c.ciqualLabel : undefined,
				name: String(c.name ?? ''),
				qtyGrams: n(c.qtyGrams) ?? 100,
				/** Valeurs /100 g de secours (composant « Estimation IA » sans match). */
				aiKcal100: n(c.aiKcal100),
				aiCarbs100: n(c.aiCarbs100),
				aiProtein100: n(c.aiProtein100),
				aiFat100: n(c.aiFat100),
			};
		});
		const res = await convex.mutation(api.meals.commitAnalyzedMeal, {
			sessionToken: token,
			date: String(body.date ?? ''),
			meal: String(body.meal ?? ''),
			components,
			clientDate: typeof body.clientDate === 'string' ? body.clientDate : undefined,
			requestId: typeof body.requestId === 'string' && body.requestId.length <= 64 ? body.requestId : undefined,
		});
		return json(res);
	} catch (e) {
		console.error('[meals/commit] commitAnalyzedMeal a échoué :', errMsg(e));
		return json({ error: "Impossible d'ajouter ce repas pour le moment. Réessaie dans quelques instants." }, { status: 500 });
	}
};
