/**
 * Tests MISSION CRM-ACCUEIL — tableau de bord coach réorganisé.
 *
 * Constat : la recherche de l'en-tête filtrait la « Vue rapide des clientes »
 * située tout en bas de page (résultats hors écran), elle-même enterrée sous
 * quatre grandes cartes de compteurs, « À traiter aujourd'hui », Google
 * Calendar et le message global.
 *
 * Attendu : liste déroulante JUSTE SOUS la barre (6 clientes max, clavier
 * ↑ ↓ / Entrée / Échap, clic extérieur), vue rapide remontée à gauche (≈ 2/3)
 * et colonne droite (≈ 1/3) empilant À traiter, Message global, Google
 * Calendar. Aucune nouvelle requête, aucun changement côté cliente.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const page = source('src/routes/admin/+page.svelte');
/* Titre réel de la carte (le nom apparaît aussi dans un commentaire du script). */
const QUICK_TITLE = '<h2 class="h2-crm text-base">Vue rapide des clientes</h2>';
const css = source('src/routes/layout.css');
const { searchCoachClients } = await import('../src/lib/coachSearch.ts');

const client = (prenom, nom, email) => ({ user: { prenom, nom, email } });

/* ── 1. Saisie « eme » → Emeline dans les résultats, 6 maximum ── */

test('« eme » fait remonter Emeline, plafonné à 6 résultats', () => {
	const clients = [
		client('Emeline', 'Falzon', 'emeline@exemple.fr'),
		client('Racha', 'Benmeziani', 'racha@exemple.fr'),
		client('Magalie', 'Boué', 'magalie@exemple.fr'),
	];
	const hits = searchCoachClients(clients, 'eme');
	assert.equal(hits.length, 1);
	assert.equal(hits[0].user.prenom, 'Emeline');

	/* Insensible à la casse, sur le nom comme sur l'email. */
	assert.equal(searchCoachClients(clients, 'FALZON')[0].user.prenom, 'Emeline');
	assert.equal(searchCoachClients(clients, 'racha@')[0].user.prenom, 'Racha');

	/* Liste vide tant que rien n'est tapé ; aucun résultat hors sujet. */
	assert.deepEqual(searchCoachClients(clients, '   '), []);
	assert.deepEqual(searchCoachClients(clients, 'zzz'), []);

	/* La liste déroulante ne dépasse jamais 6 lignes. */
	const many = Array.from({ length: 9 }, (_, i) => client(`Emma${i}`, 'Test', `e${i}@exemple.fr`));
	assert.equal(searchCoachClients(many, 'emma').length, 6);
});

/* ── 2. Les résultats s'ouvrent sous la barre, pas dans la vue rapide ── */

test('le champ de l’en-tête ouvre sa liste déroulante sous la barre', () => {
	const headerEnd = page.indexOf('</header>');
	const header = page.slice(0, headerEnd);

	assert.match(header, /bind:value=\{coachSearch\}/, 'le champ de l’en-tête a son propre état');
	assert.match(header, /id="coach-search-results"/, 'liste de résultats dans l’en-tête');
	assert.ok(
		header.indexOf('id="coach-search-results"') > header.indexOf('type="search"'),
		'la liste est rendue après le champ, donc juste dessous'
	);
	assert.ok(
		page.indexOf('id="coach-search-results"') < page.indexOf(QUICK_TITLE),
		'les résultats précèdent la vue rapide dans le document'
	);
	assert.match(header, /absolute right-0 top-full/, 'liste ancrée sous la barre');

	/* La vue rapide garde SON champ : elle n'est plus filtrée par l'en-tête. */
	const quick = page.slice(page.indexOf(QUICK_TITLE));
	assert.match(quick, /bind:value=\{query\}/, 'filtre propre à la vue rapide');
	assert.ok(!/coachSearch/.test(quick.slice(0, quick.indexOf('</section>'))), 'la vue rapide ignore l’en-tête');
});

/* ── 3. Clavier et souris ── */

