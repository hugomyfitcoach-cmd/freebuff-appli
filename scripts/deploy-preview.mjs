#!/usr/bin/env node
/**
 * Déploiement Convex uniquement pour un vrai Netlify Deploy Preview de PR.
 * Un nom stable par PR conserve les données lors des updates et n'entre jamais
 * en collision avec les previews historiques/partagés.
 */
import { spawnSync } from 'node:child_process';

const PROD_DEPLOYMENT = 'calm-jaguar-475';
const NAME_PREFIX = 'barcode-lookup-pr-';
const PREVIEW_RUN = 'previewSeed:seedPreviewData';

export function previewDeploymentName(source = process.env) {
	if (source.CONTEXT !== 'deploy-preview') {
		throw new Error('Refus : CONTEXT doit être exactement « deploy-preview ».');
	}
	if (source.PULL_REQUEST !== 'true') {
		throw new Error('Refus : PULL_REQUEST doit être exactement « true ».');
	}
	const reviewId = source.REVIEW_ID ?? '';
	if (!/^[1-9][0-9]{0,8}$/.test(reviewId)) {
		throw new Error('Refus : REVIEW_ID doit être un numéro de PR Netlify valide.');
	}
	const branch = source.HEAD ?? source.BRANCH ?? '';
	if (!branch || branch === 'main') {
		throw new Error('Refus : impossible de valider la branche source de la PR.');
	}
	return `${NAME_PREFIX}${reviewId}`;
}

export function previewDeployCommand(source = process.env) {
	const name = previewDeploymentName(source);
	return [
		'convex', 'deploy', `--preview-name=${name}`,
		`--preview-run=${PREVIEW_RUN}`,
		'--cmd-url-env-var-name', 'PUBLIC_CONVEX_URL',
		'--cmd', 'npm run build',
	];
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: 'inherit', ...options });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} échoué (exit ${result.status ?? 'inconnu'}).`);
	}
}

function buildLocally() {
	const env = { ...process.env };
	delete env.CONVEX_DEPLOY_KEY;
	delete env.CONVEX_DEPLOYMENT;
	env.CONTEXT = 'dev';
	const result = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', env });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`Build local inerte échoué (exit ${result.status ?? 'inconnu'}).`);
}

async function main() {
	if (process.env.CONTEXT === undefined || process.env.CONTEXT === 'dev') {
		buildLocally();
		return;
	}
	const name = previewDeploymentName(process.env);
	const deployKey = (process.env.CONVEX_DEPLOY_KEY ?? '').trim();
	if (!deployKey.startsWith('preview:')) {
		throw new Error('Refus : CONVEX_DEPLOY_KEY doit être une Preview Deploy Key.');
	}
	if (deployKey.includes(PROD_DEPLOYMENT)) {
		throw new Error('Refus : la clé Convex semble viser la production.');
	}
	const args = previewDeployCommand(process.env);
	console.log(`→ Convex Preview isolé pour ${name}; le seed s’exécute uniquement à la première création.`);
	// Convex transmet PUBLIC_CONVEX_URL au processus --cmd (npm run build),
	// pas à ce processus parent. build-preview.mjs vérifie l'URL et refuse le
	// build avant tout embarquement si son nom ne correspond pas à cette PR.
	run('npx', args);
	console.log(`✅ Déploiement Convex Preview et build validés pour ${name}.`);
}

if (process.argv[1] && decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
	main().catch((error) => {
		console.error(`⛔ ${error.message}`);
		process.exitCode = 1;
	});
}
