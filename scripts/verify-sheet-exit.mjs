/**
 * VÉRIFICATION POLISH-IOS — fermeture d'un volet, plusieurs images pendant le fondu.
 *
 * Page de test reproduisant un volet (fond assombri + panneau + bouton noir,
 * barre de navigation fixe en bas) qui utilise le VRAI mécanisme partagé de
 * l'app : `sheetFadeOut`, `sheetFlyOut`, `onSheetExitEnd`, `freezeSheetForExit`,
 * `lockScroll` / `unlockScroll` (src/lib/sheetMotion.ts, src/lib/scrollLock.ts).
 *
 * Pour chaque navigateur (WebKit iPhone 13 — 60 Hz/encoche, Chromium Pixel 7) :
 *  - ouverture, puis fermeture échantillonnée à chaque frame ;
 *  - le fond assombri ne doit JAMAIS réapparaître (opacité strictement
 *    décroissante, aucune remontée) ;
 *  - le contenu du volet ne doit pas bouger dans le panneau (écart constant
 *    bouton/haut du panneau) et le panneau reste ancré au même calque ;
 *  - la libération (déverrouillage + restauration de position) doit avoir lieu
 *    APRÈS la fin du fondu ;
 *  - la position de défilement est restaurée.
 * Captures d'écran à plusieurs instants de la fermeture (dossier .tmp-polish-ios).
 *
 * Usage : node scripts/verify-sheet-exit.mjs
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const RACINE = new URL('..', import.meta.url).pathname;
const SORTIE = join(RACINE, '.tmp-polish-ios');

const PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Volet — vérification de fermeture</title>
<style>
	html, body { margin: 0; background: #fff; overscroll-behavior-y: none; }
	body { font-family: -apple-system, system-ui, sans-serif; }
	header { position: sticky; top: 0; z-index: 40; background: #fff; border-bottom: 1px solid #eee;
		padding: 14px 20px; font-weight: 900; font-size: 18px; }
	main { padding: 0 20px 200px; }
	.card { margin: 16px 0; border: 1px solid #eef1ef; border-radius: 24px; padding: 20px; }
	#ouvrir { position: fixed; left: 20px; right: 20px; bottom: 120px; height: 52px; border: 0;
		border-radius: 26px; background: #111a15; color: #fff; font-size: 16px; font-weight: 700; z-index: 30; }
	nav { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; padding: 12px 16px 28px;
		background: #fff; border-top: 1px solid #eee; display: flex; gap: 18px; justify-content: center;
		font-size: 12px; font-weight: 700; color: #66716b; transform: translate3d(0, 0, 0); }
	/* Volet : mêmes valeurs que les feuilles de l'app. */
	.overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: flex-end;
		justify-content: center; background: rgba(15, 21, 18, 0.38); }
	.panneau { position: relative; width: 100%; max-width: 28rem; border-radius: 28px 28px 0 0; background: #fff;
		padding: 20px 20px 20px; padding-bottom: max(env(safe-area-inset-bottom), 20px);
		box-shadow: 0 -20px 50px -20px rgba(15, 21, 18, 0.35); }
	.panneau h2 { margin: 0; font-size: 20px; font-weight: 900; }
	.plus { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 16px; }
	.plus button { height: 64px; border: 0; border-radius: 16px; background: #e8fef0; color: #0d7c36;
		font-size: 20px; font-weight: 900; }
	#fermer { position: absolute; right: 12px; top: -44px; width: 40px; height: 40px; border: 0;
		border-radius: 20px; background: #eef1ef; font-weight: 900; }
	#noir { margin-top: 18px; width: 100%; height: 56px; border: 0; border-radius: 28px;
		background: #111a15; color: #fff; font-size: 16px; font-weight: 700; }
