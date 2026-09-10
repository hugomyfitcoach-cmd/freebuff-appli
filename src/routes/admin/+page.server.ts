import { redirect } from '@sveltejs/kit';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';	export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'coach', { next: '/admin' });
	const token = event.cookies.get(SESSION_COOKIE);

	const clients = await convex.query(api.coach.listClients, { sessionToken: token });

	const param = event.url.searchParams.get('client');
	const selectedId =
		param && clients.some((c: { user: { _id: string } }) => c.user._id === param) ? param : (clients[0]?.user._id ?? null);

	const view = selectedId
		? await convex.query(api.coach.client360, { sessionToken: token, userId: selectedId as never })
		: null;
	const checkins = selectedId
		? await convex.query(api.coach.checkinsFor, { sessionToken: token, userId: selectedId as never })
		: [];
	const photos = selectedId
		? await convex.query(api.photos.listForCoach, { sessionToken: token, userId: selectedId as never })
		: [];

	return {
		clients,
		selectedId,
		view,
		checkins,
		photos,
		form: null as null | { action: string; error?: string; ok?: string },
	};
};

function back(event: { url: URL }, clientId?: string | null): never {
	const q = clientId ? `?client=${encodeURIComponent(clientId)}` : '';
	throw redirect(303, `/admin${q}`);
}

export const actions: Actions = {
	createClient: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '');
		const prenom = String(form.get('prenom') ?? '');
		const password = String(form.get('password') ?? '');
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			const res = await convex.mutation(api.coach.createClient, {
				sessionToken: token,
				email,
				password,
				prenom,
			});
			return { action: 'createClient', ok: `Compte créé : ${prenom.trim()} (${email.trim()}). Pense à lui transmettre ses identifiants.`, userId: res.userId };
		} catch (e) {
			return fail(400, { action: 'createClient', error: errMsg(e) });
		}
	},
	updateFiche: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const prenom = String(form.get('prenom') ?? '');
		const email = String(form.get('email') ?? '');
		const birthDate = String(form.get('birthDate') ?? '');
		const heightRaw = String(form.get('heightCm') ?? '');
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			await convex.mutation(api.coach.updateClient, {
				sessionToken: token,
				userId: userId as never,
				prenom,
				email,
				birthDate,
				heightCm: heightRaw ? Number(heightRaw) : undefined,
			});
			return { action: 'updateFiche', ok: 'Fiche client mise à jour.', clientId: userId };
		} catch (e) {
			return fail(400, { action: 'updateFiche', error: errMsg(e), clientId: userId });
		}
	},
	rename: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const prenom = String(form.get('prenom') ?? '');
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			await convex.mutation(api.coach.updateClient, { sessionToken: token, userId: userId as never, prenom });
			return { action: 'rename', ok: 'Prénom mis à jour.' };
		} catch (e) {
			return fail(400, { action: 'rename', error: errMsg(e) });
		}
	},
	updateEmail: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const email = String(form.get('email') ?? '');
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			await convex.mutation(api.coach.updateClient, { sessionToken: token, userId: userId as never, email });
			return { action: 'updateEmail', ok: 'Email mis à jour.' };
		} catch (e) {
			return fail(400, { action: 'updateEmail', error: errMsg(e) });
		}
	},
	resetPassword: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const newPassword = String(form.get('newPassword') ?? '');
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			await convex.mutation(api.coach.resetPassword, { sessionToken: token, userId: userId as never, newPassword });
			return { action: 'resetPassword', ok: 'Mot de passe réinitialisé. Communique-le à la cliente (ses sessions ouvertes ont été fermées).' };
		} catch (e) {
			return fail(400, { action: 'resetPassword', error: errMsg(e) });
		}
	},
	removeClient: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const confirm = String(form.get('confirm') ?? '');
		if (confirm !== 'on') {
			return fail(400, { action: 'removeClient', error: 'Coche la case de confirmation pour supprimer.' });
		}
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			const res = await convex.mutation(api.coach.removeClient, { sessionToken: token, userId: userId as never });
			return { action: 'removeClient', ok: `Client supprimé (${res.removedCheckins} bilan(s) retiré(s)).` };
		} catch (e) {
			return fail(400, { action: 'removeClient', error: errMsg(e) });
		}
	},
	setFeedback: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const checkinId = String(form.get('checkinId') ?? '');
		const clientId = String(form.get('clientId') ?? '');
		const feedback = String(form.get('feedback') ?? '');
		const status = String(form.get('status') ?? 'nouveau');
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			await convex.mutation(api.coach.setFeedback, {
				sessionToken: token,
				checkinId: checkinId as never,
				feedback,
				status: status === 'retour_envoye' ? 'retour_envoye' : 'nouveau',
			});
			return { action: 'setFeedback', ok: 'Retour enregistré.', clientId };
		} catch (e) {
			return fail(400, { action: 'setFeedback', error: errMsg(e) });
		}
	},
	setGoals: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const num = (k: string) => Number(form.get(k));
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			await convex.mutation(api.journal.setClientGoals, {
				sessionToken: token,
				userId: userId as never,
				kcal: num('kcal'),
				carbs: num('carbs'),
				protein: num('protein'),
				fat: num('fat'),
			});
			return { action: 'setGoals', ok: 'Objectifs journaliers enregistrés.', clientId: userId };
		} catch (e) {
			return fail(400, { action: 'setGoals', error: errMsg(e), clientId: userId });
		}
	},
};
