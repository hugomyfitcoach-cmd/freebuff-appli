/**
 * Tests MISSION R5c — bilan nutritionnel du jour + correctifs fiche aliment.
 *
 * 1) Repère fibres : max(25, arrondi(objectif kcal × 0,015)).
 * 2) Couverture kcal et ses trois niveaux (85 %, 65 %, 40 %) — jamais de
 *    rouge. La carte Fibres du Journal n'en dépend plus (état unique,
 *    correctif FIX-FIBRES) ; `etatFibres` sert au volet détaillé.
 * 3) Agrégation de 3 aliments dont 1 sans fibres : totaux connus uniquement,
 *    AGS en % des kcal, sources de fibres complètes (R5c-ter), aliment sans
 *    référence non couvert.
 * 4) Câblage : requête serveur unique, route BFF, carte Fibres du Journal,
 *    volet « Bilan nutritionnel du jour », bande d'en-tête collante et tuiles
 *    macros au format de la fiche détaillée.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
	bilanJour,
	couvertureKcal,
	decouperSourcesFibres,
	etatFibres,
	niveauCouverture,
	repereFibres,
	SOURCES_FIBRES_VISIBLES,
} from '../src/lib/bilanJour.ts';
import { hashToken } from '../src/convex/helpers.ts';
import { dayNutritionDetails } from '../src/convex/journal.ts';

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/* ─── 1) Repère fibres du jour ─── */

test('repère fibres : 15 g pour 1 000 kcal, jamais moins de 25 g', () => {
	assert.equal(repereFibres(1400), 25, '1 400 kcal → plancher 25 g');
	assert.equal(repereFibres(2148), 32, '2 148 kcal → 32 g');
	assert.equal(repereFibres(2500), 38, '2 500 kcal → 38 g');
	assert.equal(repereFibres(1000), 25, '1 000 kcal → plancher');
	assert.equal(repereFibres(3000), 45, '3 000 kcal → 45 g');
	assert.equal(repereFibres(0), 25, 'objectif absent → plancher, jamais 0');
});

/* ─── 2) Couverture et seuils d'affichage ─── */

/** Aliment fictif : kcal réelles + fibres connues (ou non). */
const aliment = (kcal, fibres) => ({
	name: `Aliment ${kcal}`,
	kcal,
	fibres,
	sucres: null,
	ags: null,
	sel: null,
});

test('couverture kcal : pondérée par les kcal, les aliments sans fibres ne comptent pas', () => {
	// 850 kcal connues + 150 kcal sans référence (repas IA / saisie rapide).
	const jour = [aliment(850, 20), aliment(150, null)];
	assert.equal(couvertureKcal(jour), 85, '850 / 1 000 kcal → 85 %');
	assert.equal(niveauCouverture(85), 'complete');

	const partiel = [aliment(650, 15), aliment(350, null)];
	assert.equal(couvertureKcal(partiel), 65, '650 / 1 000 kcal → 65 %');
	assert.equal(niveauCouverture(65), 'partielle');

	const faible = [aliment(400, 8), aliment(600, null)];
	assert.equal(couvertureKcal(faible), 40, '400 / 1 000 kcal → 40 %');
	assert.equal(niveauCouverture(40), 'insuffisante');

	assert.equal(couvertureKcal([aliment(0, 3)]), 0, 'aucune kcal → jamais de division par zéro');
	assert.equal(couvertureKcal([]), 0, 'jour vide → 0 %');
});

test('seuils d’affichage : 85 % normal, 65 % « au moins » gris, 40 % sans jauge', () => {
	const complet = etatFibres(22, 32, 85);
	assert.deepEqual(complet, {
		niveau: 'complete',
		mention: 'exact',
		valeur: 22,
		jauge: true,
		pct: (22 / 32) * 100,
	});

	const partiel = etatFibres(16.8, 32, 65);
	assert.equal(partiel.niveau, 'partielle');
	assert.equal(partiel.mention, 'au-moins', 'total partiel annoncé comme un minimum');
	assert.equal(partiel.valeur, 16.8);
	assert.equal(partiel.jauge, true, 'jauge grise conservée entre 50 et 80 %');

	const insuffisant = etatFibres(12, 32, 40);
	assert.deepEqual(insuffisant, {
		niveau: 'insuffisante',
		mention: 'insuffisant',
		valeur: null,
		jauge: false,
		pct: 0,
	});

	// Bornes exactes : 80 % = complet, 50 % = partiel, 49 % = insuffisant.
	assert.equal(niveauCouverture(80), 'complete');
	assert.equal(niveauCouverture(50), 'partielle');
	assert.equal(niveauCouverture(49), 'insuffisante');
	assert.equal(etatFibres(null, 32, 100).jauge, false, 'aucune valeur connue → aucune jauge');
});