</style>
</head>
<body>
	<header id="entete">G-FLUX — Accueil</header>
	<main id="contenu"></main>
	<button id="ouvrir" type="button">Ajouter de l'eau</button>
	<nav>Accueil · Journal · Progression · Profil</nav>
	<div id="hote"></div>
	<script type="module">
		import {
			SHEET_EXIT_MS, SHEET_FADE_MS, SHEET_PANEL_MS,
			sheetFadeOut, sheetFlyOut, onSheetExitEnd, freezeSheetForExit
		} from './lib.js';
		import { lockScroll, unlockScroll, scrollLockCount } from './lib.js';

		const contenu = document.getElementById('contenu');
		contenu.innerHTML = Array.from({ length: 24 }, (_, i) =>
			'<div class="card"><strong>Carte ' + (i + 1) + '</strong><p>Contenu de la page derrière le volet.</p></div>'
		).join('');

		const infos = { exitMs: SHEET_EXIT_MS, fadeMs: SHEET_FADE_MS, panelMs: SHEET_PANEL_MS };
		window.__infos = infos;
		window.__mesures = [];
		window.__deverrouilleA = null;

		const hote = document.getElementById('hote');
		let overlay = null, panneau = null, boutonNoir = null;

		function ouvrir() {
			window.__finFermeture = false;
			lockScroll();
			overlay = document.createElement('div');
			overlay.className = 'overlay';
			overlay.setAttribute('role', 'presentation');
			overlay.style.opacity = '0';
			overlay.innerHTML =
				'<div class="panneau" role="dialog" aria-modal="true">' +
					'<button id="fermer" type="button" aria-label="Fermer">✕</button>' +
					'<h2>Ajouter de l\\'eau</h2>' +
					'<div class="plus"><button>+150</button><button>+250</button><button>+500</button></div>' +
					'<button id="noir" type="button">Ajouter</button>' +
				'</div>';
			hote.appendChild(overlay);
			panneau = overlay.querySelector('.panneau');
			boutonNoir = overlay.querySelector('#noir');
			// Entrée : mêmes durées que l'app.
			overlay.style.transition = 'opacity ' + infos.fadeMs + 'ms linear';
			panneau.style.transition = 'transform ' + infos.panelMs + 'ms cubic-bezier(0.22,1,0.36,1), opacity ' + infos.panelMs + 'ms linear';
			overlay.getBoundingClientRect();
			overlay.style.opacity = '1';
			overlay.querySelector('#fermer').addEventListener('click', fermer);
		}

		function fermer(legacy) {
			const panel = panneau;
			const calque = overlay;
			const noir = boutonNoir;
			const reposStyles = legacy ? () => {} : freezeSheetForExit(panel);
			const debut = performance.now();
			const mesures = (window.__mesures = []);
			let precedent = 1;
			let opaciteMaxApresFondu = 0;
			let fondu = false;

			function boucle() {
				if (!calque.isConnected) return;
				const o = Number(getComputedStyle(calque).opacity);
				const op = Number(getComputedStyle(panel).opacity);
				const rectPanneau = panel.getBoundingClientRect();
				const rectNoir = noir.getBoundingClientRect();
				const rectCalque = calque.getBoundingClientRect();
				const avant = precedent;
				if (o < avant - 0.0001) fondu = true;
				if (fondu) opaciteMaxApresFondu = Math.max(opaciteMaxApresFondu, o - avant);
				precedent = o;
				mesures.push({
					t: Math.round(performance.now() - debut),
					opacite: o,
					opacitePanneau: op,
					remontee: Math.max(0, o - avant),
					ecartBouton: Math.round((rectNoir.top - rectPanneau.top) * 100) / 100,
					hautCalque: Math.round(rectCalque.top),
					hauteurCalque: Math.round(rectCalque.height),
					scrollY: Math.round(window.scrollY),
					verrous: scrollLockCount(),
				});
				requestAnimationFrame(boucle);
			}
			requestAnimationFrame(boucle);

			// Sortie : fond ET panneau sur la même durée (un seul fondu).
			const dureeFond = legacy ? infos.fadeMs : sheetFadeOut().duration;
			const dureePanneau = sheetFlyOut().duration;
			calque.style.transition = 'opacity ' + dureeFond + 'ms linear';
			panel.style.transition = 'transform ' + dureePanneau + 'ms cubic-bezier(0.22,1,0.36,1), opacity ' + dureePanneau + 'ms linear';
			calque.getBoundingClientRect();
			calque.style.opacity = '0';
			panel.style.opacity = '0';
			panel.style.transform = 'translateY(' + sheetFlyOut().y + 'px)';

			const fin = () => {
				window.__deverrouilleA = Math.round(performance.now() - debut);
				reposStyles();
				unlockScroll();
				window.__finFermeture = true;
				calque.remove();
				overlay = panneau = boutonNoir = null;
			};
			if (legacy) {
				/* Ancien comportement : verrou libéré AU DÉBUT du fondu, le volet
				   continuant sa sortie jusqu'à la fin du glissement (240 ms) alors
				   que le fond, lui, a fini son fondu à 160 ms. */
				unlockScroll();
				window.__deverrouilleA = 0;
				setTimeout(() => {
					reposStyles();
					window.__finFermeture = true;
					calque.remove();
					overlay = panneau = boutonNoir = null;
				}, infos.panelMs);
			} else {
				onSheetExitEnd(panel, fin);
			}
		}

		window.__legacy = () => fermer(true);
		window.__fermer = () => fermer(false);
		document.getElementById('ouvrir').addEventListener('click', ouvrir);
	</script>
