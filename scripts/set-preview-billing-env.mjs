#!/usr/bin/env node
/**
 * Propagation du secret de facturation vers le Convex Preview — exécuté au
 * début de CHAQUE build Netlify de contexte preview (avant `convex deploy`).
 *
 * POURQUOI : le netlify.toml utilise `convex deploy --preview-create`, qui
 * SUPPRIME ET RECRÉE le deployment preview à chaque build (état seedé propre,
 * voulu). Toute variable d'environnement Convex posée à la main au dashboard
 * serait donc effacée au build suivant. Ce script réapplique
 * CONVEX_BILLING_WEBHOOK_SECRET depuis la variable Netlify du même nom
 * (scope Deploy Previews) — la valeur ne vit QUE chez Netlify et chez Convex,
 * jamais dans Git, jamais dans un fichier versionné.
 *
 * SÉCURITÉ :
 *  - n'agit QUE si CONVEX_DEPLOY_KEY est une Preview Deploy Key ("preview:") ;
 *    une clé prod/dev est ignorée (la prod calm-jaguar-475 reste hors de
 *    portée de ce script, quelles que soient les variables d'environnement) ;
 *  - n'agit QUE si CONVEX_BILLING_WEBHOOK_SECRET est fournie (sinon simple
 *    avertissement et le build continue — l'app reste fail-closed) ;
 *  - n'affiche JAMAIS la valeur du secret (ni erreurs, ni logs).
 */
import { spawnSync } from 'node:child_process';

const SECRET_NAME = 'CONVEX_BILLING_WEBHOOK_SECRET';
const PREVIEW_NAME = 'alimentation-ia-preview';

const key = (process.env.CONVEX_DEPLOY_KEY ?? '').trim();
const secret = (process.env[SECRET_NAME] ?? '').trim();

if (!key.startsWith('preview:')) {
	console.warn(
		`→ [billing-env] ignoré : CONVEX_DEPLOY_KEY n'est pas une Preview Deploy Key ` +
			`(${key ? 'préfixe "' + key.split(':')[0] + ':"' : 'absente'}) — aucune écriture.`
	);
	process.exit(0);
}
if (!secret) {
	console.warn(
		`→ [billing-env] ignoré : ${SECRET_NAME} absente de l'environnement Netlify ` +
			`(scope Deploy Previews) — à poser dans l'UI Netlify, le build continue.`
	);
	process.exit(0);
}

const res = spawnSync(
	'npx',
	['convex', 'env', 'set', SECRET_NAME, secret, '--preview-name', PREVIEW_NAME],
	{
		stdio: 'inherit',
		env: { ...process.env, CONVEX_DEPLOY_KEY: key },
		shell: process.platform === 'win32',
	}
);
if (res.status !== 0) {
	console.error(
		`⛔ [billing-env] échec de la pose de ${SECRET_NAME} sur le Convex Preview ` +
			`« ${PREVIEW_NAME} » (exit ${res.status}).`
	);
	process.exit(res.status ?? 1);
}
console.log(`✅ [billing-env] ${SECRET_NAME} posée sur le Convex Preview « ${PREVIEW_NAME} » (valeur masquée).`);
