#!/usr/bin/env node
/**
 * Propagation des variables Convex vers l'environnement Preview — exécuté à la
 * fin de CHAQUE build Netlify de contexte preview (après `convex deploy`).
 *
 * POURQUOI : le backend preview doit être autonome à chaque build, sans geste
 * manuel au dashboard :
 *  1. CONVEX_BILLING_WEBHOOK_SECRET — le checkout/portal fail-closed sinon ;
 *  2. E2E_TEST_ACCOUNTS_ALLOWED=1 — autorise les comptes jetables E2E
 *     (@example.test) créés par scripts/e2e-*.mjs UNIQUEMENT sur ce
 *     déploiement isolé ; la production Convex ne l'a jamais, et
 *     src/convex/helpers.ts::assertE2eEmailAllowed y refuse donc tout @example.test.
 *
 * CIBLE : le déploiement preview DÉDIÉ à la PR courante
 * (`barcode-lookup-pr-<REVIEW_ID>`, même nom que scripts/deploy-preview.mjs).
 * Correctif : ce script visait l'ancien nom partagé `barcode-lookup-preview`,
 * qui n'est plus celui créé par deploy-preview.mjs — la variable n'arrivait
 * donc JAMAIS sur le backend réel de la PR.
 *
 * SÉCURITÉ :
 *  - n'agit QUE si CONVEX_DEPLOY_KEY est une Preview Deploy Key ("preview:") ;
 *    une clé prod/dev est ignorée (la prod calm-jaguar-475 reste hors de
 *    portée, quelles que soient les variables d'environnement) ;
 *  - le secret ne vit QUE chez Netlify et chez Convex, jamais dans Git ;
 *  - n'affiche JAMAIS la valeur du secret (ni erreurs, ni logs).
 */
import { spawnSync } from 'node:child_process';

const PROD_DEPLOYMENT = 'calm-jaguar-475';
const NAME_PREFIX = 'barcode-lookup-pr-';
const LEGACY_SHARED_NAME = 'barcode-lookup-preview';

const key = (process.env.CONVEX_DEPLOY_KEY ?? '').trim();
const secret = (process.env.CONVEX_BILLING_WEBHOOK_SECRET ?? '').trim();

if (!key.startsWith('preview:')) {
	console.warn(
		`→ [preview-env] ignoré : CONVEX_DEPLOY_KEY n'est pas une Preview Deploy Key ` +
			`(${key ? 'préfixe "' + key.split(':')[0] + ':"' : 'absente'}) — aucune écriture.`
	);
	process.exit(0);
}
if (key.includes(PROD_DEPLOYMENT)) {
	console.error(`⛔ [preview-env] refus : la clé semble viser la production (${PROD_DEPLOYMENT}).`);
	process.exit(1);
}

/** Même calcul que scripts/deploy-preview.mjs::previewDeploymentName. */
function previewDeploymentName(source = process.env) {
	const reviewId = (source.REVIEW_ID ?? '').trim();
	if (source.CONTEXT === 'deploy-preview' && source.PULL_REQUEST === 'true' && /^[1-9][0-9]{0,8}$/.test(reviewId)) {
		return `${NAME_PREFIX}${reviewId}`;
	}
	return null;
}

const perPrName = previewDeploymentName();
const targetName = perPrName ?? LEGACY_SHARED_NAME;
if (!perPrName && targetName === LEGACY_SHARED_NAME) {
	console.warn(`→ [preview-env] REVIEW_ID absente : cible du nom partagé legacy « ${targetName} » (contexte branches).`);
}

if (!secret) {
	console.warn(
		`→ [preview-env] ignoré : CONVEX_BILLING_WEBHOOK_SECRET absente de l'environnement Netlify ` +
			`(scope Deploy Previews) — à poser dans l'UI Netlify. Le reste continue.`
	);
}

const writes = [];
if (secret) writes.push(['CONVEX_BILLING_WEBHOOK_SECRET', secret]);
writes.push(['E2E_TEST_ACCOUNTS_ALLOWED', '1']);

for (const [name, value] of writes) {
	const res = spawnSync('npx', ['convex', 'env', 'set', name, value, '--preview-name', targetName], {
		stdio: 'inherit',
		env: { ...process.env, CONVEX_DEPLOY_KEY: key },
		shell: process.platform === 'win32',
	});
	if (res.status !== 0) {
		console.error(`⛔ [preview-env] échec de la pose de ${name} sur le Convex Preview « ${targetName} » (exit ${res.status}).`);
		process.exit(res.status ?? 1);
	}
	console.log(`✅ [preview-env] ${name} posée sur le Convex Preview « ${targetName} » (valeur masquée pour les secrets).`);
}
