#!/usr/bin/env node
/**
 * Build PREVIEW (Netlify Deploy Preview) — jamais utilisé en production.
 *
 * Verrou anti-fusible : le build Netlify d'une branche doit TOUJOURS pointer
 * vers un déploiement Convex PREVIEW (journalier/branche), JAMAIS vers la
 * production G-FLUX (calm-jaguar-475). Deux garde-fous :
 *  1. la CONVEX_DEPLOY_KEY du contexte Netlify doit être une PREVIEW deploy
 *     key (préfixe "preview:" de Convex) — jamais "prod:" ;
 *  2. la PUBLIC_CONVEX_URL du contexte ne doit JAMAIS contenir le nom de la
 *     production. Si oui → build KO (message clair), rien n'est déployé.
 *
 * CONTEXT=production (build de prod Netlify) : la clé "prod:" est autorisée
 * UNIQUEMENT si PUBLIC_CONVEX_URL pointe bien vers la prod attendue (le flux
 * de prod reste inchangé — ce script ne concerne pas les builds prod normaux,
 * il s'assure simplement qu'un build preview ne peut pas fuiter vers prod).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROD_DEPLOYMENT = 'calm-jaguar-475';
const PROD_URL_PART = `${PROD_DEPLOYMENT}.convex.cloud`;

/** Netlify expose CONTEXT (production|deploy-preview|branch-deploy|dev). */
const context = process.env.CONTEXT ?? 'dev';

function readEnvFileVars() {
	// Fallback local (dev hors Netlify) : même contrat que scripts/deploy.mjs.
	const vars = {};
	const file = resolve('.env.local');
	if (existsSync(file)) {
		for (const line of readFileSync(file, 'utf8').split('\n')) {
			const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
			if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, '');
		}
	}
	return vars;
}

const fileVars = readEnvFileVars();
const deployKey = process.env.CONVEX_DEPLOY_KEY ?? fileVars.CONVEX_DEPLOY_KEY ?? '';
const publicConvexUrl = process.env.PUBLIC_CONVEX_URL ?? fileVars.PUBLIC_CONVEX_URL ?? '';

// 1) Contexte de PREVIEW (Netlify deploy-preview / branch-deploy) :
//    clé preview obligatoire, prod interdite.
if (context === 'deploy-preview' || context === 'branch-deploy') {
	if (!deployKey.startsWith('preview:')) {
		console.error(
			`⛔ Build PREVIEW refusé : CONVEX_DEPLOY_KEY n'est pas une Preview Deploy Key (préfixe attendu "preview:"). ` +
				`La production Convex (${PROD_DEPLOYMENT}) ne doit JAMAIS être ciblée depuis une preview.`
		);
		process.exit(1);
	}
	if (publicConvexUrl.includes(PROD_URL_PART) || publicConvexUrl.includes(PROD_DEPLOYMENT)) {
		console.error(
			`⛔ Build PREVIEW refusé : PUBLIC_CONVEX_URL pointe vers la production Convex (${PROD_DEPLOYMENT}). ` +
				`Configure la variable PUBLIC_CONVEX_URL (scope Deploy Previews) avec l'URL du Convex Preview.`
		);
		process.exit(1);
	}
	console.log(`✅ Preview : PUBLIC_CONVEX_URL=${publicConvexUrl} (convex preview, pas ${PROD_DEPLOYMENT}) — build autorisé.`);
}

// 2) Contexte PROD (build Netlify de production) : on vérifie la cohérence
//    sans rien changer au flux historique (clé prod + URL prod attendues).
if (context === 'production') {
	if (!publicConvexUrl.includes(PROD_URL_PART)) {
		console.error(
			`⛔ Build PRODUCTION incohérent : PUBLIC_CONVEX_URL ne pointe pas vers ${PROD_DEPLOYMENT}. ` +
				`Production Netlify inchangée → build refusé pour éviter toute fuite de config.`
		);
		process.exit(1);
	}
	console.log(`✅ Production : PUBLIC_CONVEX_URL=${publicConvexUrl} — build autorisé (flux inchangé).`);
}

// 3) Écrit de .env.production — consommé par Vite au build (valeurs du CONTEXTE
//    Netlify uniquement, jamais des secrets : la clé reste côté runtime).
writeFileSync(
	resolve('.env.production'),
	`# Généré par scripts/build-preview.mjs (contexte Netlify : ${context})\nPUBLIC_CONVEX_URL=${publicConvexUrl}\nPUBLIC_CONVEX_SITE_URL=${process.env.PUBLIC_CONVEX_SITE_URL ?? fileVars.PUBLIC_CONVEX_SITE_URL ?? ''}\nVITE_CONVEX_URL=${publicConvexUrl}\n`
);

console.log(`→ .env.production écrit pour le contexte "${context}". Lancement du build Vite…`);
