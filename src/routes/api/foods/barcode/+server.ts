import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Recherche par code-barres (EAN) : base locale d'abord, OFF en secours. */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	const code = (event.url.searchParams.get('code') ?? '').replace(/\D/g, '');
	if (code.length < 8) return json([]);
	try {
		const foods = await convex.action(api.off.barcodeLookup, {
			sessionToken: token,
			barcode: code,
		});
		return json(foods);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};