/**
 * Tests MISSION R3 — aliments de référence G-Flux gérés par le coach.
 *
 * Le coach crée ses propres aliments de référence (valeurs /100 g). Ils
 * apparaissent dans la section « Aliments de référence » des recherches
 * (journal cliente, fiche cliente CRM, plans de repas) avec un badge
 * « Référence G-Flux » à la place du badge Ciqual, soumis aux mêmes règles de
 * classement — à pertinence égale, G-Flux passe avant Ciqual.
 *
 * Les entrées de journal / de plan enregistrent une COPIE du nom et des
 * valeurs : modifier ou supprimer la fiche ne change jamais le passé.
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
	canManageReferenceFood,
	cleanReferenceFood,
	kcalMismatchWarning,
	mergeReferenceHits,
	rankReferenceFoods,
	referenceCookBadge,
	referenceFoodError,
	referenceFoodHit,
	referenceFoodSnapshot,
} from '../src/lib/referenceFoods.ts';
import { searchCiqualLocal } from '../src/convex/ciqual.ts';

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const valid = { name: 'Poulet fermier G-Flux', kcal: 165, proteinG: 31, carbsG: 0, fatG: 4 };
const coachA = { _id: 'coach-a', role: 'coach' };
const coachB = { _id: 'coach-b', role: 'coach' };
const client = { _id: 'client-1', role: 'client' };

/* ─── 1) Permissions : la cliente ne crée / modifie jamais ─── */

test('une cliente ne peut ni créer ni modifier un aliment de référence', () => {
	assert.equal(canManageReferenceFood(client, { coachId: 'coach-a' }), false, 'client non autorisée');
	// Le contrôle Convex exige un rôle coach ET la propriété de la fiche.
	const convex = source('src/convex/referenceFoods.ts');
	assert.match(convex, /async function requireCoach/, 'création/modification réservées au rôle coach');
	assert.ok(
		/if \(user\.role !== "coach"\) throw new ConvexError/.test(convex),
		'la cliente reçoit une ConvexError claire (pas un accès silencieux)'
	);
	assert.ok(/export const create = mutation/.test(convex), 'mutation create');
	assert.ok(/export const update = mutation/.test(convex), 'mutation update');
	assert.ok(/export const remove = mutation/.test(convex), 'mutation remove');
	// Les trois mutations passent par le contrôle propriétaire.
	assert.equal((convex.match(/canManageReferenceFood\(coach, row\)/g) ?? []).length, 2, 'update + remove');
});

test("un coach ne peut pas modifier l'aliment d'un autre coach", () => {
	assert.equal(canManageReferenceFood(coachB, { coachId: 'coach-a' }), false, 'autre coach refusé');
	assert.equal(canManageReferenceFood(coachA, { coachId: 'coach-a' }), true, 'propriétaire autorisé');
	assert.equal(canManageReferenceFood(null, { coachId: 'coach-a' }), false, 'session absente refusée');
	// Une fiche introuvable est traitée comme non autorisée (aucun oracle).
	const convex = source('src/convex/referenceFoods.ts');
	assert.ok(
		/if \(!row \|\| !canManageReferenceFood\(coach, row\)\) throw new ConvexError\("Aliment de référence introuvable\."\)/.test(
			convex
		),
		'update : propriétaire vérifié avant toute écriture'
	);
	assert.ok(
		/if \(!canManageReferenceFood\(coach, row\)\) throw new ConvexError\("Aliment de référence introuvable\."\)/.test(
			convex
		),
		'remove : propriétaire vérifié avant toute suppression'
	);
});

/* ─── 2) Validation serveur ─── */

test('validation : kcal 950 refusé, bornes nom / macros respectées', () => {
	const kcalTooHigh = referenceFoodError({ ...valid, kcal: 950 });
	assert.ok(kcalTooHigh, 'kcal 950 refusée');
	assert.match(kcalTooHigh, /900/, 'message clair sur la borne kcal');
	assert.equal(referenceFoodError(valid), null, 'saisie valide acceptée');
	assert.match(referenceFoodError({ ...valid, name: 'A' }), /2 et 120/, 'nom trop court refusé');
	assert.match(referenceFoodError({ ...valid, name: 'x'.repeat(121) }), /2 et 120/, 'nom trop long refusé');
	assert.match(referenceFoodError({ ...valid, proteinG: 101 }), /100/, 'macro > 100 g refusée');
	assert.match(referenceFoodError({ ...valid, fatG: -1 }), /positif/, 'valeur négative refusée');
	assert.deepEqual(cleanReferenceFood({ ...valid, name: '  Poulet  ', kcal: 165.04 }), {
		name: 'Poulet',
		kcal: 165,
		proteinG: 31,
		carbsG: 0,
		fatG: 4,
	});
	// Le serveur applique la même validation que le module testé.
	const convex = source('src/convex/referenceFoods.ts');
	assert.ok(/const error = referenceFoodError\(input\);/.test(convex), 'create valide côté serveur');
	assert.equal((convex.match(/const error = referenceFoodError\(input\);/g) ?? []).length, 2, 'create + update');
});

