import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Bibliothèque de plans de repas (coach).
 *   GET    ?id=…            → un plan complet (éditeur)
 *   GET                     → liste compacte
 *   POST   {name, items[]}  → créer
 *   PATCH  {id, name, items[]} → modifier
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	const id = event.url.searchParams.get('id');
	try {
		if (id) {
			const plan = await convex.query(api.mealPlans.getTemplate, {
				sessionToken: token,
				templateId: id as never,
			});
			return json(plan);
		}
		const plans = await convex.query(api.mealPlans.listTemplates, { sessionToken: token });
		return json(plans);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.mealPlans.createTemplate, {
			sessionToken: token,
			name: String(body.name ?? ''),
			description: body.description ? String(body.description) : undefined,
			items: sanitizeItems(body.items) as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const PATCH: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.mealPlans.updateTemplate, {
			sessionToken: token,
			templateId: String(body.id ?? '') as never,
			name: String(body.name ?? ''),
			description: body.description ? String(body.description) : undefined,
			items: sanitizeItems(body.items) as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

type SanitizedItem = {
	meal: string;
	foodId?: string;
	customFoodId?: string;
	ciqualLabel?: string;
	referenceSource?: 'ciqual' | 'gflux';
	referenceFoodId?: string;
	qtyGrams: number;
};

function sanitizeItems(raw: unknown): SanitizedItem[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
		.map((it) => {
			const out: SanitizedItem = {
				meal: String(it.meal ?? ''),
				qtyGrams: Number(it.qtyGrams ?? 0),
			};
			if (it.foodId) out.foodId = String(it.foodId);
			if (it.customFoodId) out.customFoodId = String(it.customFoodId);
			// Aliment de référence G-Flux : provenance explicite — `ciqualLabel`
			// reste réservé aux fiches Ciqual (R3-bis).
			if (it.referenceSource === 'gflux' || it.referenceSource === 'ciqual') out.referenceSource = it.referenceSource;
			if (typeof it.referenceFoodId === 'string' && it.referenceFoodId) out.referenceFoodId = it.referenceFoodId;
			if (it.referenceSource !== 'gflux' && typeof it.ciqualLabel === 'string' && it.ciqualLabel) {
				out.ciqualLabel = it.ciqualLabel;
			}
			return out;
		});
}