</body>
</html>`;

async function preparer() {
	await rm(SORTIE, { recursive: true, force: true });
	await mkdir(SORTIE, { recursive: true });
	const esbuild = await import('esbuild');
	await esbuild.build({
		stdin: {
			contents: `export * from '${join(RACINE, 'src/lib/sheetMotion.ts')}';\nexport * from '${join(RACINE, 'src/lib/scrollLock.ts')}';\n`,
			resolveDir: RACINE,
			loader: 'ts',
		},
		bundle: true,
		format: 'esm',
		outfile: join(SORTIE, 'lib.js'),
		logLevel: 'silent',
	});
	await writeFile(join(SORTIE, 'index.html'), PAGE, 'utf8');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };

function servir() {
	return new Promise((resolve) => {
		const serveur = createServer(async (req, res) => {
			const chemin = join(SORTIE, decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html');
			try {
				const corps = await readFile(chemin);
				res.writeHead(200, { 'Content-Type': TYPES[extname(chemin)] ?? 'application/octet-stream' });
				res.end(corps);
			} catch {
				res.writeHead(404).end('introuvable');
			}
		});
		serveur.listen(0, '127.0.0.1', () => resolve({ serveur, port: serveur.address().port }));
	});
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function mesurer(navigateur, device, nom, url) {
	const contexte = await navigateur.newContext({ ...device, locale: 'fr-FR' });
	const page = await contexte.newPage();
	await page.goto(url, { waitUntil: 'load' });
	await page.evaluate(() => window.scrollTo(0, 420));
	await attendre(120);
	const depart = await page.evaluate(() => Math.round(window.scrollY));
	await page.click('#ouvrir');
	await attendre(380);
	const ouvert = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.overlay')).opacity));

	// Captures d'écran pendant la fermeture (plusieurs images).
	const captures = [];
	const debutFermeture = Date.now();
	await page.evaluate(() => window.__fermer());
	for (let i = 0; i < 6; i++) {
		await attendre(60);
		const fichier = join(SORTIE, `${nom}-fermeture-${i + 1}.png`);
		await page.screenshot({ path: fichier });
		captures.push({ fichier, t: Date.now() - debutFermeture });
	}
	await page.waitForFunction(() => window.__finFermeture === true, null, { timeout: 5000 });
	await attendre(80);

	const resultat = await page.evaluate(() => ({
		mesures: window.__mesures,
		fin: window.__deverrouilleA,
		infos: window.__infos,
		scrollY: Math.round(window.scrollY),
		bodyPosition: document.body.style.position,
	}));
	await contexte.close();
	return { nom, device: device.userAgent.split(') ')[0].slice(-40), depart, ouvert, ...resultat, captures };
}

function analyser({ nom, mesures, fin, infos, depart, scrollY, bodyPosition, ouvert }) {
	const erreurs = [];
	/* Fenêtre où la page n'est plus assombrie alors que le volet est encore
	   visible : c'est exactement le clignotement constaté sur iPhone 60 Hz. */
	const sansFond = mesures.filter((m) => m.opacitePanneau > 0.02 && m.opacite < 0.02);
	if (mesures.length < 6) erreurs.push(`${nom} : trop peu d'images échantillonnées (${mesures.length})`);
	const opacites = mesures.map((m) => m.opacite);
	const maxRemontee = Math.max(...mesures.map((m) => m.remontee));
	const reaparition = mesures.some((m, i) => i > 0 && m.opacite > opacites[i - 1] + 0.005);
	const ecarts = mesures.map((m) => m.ecartBouton);
	const ecartMax = Math.max(...ecarts.filter((v) => Number.isFinite(v)));
	const ecartMin = Math.min(...ecarts.filter((v) => Number.isFinite(v)));
	const hautCalqueMax = Math.max(...mesures.map((m) => Math.abs(m.hautCalque)));
	if (ouvert < 0.99) erreurs.push(`${nom} : le volet n'est pas complètement ouvert avant la fermeture (opacité ${ouvert})`);
	if (reaparition) erreurs.push(`${nom} : le fond assombri remonte pendant la fermeture (remontée max ${maxRemontee.toFixed(3)})`);
	if (ecartMax - ecartMin > 0.6) erreurs.push(`${nom} : le contenu du volet bouge dans le panneau (${ecartMin}px → ${ecartMax}px)`);
	if (hautCalqueMax > 1) erreurs.push(`${nom} : le calque du volet se déplace (haut ${hautCalqueMax}px)`);
	if (sansFond.length) {
		erreurs.push(
			`${nom} : page visible sans fond assombri alors que le volet est encore là (${sansFond.length} image(s))`,
		);
	}
	if (!(fin >= infos.exitMs - 16)) erreurs.push(`${nom} : libération à ${fin} ms, avant la fin du fondu (${infos.exitMs} ms)`);
	if (depart !== 420) erreurs.push(`${nom} : départ de défilement inattendu (${depart})`);
	if (scrollY !== depart) erreurs.push(`${nom} : position de défilement non restaurée (${scrollY} au lieu de ${depart})`);
	if (bodyPosition !== '') erreurs.push(`${nom} : body toujours verrouillé après la fermeture (position: ${bodyPosition})`);
	return { erreurs, reaparition, maxRemontee, ecartMin, ecartMax, fin, sansFond: sansFond.length };
}