test('avertissement kcal non bloquant : > 15 % de 4P + 4G + 9L', () => {
	// 4×31 + 0 + 9×4 = 160 kcal → 165 kcal est dans la tolérance.
	assert.equal(kcalMismatchWarning(valid), false);
	// 4×10 = 40 kcal théoriques, 200 kcal saisies → écart majeur.
	assert.equal(kcalMismatchWarning({ ...valid, kcal: 200, proteinG: 10, carbsG: 0, fatG: 0 }), true);
});

/* ─── 3) Recherche : badge G-Flux, mêmes règles, G-Flux avant Ciqual ─── */

test('« poulet » renvoie l’aliment G-Flux avec son badge, avant Ciqual à pertinence égale', () => {
	const ciqual = searchCiqualLocal('poulet', 13);
	assert.ok(ciqual.length > 0, 'fiches Ciqual de référence présentes');

	const gflux = [{ ...valid, _id: 'ref-1', coachId: 'coach-a' }];
	const merged = mergeReferenceHits('poulet', gflux, ciqual);

	assert.equal(merged[0].label, 'Poulet fermier G-Flux', 'fiche G-Flux en tête');
	assert.equal(merged[0].source, 'gflux', 'provenance G-Flux (badge distinct)');
	assert.equal(merged[0].id, 'ref-1', 'identifiant brut de la fiche (aucun préfixe)');
	assert.deepEqual(
		{ kcal: merged[0].kcal, protein: merged[0].protein, carbs: merged[0].carbs, fat: merged[0].fat },
		{ kcal: 165, protein: 31, carbs: 0, fat: 4 },
		'valeurs /100 g de la fiche'
	);
	// L'ordre Ciqual existant est préservé (aucun tri concurrent).
	assert.deepEqual(
		merged.slice(1).map((h) => h.label),
		ciqual.map((h) => h.label),
		'les fiches Ciqual restent dans leur ordre R1'
	);
	// Badge affiché tel quel dans les trois écrans de recherche.
	for (const page of [
		'src/routes/espace/journal/+page.svelte',
		'src/routes/admin/+page.svelte',
		'src/routes/admin/plans/+page.svelte',
	]) {
		const src = source(page);
		assert.ok(src.includes('Référence G-Flux'), `${page} : badge G-Flux rendu`);
		assert.ok(src.includes('Référence Ciqual – ANSES'), `${page} : badge Ciqual conservé`);
	}
	// Badge G-Flux : MÊME style vert que « Référence Ciqual – ANSES » (R3-ter).
	const journal = source('src/routes/espace/journal/+page.svelte');
	assert.match(journal, /data-gflux-badge[^>]*bg-brand-light[^>]*text-brand/, 'badge G-Flux au style vert Ciqual');
});

test('règles de classement appliquées aux fiches G-Flux (tous les mots, consécutifs, cuisson)', () => {
	const foods = [
		{ name: 'Poulet basquaise', kcal: 120, proteinG: 12, carbsG: 5, fatG: 5 },
		{ name: 'Poulet fermier', kcal: 165, proteinG: 31, carbsG: 0, fatG: 4 },
		{ name: 'Riz complet', kcal: 350, proteinG: 8, carbsG: 72, fatG: 2 },
	];
	assert.deepEqual(
		rankReferenceFoods('poulet', foods).map((f) => f.name),
		['Poulet fermier', 'Poulet basquaise'],
		'seuls les noms contenant « poulet » sont candidats (règle « tous les mots »)'
	);
	assert.deepEqual(rankReferenceFoods('poulet curry', foods), [], 'mot manquant → aucun candidat');
	const cooked = rankReferenceFoods('poulet cuit', [
		{ name: 'Poulet cru', kcal: 120, proteinG: 21, carbsG: 0, fatG: 3 },
		{ name: 'Poulet cuit', kcal: 165, proteinG: 31, carbsG: 0, fatG: 4 },
	]);
	assert.equal(cooked[0].name, 'Poulet cuit', 'cuisson tapée prioritaire');
	assert.equal(referenceFoodHit({ ...valid, _id: 'x' }).source, 'gflux');
});

