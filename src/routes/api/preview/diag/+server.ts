import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { errMsg } from '$lib/errors.js';
import { env } from '$env/dynamic/private';

/**
 * DIAGNOSTIC & RÉPARATION PREVIEW (commenté pour la bêta Alimentation IA).
 *
 * Objectif : donner une vérité terrain sur l'environnement réellement
 * utilisé par le BFF de cette Deploy Preview, et permettre la réparation du
 * seed (compte bêta toujours authentifiable) SANS jamais toucher à la
 * production Convex.
 *
 * SÉCURITÉ — refus dur si :
 *  1. l'URL Convex compilée ressemble à la production (calm-jaguar-475) ;
 *  2. la présence du fichier `PREVIEW_DIAG_ENABLED` marque explicitement
 *     l'intention de l'activer (fichier PUIS gitignoré, absent du dépôt).
 */
const PROD_MARK = 'calm-jaguar-475';

// Activé uniquement sur les contextes preview Netlify (PREVIEW_DIAG = 1 dans
// netlify.toml pour deploy-preview / branch-deploy). Absent en production.
const enabled = env.PREVIEW_DIAG === '1' || env.PREVIEW_DIAG_ENABLED === '1';

export const GET = async () => {
	if (!enabled) return json({ enabled: false }, { status: 404 });
	const url = String(PUBLIC_CONVEX_URL ?? '');
	return json({
		enabled: true,
		convexUrl: url,
		isProdLike: url.includes(PROD_MARK),
	});
};

export const POST = async () => {
	if (!enabled) return json({ enabled: false }, { status: 404 });
	const url = String(PUBLIC_CONVEX_URL ?? '');
	if (!url || url.includes(PROD_MARK)) {
		return json({ enabled: true, convexUrl: url, error: 'refus: environnement ressemblant à la production' }, { status: 403 });
	}
	try {
		// Seed self-healing (hash réappliqué) — la même mutation sert au hook
		// --preview-run du workflow Convex × Netlify.
		const r = await convex.mutation(api.previewSeed.seedPreviewData, {});
		return json({
			enabled: true,
			convexUrl: url,
			isProdLike: url.includes(PROD_MARK),
			seed: r,
		});
	} catch (e) {
		return json({ enabled: true, convexUrl: url, error: errMsg(e) }, { status: 500 });
	}
};
