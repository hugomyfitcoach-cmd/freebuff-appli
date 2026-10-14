import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { netlifyConfigImpact, netlifyPreviewCommands, previewEnvironment, parsePorcelainPaths } from '../scripts/ux-mission.mjs';

test('local preview clears deploy credentials and forces loopback Convex URLs', () => {
	const safeEnv = previewEnvironment({
		CONTEXT: 'production',
		CONVEX_DEPLOY_KEY: 'prod:must-not-pass',
		PUBLIC_CONVEX_URL: 'https://calm-jaguar-475.eu-west-1.convex.cloud',
		PUBLIC_CONVEX_SITE_URL: 'https://calm-jaguar-475.eu-west-1.convex.site',
		OTHER_SETTING: 'kept',
	});
	assert.equal(safeEnv.CONTEXT, 'dev');
	assert.equal(safeEnv.CONVEX_DEPLOY_KEY, '');
	assert.equal(safeEnv.PUBLIC_CONVEX_URL, 'http://127.0.0.1:3210');
	assert.equal(safeEnv.PUBLIC_CONVEX_SITE_URL, 'http://127.0.0.1:3211');
	assert.equal(safeEnv.OTHER_SETTING, 'kept');
});

test('Netlify preview parser reads Deploy and Branch Deploy commands with quoted Convex actions', () => {
	const config = `# ignored comments\n[context.deploy-preview]\n  command = "npx convex deploy --preview-create unique --cmd 'npm run build'"\n\n[context.deploy-preview.environment]\n  PREVIEW_DIAG = "1"\n[context.branch-deploy]\n  command = "npm run build"\n`;
	assert.deepEqual(netlifyPreviewCommands(config), [
		{ context: 'deploy-preview', command: "npx convex deploy --preview-create unique --cmd 'npm run build'" },
		{ context: 'branch-deploy', command: 'npm run build' },
	]);
	const sameContextSubtable = config.replace('\n  command = "npm run build"', '\n  command = "npm run build"\n[context.branch-deploy.environment]\n  FLAG = "1"');
	assert.equal(netlifyPreviewCommands(sameContextSubtable)[1].command, 'npm run build', 'keep parsing through nested context subtables');
	assert.deepEqual(netlifyConfigImpact(config), [
		{ context: 'deploy-preview', usesConvex: true, previewName: 'unique', resetsBackend: true },
		{ context: 'branch-deploy', usesConvex: false, previewName: null, resetsBackend: false },
	]);
});

