#!/usr/bin/env node
/**
 * Fail-closed preflight for Convex deployments initiated by Netlify.
 * This file intentionally reads process.env only; it never loads .env.local.
 * It must be the first command in every Netlify context that invokes Convex.
 */
const context = process.env.CONTEXT ?? '';
const key = process.env.CONVEX_DEPLOY_KEY ?? '';
const url = process.env.PUBLIC_CONVEX_URL ?? '';
const requestedSha = process.env.COMMIT_REF ?? '';
const previewNumber = process.env.REVIEW_ID ?? '';
const expectedPreviewNumber = '16';
const productionMarker = 'calm-jaguar-475';

const fail = (reason) => {
	console.error(`⛔ Convex Preview preflight refused: ${reason}`);
	process.exit(1);
};

if (context !== 'deploy-preview') {
	fail('Netlify CONTEXT must be exactly "deploy-preview". No Convex command was started.');
}
if (previewNumber !== expectedPreviewNumber) {
	fail(`Netlify REVIEW_ID must be exactly ${expectedPreviewNumber}. No Convex command was started.`);
}
if (!/^[0-9a-f]{40}$/i.test(requestedSha)) {
	fail('Netlify COMMIT_REF must be a full 40-character Git SHA. No Convex command was started.');
}
if (!key.startsWith('preview:')) {
	fail('CONVEX_DEPLOY_KEY must be a Preview Deploy Key. No Convex command was started.');
}
if (key.includes(productionMarker)) {
	fail('The deploy key contains the production deployment marker. No Convex command was started.');
}
// Convex injects PUBLIC_CONVEX_URL only inside its --cmd build. Before
// `convex deploy` it may be absent; validate it here only if Netlify supplied it.
if (url && !/\.convex\.cloud\/?$/.test(url)) {
	fail('PUBLIC_CONVEX_URL, when present, must be a Convex cloud URL. No Convex command was started.');
}
if (url.includes(productionMarker)) {
	fail('PUBLIC_CONVEX_URL points to production. No Convex command was started.');
}

// Do not print the key or its contents. Convex CLI enforces the Preview key's
// server-side scope; the explicit context and prefix checks fail closed here.
console.log(`✅ Convex Preview preflight passed (Deploy Preview #${expectedPreviewNumber}; SHA ${requestedSha}; key value hidden).`);
