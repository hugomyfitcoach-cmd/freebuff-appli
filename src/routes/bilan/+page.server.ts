import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../convex/_generated/api.js';
import { SESSION_COOKIE, currentUser } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';
import { mondayISO } from '$lib/week.js';

const MERCI = ['rien', 'ecrit', 'appel'] as const;

export const load: PageServerLoad = async (event) => {
	const user = await currentUser(event);
	// Route réservée aux comptes clients connectés.
	if (!user) throw redirect(303, '/connexion?next=/bilan');
	if (user.role !== 'client') throw redirect(303, '/admin');
	const p = event.url.searchParams.get('merci');
	const merci: 'rien' | 'ecrit' | 'appel' | null =
		p === 'rien' || p === 'ecrit' || p === 'appel' ? p : null;
	return { user, merci };
};

export const actions: Actions = {
	submit: async (event) => {
		const user = await currentUser(event);
		if (!user) throw redirect(303, '/connexion?next=/bilan');
		if (user.role !== 'client') {
			return { success: false, error: 'Seuls les comptes clients peuvent remplir un bilan hebdo.' };
		}

		let raw: unknown;
		const isJson = (event.request.headers.get('content-type') ?? '').includes('application/json');
		if (isJson) {
			const body = await event.request.json().catch(() => null);
			raw = body?.answers;
		} else {
			const form = await event.request.formData();
			const payload = String(form.get('payload') ?? '');
			try {
				raw = JSON.parse(payload);
			} catch {
				raw = null;
			}
		}
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			return { success: false, error: 'Réponses illisibles. Recharge la page et réessaie.' };
		}

		const token = event.cookies.get(SESSION_COOKIE);
		try {
			const result = await convex.mutation(api.checkins.submit, {
				sessionToken: token,
				weekStart: mondayISO(),
				answers: raw as never,
			});
			const besoin = (raw as Record<string, unknown>).besoin_retour;
			const merci = MERCI.includes(besoin as (typeof MERCI)[number]) ? (besoin as (typeof MERCI)[number]) : 'rien';
			if (isJson) {
				return { success: true, merci, weekLabel: result.weekLabel };
			}
			throw redirect(303, `/bilan?merci=${merci}`);
		} catch (e) {
			if (e && typeof e === 'object' && 'location' in e) throw e;
			return { success: false, error: errMsg(e) };
		}
	},
};