/* ─── 4) Snapshot : modifier la fiche ne touche jamais le passé ─── */

test('une entrée de journal garde ses valeurs après modification de l’aliment', () => {
	const food = { ...valid };
	const snapshot = referenceFoodSnapshot(food, 150);
	assert.deepEqual(snapshot, { name: 'Poulet fermier G-Flux', qtyGrams: 150, kcal: 248, carbs: 0, protein: 46.5, fat: 6 });
	// Le coach modifie puis supprime la fiche : le snapshot ne bouge pas.
	food.name = 'Poulet fermier (nouveau nom)';
	food.kcal = 200;
	food.proteinG = 40;
	assert.deepEqual(snapshot, { name: 'Poulet fermier G-Flux', qtyGrams: 150, kcal: 248, carbs: 0, protein: 46.5, fat: 6 });

	// Le journal enregistre CE snapshot, sans lien vers la fiche.
	const journal = source('src/convex/journal.ts');
	assert.ok(/resolveReferenceFood\(ctx, user, referenceFoodId\)/.test(journal), 'addEntry résout la fiche côté serveur');
	assert.ok(/resolveReferenceFood\(ctx, coach, referenceFoodId\)/.test(journal), 'addEntryForCoach résout la fiche côté serveur');
	assert.ok(/kcal: Math\.round\(kcal100 \* k\)/.test(journal), 'valeurs copiées à l’ajout');
	const plans = source('src/convex/mealPlans.ts');
	assert.ok(/resolveReferenceFood\(ctx, coach, it\.referenceFoodId\)/.test(plans), 'plans : fiche résolue à l’ajout');
	assert.ok(/ciqualLabel: ciqualFood \? it\.ciqualLabel : undefined/.test(plans), 'plans : copie, aucun lien G-Flux');
});

test('un ajout G-Flux enregistre referenceSource « gflux » et laisse ciqualLabel vide', () => {
	// Identité d'ajout = identifiant BRUT de la fiche, jamais un libellé préfixé.
	assert.equal(referenceFoodHit({ ...valid, _id: 'ref-1' }).id, 'ref-1', 'identifiant brut de la fiche');
	assert.equal(referenceFoodHit({ ...valid, _id: 'ref-1' }).source, 'gflux', 'provenance explicite');

	const journal = source('src/convex/journal.ts');
	// La fiche est résolue par son IDENTIFIANT, uniquement quand la provenance
	// déclarée est « gflux ».
	assert.ok(
		/referenceSource === "gflux" \? await resolveReferenceFood\(ctx, user, referenceFoodId\) : null/.test(journal),
		'addEntry : fiche résolue par identifiant, seulement si referenceSource = gflux'
	);
	assert.ok(
		/referenceSource === "gflux" \? await resolveReferenceFood\(ctx, coach, referenceFoodId\) : null/.test(journal),
		'addEntryForCoach : idem côté coach'
	);
	// Chaque écriture porte referenceSource = « gflux » (planned, consommé, coach).
	assert.equal(
		(journal.match(/referenceSource: gfluxRef \? "gflux" : ciqualRef \? "ciqual" : undefined/g) ?? []).length,
		3,
		'planned + consommé + ajout coach écrivent la provenance'
	);
	// Aucune écriture de ciqualLabel depuis une fiche G-Flux.
	assert.ok(!/ciqualLabel: gfluxRef/.test(journal), 'ciqualLabel jamais renseigné par une fiche G-Flux');
	assert.ok(
		/referenceSource: gfluxRef \? "gflux" : ciqualRef \? "ciqual" : undefined/.test(journal),
		'provenance écrite, ciqualLabel réservé à Ciqual'
	);

	// Plans : même contrat (provenance + identifiant, jamais ciqualLabel).
	const plans = source('src/convex/mealPlans.ts');
	assert.ok(
		/it\.referenceSource === "gflux" \? await resolveReferenceFood\(ctx, coach, it\.referenceFoodId\) : null/.test(plans),
		'plans : fiche résolue par identifiant'
	);
	assert.ok(
		/referenceSource: gfluxFood \? .*"gflux".* : ciqualFood \? .*"ciqual".* : undefined/.test(plans),
		'plans : provenance écrite'
	);

	// Le schéma accepte le champ ADDITIF (aucune donnée existante migrée).
	const schema = source('src/convex/schema.ts');
	assert.ok(
		/referenceSource: v\.optional\(v\.union\(v\.literal\("ciqual"\), v\.literal\("gflux"\)\)\)/.test(schema),
		'referenceSource facultatif sur les tables d’entrées et de plans'
	);
});