async function main() {
	const { chromium, webkit, devices } = await import('playwright');
	await preparer();
	const { serveur, port } = await servir();
	const url = `http://127.0.0.1:${port}/index.html`;
	const cibles = [
		{ nom: 'webkit-iphone13', moteur: webkit, device: devices['iPhone 13'] },
		{ nom: 'chromium-pixel7', moteur: chromium, device: devices['Pixel 7'] },
	];
	const bilans = [];
	let echec = false;

	for (const cible of cibles) {
		let navigateur;
		try {
			navigateur = await cible.moteur.launch({ headless: true });
			const r = await mesurer(navigateur, cible.device, cible.nom, url);
			const a = analyser(r);
			bilans.push({ nom: cible.nom, ...a, images: r.mesures.length });
			console.log(`\n=== ${cible.nom} ===`);
			console.log(`  images échantillonnées : ${r.mesures.length} · ouverture : ${r.ouvert}`);
			console.log(`  libération à ${a.fin} ms (fondu ${r.infos.exitMs} ms)`);
			console.log(`  fond assombri : remontée max ${a.maxRemontee.toFixed(3)} · réapparition : ${a.reaparition ? 'OUI' : 'non'}`);
			console.log(`  images sans fond alors que le volet est visible : ${a.sansFond}`);
			console.log(`  bouton noir dans le panneau : ${a.ecartMin}px → ${a.ecartMax}px (écart ${(a.ecartMax - a.ecartMin).toFixed(2)}px)`);
			console.log(`  défilement : ${r.depart} → ${r.scrollY} · body.position = "${r.bodyPosition}"`);
			console.log(`  captures : ${r.captures.length} (${r.captures[0].fichier.replace(RACINE, '')} …)`);
			if (a.erreurs.length) {
				echec = true;
				for (const e of a.erreurs) console.log(`  ✖ ${e}`);
			} else {
				console.log('  ✔ aucun clignotement, aucun déplacement, position restaurée');
			}
		} catch (e) {
			echec = true;
			console.log(`\n=== ${cible.nom} ===\n  ✖ navigateur indisponible : ${e.message.split('\n')[0]}`);
		} finally {
			await navigateur?.close();
		}
	}

	// Témoin : ancien comportement (fond 160 ms, libération immédiate).
	const navigateur = await webkit.launch({ headless: true });
	try {
		const contexte = await navigateur.newContext({ ...devices['iPhone 13'], locale: 'fr-FR' });
		const page = await contexte.newPage();
		await page.goto(url, { waitUntil: 'load' });
		await page.evaluate(() => window.scrollTo(0, 420));
		await page.click('#ouvrir');
		await attendre(380);
		await page.evaluate(() => window.__legacy());
		await attendre(500);
		const ancien = await page.evaluate(() => ({
			mesures: window.__mesures,
			fin: window.__deverrouilleA,
			scrollY: Math.round(window.scrollY),
		}));
		const sansFondAncien = ancien.mesures.filter((m) => m.opacitePanneau > 0.02 && m.opacite < 0.02);
		const visionAncien = ancien.mesures.filter((m) => m.opacite > 0.02 && m.t > ancien.fin);
		console.log('\n=== témoin : ancien mécanisme (WebKit iPhone 13) ===');
		console.log(`  libération à ${ancien.fin} ms (début du fondu) · défilement ${ancien.scrollY}`);
		console.log(
			`  images où le volet est encore visible SANS fond assombri : ${sansFondAncien.length}` +
				(sansFondAncien.length ? ` (de ${sansFondAncien[0].t} à ${sansFondAncien.at(-1).t} ms)` : ''),
		);
		console.log(`  images avec fond encore visible après libération : ${visionAncien.length}`);
		if (!sansFondAncien.length) {
			console.log('  ⚠ le témoin ne reproduit pas la fenêtre de clignotement sur ce moteur');
		}
		await contexte.close();
	} finally {
		await navigateur.close();
	}

	serveur.close();
	console.log(`\nBilan : ${echec ? 'ÉCHEC' : 'OK — les deux navigateurs passent'}`);
	console.log(`Captures : ${SORTIE}`);
	process.exit(echec ? 1 : 0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
