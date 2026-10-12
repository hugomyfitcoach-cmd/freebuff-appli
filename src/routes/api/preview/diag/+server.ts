import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { errMsg } from '$lib/errors.js';
import { env } from '$env/dynamic/private';
import { BUILD_VERSION } from '$lib/buildVersion';

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

// Activé uniquement sur les contextes preview Netlify. Trois portes, dont
// aucune n'existe en production :
//  1. CONTEXT injecté par Netlify au runtime des fonctions ;
//  2. PREVIEW_DIAG = 1 configuré dans l'UI Netlify (scope Deploy Previews) ;
//  3. l'URL Convex compilée est non vide ET ne ressemble PAS à la prod.
const ctx = env.CONTEXT ?? '';
const url = String(PUBLIC_CONVEX_URL ?? '');
const enabled =
	ctx === 'deploy-preview' ||
	ctx === 'branch-deploy' ||
	env.PREVIEW_DIAG === '1' ||
	(!!url && !url.includes(PROD_MARK));

export const GET = async () => {
	if (!enabled) return json({ enabled: false }, { status: 404 });
	// Statut IA du backend Convex ciblé — booléens, jamais la valeur de la clé.
	// keyStatus est une ACTION : exécutée dans le runtime node, le même
	// environnement que les VRAIS appels OpenAI (les variables Convex n'y
	// sont pas toujours visibles depuis l'isolate des queries).
	const ai = await convex
		.action(api.aiAnalysis.keyStatus, {})
		.then((r) => ({ openaiKeyPresent: r.openaiKeyPresent, openaiModel: r.openaiModel, error: null }))
		.catch((e) => ({ openaiKeyPresent: null, openaiModel: null, error: errMsg(e) }));
	// Lot 2B — les nouvelles fonctions assistant sont-elles bien SUR LE
	// BACKEND ciblé ? Un query sans session doit répondre « Session invalide »
	// (fonction présente) et non une erreur « Unknown function » (backend
	// pas à jour) — diagnostic du bypass clarification.
	const lot2b = await convex
		.query(api.assistantTools.latestPendingJournalAdd, { threadId: 'diag-probe-0001' })
		.then(() => ({ latestPendingJournalAdd: true, error: null }))
		.catch((e) => ({ latestPendingJournalAdd: !/unknown|does not exist/i.test(errMsg(e)), error: errMsg(e) }));
	// §9 batterie — dernières erreurs d'outil tracées (échecs d'outils avalés
	// par le registre pendant les tours IA). Vide si aucune erreur récente.
	const toolTrace = await convex
		.query(api.previewDiag.recentToolErrors, {})
		.then((r: unknown) => r as { errors?: unknown; recentCalls?: unknown })
		.catch(() => ({ errors: [], recentCalls: [] }));
	const toolErrors = toolTrace.errors ?? [];
	const recentCalls = toolTrace.recentCalls ?? [];
	const foodTrace = await convex
		.query(api.previewFoodTrace.recentFoodTraces, {})
		.then((r: unknown) => r as { enabled?: boolean; traces?: unknown })
		.catch(() => ({ enabled: false, traces: [] }));
	return json({
		enabled: true,
		convexUrl: url,
		isProdLike: url.includes(PROD_MARK),
		netlifyContext: ctx || null,
		deploySha: env.COMMIT_REF ?? __NETLIFY_COMMIT_REF__ ?? null,
		deployId: env.DEPLOY_ID ?? env.BUILD_ID ?? __NETLIFY_DEPLOY_ID__ ?? null,
		buildVersion: BUILD_VERSION,
		ai,
		lot2b,
		toolErrors,
		recentCalls,
		foodTrace,
	});
};

export const POST = async () => {
	if (!enabled) return json({ enabled: false }, { status: 404 });
	if (!url || url.includes(PROD_MARK)) {
		return json({ enabled: true, convexUrl: url, error: 'refus: environnement ressemblant à la production' }, { status: 403 });
	}
	try {
		// Seed self-healing (hash réappliqué) — la même ACTION sert au hook
		// --preview-run du workflow Convex × Netlify (action : l'upload de la
		// photo DEMO au storage exige ce contexte).
		const r = await convex.action(api.previewSeed.seedPreviewData, {});
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
