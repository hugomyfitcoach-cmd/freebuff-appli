#!/usr/bin/env node
/**
 * Propagation des secrets vers le Convex Preview — exécuté à la FIN de
 * CHAQUE build Netlify de contexte preview (netlify.toml).
 *
 * POURQUOI : le netlify.toml utilise `convex deploy --preview-create`, qui
 * SUPPRIME ET RECRÉE le deployment preview à chaque build (état seedé propre,
 * voulu). Toute variable Convex posée à la main au dashboard serait effacée au
 * build suivant. Ce script réapplique depuis les variables Netlify du même nom
 * (scope Deploy Previews) — les valeurs ne vivent QUE chez Netlify et chez
 * Convex, jamais dans Git, jamais dans un fichier versionné.
 *
 * VARIABLES TRANSMISES :
 *  - CONVEX_BILLING_WEBHOOK_SECRET (facturation, comportement historique) ;
 *  - OPENAI_API_KEY + ASSISTANT_MODEL (Assistant G-FLUX — sans clé, l'IA
 *    renvoie un message d'erreur propre, tout le reste reste fonctionnel) ;
 *  - COACH_WHATSAPP, ASSISTANT_DISABLED, ASSISTANT_ALLOWLIST,
 *    ASSISTANT_TEXT_PER_DAY, ASSISTANT_VISION_PER_DAY (optionnels — ignorés
 *    s'ils ne sont pas posés chez Netlify).
 *
 * SÉCURITÉ :
 *  - n'agit QUE si CONVEX_DEPLOY_KEY est une Preview Deploy Key ("preview:") ;
 *    une clé prod/dev est ignorée (la prod calm-jaguar-475 reste hors de
 *    portée de ce script, quelles que soient les variables d'environnement) ;
 *  - n'affiche JAMAIS la valeur d'un secret (ni erreurs, ni logs) ;
 *  - une variable absente = simple avertissement, le build continue.
 */
import { spawnSync } from 'node:child_process';

const PREVIEW_NAME = 'alimentation-ia-preview';

/** Obligatoires (comportement historique) — leur absence est signalée. */
const REQUIRED = ['CONVEX_BILLING_WEBHOOK_SECRET'];
/** Transmises si présentes chez Netlify ; OPENAI_API_KEY est fortement conseillée. */
const OPTIONAL = [
	'OPENAI_API_KEY',
	'ASSISTANT_MODEL',
	'COACH_WHATSAPP',
	'ASSISTANT_DISABLED',
	'ASSISTANT_ALLOWLIST',
	'ASSISTANT_TEXT_PER_DAY',
	'ASSISTANT_VISION_PER_DAY',
	'PREVIEW_FOOD_TRACE',
];

const key = (process.env.CONVEX_DEPLOY_KEY ?? '').trim();

if (!key.startsWith('preview:')) {
	console.warn(
		`→ [preview-env] ignoré : CONVEX_DEPLOY_KEY n'est pas une Preview Deploy Key ` +
			`(${key ? 'préfixe "' + key.split(':')[0] + ':"' : 'absente'}) — aucune écriture.`
	);
	process.exit(0);
}

const toSet = [];
for (const name of REQUIRED) {
	const value = (process.env[name] ?? '').trim();
	if (!value) {
		console.warn(
			`→ [preview-env] ${name} absente de l'environnement Netlify (scope Deploy Previews) — ` +
				`à poser dans l'UI Netlify, le build continue (l'app reste fail-closed).`
		);
		continue;
	}
	toSet.push([name, value]);
}
for (const name of OPTIONAL) {
	const value = (process.env[name] ?? '').trim();
	if (!value) continue;
	if (name === 'OPENAI_API_KEY') {
		// jamais la longueur ni le début : uniquement la présence.
		console.log(`→ [preview-env] OPENAI_API_KEY détectée (valeur masquée) — transmise au Convex Preview.`);
	}
	toSet.push([name, value]);
}
if (!toSet.some(([n]) => n === 'OPENAI_API_KEY')) {
	console.warn(
		'→ [preview-env] OPENAI_API_KEY absente chez Netlify : l’Assistant affichera un message ' +
			'd’erreur propre côté preview (aucun autre impact — Journal, recherche, scan restent fonctionnels).'
	);
}

let failed = 0;
for (const [name, value] of toSet) {
	const res = spawnSync('npx', ['convex', 'env', 'set', name, value, '--preview-name', PREVIEW_NAME], {
		stdio: ['ignore', 'inherit', 'inherit'],
		env: { ...process.env, CONVEX_DEPLOY_KEY: key },
		shell: process.platform === 'win32',
	});
	if (res.status !== 0) {
		// CONVEX_BILLING_WEBHOOK_SECRET reste bloquant (comportement historique) ;
		// les variables Assistant ne font que prévenir (dégradation propre).
		console.error(`⛔ [preview-env] échec de la pose de ${name} sur le Convex Preview « ${PREVIEW_NAME} » (exit ${res.status}).`);
		if (REQUIRED.includes(name)) failed = res.status ?? 1;
	}
}
if (failed) process.exit(failed);
console.log(
	`✅ [preview-env] ${toSet.length} variable(s) posée(s) sur le Convex Preview « ${PREVIEW_NAME} » (valeurs masquées).`
);