/* ─── 3) Agrégation du jour (3 aliments, 1 sans fibres) ─── */

test('agrégation : totaux connus, AGS en % des kcal, sources, non couvert exclu', () => {
	const aliments = [
		{ name: 'Pain complet', kcal: 468, fibres: 15, sucres: 6, ags: 3.2, sel: 1.8 },
		{ name: 'Fromage blanc 0 %', kcal: 194, fibres: null, sucres: 12, ags: 1.4, sel: 0.4 },
		{ name: 'Tomates', kcal: 27, fibres: 1.8, sucres: 3.9, ags: 0.1, sel: 0.03 },
	];
	const b = bilanJour(aliments, 2148);

	assert.equal(b.aliments, 3);
	assert.equal(b.kcal, 689, 'kcal du jour = somme des entrées');
	assert.equal(b.repere, 32, 'repère calculé sur l’objectif, jamais les kcal mangées');
	assert.equal(b.fibres, 16.8, 'fibres : seules les valeurs connues sont additionnées');
	assert.equal(b.sucres, 21.9);
	assert.equal(b.ags, 4.7);
	assert.equal(b.agsPctKcal, 6, '4,7 g d’AGS × 9 kcal/g / 689 kcal → 6 %');
	assert.equal(b.sel, 2.2, 'sel arrondi à une décimale, jamais inventé');
	assert.equal(b.couverture, 72, '(468 + 27) / 689 kcal → 72 % (fromage sans fibres exclu)');
	assert.deepEqual(
		b.sourcesFibres,
		[
			{ name: 'Pain complet', fibres: 15 },
			{ name: 'Tomates', fibres: 1.8 },
		],
		'sources décroissantes, aliment sans fibres exclu'
	);
});

test('AGS : part des kcal = (AGS g × 9) ÷ kcal du jour, arrondie à l’entier', () => {
	// 3,6 g d'AGS sur 642 kcal → 32,4 / 642 × 100 = 5,05 → 5 %.
	const b = bilanJour(
		[{ name: 'Repas', kcal: 642, fibres: 5, sucres: 20, ags: 3.6, sel: 1 }],
		2000
	);
	assert.equal(b.agsPctKcal, 5, '3,6 g × 9 / 642 kcal → 5 %');
	// Sans AGS connues : jamais un pourcentage inventé.
	assert.equal(
		bilanJour([{ name: 'Inconnu', kcal: 500, fibres: null, sucres: null, ags: null, sel: null }], 2000)
			.agsPctKcal,
		null
	);
});

test('agrégation : aucune valeur inventée quand rien n’est connu + liste complète', () => {
	const inconnu = bilanJour(
		[{ name: 'Repas IA', kcal: 620, fibres: null, sucres: null, ags: null, sel: null }],
		2000
	);
	assert.equal(inconnu.fibres, null);
	assert.equal(inconnu.sucres, null);
	assert.equal(inconnu.ags, null);
	assert.equal(inconnu.agsPctKcal, null, 'pas de % sans AGS connues');
	assert.equal(inconnu.sel, null);
	assert.equal(inconnu.couverture, 0);
	assert.deepEqual(inconnu.sourcesFibres, []);

	const quatre = bilanJour(
		[
			{ name: 'A', kcal: 100, fibres: 1, sucres: 0, ags: 0, sel: 0 },
			{ name: 'B', kcal: 100, fibres: 9, sucres: 0, ags: 0, sel: 0 },
			{ name: 'C', kcal: 100, fibres: 3, sucres: 0, ags: 0, sel: 0 },
			{ name: 'D', kcal: 100, fibres: 5, sucres: 0, ags: 0, sel: 0 },
		],
		2000
	);
	assert.deepEqual(
		quatre.sourcesFibres.map((s) => s.name),
		['B', 'D', 'C', 'A'],
		'toutes les sources sont renvoyées, décroissantes'
	);
});

