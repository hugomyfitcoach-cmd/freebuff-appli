import type { RequestHandler } from './$types';
import { startConnect } from '$lib/server/googleOAuth';

/** Démarre le flow OAuth Google Calendar (réservé au coach connecté). */
export const GET: RequestHandler = (event) => startConnect(event);
