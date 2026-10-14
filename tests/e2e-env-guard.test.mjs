import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTarget } from '../scripts/lib/e2e-env.mjs';

const PROD = 'https://calm-jaguar-475.eu-west-1.convex.cloud';
const LOCAL = 'http://127.0.0.1:3210';
const PREVIEW = 'https://barcode-lookup-pr-19.convex.cloud';

test('production Convex est TOUJOURS refusé, même avec une déclaration explicite', () => {
	assert.equal(classifyTarget(PROD).ok, false, 'URL production brute');
	assert.equal(classifyTarget(PROD.replace('.eu-west-1.convex.cloud', '.convex.cloud')).ok, false, 'URL production sans région');
	assert.equal(classifyTarget(PROD, { E2E_TARGET_URL: PROD }).ok, false, 'aucun override E2E_TARGET_URL sur la prod');
	assert.equal(classifyTarget(PROD, { E2E_TEST_ACCOUNTS_ALLOWED: '1' }).ok, false, 'aucune variable magique ne déblocque la prod');
});

test('backend local convex dev et preview dédiée de PR sont acceptés', () => {
	assert.deepEqual(classifyTarget(LOCAL).ok, true);
	assert.equal(classifyTarget('http://localhost:3210').ok, true, 'localhost au sens large (convex dev)');
	assert.equal(classifyTarget(PREVIEW).ok, true, 'preview dédiée barcode-lookup-pr-<n>');
	assert.equal(classifyTarget('https://autre-autre-1234.convex.cloud').ok, false, 'déploiement Convex inconnu → refuse');
});

test('URL absente ou invalide → refus fail-closed', () => {
	assert.equal(classifyTarget(undefined).ok, false);
	assert.equal(classifyTarget('').ok, false);
	assert.equal(classifyTarget('not-a-url').ok, false);
});

test('E2E_TARGET_URL accepte SEULEMENT la cible harmonisée, jamais au-delà', () => {
	assert.equal(classifyTarget('https://debef98-6634.app.convex.cloud', { E2E_TARGET_URL: 'https://debef98-6634.app.convex.cloud' }).ok, true);
	assert.equal(classifyTarget('https://debef98-6634.app.convex.cloud', { E2E_TARGET_URL: 'https://autre-chose.convex.cloud' }).ok, false);
	assert.equal(classifyTarget('https://debef98-6634.app.convex.cloud', {}).ok, false, 'sans déclaration → refuse');
});

test('sanité documentée : le refuse passe toujours avant toute écriture', () => {
	// Garde-fou documenté : la production est toujours refusée et la déclaration
	// explicite (E2E_TARGET_URL) est le seul chemin hors local/preview.
	assert.ok(classifyTarget(LOCAL).ok && classifyTarget(PREVIEW).ok);
	assert.notEqual(classifyTarget(PROD).reason, '');
});
