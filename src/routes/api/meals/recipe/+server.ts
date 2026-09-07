import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';
import { recipes, newRecipes } from '$lib/data/recettes';

type GFluxRecipe = {
	index: string;
	name: string;
	kcal: number;
	prot: number;
	glucides: number;
	lipides: number;
};

/** Toutes les recettes du guide G-FLUX (catégories fusionnées), indexées par identifiant. */
const ALL_RECIPES: Record<string, GFluxRecipe> = (() => {
	const out: Record<string, GFluxRecipe> = {};
	for (const group of [recipes, newRecipes]) {
		for (const list of Object.values(group) as unknown as GFluxRecipe[][]) {
			for (const r of list) out[r.index] = r;
		}
	}
	return out;
})();

/**
 * Ajoute une recette du guide G-FLUX à « Mes repas » du client.
 * Les valeurs nutritionnelles proviennent des données statiques (jamais du
 * client) ; l'index sert de clé d'unicité → aucune copie en double.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const recipeIndex = String(body.recipeIndex ?? '');
		const recipe = ALL_RECIPES[recipeIndex];
		if (!recipe) return json({ error: 'Recette introuvable.' }, { status: 404 });

		const res = await convex.mutation(api.meals.addGFluxRecipe, {
			sessionToken: token,
			recipeIndex,
			name: recipe.name,
			kcal: recipe.kcal,
			carbs: recipe.glucides,
			protein: recipe.prot,
			fat: recipe.lipides,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};