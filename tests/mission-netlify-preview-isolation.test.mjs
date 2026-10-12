import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { previewDeployCommand, previewDeploymentName } from '../scripts/deploy-preview.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const netlify = readFileSync(join(root, 'netlify.toml'), 'utf8');
const deployScript = readFileSync(join(root, 'scripts/deploy-preview.mjs'), 'utf8');
const buildScript = readFileSync(join(root, 'scripts/build-preview.mjs'), 'utf8');

const validPr = { CONTEXT: 'deploy-preview', PULL_REQUEST: 'true', REVIEW_ID: '271', HEAD: 'ux/journal-alimentaire' };

test('un nom Convex distinct, stable et idempotent est dérivé de l’identifiant PR Netlify', () => {
	assert.equal(previewDeploymentName(validPr), 'barcode-lookup-pr-271');
	assert.equal(previewDeploymentName({ ...validPr, HEAD: 'fix/autre-branche' }), 'barcode-lookup-pr-271');
	assert.notEqual(previewDeploymentName(validPr), previewDeploymentName({ ...validPr, REVIEW_ID: '272' }));
	assert.notEqual(previewDeploymentName(validPr), 'barcode-lookup-preview');
});

test('le nom de preview fail-closed en dehors d’un Deploy Preview de PR vérifiable', () => {
	for (const context of ['production', 'branch-deploy', 'dev', '']) {
		assert.throws(() => previewDeploymentName({ ...validPr, CONTEXT: context }), /CONTEXT/);
	}
	assert.throws(() => previewDeploymentName({ ...validPr, PULL_REQUEST: 'false' }), /PULL_REQUEST/);
	assert.throws(() => previewDeploymentName({ ...validPr, PULL_REQUEST: undefined }), /PULL_REQUEST/);
	for (const reviewId of ['', '0', '-1', '12x', '1234567890', '01']) {
		assert.throws(() => previewDeploymentName({ ...validPr, REVIEW_ID: reviewId }), /REVIEW_ID/);
	}
	assert.throws(() => previewDeploymentName({ ...validPr, HEAD: 'main' }), /branche/);
});

test('la commande conserve le preview nommé et ne remet jamais à zéro un backend partagé', () => {
	const args = previewDeployCommand(validPr).join(' ');
	assert.match(args, /--preview-name=barcode-lookup-pr-271/);
	assert.doesNotMatch(args, /--preview-create|barcode-lookup-preview/);
	assert.match(args, /--preview-run=previewSeed:seedPreviewData/);
	assert.match(args, /--cmd-url-env-var-name PUBLIC_CONVEX_URL/);
	assert.match(args, /--cmd npm run build/);
	assert.doesNotMatch(deployScript, /process\.env\.PUBLIC_CONVEX_URL/);
	assert.match(netlify, /\[context\.deploy-preview\]/);
	assert.match(netlify, /node scripts\/deploy-preview\.mjs/);
	assert.doesNotMatch(netlify, /\[context\.branch-deploy\]/);
	const deployPreviewCommand = netlify.match(/\[context\.deploy-preview\][\s\S]*?command = \"([^\"]+)\"/)?.[1] ?? '';
	assert.doesNotMatch(deployPreviewCommand, /barcode-lookup-preview|--preview-create/);
	assert.match(deployScript, /CONTEXT !== 'deploy-preview'/);
	assert.match(deployScript, /PULL_REQUEST !== 'true'/);
	assert.match(deployScript, /REVIEW_ID/);
});

test('le build Preview vérifie aussi l’identité du backend avant embarquement', () => {
	assert.match(buildScript, /process\.env\.PULL_REQUEST !== 'true'/);
	assert.match(buildScript, /barcode-lookup-pr-\$\{reviewId\}/);
	assert.match(buildScript, /parsedPreviewUrl\.hostname !== `\$\{expectedPreviewName\}\.convex\.cloud`/);
	assert.match(buildScript, /parsedPreviewUrl\.protocol !== 'https:'/);
	assert.match(buildScript, /parsedPreviewUrl\.username/);
	assert.match(buildScript, /parsedPreviewUrl\.password/);
	assert.match(buildScript, /deployKey\.startsWith\('preview:'\)/);
});

test('le build Preview n’accepte que l’URL HTTPS canonique du déploiement de cette PR', () => {
	const directory = mkdtempSync(join(tmpdir(), 'gflux-preview-guard-'));
	const script = join(root, 'scripts/build-preview.mjs');
	const runGuard = (url) => spawnSync(process.execPath, [script], {
		cwd: directory,
		env: {
			...process.env,
			CONTEXT: 'deploy-preview',
			PULL_REQUEST: 'true',
			REVIEW_ID: '271',
			CONVEX_DEPLOY_KEY: 'preview:non-secret-test-value',
			PUBLIC_CONVEX_URL: url,
		},
		encoding: 'utf8',
	});
	try {
		const valid = runGuard('https://barcode-lookup-pr-271.convex.cloud');
		assert.equal(valid.status, 0, valid.stderr);
		for (const url of [
			'http://barcode-lookup-pr-271.convex.cloud',
			'https://barcode-lookup-pr-271.convex.site',
			'https://barcode-lookup-pr-271.convex.cloud.attacker.example',
			'https://barcode-lookup-pr-271.convex.cloud.evil',
			'https://user@barcode-lookup-pr-271.convex.cloud',
			'https://barcode-lookup-pr-271.convex.cloud/path',
			'https://calm-jaguar-475.eu-west-1.convex.cloud',
			'not a URL',
		]) {
			const result = runGuard(url);
			assert.notEqual(result.status, 0, `must reject ${url}`);
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
