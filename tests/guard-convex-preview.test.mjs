import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const guard = new URL('../scripts/guard-convex-preview.mjs', import.meta.url);
const guardPath = decodeURIComponent(guard.pathname);
const run = (env) => spawnSync(process.execPath, [guardPath], { encoding: 'utf8', env: { ...process.env, ...env } });
const previewEnv = (overrides = {}) => ({ CONTEXT: 'deploy-preview', CONVEX_DEPLOY_KEY: 'preview:fake', PUBLIC_CONVEX_URL: 'https://canny-labrador-100.eu-west-1.convex.cloud', ...overrides });

test('preflight: rejects missing and non-Deploy-Preview Netlify contexts', () => {
	for (const context of ['', 'production', 'branch-deploy']) {
		const result = run({ CONTEXT: context, CONVEX_DEPLOY_KEY: 'preview:fake' });
		assert.notEqual(result.status, 0, `context ${context || '(absent)'} rejected`);
	}
});

test('preflight: rejects missing and non-Deploy-Preview contexts, malformed URL, prod key and prod URL', () => {
	const missingContext = run({ CONVEX_DEPLOY_KEY: 'preview:fake', PUBLIC_CONVEX_URL: 'https://canny-labrador-100.eu-west-1.convex.cloud' });
	assert.notEqual(missingContext.status, 0);
	const wrongContext = run(previewEnv({ CONTEXT: 'production' }));
	assert.notEqual(wrongContext.status, 0);
	const missingKey = run(previewEnv({ CONVEX_DEPLOY_KEY: '' }));
	assert.notEqual(missingKey.status, 0);
	const malformedUrl = run(previewEnv({ PUBLIC_CONVEX_URL: 'https://example.com' }));
	assert.notEqual(malformedUrl.status, 0);
	const prodKey = run(previewEnv({ CONVEX_DEPLOY_KEY: 'prod:fake' }));
	assert.notEqual(prodKey.status, 0);
	const prodUrl = run(previewEnv({ PUBLIC_CONVEX_URL: 'https://calm-jaguar-475.eu-west-1.convex.cloud' }));
	assert.notEqual(prodUrl.status, 0);
});

test('preflight: accepts a Deploy Preview key without exposing it or reading .env.local', () => {
	const result = run(previewEnv({ CONVEX_DEPLOY_KEY: 'preview:fictional-secret' }));
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /preflight passed/);
	assert.doesNotMatch(result.stdout + result.stderr, /fictional-secret/);
	const source = readFileSync(guard, 'utf8');
	assert.doesNotMatch(source, /readFileSync|existsSync/);
	assert.doesNotMatch(source, /\.env\\.local/);
});

test('build-preview refuses bad deploy keys before producing a frontend build and ignores local env files', () => {
	const buildScript = fileURLToPath(new URL('../scripts/build-preview.mjs', import.meta.url));
	const runBuild = ({ key, url, localEnv = '', preflight = false }) => {
		const cwd = mkdtempSync(join(tmpdir(), 'gflux-build-preview-'));
		try {
			if (localEnv) writeFileSync(join(cwd, '.env.local'), localEnv);
		const env = { ...process.env, CONTEXT: 'deploy-preview' };
		delete env.CONVEX_DEPLOY_KEY;
		delete env.PUBLIC_CONVEX_URL;
		if (key !== undefined) env.CONVEX_DEPLOY_KEY = key;
		if (url !== undefined) env.PUBLIC_CONVEX_URL = url;
			const result = spawnSync(process.execPath, [buildScript, ...(preflight ? ['--preflight'] : [])], { cwd, env, encoding: 'utf8' });
			return { ...result, generatedEnv: existsSync(join(cwd, '.env.production')) ? readFileSync(join(cwd, '.env.production'), 'utf8') : null };
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	};

	const localProdFallback = runBuild({
		localEnv: 'CONVEX_DEPLOY_KEY=prod:fictional-local-secret\nPUBLIC_CONVEX_URL=https://calm-jaguar-475.eu-west-1.convex.cloud\n',
	});
	assert.notEqual(localProdFallback.status, 0);
	assert.equal(localProdFallback.generatedEnv, null);
	assert.doesNotMatch(localProdFallback.stdout + localProdFallback.stderr, /fictional-local-secret/);

	const localProdPreflight = runBuild({
		preflight: true,
		localEnv: 'CONVEX_DEPLOY_KEY=prod:fictional-local-secret\\nPUBLIC_CONVEX_URL=https://calm-jaguar-475.eu-west-1.convex.cloud\\n',
	});
	assert.notEqual(localProdPreflight.status, 0);
	assert.equal(localProdPreflight.generatedEnv, null);
	assert.doesNotMatch(localProdPreflight.stdout + localProdPreflight.stderr, /fictional-local-secret/);

	const prodKey = runBuild({ key: 'prod:fictional-secret', url: 'https://canny-labrador-100.eu-west-1.convex.cloud' });
	assert.notEqual(prodKey.status, 0);
	assert.equal(prodKey.generatedEnv, null);
	assert.doesNotMatch(prodKey.stdout + prodKey.stderr, /fictional-secret/);

	const prodUrl = runBuild({ key: 'preview:fictional-secret', url: 'https://calm-jaguar-475.eu-west-1.convex.cloud' });
	assert.notEqual(prodUrl.status, 0);
	assert.equal(prodUrl.generatedEnv, null);

	const accepted = runBuild({ key: 'preview:fictional-secret', url: 'https://canny-labrador-100.eu-west-1.convex.cloud' });
	assert.equal(accepted.status, 0, accepted.stderr);
	assert.match(accepted.generatedEnv, /PUBLIC_CONVEX_URL=https:\/\/canny-labrador-100/);
	assert.doesNotMatch(accepted.generatedEnv, /fictional-secret/);

	const previewPreflight = runBuild({ key: 'preview:fictional-secret', preflight: true });
	assert.equal(previewPreflight.status, 0, previewPreflight.stderr);
	assert.equal(previewPreflight.generatedEnv, null, 'preflight ne crée ni fichier build ni artefact');
});

test('Netlify runs the preflight immediately before Convex deploy, only in Deploy Previews', () => {
	const config = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
	const deployPreview = config.match(/\[context\.deploy-preview\][\s\S]*?command = "([^"]+)"/)?.[1] ?? '';
	const branchDeploy = config.match(/\[context\.branch-deploy\][\s\S]*?command = "([^"]+)"/)?.[1] ?? '';
	assert.match(deployPreview, /^node scripts\/guard-convex-preview\.mjs && node scripts\/build-preview\.mjs --preflight && npx convex deploy/);
	assert.match(deployPreview, /--preview-create alimentation-ia-preview --preview-run previewSeed:seedPreviewData/);
	assert.match(deployPreview, /--cmd-url-env-var-name PUBLIC_CONVEX_URL/);
	assert.match(deployPreview, /--cmd 'npm run build'/);
	assert.ok(deployPreview.indexOf('scripts/build-preview.mjs --preflight') < deployPreview.indexOf('convex deploy'));
	assert.match(config, /command = "node scripts\/guard-convex-preview\.mjs && node scripts\/build-preview\.mjs --preflight/);
	assert.doesNotMatch(branchDeploy, /convex deploy/);
});
