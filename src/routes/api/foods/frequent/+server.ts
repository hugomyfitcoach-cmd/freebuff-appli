import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * ALIMENTS FRÉQUENTS INTELLIGENTS — habitudes apprises de CETTE cliente.
 *
 * Score personnel côté serveur (query journal.freqFoods, module pur
 * lib/foodFrequency.ts) : fréquence d'utilisation × récence × contexte du
 * repas en cours. Panier borné (20 par défaut, 50 max — « Voir plus »).
 * L'identité exacte des produits est conservée (produit OFF importé avec
 * marque/barcode/image, fiche perso, référence CIQUAL).
 *
 * `meal` (optionnel) = petit-dej | dejeuner | diner | collation — bonus
 * d'affinité simple et explicable (aucun ML, aucune donnée externe).
 */
const MEALS = new Set(['petit-dej', 'dejeuner', 'diner', 'collation'] as const);
/** Type littéral attendu par la query Convex (aucun cast implicite). */
type MealParam = 'petit-dej' | 'dejeuner' | 'diner' | 'collation';

export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	const limit = Math.min(50, Math.max(1, Math.floor(Number(event.url.searchParams.get('limit') ?? 20) || 20)));
	const mealRaw = event.url.searchParams.get('meal') ?? '';
	const meal: MealParam | undefined = (MEALS as ReadonlySet<string>).has(mealRaw) ? (mealRaw as MealParam) : undefined;
	try {
		const foods = await convex.query(api.journal.freqFoods, {
			sessionToken: token,
			limit,
			...(meal ? { currentMeal: meal } : {}),
		});
		return json(foods);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
