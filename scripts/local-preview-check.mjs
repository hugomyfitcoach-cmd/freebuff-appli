#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, statSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const envFile = resolve(root, '.env.production');
const existed = existsSync(envFile);
if (existed && lstatSync(envFile).isSymbolicLink()) throw new Error('Refus : .env.production est un lien symbolique.');
const original = existed ? readFileSync(envFile) : null;
const mode = existed ? statSync(envFile).mode & 0o777 : undefined;
const env = { ...process.env, CONTEXT: 'dev', CONVEX_DEPLOY_KEY: '', PUBLIC_CONVEX_URL: 'http://127.0.0.1:3210', PUBLIC_CONVEX_SITE_URL: 'http://127.0.0.1:3211' };
try {
  const r = spawnSync('npm', process.argv.slice(2), { stdio: 'inherit', env });
  if (r.error) throw r.error;
  process.exitCode = r.status ?? 1;
} finally {
  if (original !== null) { writeFileSync(envFile, original, { mode }); chmodSync(envFile, mode); }
  else rmSync(envFile, { force: true });
}
