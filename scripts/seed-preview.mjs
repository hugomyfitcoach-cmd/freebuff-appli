#!/usr/bin/env node
/**
 * SEED de secours du Convex PREVIEW — données 100 % FICTIVES.
 *
 * Le seed AUTOMATIQUE passe par `--preview-run previewSeed:seedPreviewData`
 * (exécuté par `convex deploy` sur le preview uniquement — voir netlify.toml).
 * Ce script n'est utile QUE si tu veux re-seder à la main un preview déjà
 * déployé : POST /seedPreview sur le .convex.site du preview.
 *
 * ⛔ ANTI-FUSIBLES : refuse l'URL prod (calm-jaguar-475) et une clé "prod:".
 * Si PREVIEW_SEED_TOKEN est configuré sur le preview, il est requis.
 *
 * Usage : node scripts/seed-preview.mjs https://<preview>.convex.cloud [token-optionnel]
 */
import { readFileSync, existsSync } from 'node:fs';

const PROD_DEPLOYMENT = 'calm-jaguar-475';

const urlArg = process.argv[2] ?? '';
const seedToken = process.argv[3] ?? process.env.PREVIEW_SEED_TOKEN ?? '';
if (!urlArg.startsWith('http')) {
	console.error('Usage : node scripts/seed-preview.mjs https://<preview>.convex.cloud [token-optionnel]');
	process.exit(1);
}
if (urlArg.includes(PROD_DEPLOYMENT)) {
	console.error(`⛔ REFUS : cette URL est la PRODUCTION Convex (${PROD_DEPLOYMENT}). Aucune écriture de test autorisée.`);
	process.exit(1);
}
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

const siteUrl = urlArg.replace('.convex.cloud', '.convex.site');
const res = await fetch(`${siteUrl}/seedPreview`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify(seedToken ? { seedToken } : {}),
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
