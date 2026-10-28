/**
 * Mission PWA-STYLE — page sans mise en forme à l'ouverture (Android).
 *
 * Simule le scénario réel : un document de l'ANCIEN build reste affiché et
 * réclame `/_app/immutable/assets/<hash>.css`, fichier qu'un déploiement a
 * supprimé du serveur (404). Sans filet, la page reste nue indéfiniment
 * (fermer/rouvrir l'app était le seul remède).
 *
 * Garanties verrouillées ici, dans un vrai Chromium `Pixel 7` :
 * 1. UN SEUL rechargement automatique → la page repart sur le document du
 *    build en ligne et S'AFFICHE STYLÉE ;
 * 2. aucune boucle : un déploiement réellement cassé ne recharge pas l'app
 *    sans fin ;
 * 3. aucune perte de saisie : volet (`role="dialog"` + `aria-modal`) ouvert →
 *    aucun rechargement ; il n'a lieu qu'à la navigation suivante.
 *
 * Le module de production `src/lib/shellRecovery.ts` est chargé tel quel
 * (types retirés par Node) : le test porte sur le code réellement déployé.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const recoverySource = stripTypeScriptTypes(readFileSync(join(root, 'src/lib/shellRecovery.ts'), 'utf8'));

const OLD_CSS = '/_app/immutable/assets/ancien-build.css';
const NEW_CSS = '/_app/immutable/assets/nouveau-build.css';

/** Document de l'ancien build : la feuille demandée n'existe plus (404). */
function oldDocument({ sheet = '' } = {}) {
	return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8" />
<link rel="stylesheet" href="${OLD_CSS}" />
</head><body>
${sheet}
<div id="app">ancienne page</div>
<script type="module">
	import { installShellRecovery, flushDeferredShellReload, isShellReloadDeferred } from '/src/shellRecovery.mjs';
	window.__recovery = { flushDeferredShellReload, isShellReloadDeferred };
	installShellRecovery({ build: 'ancien-build' });
</script>
</body></html>`;
}

/** Document du build en ligne : feuille servie → page stylée. */
function newDocument() {
	return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8" />
<link rel="stylesheet" href="${NEW_CSS}" />
</head><body>
<div id="app">page à jour</div>
<script type="module">
	import { installShellRecovery } from '/src/shellRecovery.mjs';
	installShellRecovery({ build: 'nouveau-build' });
</script>
</body></html>`;
}

/**
 * Contexte Chromium `Pixel 7` + un faux serveur : le premier document servi
 * est l'ancien, les suivants selon `nextDocument` (null = toujours l'ancien).
 */
async function openScenario(browser, { firstDocument = oldDocument(), nextDocument = newDocument() } = {}) {
	const { devices } = await import('playwright');
	const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'fr-FR' });
	const state = { documents: 0 };
	await context.route('**/*', async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (request.resourceType() === 'document') {
			state.documents += 1;
			const body = state.documents === 1 || !nextDocument ? firstDocument : nextDocument;
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
		}
		if (path === '/src/shellRecovery.mjs') {
			return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: recoverySource });
		}
		if (path === OLD_CSS) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'introuvable' });
		if (path === NEW_CSS) {
			return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: 'body{background:rgb(1,2,3)}' });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});
	const page = await context.newPage();
	return { context, page, state };
}

async function launch() {
	try {
		const { chromium } = await import('playwright');
		return await chromium.launch();
	} catch {
		return null; // Playwright / Chromium non installés : test non exécutable ici.
	}
}

test('PWA sans CSS : un seul rechargement, page stylée, aucune boucle', async (t) => {
	const browser = await launch();
	if (!browser) return t.skip('Playwright/Chromium indisponible');
	try {
		const { context, page, state } = await openScenario(browser);
		try {
			await page.goto('http://gflux.test/');
			// La page de l'ancien build est bien NUE au départ (CSS 404 = feuille vide).
			assert.equal(
				await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
				'rgba(0, 0, 0, 0)',
				'page sans feuille de style au départ'
			);

			// Le filet recharge une fois : nouveau document + CSS servi.
			await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(1, 2, 3)', null, {
				timeout: 10_000,
			});
			assert.equal(state.documents, 2, 'exactement un rechargement automatique');

			// Aucune boucle : plus aucun rechargement ensuite.
			await page.waitForTimeout(1500);
			assert.equal(state.documents, 2, 'aucun rechargement supplémentaire');
		} finally {
			await context.close();
		}
	} finally {
		await browser.close();
	}
});

test('PWA sans CSS : déploiement cassé = jamais de boucle de rechargement', async (t) => {
	const browser = await launch();
	if (!browser) return t.skip('Playwright/Chromium indisponible');
	try {
		// Le serveur ne sert QUE l'ancien document : la panne persiste.
		const { context, page, state } = await openScenario(browser, { nextDocument: null });
		try {
			await page.goto('http://gflux.test/');
			await page.waitForTimeout(3000);
			assert.equal(state.documents, 2, 'un seul rechargement automatique, puis on s’arrête');
		} finally {
			await context.close();
		}
	} finally {
		await browser.close();
	}
});

test('PWA sans CSS : volet ouvert = rechargement reporté à la navigation suivante', async (t) => {
	const browser = await launch();
	if (!browser) return t.skip('Playwright/Chromium indisponible');
	try {
		const sheet =
			'<div role="dialog" aria-modal="true" aria-label="Saisie du poids"><input aria-label="Poids" value="72" /></div>';
		const { context, page, state } = await openScenario(browser, { firstDocument: oldDocument({ sheet }) });
		try {
			await page.goto('http://gflux.test/');
			await page.waitForTimeout(1500);
			// Aucune perte de saisie : rien n'est rechargé tant que le volet est ouvert.
			assert.equal(state.documents, 1, 'aucun rechargement pendant une saisie');
			assert.equal(await page.evaluate(() => window.__recovery.isShellReloadDeferred()), true, 'rechargement mis en attente');

			// Le volet se ferme et la navigation suivante applique le report.
			await page.evaluate(() => {
				document.querySelector('[role="dialog"]')?.remove();
				window.__recovery.flushDeferredShellReload();
			});
			await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(1, 2, 3)', null, {
				timeout: 10_000,
			});
			assert.equal(state.documents, 2, 'rechargement unique à la navigation suivante');
		} finally {
			await context.close();
		}
	} finally {
		await browser.close();
	}
});