test('start audits PR commits and dirty assistant worktree before creating; then starts from origin/main', () => {
	const dir = mkdtempSync(join(tmpdir(), 'ux-mission-git-'));
	const seed = join(dir, 'seed');
	const remote = join(dir, 'origin.git');
	const assistantWorktree = join(dir, 'assistant-worktree');
	const bin = join(dir, 'bin');
	const script = fileURLToPath(new URL('../scripts/ux-mission.mjs', import.meta.url));
	const git = (...args) => {
		const result = spawnSync('git', args, { cwd: seed, encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};
	try {
		mkdirSync(seed);
		mkdirSync(bin);
		git('init', '-b', 'main');
		git('config', 'user.name', 'UX workflow test');
		git('config', 'user.email', 'ux-test@example.invalid');
		git('config', 'core.excludesfile', join(dir, 'root-excludes'));
		writeFileSync(join(dir, 'root-excludes'), '.env.local\n');
		writeFileSync(join(seed, 'README.md'), 'safe fixture\n');
		git('add', 'README.md');
		git('commit', '-m', 'fixture main');
		const clone = spawnSync('git', ['clone', '--bare', seed, remote], { cwd: dir, encoding: 'utf8' });
		assert.equal(clone.status, 0, clone.stderr);
		git('remote', 'add', 'origin', remote);
		git('push', '-u', 'origin', 'main');
		git('switch', '-c', 'feat/assistant-gflux-v1');
		writeFileSync(join(seed, 'assistant-committed.txt'), 'PR commit\n');
		git('add', 'assistant-committed.txt');
		git('commit', '-m', 'assistant change');
		git('switch', 'main');
		git('worktree', 'add', assistantWorktree, 'feat/assistant-gflux-v1');
		writeFileSync(join(assistantWorktree, 'assistant-local.txt'), 'uncommitted PR work\n');
		writeFileSync(join(assistantWorktree, 'assistant-ignored.txt'), 'ignored PR work\n');
		const assistantIgnore = spawnSync('git', ['-C', assistantWorktree, 'config', 'core.excludesfile', join(dir, 'global-excludes')], { encoding: 'utf8' });
		assert.equal(assistantIgnore.status, 0, assistantIgnore.stderr);
		writeFileSync(join(dir, 'global-excludes'), 'assistant-ignored.txt\n');
		const gh = join(bin, 'gh');
		writeFileSync(gh, '#!/bin/sh\nif [ "$2" = "view" ]; then echo \'{"headRefName":"feat/assistant-gflux-v1","state":"OPEN","baseRefName":"main"}\'; else echo assistant-committed.txt; fi\n');
		chmodSync(gh, 0o755);
		const npm = join(bin, 'npm');
		writeFileSync(npm, '#!/bin/sh\nexit 0\n');
		chmodSync(npm, 0o755);
		const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
		const invoke = (slug, file) => spawnSync(process.execPath, [script, 'start', slug, '--files', file], { cwd: seed, encoding: 'utf8', env });

		const mainSha = git('rev-parse', 'HEAD');
		writeFileSync(join(seed, '.env.local'), 'local secret must be left alone\n');
		const protectedIgnored = invoke('ignored-local', 'src/ux-only.svelte');
		assert.equal(protectedIgnored.status, 0, protectedIgnored.stderr + protectedIgnored.stdout);
		assert.equal(readFileSync(join(seed, '.env.local'), 'utf8'), 'local secret must be left alone\n');
		rmSync(join(seed, '.env.local'));
		writeFileSync(join(seed, 'user-local-change.txt'), 'must be preserved\n');
		const protectedLocal = invoke('local-change', 'user-local-change.txt');
		assert.notEqual(protectedLocal.status, 0);
		assert.match(protectedLocal.stderr, /modifications locales/);
		assert.equal(spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/ux/local-change'], { cwd: seed }).status, 1);
		rmSync(join(seed, 'user-local-change.txt'));
		assert.equal(git('rev-parse', 'HEAD'), mainSha, 'start must not move or modify main');

		const ignoredCollision = invoke('blocked-ignored', 'assistant-ignored.txt');
		assert.notEqual(ignoredCollision.status, 0);
		assert.match(ignoredCollision.stderr, /assistant-ignored\.txt/);
		const collision = invoke('blocked', 'assistant-local.txt');
		assert.notEqual(collision.status, 0);
		assert.match(collision.stderr, /assistant-local\.txt/);
		assert.equal(spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/ux/blocked'], { cwd: seed }).status, 1);
		assert.equal(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: seed }).stdout.includes('ux-blocked'), false);

		rmSync(join(assistantWorktree, 'assistant-local.txt'));
		rmSync(join(assistantWorktree, 'assistant-ignored.txt'));
		const started = invoke('safe-visual-change', 'src/ux-only.svelte');
		assert.equal(started.status, 0, started.stderr + started.stdout);
		const worktree = join(seed, '.freebuff', 'worktrees', 'ux-safe-visual-change');
		assert.equal(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, encoding: 'utf8' }).stdout.trim(),
			spawnSync('git', ['rev-parse', 'origin/main'], { cwd: seed, encoding: 'utf8' }).stdout.trim());
		assert.equal(spawnSync('git', ['branch', '--show-current'], { cwd: worktree, encoding: 'utf8' }).stdout.trim(), 'ux/safe-visual-change');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('git porcelain parser preserves spaced paths, renames, and untracked paths', () => {
	const status = ' M src/lib/a file.svelte\0?? new file.txt\0R  old-name\0new-name\0!! ignored-secret.env\0';
	assert.deepEqual([...parsePorcelainPaths(status)], [
		'src/lib/a file.svelte',
		'new file.txt',
		'old-name',
		'new-name',
		'ignored-secret.env',
	]);
});
