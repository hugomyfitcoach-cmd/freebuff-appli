#!/usr/bin/env node
/** Local-only workflow for independent G-FLUX UX/fix missions. Never pushes or deploys. */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSISTANT_PR = '16';
const ASSISTANT_BRANCH = 'feat/assistant-gflux-v1';
const LOCAL_CONVEX_URL = 'http://127.0.0.1:3210';
const LOCAL_CONVEX_SITE_URL = 'http://127.0.0.1:3211';

function run(file, args, cwd, { inherit = false, env = process.env } = {}) {
	const result = spawnSync(file, args, { cwd, encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe', env });
	if (result.error) throw result.error;
	return result;
}

function checked(file, args, cwd, options) {
	const result = run(file, args, cwd, options);
	if (result.status !== 0) {
		const output = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
		throw new Error(`${file} ${args.join(' ')} failed${output ? `:\n${output}` : ` (exit ${result.status ?? 'unknown'})`}`);
	}
	return result.stdout ?? '';
}

function git(root, ...args) {
	return checked('git', args, root).trim();
}

function rootFrom(cwd) {
	return git(cwd, 'rev-parse', '--show-toplevel');
}

function fetchOriginMain(root) {
	console.log('→ Fetch origin/main…');
	checked('git', ['fetch', '--no-tags', 'origin', 'main'], root, { inherit: true });
	const sha = git(root, 'rev-parse', 'origin/main');
	console.log(`✅ origin/main actualisée : ${sha}`);
	return sha;
}

function normalizePath(value) {
	const path = value.replaceAll('\\', '/').replace(/^\.\//, '');
	if (!path || path.startsWith('/') || path.split('/').includes('..')) {
		throw new Error(`Chemin relatif au dépôt invalide : ${value}`);
	}
	return path;
}

/** Parse NUL-delimited `git status --porcelain -z`, including paths with spaces and renames. */
export function parsePorcelainPaths(output) {
	const entries = output.split('\0').filter(Boolean);
	const paths = new Set();
	for (let i = 0; i < entries.length; i += 1) {
		const entry = entries[i];
		if (entry.length < 4 || (entry[2] !== ' ' && entry.slice(0, 2) !== '!!')) continue;
		paths.add(entry.slice(3));
		if (/[RC]/.test(entry.slice(0, 2)) && entries[i + 1]) paths.add(entries[++i]);
	}
	return paths;
}

function dirtyPaths(root, cwd = root, includeIgnored = false) {
	const args = ['status', '--porcelain=v1', '-z', '--untracked-files=all'];
	if (includeIgnored) args.push('--ignored=matching');
	return parsePorcelainPaths(checked('git', args, cwd));
}

export function netlifyConfigImpact(config) {
	const commands = netlifyPreviewCommands(config);
	return commands.map(({ context, command }) => ({
		context,
		usesConvex: /\bconvex\s+deploy\b/.test(command),
		previewName: command.match(/--preview-(?:create|name)\s+([^\s]+)/)?.[1] ?? null,
		resetsBackend: /--preview-create\b/.test(command),
	}));
}

function assistantInfo(root) {
	const info = JSON.parse(checked('gh', ['pr', 'view', ASSISTANT_PR, '--json', 'headRefName,state,baseRefName'], root));
	if (info.state !== 'OPEN' || info.baseRefName !== 'main') {
		throw new Error(`PR #${ASSISTANT_PR} n’est plus une PR ouverte vers main; audit interrompu.`);
	}
	const branch = info.headRefName;
	const prDiff = run('gh', ['pr', 'diff', ASSISTANT_PR, '--name-only'], root);
	if (prDiff.status !== 0) {
		throw new Error(`Impossible de lire le périmètre distant de PR #${ASSISTANT_PR}; refus fail-closed${prDiff.stderr ? ` : ${prDiff.stderr.trim()}` : '.'}`);
	}
	const paths = new Set((prDiff.stdout ?? '')
		.split(/\r?\n/).map((path) => path.trim()).filter(Boolean).map(normalizePath));

	// If the PR head is unavailable locally, GitHub's verified diff remains the
	// source for commits; local delta is added when its ref exists.
	const localHead = run('git', ['rev-parse', '--verify', branch], root);
	if (localHead.status === 0) {
		const base = git(root, 'merge-base', 'origin/main', branch);
		checked('git', ['diff', '--name-only', `${base}...${branch}`], root)
			.split(/\r?\n/).filter(Boolean).forEach((path) => paths.add(normalizePath(path)));
	} else if (localHead.status !== 128) {
		throw new Error(`Impossible de vérifier la branche locale ${branch}; audit refusé.`);
	}

	// Add staged, unstaged, untracked, and ignored local files from the actual PR worktree.
	const worktrees = checked('git', ['worktree', 'list', '--porcelain'], root);
	for (const block of worktrees.split(/\n\n/)) {
		const path = block.match(/^worktree (.+)$/m)?.[1];
		const head = block.match(/^branch refs\/heads\/(.+)$/m)?.[1];
		if (path && head === branch) {
			for (const dirtyPath of dirtyPaths(root, path, true)) paths.add(normalizePath(dirtyPath));
		}
	}
	return { branch, paths };
}

function auditFiles(candidates, assistant) {
	const overlaps = [...new Set(candidates.map(normalizePath))].filter((path) => assistant.paths.has(path)).sort();
	console.log(`PR #${ASSISTANT_PR} (${assistant.branch}) : ${assistant.paths.size} fichier(s), commits distants/locaux et modifications non commitées.`);
	if (overlaps.length) {
		console.error('⛔ Fichiers communs détectés :');
		overlaps.forEach((path) => console.error(`  - ${path}`));
		return false;
	}
	console.log(`✅ Aucun chevauchement parmi ${candidates.length} fichier(s) envisagé(s).`);
	return true;
}

function parseFiles(args) {
	const marker = args.indexOf('--files');
	if (marker < 0 || marker === args.length - 1) {
		throw new Error('Indique les fichiers envisagés : --files <chemin> [autre-chemin…].');
	}
	return args.slice(marker + 1).map(normalizePath);
}

function assertMissionWorktree(root) {
	const branch = git(root, 'branch', '--show-current');
	if (!/^(ux|fix)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(branch) || branch === ASSISTANT_BRANCH || branch === 'main') {
		throw new Error(`Commande réservée à une branche ux/<sujet> ou fix/<sujet> (actuelle : ${branch || 'détachée'}).`);
	}
	const worktrees = checked('git', ['worktree', 'list', '--porcelain'], root);
	for (const block of worktrees.split(/\n\n/)) {
		const path = block.match(/^worktree (.+)$/m)?.[1];
		const head = block.match(/^branch refs\/heads\/(.+)$/m)?.[1];
		if (path && head === ASSISTANT_BRANCH && resolve(path) === resolve(root)) {
			throw new Error(`Refus : le worktree assistant PR #${ASSISTANT_PR} est protégé.`);
		}
	}
	return branch;
}

function safeLocalEnv() {
	return {
		...process.env,
		CONTEXT: 'dev',
		CONVEX_DEPLOY_KEY: '',
		PUBLIC_CONVEX_URL: LOCAL_CONVEX_URL,
		PUBLIC_CONVEX_SITE_URL: LOCAL_CONVEX_SITE_URL,
	};
}

export function previewEnvironment(source = process.env) {
	return {
		...source,
		CONTEXT: 'dev',
		CONVEX_DEPLOY_KEY: '',
		PUBLIC_CONVEX_URL: LOCAL_CONVEX_URL,
		PUBLIC_CONVEX_SITE_URL: LOCAL_CONVEX_SITE_URL,
	};
}

/** Read preview build commands directly from the exact Netlify context sections. */
export function netlifyPreviewCommands(config) {
	const lines = config.split(/\r?\n/);
	const commands = [];
	for (const context of ['deploy-preview', 'branch-deploy']) {
		const start = lines.findIndex((line) => line.trim() === `[context.${context}]`);
		if (start < 0) continue;
		const section = [];
		for (const line of lines.slice(start + 1)) {
			const heading = line.match(/^\s*\[([^\]]+)\]/)?.[1];
			if (heading && !heading.startsWith(`context.${context}.`)) break;
			section.push(line);
		}
		const command = section.join('\n').match(/^\s*command\s*=\s*"([^"]+)"/m)?.[1];
		if (command) commands.push({ context, command });
	}
	return commands;
}

function reportNetlifyPreview(root) {
	const file = resolve(root, 'netlify.toml');
	if (!existsSync(file)) {
		console.log('⚠️ netlify.toml absent : contrôle manuel des paramètres Netlify requis avant push.');
		return;
	}
	const impact = netlifyConfigImpact(readFileSync(file, 'utf8'));
	if (!impact.length) {
		console.log('⚠️ Aucun command Deploy Preview / branch-deploy trouvé. Vérifie les paramètres Netlify du site avant push.');
		return;
	}
	for (const { context, usesConvex, previewName, resetsBackend } of impact) {
		if (!usesConvex) {
			console.log(`✅ Netlify ${context} : aucune commande convex deploy dans netlify.toml.`);
			continue;
		}
		console.log(`⚠️ Netlify ${context} lance Convex Preview « ${previewName ?? 'nom non détecté'} »${resetsBackend ? ' avec --preview-create (suppression/recréation et reset des données)' : ''}.`);
		console.log('   N’effectue aucune écriture de test avant confirmation que ce backend est isolé de PR #16 et dédié à cette PR.');
	}
	console.log('   netlify.toml ne révèle pas les variables/secrets ni les overrides réglés dans l’interface Netlify : les contrôler séparément.');
}

function start(root, args) {
	const slug = args[0];
	if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
		throw new Error('Usage : start <sujet-en-kebab-case> --files <chemin> [autre-chemin…].');
	}
	const candidates = parseFiles(args.slice(1));
	const currentBranch = git(root, 'branch', '--show-current');
	if (currentBranch === ASSISTANT_BRANCH) throw new Error(`Refus : démarre depuis un worktree de préparation, pas celui de PR #${ASSISTANT_PR}.`);
	if (currentBranch !== 'main') throw new Error(`Refus : start doit être lancé depuis le worktree main propre (actuel : ${currentBranch}).`);
	const localPaths = dirtyPaths(root, root, true);
	const localCollisions = [...new Set(candidates)].filter((path) => localPaths.has(path));
	if (localCollisions.length) {
		throw new Error(`Refus : les fichiers envisagés ont déjà des modifications locales sur main; elles restent intactes : ${localCollisions.join(', ')}.`);
	}

	const baseSha = fetchOriginMain(root);
	const activeMain = git(root, 'rev-parse', 'main');
	if (activeMain !== baseSha) {
		throw new Error(`Refus : main (${activeMain}) n’est pas alignée sur origin/main (${baseSha}); vérifie la synchronisation sans déplacer main.`);
	}
	const assistant = assistantInfo(root);
	if (!auditFiles(candidates, assistant)) throw new Error('Mission annulée avant création de branche/worktree à cause du chevauchement.');

	const branch = `ux/${slug}`;
	const worktree = resolve(root, '.freebuff', 'worktrees', `ux-${slug}`);
	const rel = relative(root, worktree);
	if (rel === '..' || rel.startsWith(`..${sep}`) || existsSync(worktree)) {
		throw new Error(`Chemin déjà existant ou hors du dépôt : ${worktree}; rien n’a été modifié.`);
	}
	const registered = checked('git', ['worktree', 'list', '--porcelain'], root);
	if (registered.split(/\n\n/).some((block) => resolve(block.match(/^worktree (.+)$/m)?.[1] ?? '') === resolve(worktree))) {
		throw new Error(`Git a déjà enregistré ce worktree : ${worktree}.`);
	}
	const existingBranch = run('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], root);
	if (existingBranch.status === 0) throw new Error(`La branche ${branch} existe déjà; choisis un autre sujet.`);
	if (existingBranch.status !== 1) throw new Error('Impossible de vérifier le nom de branche; démarrage annulé.');

	mkdirSync(resolve(root, '.freebuff', 'worktrees'), { recursive: true });
	checked('git', ['worktree', 'add', '-b', branch, worktree, 'origin/main'], root, { inherit: true });
	console.log(`✅ ${branch} créée depuis origin/main@${baseSha} dans ${worktree}`);
	console.log('→ Installation des dépendances locales (npm ci)…');
	const install = run('npm', ['ci'], worktree, { inherit: true });
	if (install.status !== 0) throw new Error(`npm ci a échoué (exit ${install.status}); le worktree est conservé pour diagnostic. Aucun push n’a été effectué.`);
	console.log(`✅ Prêt à travailler dans ${worktree}.`);
}

export function preserveGeneratedEnvFile(file, action) {
	const existed = existsSync(file);
	if (existed && lstatSync(file).isSymbolicLink()) {
		throw new Error(`${file} est un lien symbolique local; refus d’écraser ce fichier.`);
	}
	const original = existed ? readFileSync(file) : null;
	const mode = existed ? statSync(file).mode & 0o777 : undefined;
	try {
		return action();
	} finally {
		if (original !== null) {
			writeFileSync(file, original, { mode });
			chmodSync(file, mode);
		} else {
			rmSync(file, { force: true });
		}
	}
}

function buildWithoutChangingLocalEnv(root) {
	// build-preview.mjs generates .env.production. Preserve any ignored local file
	// and force its temporary build URL to loopback; only npm build runs locally.
	const envFile = resolve(root, '.env.production');
	const result = preserveGeneratedEnvFile(envFile, () =>
		run('npm', ['run', 'build'], root, { inherit: true, env: safeLocalEnv() }),
	);
	if (result.status !== 0) throw new Error(`Build local frontend échoué (exit ${result.status ?? 'inconnu'}).`);
}

function check(root) {
	const branch = assertMissionWorktree(root);
	fetchOriginMain(root);
	const based = run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], root);
	if (based.status === 1) throw new Error('Cette branche ne contient pas origin/main à jour; synchronise-la puis relance ux check.');
	if (based.status !== 0) throw new Error('Vérification d’ascendance impossible; validation arrêtée.');
	const changed = checked('git', ['diff', '--name-only', 'origin/main...HEAD'], root).split(/\r?\n/).filter(Boolean);
	for (const path of dirtyPaths(root)) changed.push(path);
	const assistant = assistantInfo(root);
	if (!auditFiles(changed, assistant)) throw new Error('Validation bloquée : collision de fichiers avec PR #16.');
	console.log(`Branche vérifiée : ${branch}`);
	for (const [label, args] of [['Typecheck', ['run', 'check']], ['Tests', ['test']]]) {
		console.log(`\n→ ${label} : npm ${args.join(' ')}`);
		const result = run('npm', args, root, { inherit: true, env: safeLocalEnv() });
		if (result.status !== 0) throw new Error(`${label} échoué (exit ${result.status ?? 'inconnu'}).`);
	}
	console.log('\n→ Build local frontend (sans commande Convex) : npm run build');
	buildWithoutChangingLocalEnv(root);
	console.log('\nAvant tout push susceptible de déclencher Netlify :');
	console.log('  • relire le diff et refaire le contrôle des chevauchements;');
	console.log('  • confirmer typecheck, tests et build réussis;');
	console.log('  • avant tout essai avec écritures, vérifier clé Preview, backend isolé et données de reset;');
	console.log('  • après ouverture de PR, contrôler checks GitHub et Deploy Preview réellement servie. Le push reste manuel.');
	reportNetlifyPreview(root);
}

