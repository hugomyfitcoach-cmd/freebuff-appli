#!/usr/bin/env node
/**
 * SEED du Convex PREVIEW — données 100 % FICTIVES, jamais la production.
 *
 * ⛔ ANTI-FUSIBLE : refuse de s'exécuter si l'URL cible est la production
 * calm-jaguar-475, ou si la clé n'est pas une Preview Deploy Key.
 *
 * Principe : Convex n'autorise pas l'appel direct d'une mutation depuis un
 * script externe sans auth applicative. Le seed passe donc par une ACTION
 * HTTP publique dédiée (previewSeed:runSeedHttp) qui vérifie un token
 * d'exécution (PREVIEW_SEED_TOKEN, variable d'env du Convex Preview), crée
 * les comptes/journal de test si absents, puis renvoie les identifiants.
 * Aucun secret n'est affiché par ce script : seuls les identifiants de TEST
 * fictifs sont imprimés.
 *
 * Usage : node scripts/seed-preview.mjs https://<preview-deployment>.convex.cloud
 */
import { readFileSync, existsSync } from 'node:fs';

const PROD_DEPLOYMENT = 'calm-jaguar-475';

const urlArg = process.argv[2] ?? process.env.PUBLIC_CONVEX_URL ?? '';
if (!urlArg.startsWith('http')) {
	console.error('Usage : node scripts/seed-preview.mjs https://<preview>.convex.cloud');
	process.exit(1);
}
if (urlArg.includes(PROD_DEPLOYMENT)) {
	console.error(`⛔ REFUS : cette URL est la PRODUCTION Convex (${PROD_DEPLOYMENT}). Aucune écriture de test autorisée.`);
	process.exit(1);
}

// Clé : env du contexte Netlify preview, sinon .env.local (dev).
let deployKey = process.env.CONVEX_DEPLOY_KEY ?? '';
if (!deployKey && existsSync('.env.local')) {
	for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
		const m = line.match(/^CONVEX_DEPLOY_KEY\s*=\s*(.*?)\s*$/);
		if (m) deployKey = m[1].replace(/^["']|["']$/g, '');
	}
}
if (deployKey.startsWith('prod:')) {
	console.error('⛔ REFUS : CONVEX_DEPLOY_KEY est une clé de PRODUCTION — ce script n’écrit jamais sur la prod.');
	process.exit(1);
}

// Le token de seed vit côté Convex Preview (PREVIEW_SEED_TOKEN). En CI/Netlify
// preview, il est fourni par la variable d'environnement du même nom.
const seedToken = process.env.PREVIEW_SEED_TOKEN ?? '';
if (!seedToken) {
	console.error('⛔ PREVIEW_SEED_TOKEN manquant (variable Netlify preview + convex env set sur le preview).');
	process.exit(1);
}

// Route HTTP publique dédiée (voir src/convex/http.ts) : POST /seedPreview
const siteUrl = urlArg.replace('.convex.cloud', '.convex.site');
const res = await fetch(`${siteUrl}/seedPreview`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ seedToken }),
});
const j = await res.json();
if (!res.ok || j.status !== 'success') {
	console.error('⛔ Seed échoué :', JSON.stringify(j).slice(0, 400));
	process.exit(1);
}
console.log('✅ Convex Preview seedé (données 100 % fictives) :');
console.log(`   Coach   : ${j.result.coachEmail} / ${j.result.coachPassword}`);
console.log(`   Bêta IA : ${j.result.betaEmail} / ${j.result.betaPassword}  ← compte de test iPhone`);
console.log(`   Journal de test Ciqual créé pour aujourd'hui (si absent).`);