/* ─── 3 bis) Sources de fibres du volet (R5c-ter) ─── */

test('sources de fibres : tri décroissant, aliments identiques regroupés, 0 g exclus', () => {
	const aliments = [
		{ name: 'Tomate cerise, crue', kcal: 18, fibres: 2.4, sucres: 0, ags: 0, sel: 0 },
		{ name: 'Pain complet', kcal: 468, fibres: 15, sucres: 0, ags: 0, sel: 0 },
		{ name: 'Philadelphia Light', kcal: 60, fibres: 0.4, sucres: 0, ags: 0, sel: 0 },
		{ name: 'Tomate ronde, crue', kcal: 20, fibres: 4.2, sucres: 0, ags: 0, sel: 0 },
		// Identique au premier repas : les deux portions sont additionnées.
		{ name: 'Tomate cerise, crue', kcal: 18, fibres: 1.6, sucres: 0, ags: 0, sel: 0 },
		// 0 g (valeur réelle) et inconnu : aucune ligne.
		{ name: 'Eau', kcal: 0, fibres: 0, sucres: 0, ags: 0, sel: 0 },
		{ name: 'Repas IA', kcal: 300, fibres: null, sucres: null, ags: null, sel: null },
	];
	const b = bilanJour(aliments, 2148);

	assert.deepEqual(
		b.sourcesFibres,
		[
			{ name: 'Pain complet', fibres: 15 },
			{ name: 'Tomate ronde, crue', fibres: 4.2 },
			{ name: 'Tomate cerise, crue', fibres: 4 },
			{ name: 'Philadelphia Light', fibres: 0.4 },
		],
		'tri par grammes décroissants, tomates cerise regroupées, 0 g et inconnu exclus'
	);
	assert.equal(b.fibres, 23.6, 'le total reste celui du jour');
	assert.ok(!b.sourcesFibres.some((s) => s.name === 'Eau'), 'aliment à 0 g exclu');
	assert.ok(!b.sourcesFibres.some((s) => s.name === 'Repas IA'), 'aliment sans donnée exclu');

	// Jour vide : aucune source, donc aucune liste à afficher.
	assert.deepEqual(bilanJour([], 2000).sourcesFibres, []);
});

test('seuil de 6 lignes : 6 sources visibles, le reste derrière « + N autres »', () => {
	assert.equal(SOURCES_FIBRES_VISIBLES, 6);
	const sources = Array.from({ length: 9 }, (_, i) => ({ name: `Aliment ${i}`, fibres: 9 - i }));

	const coupees = decouperSourcesFibres(sources);
	assert.deepEqual(
		coupees.visibles.map((s) => s.name),
		['Aliment 0', 'Aliment 1', 'Aliment 2', 'Aliment 3', 'Aliment 4', 'Aliment 5'],
		'6 premières lignes affichées'
	);
	assert.deepEqual(
		coupees.autres.map((s) => s.name),
		['Aliment 6', 'Aliment 7', 'Aliment 8'],
		'le reste derrière « + 3 autres »'
	);

	// Borne exacte : 6 lignes → aucun « + N autres ». 7 → une ligne repliée.
	assert.deepEqual(decouperSourcesFibres(sources.slice(0, 6)), { visibles: sources.slice(0, 6), autres: [] });
	assert.equal(decouperSourcesFibres(sources.slice(0, 7)).autres.length, 1);
	assert.deepEqual(decouperSourcesFibres([]), { visibles: [], autres: [] });
});

/* ─── 4) La requête elle-même : résolution OFF / Ciqual / perso ─── */

const SESSION_TOKEN = 'session-r5c';
const USER = { _id: 'user-1', role: 'client', disabled: false, createdBy: 'coach-1' };
const DATE = '2026-10-27';

/** Contexte Convex minimal : session réelle (hashToken) + documents fournis.
 *  Les queries ne tournent pas hors Convex — son handler est appelé avec ce
 *  contexte de lecture, ce qui exerce bien le chemin d'accès de la requête. */
