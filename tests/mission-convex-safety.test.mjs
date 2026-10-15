/**
 * Garde-fous Convex (non-régression) :
 *  - aucun script ne doit contenir d'URL de production en repli ;
 *  - setup-coach exige une URL explicite (pas de fallback) ;
 *  - les E2E qui créent des données passent par le garde-fou assertE2eTargetEnv.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('aucun script ne contient d\'URL Convex de production en repli', () => {
	const dir = join(root, 'scripts');
	for (const f of readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
		const src = readFileSync(join(dir, f), 'utf8');
		assert.ok(!/\?\?\s*'https:\/\/calm-jaguar-475/.test(src), `${f} : repli production interdit`);
	}
});

test('setup-coach : URL Convex explicite obligatoire (pas de repli)', () => {
	const src = read('scripts/setup-coach.mjs');
	assert.ok(!src.includes('calm-jaguar-475'), 'aucune URL de production dans setup-coach');
	assert.match(src, /if \(!url\) \{[\s\S]*process\.exit\(1\)/);
});

test('e2e-hotfix-flows : garde-fou appelé avant toute création de compte', () => {
	const src = read('scripts/e2e-hotfix-flows.mjs');
	assert.match(src, /import \{ assertE2eTargetEnv \} from '\.\/lib\/e2e-env\.mjs'/);
	const guardAt = src.indexOf('assertE2eTargetEnv(diag.convexUrl)');
	const firstWriteAt = src.indexOf('api.coach.createClient');
	assert.ok(guardAt > 0 && firstWriteAt > guardAt, 'garde-fou exécuté avant la première écriture');
});
