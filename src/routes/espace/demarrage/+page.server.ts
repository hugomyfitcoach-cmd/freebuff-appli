import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';

export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'client', { next: '/espace/demarrage' });
	const token = event.cookies.get(SESSION_COOKIE);
	const intake = await convex
		.query(api.onboarding.mine, { sessionToken: token })
		.catch(() => ({ status: null, answers: {}, submittedAt: null, updatedAt: null, accountHeightCm: null }));
	return { intake };
};
