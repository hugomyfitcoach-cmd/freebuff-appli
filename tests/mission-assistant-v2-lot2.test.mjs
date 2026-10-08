/**
 * MISSION — ASSISTANT G-FLUX V2 · LOT 2 (contexte client + registre d'outils).
 *
 * Couvre : registre modulaire (source unique), outils de lecture étendus,
 * bloc <contexte> injecté serveur, moyennes qualifiées (jours vides ≠ 0),
 * retour du coach distinct des analyses IA, et préservation des garde-fous.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const registrySrc = read('src/convex/assistantRegistry.ts');
const readSrc = read('src/convex/assistantRead.ts');
const assistant = read('src/convex/assistant.ts');
const aiSrc = read('src/lib/server/assistantAi.ts');
const policy = read('src/lib/assistant/policy.ts');

/* ══════════════ 1. REGISTRE — source unique, types fermés ══════════════ */

const reg = await import(new URL('../src/convex/assistantRegistry.ts', import.meta.url).href);

test('Registre : chaque outil déclare nom, type fermé, description, schéma et exécuteur', () => {
	for (const t of reg.ASSISTANT_REGISTRY) {
		assert.ok(t.name && t.description.length > 10, `${t.name} : nom + description`);
		assert.ok(['read', 'prepare', 'meta'].includes(t.kind), `${t.name} : type fermé`);
		assert.ok(t.parameters && typeof t.parameters === 'object', `${t.name} : schéma`);
		assert.equal(typeof t.run, 'function', `${t.name} : exécuteur`);
	}
});

test('Registre : les 12 outils V1 + 4 nouveaux outils de lecture', () => {
	const names = reg.ASSISTANT_REGISTRY.map((t) => t.name);
	for (const v1 of ['setTopic', 'getToday', 'searchFood', 'getFoodReference', 'estimateFoodPortion', 'searchRecipes', 'getPeriodRecap', 'getJournalEntries', 'prepareJournalEntry', 'prepareJournalRemoval', 'prepareMeasurement', 'prepareCoachQuestion']) {
		assert.ok(names.includes(v1), `V1 conservé : ${v1}`);
	}
	for (const v2 of ['getProfile', 'getMeasurements', 'getLastCheckin', 'getMealPlan']) {
		assert.ok(names.includes(v2), `Lot 2 ajouté : ${v2}`);
	}
	assert.equal(names.length, new Set(names).size, 'aucun doublon de nom');
});

test('Registre : prepare = seul type qui prépare une écriture ; read = lecture pure', () => {
	for (const t of reg.ASSISTANT_REGISTRY) {
		// Lot 2B : updateJournalEntry est un « prepare » qui MODIFIE une action
		// en attente (jamais d'écriture directe) — nom contrôlé explicitement.
		if (t.kind === 'prepare')
			assert.match(t.name, /^(prepare|update)/, `${t.name} : un outil prepare prépare ou met à jour une action en attente`);
		if (t.kind === 'read') assert.ok(!/^(prepare|set)/.test(t.name), `${t.name} : un outil read ne prépare rien`);
	}
	assert.ok(registrySrc.includes('resolveAction'), 'le registre rappelle que resolveAction reste le seul chemin d’écriture');
});

test('Registre : outil inconnu → refus propre, JAMAIS d’accès générique Convex', () => {
	assert.ok(/Outil inconnu/.test(registrySrc), 'dispatchTool refuse les outils hors liste');
	assert.ok(!/ctx\.db/.test(registrySrc), 'aucun ctx.db dans le registre (passe par ctx.runQuery/runMutation)');
});

test('Orchestrateur : le switch géant a disparu, le dispatch passe par le registre', () => {
	assert.ok(assistant.includes('dispatchTool('), 'send() délègue au registre');
	assert.ok(assistant.includes('registryToolDefs()'), 'les définitions OpenAI viennent du registre');
	assert.ok(!/case "prepareJournalEntry"/.test(assistant), 'plus aucun switch d’outils dans send()');
});

test('assistantAi : ne contient plus de catalogue dupliqué (source unique)', () => {
	assert.ok(!/name: 'searchFood'/.test(aiSrc), 'plus de catalogue d’outils dans assistantAi.ts');
	assert.ok(/runAssistantTurn/.test(aiSrc), 'la boucle générique reste dans assistantAi.ts');
});

/* ══════════════ 2. OUTILS DE LECTURE ÉTENDUS ══════════════ */

