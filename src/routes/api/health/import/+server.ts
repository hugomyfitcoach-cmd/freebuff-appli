import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { errMsg } from '$lib/errors.js';

/** CORS : autorise uniquement les appels lancés par Raccourcis (origine `null`). */
const ALLOWED_ORIGIN = 'null';

function corsHeaders(): Record<string, string> {
	return {
		'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Max-Age': '86400',
	};
}

/** Preflight OPTIONS (Raccourcis envoie une requête simple en général, mais restons robustes). */
export const OPTIONS: RequestHandler = async () => {
	return new Response(null, { status: 204, headers: corsHeaders() });
};

/**
 * Import des pas Apple Santé — appelé par le raccourci « G-FLUX — Synchroniser
 * mes pas » (app Raccourcis iOS), PAS par le navigateur.
 *
 * Requête attendue : POST { token, days: [{ date, count }, …] } — 7 couples
 * date ("yyyy-mm-dd", heure locale de l'iPhone) + nombre de pas.
 *
 * Sécurité : le jeton court (15 min, hashé en base, créé via /api/health/token
 * depuis la session de la cliente) est la seule identification — aucun cookie,
 * aucun ID permanent. Chaque journée : remplacement de la valeur Apple Santé
 * uniquement (healthCount), correction manuelle conservée, aucun faux « 0 ».
 */
export const POST: RequestHandler = async (event) => {
	try {
		const body = await event.request.json();
		const token = typeof body?.token === 'string' ? body.token : '';
		const days = Array.isArray(body?.days) ? body.days : null;
		if (!token) return json({ error: 'Jeton manquant.' }, { status: 400 });
		if (!days || days.length === 0) return json({ error: 'Aucune donnée de pas reçue.' }, { status: 400 });

		// Journée SANS donnée Apple Santé : le raccourci produit une valeur vide
		// (ou absente) → on ignore ce jour, sans jamais créer de faux « 0 pas ».
		// Une valeur 0 réelle (échantillon existant à 0 pas) reste transmise.
		const clean = days
			.map((x: { date?: unknown; count?: unknown }) => ({
				date: typeof x?.date === 'string' ? x.date.trim() : '',
				rawCount: x?.count,
			}))
			.filter((x: { date: string; rawCount: unknown }) => /^\d{4}-\d{2}-\d{2}$/.test(x.date))
			.map((x: { date: string; rawCount: unknown }) => ({ date: x.date, count: Number(x.rawCount) }))
			.filter((x: { date: string; count: number }) => Number.isFinite(x.count));
		if (clean.length === 0) return json({ error: 'Aucune donnée de pas exploitable reçue.' }, { status: 400 });

		// Date du jour côté serveur : borne la fenêtre côté Convex (pas de jour futur).
		const d = new Date();
		const nowISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

		const res = await convex.mutation(api.steps.importFromHealth, {
			token,
			days: clean,
			nowISO,
		});
		return json(res, { headers: corsHeaders() });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400, headers: corsHeaders() });
	}
};
