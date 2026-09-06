import { ConvexClient } from 'convex/browser';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

/**
 * Client Convex unique côté serveur (BFF) : toute la lecture/écriture de
 * données passe par SvelteKit. Le navigateur n'appelle jamais Convex
 * directement — il ne connaît que des formulaires/actions de notre serveur,
 * qui ajoute le jeton de session (cookie HttpOnly).
 */
export const convex = new ConvexClient(PUBLIC_CONVEX_URL);
