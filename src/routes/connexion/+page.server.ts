import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../convex/_generated/api.js';
import { clearSessionCookie, currentUser, setSessionCookie } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

const PUBLIC_PATHS = ['/', '/connexion', '/espace', '/espace/progression', '/espace/historique', '/admin'];

function resolveNext(raw: string | null | undefined, role: 'coach' | 'client'): string {
	if (raw && raw.startsWith('/') && !raw.startsWith('//')) {
		// n'autorise que des destinations connues de l'app
		if (PUBLIC_PATHS.some((p) => raw === p || raw.startsWith(`${p}/`))) return raw;
	}
	return role === 'coach' ? '/admin' : '/espace';
}

export const actions: Actions = {
	login: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const nextRaw = String(form.get('next') ?? '');

		if (!email || !password) {
			return fail(400, { error: 'Renseigne ton email et ton mot de passe.', email });
		}
		let res: { token: string; user: { role: 'coach' | 'client' } };
		try {
			res = await convex.mutation(api.users.signIn, { email, password });
		} catch (e) {
			return fail(401, { error: errMsg(e), email });
		}
		setSessionCookie({ cookies, url }, res.token);
		throw redirect(303, resolveNext(nextRaw || null, res.user.role));
	},
	logout: async ({ cookies, url }) => {
		const token = cookies.get('gflux_session');
		if (token) {
			try {
				await convex.mutation(api.users.signOut, { sessionToken: token });
			} catch {
				// session déjà expirée : on nettoie le cookie quand même
			}
		}
		clearSessionCookie({ cookies, url });
		throw redirect(303, '/connexion');
	},
};

export const load = async (event) => {
	const user = await currentUser(event);
	if (user) {
		const next = String(event.url.searchParams.get('next') ?? '');
		throw redirect(303, resolveNext(next || null, user.role));
	}
	return { next: String(event.url.searchParams.get('next') ?? '') };
};