async function fakeCtx({ entries, goals, history = [], referenceFoods = [], docs = {} }) {
	const session = {
		userId: USER._id,
		tokenHash: await hashToken(SESSION_TOKEN),
		expiresAt: Date.now() + 60_000,
	};
	const chain = (rows) => ({
		withIndex: () => chain(rows),
		filter: () => chain(rows),
		order: () => chain(rows),
		collect: async () => rows,
		first: async () => rows[0] ?? null,
		unique: async () => rows[0] ?? null,
	});
	return {
		db: {
			query: (table) => {
				if (table === 'sessions') return chain([session]);
				if (table === 'diaryEntries') return chain(entries);
				if (table === 'clientGoals') return chain(goals ? [goals] : []);
				if (table === 'clientGoalHistory') return chain(history);
				if (table === 'referenceFoods') return chain(referenceFoods);
				if (table === 'users') return chain([USER]);
				return chain([]);
			},
			get: async (id) =>
				id === USER._id
					? USER
					: id === 'coach-1'
						? { _id: 'coach-1', role: 'coach', disabled: false }
						: (docs[id] ?? null),
		},
	};
}

test('dayNutritionDetails : OFF + Ciqual + perso, sans référence exclu, session obligatoire', async () => {
	const entries = [
		// Produit OFF (fibres connues au cache).
		{ _id: 'e1', date: DATE, meal: 'dejeuner', foodId: 'food-1', name: 'Yaourt nature', qtyGrams: 200, kcal: 104 },
		// Référence Ciqual : libellé officiel, aucune identité stockée.
		{ _id: 'e2', date: DATE, meal: 'dejeuner', referenceSource: 'ciqual', name: 'Riz basmati, cuit, sans sel ajouté', qtyGrams: 100, kcal: 148 },
		// Aliment personnel de la cliente.
		{ _id: 'e3', date: DATE, meal: 'petit-dej', customFoodId: 'custom-1', name: 'Mon granola', qtyGrams: 50, kcal: 200 },
		// Fiche perso d'une AUTRE cliente : non couverte, jamais lue.
		{ _id: 'e4', date: DATE, meal: 'diner', customFoodId: 'custom-2', name: 'Plat privé', qtyGrams: 300, kcal: 300 },
		// Repas IA : composants estimés, non couverts.
		{ _id: 'e5', date: DATE, meal: 'diner', mealGroup: 'analyse:1', name: 'Assiette estimée', qtyGrams: 250, kcal: 250 },
	];
	const ctx = await fakeCtx({
		entries,
		goals: { kcal: 2148, carbs: 217, protein: 158, fat: 72 },
		docs: {
			'food-1': {
				_id: 'food-1',
				kcal100: 52, carbs100: 12.5, protein100: 0.3, fat100: 0.2,
				fiber100: 1.5, sugars100: 4, saturatedFat100: 0.3, salt100: 0.1,
			},
			'custom-1': {
				_id: 'custom-1', userId: USER._id, name: 'Mon granola',
				kcal100: 400, carbs100: 60, protein100: 10, fat100: 12,
				fiber100: 8, salt100: 0.2, createdAt: 0,
			},
			'custom-2': {
				_id: 'custom-2', userId: 'user-2', name: 'Plat privé',
				kcal100: 100, carbs100: 10, protein100: 5, fat100: 2, fiber100: 9, createdAt: 0,
			},
		},
	});

	const bilan = await dayNutritionDetails._handler(ctx, { sessionToken: SESSION_TOKEN, date: DATE });
	assert.equal(bilan.aliments, 5, '5 aliments consommés');
	assert.equal(bilan.kcal, 1002, 'kcal du jour = toutes les entrées');
	assert.equal(bilan.repere, 32, 'repère calculé sur l’objectif affiché (2 148 kcal)');
	assert.equal(bilan.fibres, 7, 'OFF 3 g + perso 4 g + Ciqual 0 g (traces), non couverts exclus');
	assert.equal(bilan.sucres, 8, 'sucres connus uniquement (perso : non publié)');
	assert.equal(bilan.ags, 0.7);
	assert.equal(bilan.sel, 0.3);
	assert.equal(bilan.couverture, 45, '(104 + 148 + 200) / 1 002 kcal → 45 %');
	assert.deepEqual(
		bilan.sourcesFibres,
		[
			{ name: 'Mon granola', fibres: 4 },
			{ name: 'Yaourt nature', fibres: 3 },
		],
		'2 principales sources de fibres'
	);

	await assert.rejects(() =>
		dayNutritionDetails._handler(ctx, { sessionToken: undefined, date: DATE }),
		'session obligatoire'
	);
	await assert.rejects(() =>
		dayNutritionDetails._handler(ctx, { sessionToken: SESSION_TOKEN, date: '2026-13-40' }),
		'date invalide refusée'
	);
});