test('↑ ↓ naviguent, Entrée ouvre la Vision 360°, Échap et clic extérieur ferment', () => {
	assert.match(page, /onkeydown=\{onCoachSearchKey\}/);

	const handler = page.slice(page.indexOf('function onCoachSearchKey'), page.indexOf('/** Entrée ou « Vision 360 › »'));
	assert.match(handler, /e\.key === 'ArrowDown'/, 'flèche bas');
	assert.match(handler, /e\.key === 'ArrowUp'/, 'flèche haut');
	assert.match(handler, /e\.key === 'Enter'/, 'Entrée');
	assert.match(handler, /e\.key === 'Escape'/, 'Échap');

	/* Entrée délègue à l'ouverture réelle de la fiche, comme la vue rapide. */
	const go = page.slice(page.indexOf('function coachSearchGo'), page.indexOf('function coachSearchSection'));
	assert.match(go, /coachSearchOpen = false/);
	assert.match(go, /openClient\(clientId\)/, 'même navigation Vision 360° que la vue rapide');

	/* Échap referme sans naviguer ; le clic extérieur utilise un listener. */
	assert.match(page, /onPointerDown[\s\S]*?coachSearchEl\?\.contains/, 'clic hors du bloc = fermeture');
	assert.match(page, /document\.addEventListener\('pointerdown'/, 'écoute du clic extérieur');

	/* Raccourcis vers les onglets du tiroir. */
	assert.match(page, /coachSearchSection\(c\.user\._id, 'journal'\)/);
	assert.match(page, /coachSearchSection\(c\.user\._id, 'calibrage'\)/);
	assert.match(page, /coachSearchSection\(c\.user\._id, 'bilans'\)/);
	assert.match(page, /\?client=\$\{clientId\}&section=\$\{target\}/);
});

test('aucune requête ajoutée : la liste vient de `clients`', () => {
	assert.match(page, /const coachResults = \$derived\(searchCoachClients\(clients, coachSearch\)\)/);
	const searchZone = page.slice(page.indexOf('Recherche de l’en-tête'), page.indexOf('/** Âge calculé'));
	assert.ok(!/useQuery|api\.|fetch\(/.test(searchZone), 'aucun accès réseau dans la recherche');
});

/* ── 4. Ordre des sections du tableau de bord ── */

test('compteurs, puis deux colonnes : vue rapide à gauche, pile à droite', () => {
	const grid = page.indexOf('class="dash-grid');
	assert.ok(grid > page.indexOf('class="kpi-compact'), 'les compteurs précèdent les colonnes');
	assert.ok(page.indexOf(QUICK_TITLE) > grid, 'la vue rapide est dans la grille');

	const zone = page.slice(grid, page.indexOf('<!-- ═══ Vision 360° : occupe'));
	const order = [QUICK_TITLE, "À traiter aujourd'hui", 'Message global', 'Google Calendar'];
	const positions = order.map((label) => zone.indexOf(label));
	assert.ok(positions.every((i) => i > -1), 'les quatre blocs sont présents');
	for (let i = 1; i < positions.length; i++) {
		assert.ok(positions[i - 1] < positions[i], `« ${order[i - 1]} » précède « ${order[i]} »`);
	}

	assert.match(zone, /<aside class="dash-side/, 'colonne droite identifiée');
	assert.match(zone, /Ajouter une cliente/, 'bouton d’ajout conservé dans la vue rapide');
});

test('mise en page : ≈ 2/3 – 1/3, empilée sous 1100 px, styles conservés', () => {
	const style = page.slice(page.indexOf('<style>'));
	assert.match(style, /\.dash-grid\s*\{[^}]*display:\s*grid/, 'grille CSS');
	assert.match(style, /@media \(min-width: 1100px\)/, 'point de bascule demandé');
	assert.match(style, /grid-template-columns:\s*minmax\(0, 2fr\) minmax\(0, 1fr\)/, '2/3 – 1/3');
	assert.ok(!/xl:grid-cols-12/.test(page), 'ancienne grille 5/7 supprimée');

	/* Hauteur des compteurs réduite par le padding, contenus inchangés. */
	assert.match(css, /\.ds-crm \.kpi-compact \.kpi-crm\s*\{\s*padding:/, 'compteurs plus compacts');
	assert.match(page, /class="kpi-compact/, 'classe appliquée aux compteurs');
	assert.equal((page.match(/class="kpi-tile-lg"/g) ?? []).length, 4, 'icônes des 4 compteurs intactes');
	assert.equal((page.match(/class="spark-crm"/g) ?? []).length, 4, 'mini-graphiques des 4 compteurs intacts');

	/* Google Calendar reste une carte complète, pas une pastille. */
	assert.match(page, /Google Calendar<\/h2>/);
	assert.match(page, /\/img\/google-calendar\.svg/, 'logo et carte conservés');
});
