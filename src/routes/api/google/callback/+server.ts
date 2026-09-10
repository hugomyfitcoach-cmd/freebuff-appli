import type { RequestHandler } from './$types';
import { handleCallback } from '$lib/server/googleOAuth';

/**
 * Callback OAuth Google : échange le code, chiffre et stocke les tokens,
 * puis revient sur /admin (google=ok | google=error).
 */
export const GET: RequestHandler = (event) => handleCallback(event);