test('un ajout Ciqual garde son ciqualLabel', () => {
	const journal = source('src/convex/journal.ts');
	assert.ok(
		/const ciqualRef = !gfluxRef && ciqualLabel \? ciqualFoodSource\(ciqualLabel\) : null/.test(journal),
		'addEntry garde la résolution Ciqual'
	);
	const plans = source('src/convex/mealPlans.ts');
	assert.ok(/ciqualLabel: ciqualFood \? it\.ciqualLabel : undefined/.test(plans), 'plans : ciqualLabel conservé');
	// Le champ reste facultatif et inchangé dans le schéma.
	const schema = source('src/convex/schema.ts');
	assert.ok(/ciqualLabel: v\.optional\(v\.string\(\)\)/.test(schema), 'ciqualLabel inchangé');
});

test('aucune chaîne « gflux: » comme identité d’aliment dans le code source', () => {
	const files = [
		'src/lib/referenceFoods.ts',
		'src/lib/foodSearch.svelte.ts',
		'src/convex/referenceFoods.ts',
		'src/convex/ciqual.ts',
		'src/convex/journal.ts',
		'src/convex/mealPlans.ts',
		'src/routes/espace/journal/+page.svelte',
		'src/routes/admin/+page.svelte',
		'src/routes/admin/plans/+page.svelte',
	];
	for (const file of files) {
		const src = source(file);
		assert.ok(!/gflux:\$\{/.test(src), `${file} : aucun identifiant préfixé construit`);
		assert.ok(!/GFX_LABEL_PREFIX|gfluxIdFromLabel|referenceFoodLabel/.test(src), `${file} : aucune logique de préfixe`);
		assert.ok(!/['"`]gflux:['"`]\s*\+/.test(src), `${file} : aucun préfixe concaténé`);
	}
	// Le seul identifiant de fiche G-Flux transmis est `referenceFoodId`.
	const journal = source('src/convex/journal.ts');
	assert.ok(/referenceFoodId: v\.optional\(v\.string\(\)\)/.test(journal), 'ajout par referenceFoodId');
	assert.ok(/resolveReferenceFood\(ctx, user, referenceFoodId\)/.test(journal), 'résolution par identifiant');
});

/* ─── 5) Mission R3-ter : page dédiée, cuisson explicite, badge unifié ─── */

/** Apostrophes typographiques normalisées (comparaison de texte insensible). */
const normText = (s) => s.replace(/[\u2019']/g, "'");

test('R3-ter : la gestion des aliments a quitté la page recettes', () => {
	const recettes = source('src/routes/recettes/+page.svelte');
	assert.ok(!recettes.includes('reference-foods'), 'page recettes : plus d’appel API des fiches');
	assert.ok(!/refForm|refFoods|refSaving/.test(recettes), 'page recettes : plus de formulaire ni de liste');
	assert.ok(!recettes.includes('Référence G-Flux'), 'page recettes : section entièrement retirée');
});

test('R3-ter : page « Aliments de référence » — accès coach, encadré, entrée de menu', () => {
	const layout = source('src/routes/aliments-reference/+layout.server.ts');
	assert.match(layout, /requireRole\(event, 'coach', \{ next: '\/aliments-reference' \}\)/, 'accès réservé au coach');

	const page = normText(source('src/routes/aliments-reference/+page.svelte'));
	assert.ok(page.includes('Tes aliments de référence'), 'encadré : titre exact');
	assert.ok(
		page.includes(
			"Ajoute ici les aliments que tu recommandes souvent et qui manquent dans la base Ciqual (une préparation précise, un produit que tu utilises avec tes clientes)."
		),
		'encadré : paragraphe d’introduction exact'
	);
	assert.ok(
		page.includes(
			"Ce que voient tes clientes : quand elles cherchent un aliment dans leur journal, tes aliments apparaissent dans « Aliments de référence », avec le badge « Référence G-Flux ». À pertinence égale, ils passent avant les aliments Ciqual."
		),
		'encadré : explication côté cliente exacte'
	);
	assert.ok(page.includes('Les bonnes règles :'), 'encadré : titre des règles');
	for (const rule of [
		"Vérifie d'abord que l'aliment n'existe pas déjà dans Ciqual : cherche-le dans un journal.",
		"Saisis toujours les valeurs pour 100 g, d'après une source fiable (étiquette, table nutritionnelle).",
		"Donne un nom clair, l'aliment d'abord puis les précisions : « Poulet, blanc, sans peau ».",
		"Choisis le mode de cuisson : il s'affiche sous le nom pour tes clientes.",
		'Modifier ou supprimer un aliment ne change jamais ce que tes clientes ont déjà enregistré.',
	]) {
		assert.ok(page.includes(rule), `encadré : règle « ${rule.slice(0, 30)}… »`);
	}
	assert.match(page, /Aucun aliment pour l.instant\./, 'état vide présent');

	const shell = source('src/lib/components/AppShell.svelte');
	assert.match(
		shell,
		/\{ href: '\/aliments-reference', label: 'Aliments de référence', icon: 'salad' \}/,
		'entrée de menu COACHING présente'
	);
	assert.ok(
		shell.indexOf("label: 'Guide nutrition & recettes'") < shell.indexOf("label: 'Aliments de référence'"),
		'entrée placée juste sous Guide nutrition & recettes'
	);
});

test('R3-ter : cookingState pilote le badge de cuisson', () => {
	// « four » → « Au four » même si le nom ne le dit pas.
	assert.equal(referenceCookBadge({ name: 'Poulet blanc', cookingState: 'four' }), 'Au four');
	assert.equal(referenceCookBadge({ name: 'Purée maison', cookingState: 'eau' }), "Cuit à l'eau");
	assert.equal(referenceCookBadge({ name: 'Légumes', cookingState: 'vapeur' }), 'Vapeur');
	// Sans cookingState : détection d'après le nom (inchangée).
	assert.equal(referenceCookBadge({ name: 'Poulet rôti' }), 'Au four');
	assert.equal(referenceCookBadge({ name: 'Haricots verts en conserve' }), 'En conserve');
	assert.equal(referenceCookBadge({ name: 'Poulet blanc' }), null, 'aucune cuisson → aucun badge');
});

test('R3-ter : valeur de cuisson invalide refusée par la validation serveur', () => {
	const bad = referenceFoodError({ ...valid, cookingState: 'micro-ondes' });
	assert.ok(bad, 'valeur inconnue refusée');
	assert.match(bad, /cuisson/i, 'message clair');
	assert.equal(referenceFoodError({ ...valid, cookingState: 'four' }), null, 'valeur valide acceptée');
	assert.equal(referenceFoodError({ ...valid, cookingState: '' }), null, 'vide = non précisé');
	// Le serveur applique bien cette validation (create + update = 2 appels).
	const convex = source('src/convex/referenceFoods.ts');
	assert.equal((convex.match(/const error = referenceFoodError\(input\);/g) ?? []).length, 2, 'create + update');
});

test('R3-ter : badge G-Flux sans classe ambre (style vert Ciqual partout)', () => {
	for (const page of [
		'src/routes/espace/journal/+page.svelte',
		'src/routes/admin/+page.svelte',
		'src/routes/admin/plans/+page.svelte',
		'src/lib/components/QuantitySheet.svelte',
	]) {
		const src = source(page);
		assert.ok(!src.includes('FFF3D6'), `${page} : fond ambre retiré`);
		assert.ok(!src.includes('8A5A00'), `${page} : texte ambre retiré`);
	}
});

test('la table de référence reste additive et partage le moteur Ciqual', () => {
	// La table est additive : aucune table existante n'est modifiée.
	const schema = source('src/convex/schema.ts');
	assert.ok(/\treferenceFoods: defineTable\(\{/.test(schema), 'table referenceFoods ajoutée');
	assert.ok(/\/\*\*\n\t \* ALIMENTS DE RÉFÉRENCE G-FLUX/.test(schema), 'documentation additive');
	// La recherche G-Flux passe par le même moteur que Ciqual.
	const ciqual = source('src/convex/ciqual.ts');
	assert.ok(/listReferenceFoodsForUser/.test(ciqual) && /mergeReferenceHits/.test(ciqual), 'même section de recherche');
});
