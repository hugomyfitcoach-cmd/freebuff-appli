import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

/** Clé publique VAPID (publique par conception) — sert à l'abonnement push du navigateur. */
export const GET: RequestHandler = async () => {
	const key = env.VAPID_PUBLIC_KEY ?? '';
	if (!key) return json({ error: 'Push non configuré.' }, { status: 404 });
	return json({ publicKey: key });
};