#!/usr/bin/env node
/**
 * Garde-fous de build — exécuté avant `vite build` (npm run build).
 *
 * PRINCIPE (workflow officiel Convex × Netlify) :
 *  - Deploy Preview Netlify : `npx convex deploy --cmd-url-env-var-name
 *    PUBLIC_CONVEX_URL --cmd "npm run build"` — la PREVIEW deploy key crée/
 *    réutilise automatiquement le Convex Preview et INJECTE son URL dans le
 *    build via PUBLIC_CONVEX_URL (aucune config manuelle). Ce script vérifie
 *    que cette URL n'est JAMAIS la production ;
 *  - Production Netlify : flux historique INCHANGÉ (pas de convex deploy dans
 *    le build — le déploiement Convex prod reste manuel via scripts/deploy.mjs)
 *    et PUBLIC_CONVEX_URL doit pointer vers la prod attendue.
 *
 * ⛔ FUSIBLES : jamais de preview vers calm-jaguar-475 ; jamais de clé "prod:"
 * dans un contexte preview.
 */
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const PROD_DEPLOYMENT = 'calm-jaguar-475';
const PROD_URL_PART = `${PROD_DEPLOYMENT}.convex.cloud`;

/** Netlify expose CONTEXT (production | deploy-preview | branch-deploy | dev). */
const context = process.env.CONTEXT ?? 'dev';
const isPreview = context === 'deploy-preview' || context === 'branch-deploy';

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
/** En preview, `convex deploy` injecte l'URL du backend preview AVANT le build. */
const publicConvexUrl = process.env.PUBLIC_CONVEX_URL ?? fileVars.PUBLIC_CONVEX_URL ?? '';

if (isPreview) {
	if (!deployKey.startsWith('preview:')) {
		console.error(
			`⛔ Build PREVIEW refusé : CONVEX_DEPLOY_KEY n'est pas une Preview Deploy Key (préfixe attendu "preview:"). ` +
				`La production Convex (${PROD_DEPLOYMENT}) ne doit JAMAIS être ciblée depuis une preview.`
		);
		process.exit(1);
	}
	if (deployKey.includes(PROD_DEPLOYMENT)) {
		console.error(`⛔ Build PREVIEW refusé : la clé semble liée à la production (${PROD_DEPLOYMENT}).`);
		process.exit(1);
	}
	if (publicConvexUrl.includes(PROD_URL_PART) || publicConvexUrl.includes(PROD_DEPLOYMENT)) {
		console.error(
			`⛔ Build PREVIEW refusé : PUBLIC_CONVEX_URL pointe vers la production Convex (${PROD_DEPLOYMENT}). ` +
				`Le workflow officiel injecte l'URL du Convex Preview via --cmd-url-env-var-name — jamais l'URL prod.`
		);
		process.exit(1);
	}
	if (!publicConvexUrl) {
		console.error(
			`⛔ Build PREVIEW refusé : PUBLIC_CONVEX_URL absente. Le build doit être lancé par ` +
				`\`npx convex deploy --cmd-url-env-var-name PUBLIC_CONVEX_URL --cmd "npm run build"\` ` +
				`(l'URL du Convex Preview est alors injectée automatiquement).`
		);
		process.exit(1);
	}
	console.log(`✅ Preview : PUBLIC_CONVEX_URL=${publicConvexUrl} (Convex Preview, pas ${PROD_DEPLOYMENT}).`);
}if (context === 'production') {
	// L'URL réelle du déploiement production porte un sous-domaine RÉGION
	// (calm-jaguar-475.eu-west-1.convex.cloud) — forme documentée dans
	// .env.example. On accepte le nom de déploiement + un hôte *.convex.cloud,
	// avec ou sans région : tout autre hôte reste refusé (fuite de config).
	const isProdConvexHost =
		publicConvexUrl.includes(PROD_DEPLOYMENT) && /\.convex\.cloud\/?$/.test(publicConvexUrl);
	if (!isProdConvexHost) {
		console.error(
			`⛔ Build PRODUCTION incohérent : PUBLIC_CONVEX_URL ne pointe pas vers ${PROD_DEPLOYMENT}. ` +
				`Production Netlify inchangée → build refusé pour éviter toute fuite de config.`
			);
		process.exit(1);
	}
	console.log(`✅ Production : PUBLIC_CONVEX_URL=${publicConvexUrl} — build autorisé (flux inchangé).`);
}

// `.env.production` est gitignored : pour les builds locaux/dev (pas Netlify),
// on le déduit de .env.local. En contexte Netlify, PUBLIC_CONVEX_URL vient de
// l'environnement (injecté par `convex deploy --cmd` en preview) — on l'écrit
// pour que Vite ($env/static/public) l'embarque comme constante de build.
if (context === 'dev' || isPreview) {
	writeFileSync(
		resolve('.env.production'),
		`# Généré par scripts/build-preview.mjs (contexte : ${context}) — gitignored.\nPUBLIC_CONVEX_URL=${publicConvexUrl}\nPUBLIC_CONVEX_SITE_URL=${process.env.PUBLIC_CONVEX_SITE_URL ?? fileVars.PUBLIC_CONVEX_SITE_URL ?? ''}\n`
	);
} else {
	rmSync(resolve('.env.production'), { force: true });
}
console.log(`→ Build Vite (contexte "${context}")…`);
