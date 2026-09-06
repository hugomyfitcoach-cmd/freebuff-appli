#!/usr/bin/env node
/**
 * Crée le premier compte coach (une seule fois par déploiement).
 *
 * Lit COACH_EMAIL / COACH_PASSWORD / COACH_BOOTSTRAP_CODE dans .env.local,
 * puis appelle la fonction Convex users:bootstrapCoach — refusée dès qu'un
 * compte coach existe déjà (le code secret devient alors inutile).
 *
 * Usage : npm run setup:coach
 */
import { readFileSync, existsSync } from 'node:fs';
import { ConvexClient } from 'convex/browser';

const envFile = new URL('../.env.local', import.meta.url);
if (!existsSync(envFile)) {
	console.error('❌ .env.local introuvable. Copie .env.example → .env.local et remplis COACH_EMAIL, COACH_PASSWORD, COACH_BOOTSTRAP_CODE.');
	process.exit(1);
}

const env = {};
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
	const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
	if (m) env[m[1]] = m[2];
}

const email = env.COACH_EMAIL;
const password = env.COACH_PASSWORD;
const code = env.COACH_BOOTSTRAP_CODE;

if (!email || !password || !code) {
	console.error('❌ COACH_EMAIL, COACH_PASSWORD et COACH_BOOTSTRAP_CODE doivent être dans .env.local.');
	console.error('   (COACH_BOOTSTRAP_CODE doit aussi être posé côté Convex : npx convex env set COACH_BOOTSTRAP_CODE … --prod)');
	process.exit(1);
}

const url = env.PUBLIC_CONVEX_URL ?? 'https://calm-jaguar-475.eu-west-1.convex.cloud';
const client = new ConvexClient(url);

try {
	const res = await client.mutation('users:bootstrapCoach', {
		email,
		password,
		prenom: 'Hugo',
		code,
	});
	console.log(`✅ Compte coach créé : ${email}`);
	console.log('   Identifiants de connexion → /connexion puis /admin.');
	console.log(JSON.stringify(res));
} catch (e) {
	const data = e && typeof e === 'object' && e.data !== undefined ? e.data : e?.message ?? String(e);
	console.error(`❌ Impossible de créer le compte coach : ${data}`);
	console.error('   (Normal si un compte coach existe déjà — vérifie COACH_EMAIL/COACH_PASSWORD et connecte-toi.)');
	process.exitCode = 1;
} finally {
	await client.close();
}
