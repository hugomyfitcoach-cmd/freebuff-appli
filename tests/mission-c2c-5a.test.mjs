/**
 * Mission C2c-5a — CALIBRAGE : détail du supplément travail, lettres de macros
 * colorées, 4e case « Maintenance totale » dans le bandeau de synthèse.
 *
 * Vérifié :
 *  1. `supplementTravailTextes(2)` → total « +0,15 » et détail
 *     « 0,05 travail de bureau + 0,10 pour 2 h en mouvement » ;
 *  2. `supplementTravailTextes(0)` → total « +0,05 », détail « 0,05 travail de
 *     bureau » (aucune part mouvement) ; heures invalides → null ;
 *  3. les lettres G, P, L sont colorées par `macroColor` (glucides, protéines,
 *     lipides) dans l'historique des objectifs ET la confirmation ;
 *  4. le bandeau de synthèse a 4 cases (dont « Maintenance totale ») sur une
 *     grille `grid-cols-2 sm:grid-cols-4`.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fiche = await import(new URL('../src/lib/calibrageFiche.ts', import.meta.url).href);
const adminPage = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');

/* ═══════════ 1 · Supplément travail : 2 h ═══════════ */

test('SUPPLÉMENT TRAVAIL : 2 h → « +0,15 » et le détail bureau + mouvement', () => {
	const textes = fiche.supplementTravailTextes(2);
	assert.ok(textes, 'textes retournés pour 2 h');
	assert.equal(textes.total, '+0,15');
	assert.equal(textes.detail, '0,05 travail de bureau + 0,10 pour 2 h en mouvement');

	/* La page appelle la fonction DIRECTEMENT dans le balisage, sur les heures saisies. */
	assert.ok(
		adminPage.includes('supplementTravailTextes(calibrageInputs.heuresTravail)'),
		'appel direct dans le balisage du bloc « Supplément travail »'
	);
});

/* ═══════════ 2 · Supplément travail : 0 h ═══════════ */

test('SUPPLÉMENT TRAVAIL : 0 h → « +0,05 » et le détail bureau seul', () => {
	const textes = fiche.supplementTravailTextes(0);
	assert.ok(textes, 'textes retournés pour 0 h');
	assert.equal(textes.total, '+0,05');
	assert.equal(textes.detail, '0,05 travail de bureau');

	/* Heures invalides : aucun texte, jamais un total inventé. */
	assert.equal(fiche.supplementTravailTextes(-1), null);
	assert.equal(fiche.supplementTravailTextes(Number.NaN), null);
	assert.equal(fiche.supplementTravailTextes(13), null);
});

/* ═══════════ 3 · Lettres G, P, L colorées ═══════════ */

test('MACROS : lettres G, P, L colorées par macroColor dans l’historique ET la confirmation', () => {
	const historyStart = adminPage.indexOf("<!-- HISTORIQUE DES OBJECTIFS");
	const confirmStart = adminPage.indexOf('<!-- Confirmation obligatoire');
	const dialogEnd = adminPage.indexOf('</ConfirmDialog>');
	assert.ok(historyStart > 0 && confirmStart > historyStart && dialogEnd > confirmStart, 'sections trouvées');

	const historique = adminPage.slice(historyStart, confirmStart);
	const confirmation = adminPage.slice(confirmStart, dialogEnd);

	for (const [nom, section] of [
		['historique', historique],
		['confirmation', confirmation]
	]) {
		assert.ok(
			section.includes("style=\"color:{macroColor('carbs')}\">G "),
			`${nom} : G (glucides) coloré`
		);
		assert.ok(
			section.includes("style=\"color:{macroColor('protein')}\">P "),
			`${nom} : P (protéines) coloré`
		);
		assert.ok(
			section.includes("style=\"color:{macroColor('fat')}\">L "),
			`${nom} : L (lipides) coloré`
		);
	}
});

/* ═══════════ 4 · Bandeau : 4 cases dont « Maintenance totale » ═══════════ */

test('BANDEAU : 4 cases en grid-cols-2 sm:grid-cols-4, dont « Maintenance totale »', () => {
	const debut = adminPage.indexOf('BANDEAU DE SYNTHÈSE');
	const fin = adminPage.indexOf('{#if applyMsg}', debut);
	assert.ok(debut > 0 && fin > debut, 'bandeau localisé');
	const bandeau = adminPage.slice(debut, fin);

	const cases = bandeau.match(/class="min-w-0 px-1\.5 text-center"/g) ?? [];
	assert.equal(cases.length, 4, '4 cases dans le bandeau');
	assert.ok(
		bandeau.includes('grid grid-cols-2 divide-x divide-line sm:grid-cols-4'),
		'grille 2 colonnes mobile / 4 colonnes écran large'
	);
	assert.ok(bandeau.includes('>Maintenance totale</div>'), '4e case intitulée « Maintenance totale »');
	assert.ok(
		bandeau.includes("{calImpact.maintenanceTotaleKcal.toLocaleString('fr-FR')}"),
		'valeur de la maintenance totale (module, jamais recalculée)'
	);
	assert.ok(bandeau.includes('kcal'), 'unité kcal');
});