function printHelp() {
	console.log(`Workflow UX local uniquement — aucun push, PR, merge ou déploiement automatique.

  npm run ux -- start <sujet> --files <fichier> [autre-fichier…]
      Depuis main propre : fetch origin/main, audit PR #16, crée ux/<sujet> + worktree.
  npm run ux -- audit --files <fichier> [autre-fichier…]
      Fetch + audit des fichiers envisagés vs changements commités et locaux de PR #16.
  npm run ux -- preview [--port <port>]
      Vite sur 127.0.0.1, deploy key effacée, Convex forcé vers localhost (pas de données API).
  npm run ux -- check
      Sur ux/* ou fix/* : vérifie base et collisions, typecheck, tests, build et alerte Netlify.

Le démarrage exige main synchronisée sur origin/main sans changements tracked/non suivis.\nLa branche est basée directement sur origin/main; main et le worktree assistant restent intacts.
PR #16 et tout fichier candidat en collision restent intacts; résous l’ambiguïté avant de poursuivre.`);
}

async function main(args) {
	const action = args[0] ?? 'help';
	if (['help', '--help', '-h'].includes(action)) return printHelp();
	const root = rootFrom(process.cwd());
	if (action === 'start') return start(root, args.slice(1));
	if (action === 'audit') {
		const files = parseFiles(args.slice(1));
		fetchOriginMain(root);
		if (!auditFiles(files, assistantInfo(root))) process.exitCode = 2;
		return;
	}
	if (action === 'preview') {
		assertMissionWorktree(root);
		const index = args.indexOf('--port');
		const port = index < 0 ? '' : args[index + 1];
		if (port && (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)) {
			throw new Error('--port doit être compris entre 1024 et 65535.');
		}
		console.log(`Preview frontend locale — Convex=${LOCAL_CONVEX_URL}, clé de déploiement supprimée; aucune commande Convex.`);
		const viteArgs = ['run', 'dev:web', '--', '--host', '127.0.0.1'];
		if (port) viteArgs.push('--port', port);
		const child = spawn('npm', viteArgs, { cwd: root, env: previewEnvironment(), stdio: 'inherit' });
		child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
		child.on('exit', (code) => { process.exitCode = code ?? 1; });
		return;
	}
	if (action === 'check') return check(root);
	throw new Error(`Commande inconnue « ${action} »; lance npm run ux -- help.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(`⛔ ${error.message}`);
		process.exitCode = 1;
	});
}
