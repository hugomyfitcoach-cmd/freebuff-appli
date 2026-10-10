#!/usr/bin/env node
/**
 * Fail-closed preflight for Convex deployments initiated by Netlify.
 * This file intentionally reads process.env only; it never loads .env.local.
 * It must be the first command in every Netlify context that invokes Convex.
 */
const context = process.env.CONTEXT ?? '';
const key = process.env.CONVEX_DEPLOY_KEY ?? '';
const url = process.env.PUBLIC_CONVEX_URL ?? '';
const productionMarker = 'calm-jaguar-475';

const fail = (reason) => {
	console.error(`⛔ Convex Preview preflight refused: ${reason}`);
	process.exit(1);
};

if (context !== 'deploy-preview') {
	fail('Netlify CONTEXT must be exactly "deploy-preview". No Convex command was started.');
}
if (!key.startsWith('preview:')) {
	fail('CONVEX_DEPLOY_KEY must be a Preview Deploy Key. No Convex command was started.');
}
if (key.includes(productionMarker)) {
	fail('The deploy key contains the production deployment marker. No Convex command was started.');
}
if (url && !/\.convex\.cloud\/?$/.test(url)) {
	fail('PUBLIC_CONVEX_URL, when present, must be a Convex cloud URL. No Convex command was started.');
}
if (url.includes(productionMarker)) {
	fail('PUBLIC_CONVEX_URL points to production. No Convex command was started.');
}

// Do not print the key or its contents. Convex CLI enforces the Preview key's
// server-side scope; the explicit context and prefix checks fail closed here.
console.log('✅ Convex Preview preflight passed (Deploy Preview context; key value hidden).');