test('dayNutritionDetails : jour vide → bilan à 0 avec repère, jamais null', async () => {
	const ctx = await fakeCtx({
		entries: [],
		goals: { kcal: 2148, carbs: 217, protein: 158, fat: 72 },
	});
	const bilan = await dayNutritionDetails._handler(ctx, { sessionToken: SESSION_TOKEN, date: DATE });

	assert.ok(bilan, 'jour vide : le volet reste ouvrable');
	assert.equal(bilan.aliments, 0);
	assert.equal(bilan.kcal, 0);
	assert.equal(bilan.fibres, null, 'aucune valeur inventée pour un jour sans aliment');
	assert.equal(bilan.couverture, 0);
	assert.equal(bilan.repere, 32, 'repère de l’objectif affiché, même sans aliment');
	assert.deepEqual(bilan.sourcesFibres, [], 'aucune source : liste masquée');
});

/* ─── 5) Câblage serveur / interface ─── */

const journal = source('src/convex/journal.ts');
const journalDay = source('src/lib/components/JournalDay.svelte');
const sheet = source('src/lib/components/QuantitySheet.svelte');
const bilanSheet = source('src/lib/components/BilanJourSheet.svelte');
const route = source('src/routes/api/journal/nutrition/+server.ts');

test('serveur : une requête dayNutritionDetails qui réutilise foodDetails, sans schéma', () => {
	assert.match(journal, /export const dayNutritionDetails = query\(\{/);
	assert.ok(journal.includes('foodDetailsFromOffFood'), 'cache OFF');
	assert.ok(journal.includes('foodDetailsFromCustomFood'), 'aliments personnels');
	assert.ok(journal.includes('ciqualFoodDetails'), 'référence Ciqual');
	assert.ok(journal.includes('foodDetailsFromReferenceFood'), 'Référence G-Flux');
	assert.ok(journal.includes('listReferenceFoodsForUser'), 'fiches du coach de la cliente uniquement');
	assert.ok(journal.includes('food.userId === ownerId'), 'isolation stricte des fiches perso');
	assert.ok(journal.includes('bilanJour(aliments, objectifKcal)'), 'calcul pur partagé');
	assert.ok(journal.includes('kcalGoalForDate('), 'objectif calorique daté du Journal');
	assert.ok(!journal.includes('if (entries.length === 0) return null'), 'jour vide → bilan à 0, plus masqué');
	assert.ok(!source('src/convex/schema.ts').includes('nutritionDetails'), 'aucun schéma modifié');

	assert.ok(route.includes('api.journal.dayNutritionDetails'), 'une seule requête Convex');
	assert.ok(/requireRole\(event, 'client'/.test(route), 'même contrôle d’accès que le journal');
});

test('journal : carte Fibres sous les macros, état unique « X g / Y g », aucun rouge', () => {
	/* Correctif FIX-FIBRES : les trois états d'affichage (au-moins /
	   incomplet / insuffisant) sont remplacés par UN seul état — la valeur
	   connue et son repère, quelle que soit la couverture. */
	assert.ok(journalDay.includes('affichageFibres('), 'affichage unique, jamais dépendant de la couverture');
	assert.match(journalDay, /\{#if fibresCard\}/, 'cliente uniquement (carte rendue dès la première image, R5c-sexies)');
	assert.ok(journalDay.includes('aria-label="Voir le bilan nutritionnel du jour"'), 'carte entière → volet');
	assert.ok(!journalDay.includes('Détail du jour ›'), 'plus de lien texte');
	assert.ok(journalDay.includes("name=\"leaf\""), 'icône feuille');
	assert.ok(journalDay.includes("name=\"chevronRight\""), 'chevron grisé');
	assert.ok(journalDay.includes('/ {bilanJour?.repere} g'), 'toujours « X g / Y g »');
	assert.ok(!journalDay.includes('au moins '), 'plus de mention « au moins »');
	assert.ok(!journalDay.includes('Données incomplètes'), 'plus de « Données incomplètes »');
	assert.ok(!journalDay.includes('pas assez de données'), 'plus d’état « pas assez de données »');
	const ligne = journalDay.slice(
		journalDay.indexOf('{#if fibresCard}'),
		journalDay.indexOf('<!-- Repas -->')
	);
	assert.ok(ligne.includes('bg-fibres'), 'jauge aux couleurs des fibres');
	assert.ok(!ligne.includes('bg-mist'), 'plus de jauge grise');
	assert.ok(!/danger/.test(ligne), 'jamais de rouge dans la ligne Fibres');
});

test('volet : titre, couverture, blocs fibres/sucres/AGS/sel et phrases obligatoires', () => {
	assert.ok(bilanSheet.includes('Bilan nutritionnel du jour'));
	assert.ok(bilanSheet.includes('Calculé sur {bilan.couverture} % des calories de la journée'));
	assert.ok(bilanSheet.includes('15 g pour 1 000 kcal, jamais moins de 25 g'));
	assert.ok(bilanSheet.includes("D'où viennent tes fibres"), 'liste des sources du jour');
	assert.ok(!bilanSheet.includes('Principales sources'), 'plus de « Principales sources »');
	assert.ok(bilanSheet.includes('+ {sourcesCoupees.autres.length} autres'), 'reste dépliable au-delà de 6 lignes');
	assert.ok(bilanSheet.includes('Acides gras saturés'));
	assert.ok(bilanSheet.includes('% des kcal'));
	assert.ok(bilanSheet.includes('des aliments enregistrés'));
	assert.ok(
		bilanSheet.includes("Le sel ajouté en cuisine ou à table n'est pas compté."),
		'phrase sel obligatoire'
	);
	assert.ok(bilanSheet.includes('Les vitamines et minéraux'), 'phrase finale micros');
	assert.ok(bilanSheet.includes('sheetFade') && bilanSheet.includes('sheetFly'), 'volet existant réutilisé');
});

test('fiche aliment : bande de défilement hors flux derrière les contrôles + macros au format détaillé', () => {
	const bande = sheet.slice(
		sheet.indexOf('DÉFILEMENT'),
		sheet.indexOf('min-h-0 flex-1 overflow-y-auto')
	);
	assert.ok(bande.includes('pointer-events-none'), 'bande hors flux, ne bloque pas le contenu');
	assert.ok(bande.includes('absolute inset-x-0 top-[max(env(safe-area-inset-top),12px)] z-[5]'), 'superposée, derrière les boutons (z-10)');
	assert.ok(bande.includes('h-14 -translate-y-1.5'), '56 px centrée sur les contrôles de 44 px');
	assert.ok(bande.includes('transition-opacity duration-150'), 'apparition en fondu ~150 ms');
	assert.ok(bande.includes('opacity-0'), 'invisible en haut de fiche');
	assert.ok(!sheet.includes('sticky top-0 z-[1]'), 'plus de bande dans le flux : la photo garde sa hauteur');
	assert.ok(sheet.includes('bind:this={heroEl}'), 'seuil mesuré sur la photo');
	assert.ok(sheet.includes('heroEl.getBoundingClientRect().bottom'), 'bande déclenchée quand la photo sort de vue');
	assert.ok(sheet.includes('el.scrollTop > 8'), 'seuil de quelques pixels sans photo');
	assert.ok(sheet.includes('onscroll={onSheetScroll}'));
	assert.ok(
		sheet.includes('absolute right-3 top-[max(env(safe-area-inset-top),12px)] z-10'),
		'cœur et fermer restent fixes'
	);
	assert.ok(sheet.includes("formatDetailValue(kcal, 'kcal')"), 'kcal entières');
	assert.ok(sheet.includes("formatDetailValue(carbs, 'g')"), 'glucides : une décimale sous 10 g');
	assert.ok(sheet.includes("formatDetailValue(protein, 'g')"), 'protéines : même format');
	assert.ok(sheet.includes("formatDetailValue(fat, 'g')"), 'lipides : même format');
});