test('Outils lecture : profil, mesures, bilan coach, plan — tous en lecture seule', () => {
	for (const fn of ['getProfile', 'getMeasurements', 'getLastCheckin', 'getMealPlan', 'contextFor']) {
		assert.ok(new RegExp(`export const ${fn} = query`).test(readSrc), `${fn} est une query (lecture)`);
	}
	assert.ok(!/\.insert\(|\.patch\(|\.delete\(/.test(readSrc), 'AUCUNE écriture dans le module de lecture');
});

test('Outils lecture : garde commune (session + rôle + flag + hard lock) sur chaque query', () => {
	const guards = (readSrc.match(/requireReadClient\(ctx/g) ?? []).length;
	assert.ok(guards >= 5, `garde présente dans toutes les queries (trouvée ${guards}×)`);
	assert.ok(readSrc.includes('requireAssistantClient'), 'passe par le garde canonique assistant');
});

test('Bilan : le retour du COACH est identifié comme consigne officielle (jamais confondu avec l’IA)', () => {
	assert.ok(readSrc.includes('coachFeedback'), 'champ coachFeedback dédié');
	assert.ok(/RETOUR DE HUGO/.test(readSrc), 'le bloc contexte marque explicitement la provenance coach');
});

test('Mensurations : bornes anti-abus (take ≤ 20) et tendance déterministe', () => {
	assert.ok(/Math\.min\(20, Math\.max\(1, limit\)\)/.test(readSrc), 'limit borné');
	assert.ok(/weightTrend/.test(readSrc), 'tendance calculée côté serveur');
});

/* ══════════════ 3. CONTEXTE INJECTÉ — fonctionnel ══════════════ */

const readMod = await import(new URL('../src/convex/assistantRead.ts', import.meta.url).href);

test('buildContextBlock : bloc compact avec objectifs, jour, semaine qualifiée', () => {
	const block = readMod.buildContextBlock({
		prenom: 'Sophie',
		mode: 'coaching',
		goals: { kcal: 1950, protein: 120, carbs: 180, fat: 60, stepGoal: 8000 },
		eaten: { kcal: 1154, protein: 98.9, carbs: 120.9, fat: 30.1 },
		remaining: { kcal: 796, protein: 21.1, carbs: 59.1, fat: 29.9 },
		week: { daysTotal: 7, daysLogged: 2, daysMissing: 5, avgKcal: 1175 },
		measurements: [{ date: '2026-10-05', weightKg: 67.3 }],
		weightTrend: { fromKg: 68, toKg: 67.3, deltaKg: -0.7 },
		lastCheckin: { weekLabel: 'Semaine 40', coachFeedback: { text: 'Continue comme ça.' } },
		mealPlan: { name: 'Plan recompo', startDate: '2026-10-01', endDate: '2026-11-01' },
	});
	assert.ok(block.startsWith('<contexte>') && block.endsWith('</contexte>'), 'bloc délimité');
	assert.ok(block.includes('1950 kcal') && block.includes('NE JAMAIS modifier'), 'objectifs marqués intouchables');
	assert.ok(block.includes('796 kcal'), 'restes du jour présents');
	assert.ok(block.includes('2/7') || block.includes('5 sans saisie'), 'couverture de semaine exposée');
	assert.ok(block.includes('RETOUR DE HUGO') && block.includes('Continue comme ça.'), 'retour coach distinct');
	assert.ok(block.includes('Plan recompo'), 'plan alimentaire mentionné');
});

test('buildContextBlock : borné en taille (coût tokens maîtrisé)', () => {
	const big = readMod.buildContextBlock({
		prenom: 'X'.repeat(200),
		mode: 'coaching',
		goals: { kcal: 1, protein: 1, carbs: 1, fat: 1, stepGoal: null },
		eaten: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
		remaining: { kcal: 1, protein: 1, carbs: 1, fat: 1 },
		week: { daysTotal: 7, daysLogged: 0, daysMissing: 7, avgKcal: null },
		measurements: [],
		weightTrend: null,
		lastCheckin: { weekLabel: 'w', coachFeedback: { text: 'y'.repeat(1000) } },
		mealPlan: null,
	});
	assert.ok(big.length < 2500, `bloc compact (${big.length} < 2500 caractères)`);
});

test('Moyennes : qualifyWeek ne compte JAMAIS un jour vide comme un 0', () => {
	const q = readMod.qualifyWeek(
		[
			{ date: '2026-10-05', kcal: 1900 },
			{ date: '2026-10-06', kcal: 0 },
			{ date: '2026-10-07', kcal: 0 },
		],
		2000
	);
	assert.equal(q.daysTotal, 3);
	assert.equal(q.daysLogged, 1);
	assert.equal(q.daysMissing, 2);
	assert.equal(q.avgKcal, 1900, 'moyenne sur les jours RENSEIGNÉS uniquement');
});

test('Contexte injecté au tour : échec non bloquant (try/catch) dans send()', () => {
	assert.ok(/contexte indisponible : on continue sans/.test(assistant), 'panne du contexte ≠ panne de l’assistant');
});

/* ══════════════ 4. SÉCURITÉ — non-régression ══════════════ */

test('Sécurité : l’identité vient de la session, jamais d’un id du modèle', () => {
	assert.ok(!/userId: args\.|userId: a\.|userId: String\(a\./.test(readSrc + registrySrc), 'aucun userId pris des arguments');
	assert.ok(readSrc.includes('requireReadClient(ctx, sessionToken)'), 'identité résolue depuis la session');
});

test('Sécurité : garde Billing et quotas toujours recalculés côté Convex', () => {
	assert.ok(readSrc.includes('requireAssistantClient'), 'garde assistant partagée');
	assert.ok(assistant.includes('accessStateForUser'), 'hard lock intact dans send');
	assert.ok(assistant.includes('INFLIGHT_TIMEOUT_MS'), 'anti double-submit intact');
});

test('Sécurité : flag serveur unique — le registre n’active rien sans policy', () => {
	assert.ok(readSrc.includes('assistantEnabledFor') || readSrc.includes('requireAssistantClient'), 'flag via la garde canonique');
	assert.ok(policy.includes('ASSISTANT_DISABLED'), 'kill switch toujours dans policy.ts');
});
