#!/usr/bin/env node
/**
 * Garde-fou de déploiement : ce script refuse de déployer ailleurs qu'en
 * PRODUCTION sur Convex (calm-jaguar-475).
 *
 * Le déploiement cible est imposé par la clé CONVEX_DEPLOY_KEY : une clé
 * `prod:` ne peut pousser que vers le déploiement de production auquel elle
 * est rattachée. Ce script vérifie la clé avant d'appeler `convex deploy`,
 * puis affiche la cible réelle.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROD_NAME = 'calm-jaguar-475';

function loadEnvLocal() {
	const file = join(root, '.env.local');
	if (!existsSync(file)) return {};
	const env = {};
	for (const line of readFileSync(file, 'utf8').split('\n')) {
		const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (!match) continue;
		let value = match[2].trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		env[match[1]] = value;
	}
	return env;
}

const fail = (message) => {
	console.error(`⛔ ${message}`);
	process.exit(1);
};

const env = loadEnvLocal();
const key = env.CONVEX_DEPLOY_KEY ?? process.env.CONVEX_DEPLOY_KEY;
const publicUrl = env.PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL;

if (!key) {
	fail(
		'CONVEX_DEPLOY_KEY introuvable (ni dans .env.local ni dans l’environnement). ' +
			'Copie .env.example vers .env.local et complète la clé avant de déployer.'
	);
}
if (!key.startsWith('prod:')) {
	fail(
		'La clé CONVEX_DEPLOY_KEY n’est pas une clé de PRODUCTION (attendu : préfixe « prod: »). ' +
			'Déploiement annulé : on ne déploie jamais ailleurs qu’en production.'
	);
}
if (!key.includes(PROD_NAME)) {
	fail(
		`La clé cible un déploiement qui n’est pas « ${PROD_NAME} ». ` +
			'Déploiement annulé : le projet ne déploie qu’en production sur calm-jaguar-475.'
	);
}

console.log(`🚀 Déploiement PRODUCTION → ${publicUrl || `https://${PROD_NAME}.convex.cloud`}`);
console.log(`   (clé prod: ${PROD_NAME} présente, cible verrouillée)`);

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npx, ['convex', 'deploy', ...process.argv.slice(2)], {
	stdio: 'inherit',
	cwd: root,
	env: process.env,
});
process.exit(result.status ?? 1);
