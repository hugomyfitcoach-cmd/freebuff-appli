import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Résolution code-barres AVANT création d'un aliment (anti-doublon).
 *
 *   GET /api/foods/custom-barcode?barcode=1234567890123
 *    → hit  { source: 'global'|'own', name, kcal100, … }  si le produit existe
 *      déjà (base commune OU fiche perso de la cliente) → « Ce produit existe
 *      déjà dans G-FLUX », aucun doublon ni candidat créé.
 *    → null  si code inconnu → la création produira aliment personnel +
 *      simple candidat global (jamais publié automatiquement).
 */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	const code = (event.url.searchParams.get('barcode') ?? '').replace(/\D/g, '');
	if (code.length < 8) return json(null);
	try {
		const hit = await convex.query(api.customFoods.byBarcodeGlobal, {
			sessionToken: token,
			barcode: code,
		});
		return json(hit);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
