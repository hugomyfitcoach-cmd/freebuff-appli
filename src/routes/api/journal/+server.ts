import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Jour complet (objectifs + consommé + planifié + totaux) — ?date=yyyy-mm-dd.
 *  Le plan coach actif est matérialisé (copy-on-write) AVANT la lecture. */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	const date = event.url.searchParams.get('date') ?? '';
	try {
		if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
			// Résolution copy-on-write du plan coach (mutation) — jamais dans le passé.
			await convex.mutation(api.mealPlans.ensurePlanForDate, { sessionToken: token, date });
		}
		const day = await convex.query(api.journal.getDay, {
			sessionToken: token,
			date: date || toLocalISO(new Date()),
		});
		return json(day);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Ajout : aujourd'hui (client) → consommé ; date future → planifié (client_planned). */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const body = await event.request.json();
		const res = await convex.mutation(api.journal.addEntry, {
			sessionToken: token,
			date: String(body.date ?? ''),
			meal: String(body.meal ?? ''),
			foodId: body.foodId as never,
			customFoodId: body.customFoodId as never,
			/** Fiche de référence Ciqual (ANSES) — libellé officiel exact. */
			ciqualLabel: body.ciqualLabel ? String(body.ciqualLabel) : undefined,
			qtyGrams: Number(body.qtyGrams),
			/** Portions mémorisées (préférence utilisateur, aliment → dernière
			 *  quantité validée) — pré-remplissage de la feuille de quantité pour
			 *  les autres items du même lot. Optionnel : absent → identique à
			 *  l'ancien contrat. */
			lastPortions: isRecordArray(body.lastPortions)
				? body.lastPortions
					.filter(
						(p: unknown): p is LastPortionArg =>
							!!p && typeof p === 'object' &&
							isFiniteNumber((p as LastPortionArg).qtyGrams)
					)
					.map((p: LastPortionArg) => ({
						foodId: typeof p.foodId === 'string' ? p.foodId : undefined,
						customFoodId: typeof p.customFoodId === 'string' ? p.customFoodId : undefined,
						ciqualLabel: typeof p.ciqualLabel === 'string' ? p.ciqualLabel : undefined,
						qtyGrams: Number(p.qtyGrams),
					}))
				: undefined,
			// ⚠️ clientDate (date locale navigateur, fix « date future » la nuit)
			// DÉSACTIVÉ tant que la mutation `addEntry` n'a pas été poussée sur
			// Convex prod : l'ancien backend rejette les arguments inconnus.
			// Réactiver après `npx convex push` :
			// clientDate: /^\d{4}-\d{2}-\d{2}$/.test(String(body.clientDate ?? '')) ? String(body.clientDate) : undefined,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Portion mémorisée transmise par l'UI (identifiant stable + quantité validée). */
type LastPortionArg = {
	foodId?: string;
	customFoodId?: string;
	ciqualLabel?: string;
	qtyGrams: number;
};

function isRecordArray(v: unknown): v is unknown[] {
	return Array.isArray(v) && v.length > 0 && v.length <= 50;
}

function isFiniteNumber(v: unknown): v is number {
	return typeof v === 'number' && isFinite(v) && v > 0;
}

function toLocalISO(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${dd}`;
}
