/**
 * MISSION M3 — VRAI FOURNISSEUR POUR LES BROUILLONS DE RETOUR.
 *
 * FOURNISSEUR SIMULÉ, AUCUN APPEL RÉEL : `fetch` est remplacé par une
 * maquette qui capture la requête envoyée à OpenAI et renvoie une réponse
 * factice. Aucune clé réelle, aucune donnée cliente réelle, aucune écriture
 * Convex.
 *
 * Couverture demandée :
 *  - guide de style : source unique (génération au build, test de divergence) ;
 *  - ordre et contenu des consignes (méthode, guide, contexte, réponses) ;
 *  - absence de nom, e-mail et identifiant dans l'appel, prénom réinséré ;
 *  - arrêt d'urgence prioritaire ;
 *  - variable absente ou vide → fournisseur factice ;
 *  - erreur → message clair ;
 *  - enregistrement des coûts (modèle, tokens lus/écrits/mis en cache, durée).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	anonymizePrenom,
	buildCoachDraftPrompt,
	PRENOM_PLACEHOLDER,
	restorePrenom,
} from '../src/convex/coachDraftPrompt.ts';
import {
	COACH_DRAFT_MODEL_ENV,
	generateText,
	resolveGenerationConfig,
} from '../src/convex/ai/provider.ts';
import { COACH_DRAFT_STYLE_GUIDE } from '../src/lib/data/coachDraftStyleGuide.ts';
import { COACH_DRAFT_METHOD_REFERENCE } from '../src/convex/ai/methodeGflux.ts';
import { renderGuideModule } from '../scripts/gen-guide-style.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const fixturesDir = join(root, 'tests/fixtures/coach-draft');
const fileExamples = JSON.parse(readFileSync(join(root, 'src/lib/data/coach-feedback-examples.json'), 'utf8'));

const contextOf = (file) => JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));

function buildFor(context, targetWords) {
	return buildCoachDraftPrompt({
		context,
		styleGuide: COACH_DRAFT_STYLE_GUIDE,
		methodReference: COACH_DRAFT_METHOD_REFERENCE,
		examples: [...fileExamples, ...context.examples],
		targetWords,
	});
}

/* ═══════════ 1) GUIDE DE STYLE — SOURCE UNIQUE, COMME LA MÉTHODE ═══════════ */

test('guide-style-retours.md est la seule source : le module généré ne diverge jamais', () => {
	const markdown = read('docs/guide-style-retours.md');
	const expected = renderGuideModule(markdown);
	const module_ = read('src/lib/data/coachDraftStyleGuide.ts');
	assert.equal(
		module_,
		expected,
		'le module diverge du générateur : relancer scripts/gen-guide-style.mjs et n’éditer que le .md'
	);
	assert.ok(module_.includes('FICHIER GÉNÉRÉ, NE PAS ÉDITER'), 'en-tête de génération présent');
	assert.ok(!markdown.includes('FICHIER GÉNÉRÉ'), 'le .md est la source, jamais un fichier généré');
	assert.ok(markdown.includes('# Guide de style des retours G-Flux'), 'guide complet transmis');
	const pkg = JSON.parse(read('package.json'));
	assert.ok(pkg.scripts.build.includes('gen-guide-style'), 'le générateur tourne à chaque build');
});

test('Le guide de style ne voyage qu’avec les fonctions Convex — jamais dans le bundle navigateur', () => {
	const offenders = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			if (statSync(p).isDirectory()) walk(p);
			else if (/\.(ts|svelte|js)$/.test(name) && readFileSync(p, 'utf8').includes('coachDraftStyleGuide')) {
				offenders.push(p.slice(root.length + 1));
			}
		}
	};
	walk(join(root, 'src'));
	for (const file of offenders) {
		assert.ok(file.startsWith('src/convex/'), `import navigateur possible : ${file}`);
	}
	assert.ok(offenders.includes('src/convex/coachDraft.ts'), 'le guide est bien chargé par le serveur');
});

/* ═══════════════ 2) CONSIGNES — ORDRE ET CONTENU DE L’APPEL ═══════════════ */

test('Ordre des consignes : méthode, guide de style, contexte de la semaine, réponses du bilan', () => {
	const prompt = buildFor(contextOf('progression.context.json'));
	const methode = prompt.indexOf('--- 1. RÉFÉRENTIEL DE MÉTHODE ---');
	const guide = prompt.indexOf('--- 2. GUIDE DE STYLE ---');
	const contexte = prompt.indexOf('FAITS DE LA SEMAINE');
	const reponses = prompt.indexOf('Réponses du bilan :');
	assert.ok(methode >= 0 && guide > methode, 'la méthode précède le guide de style');
	assert.ok(contexte > guide, 'le contexte de la semaine vient après les deux sources');
	assert.ok(reponses > contexte, 'les réponses du bilan viennent en dernier');
	assert.ok(prompt.indexOf('CONSIGNES DE RÉDACTION') > reponses, 'les consignes ferment le prompt');
	assert.ok(prompt.includes(COACH_DRAFT_METHOD_REFERENCE.slice(0, 40)), 'méthode intégralement injectée');
	assert.ok(prompt.includes(COACH_DRAFT_STYLE_GUIDE.slice(0, 40)), 'guide intégralement injecté');
});

test('Méthode et guide sont EN TÊTE et identiques à chaque appel (cache de prompt)', () => {
	const one = buildFor(contextOf('progression.context.json'));
	const two = buildFor(contextOf('alerte-fatigue.context.json'));
	const cut = (prompt) => prompt.slice(0, prompt.indexOf('--- 3. EXEMPLES'));
	assert.ok(cut(one).length > 1000, 'tête d’appel substantielle');
	assert.equal(cut(one), cut(two), 'le préfixe ne dépend pas de la cliente : même cache pour tous les appels');
});

test('Les consignes couvrent les règles de rédaction demandées', () => {
	const prompt = buildFor(contextOf('stagnation.context.json'));
	assert.ok(prompt.includes('en français'), 'français exigé');
	assert.ok(prompt.includes('ton et la structure du guide de style'), 'ton et structure du guide exigés');
	assert.ok(prompt.includes('uniquement sur les chiffres présents dans le contexte'), 'aucun chiffre hors contexte');
	assert.ok(prompt.includes('INTERDICTION DE CALCULER'), 'jamais de calcul');
	assert.ok(prompt.includes("INTERDICTION D'INVENTER"), 'jamais d’invention');
	assert.ok(prompt.includes('section 10'), 'interdits de la méthode (section 10) rappelés');
	assert.ok(prompt.includes('aucun ton moqueur ou culpabilisant'), 'interdit de la méthode explicite');
	assert.ok(prompt.includes("Ne mentionne jamais l'IA"), 'IA jamais mentionnée');
	assert.ok(prompt.includes("Rien n'est envoyé à la cliente"), 'brouillon seulement');
	assert.ok(prompt.includes('Hugo relit'), 'le coach relit avant publication');
	assert.ok(prompt.includes('prêt à être relu par Hugo'), 'sortie = brouillon relu');
});

/* ═══════════ 3) DONNÉES MINIMALES — {{prenom}} DANS L’APPEL ═══════════ */

test('Le prénom est remplacé par {{prenom}} dans l’appel, puis réinséré côté serveur', () => {
	const context = contextOf('progression.context.json');
	const prompt = buildFor(context);
	assert.ok(prompt.includes(PRENOM_PLACEHOLDER), 'marqueur {{prenom}} présent');
	assert.ok(!prompt.includes(context.prenom), 'prénom réel absent de l’appel');
	// Réinsertion, y compris avec une variante d’espacement du modèle.
	assert.equal(restorePrenom(`Salut ${PRENOM_PLACEHOLDER}, bilan reçu.`, context.prenom), `Salut ${context.prenom}, bilan reçu.`);
	assert.equal(restorePrenom('Salut {{ prenom }}, bilan reçu.', context.prenom), `Salut ${context.prenom}, bilan reçu.`);
	assert.equal(restorePrenom('Aucun marqueur ici.', context.prenom), 'Aucun marqueur ici.');
	// Prénom vide ou absent : aucune transformation hasardeuse.
	assert.equal(anonymizePrenom('texte', ''), 'texte');
	assert.equal(restorePrenom('texte', ''), 'texte');
});

/* ═════════ 4) FOURNISSEUR RÉEL — APPEL SIMULÉ (fetch maquetté) ═════════ */

/** Maquette fetch : capture la requête et renvoie une réponse factice. */
function mockFetch(response) {
	const calls = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), init });
		if (typeof response === 'function') return response(String(url), init);
		return response;
	};
	return {
		calls,
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

const jsonResponse = (body, status = 200) => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => body,
});

/** Sauvegarde / restauration de la clé de test (jamais affichée). */
function withFakeKey(run) {
	const saved = process.env.OPENAI_API_KEY;
	process.env.OPENAI_API_KEY = 'cle-de-test-simulee';
	return Promise.resolve()
		.then(run)
		.finally(() => {
			if (saved === undefined) delete process.env.OPENAI_API_KEY;
			else process.env.OPENAI_API_KEY = saved;
		});
}

test('Variable absente ou vide → fournisseur factice, aucun appel réseau', async () => {
	const fetchMock = mockFetch(() => {
		throw new Error('fetch ne doit jamais être appelé');
	});
	try {
		for (const env of [{}, { [COACH_DRAFT_MODEL_ENV]: '' }, { [COACH_DRAFT_MODEL_ENV]: '   ' }]) {
			const result = await generateText({
				feature: 'coach_draft',
				env,
				system: 'système',
				prompt: 'prompt',
				maxTokens: 400,
				fakeFacts: { prenom: 'Léa', weekLabel: 'S41' },
			});
			assert.equal(result.usage.provider, 'fake', `fournisseur factice attendu pour ${JSON.stringify(env)}`);
			assert.ok(result.text.startsWith('Brouillon de test'), 'texte factice reconnaissable');
			assert.equal(result.usage.cachedInputTokens, 0, 'aucun cache factice');
		}
		assert.equal(fetchMock.calls.length, 0, 'aucun appel réseau');
		// Résolution explicite : la variable absente traite « openai » comme factice.
		assert.deepEqual(resolveGenerationConfig('coach_draft', {}), { provider: 'fake', model: 'fake-deterministic-v1' });
		assert.deepEqual(
			resolveGenerationConfig('coach_draft', { AI_PROVIDER_COACH_DRAFT: 'openai', [COACH_DRAFT_MODEL_ENV]: '  ' }),
			{ provider: 'fake', model: 'fake-deterministic-v1' }
		);
	} finally {
		fetchMock.restore();
	}
});

test('Variable présente → appel OpenAI simulé : modèle de la variable, aucune identité, usages complets', async () => {
	const context = contextOf('progression.context.json');
	const prompt = buildFor(context);
	const system = 'Tu es Hugo, coach G-FLUX.';
	const fetchMock = mockFetch(
		jsonResponse({
			output_text: `Salut ${PRENOM_PLACEHOLDER}, bilan bien reçu. On ne touche à rien.`,
			usage: {
				input_tokens: 1234,
				output_tokens: 210,
				input_tokens_details: { cached_tokens: 1024 },
			},
		})
	);
	try {
		await withFakeKey(async () => {
			const result = await generateText({
				feature: 'coach_draft',
				env: { [COACH_DRAFT_MODEL_ENV]: 'modele-simule-m3' },
				system,
				prompt,
				maxTokens: 400,
			});

			// 1) Un seul appel, vers l'API Responses, avec le modèle de la variable.
			assert.equal(fetchMock.calls.length, 1);
			const { url, init } = fetchMock.calls[0];
			assert.ok(url.includes('api.openai.com'), 'API OpenAI');
			const body = JSON.parse(init.body);
			assert.equal(body.model, 'modele-simule-m3', 'modèle lu dans la variable, jamais en dur');
			assert.equal(body.text, undefined, 'sortie texte, pas de format JSON');

			// 2) Consignes système en tête, puis le prompt complet.
			assert.equal(body.input[0].role, 'system');
			assert.equal(body.input[0].content[0].text, system);
			assert.equal(body.input[1].role, 'user');
			const call = body.input[1].content[0].text;
			assert.ok(call.indexOf('RÉFÉRENTIEL DE MÉTHODE') < call.indexOf('GUIDE DE STYLE'), 'méthode avant guide');
			assert.ok(call.indexOf('GUIDE DE STYLE') < call.indexOf('FAITS DE LA SEMAINE'), 'guide avant contexte');
			assert.ok(call.indexOf('FAITS DE LA SEMAINE') < call.indexOf('Réponses du bilan :'), 'contexte avant réponses');

			// 3) Aucune identité dans l'appel : ni nom, ni e-mail, ni identifiant.
			const dataPart = call
				.replace(COACH_DRAFT_METHOD_REFERENCE.trim(), '')
				.replace(COACH_DRAFT_STYLE_GUIDE.trim(), '');
			assert.ok(!dataPart.includes(context.prenom), 'prénom réel absent');
			assert.ok(dataPart.includes(PRENOM_PLACEHOLDER), 'marqueur {{prenom}} à la place');
			assert.ok(!/@/.test(dataPart), 'aucun e-mail');
			assert.ok(!/userId|checkinId|_id/i.test(dataPart), 'aucun identifiant');

			// 4) Usages renvoyés : modèle, tokens lus/écrits/mis en cache, durée.
			assert.equal(result.usage.provider, 'openai');
			assert.equal(result.usage.model, 'modele-simule-m3');
			assert.equal(result.usage.inputTokens, 1234);
			assert.equal(result.usage.outputTokens, 210);
			assert.equal(result.usage.cachedInputTokens, 1024);
			assert.ok(result.usage.durationMs >= 0, 'durée mesurée');
			assert.equal(result.text, `Salut ${PRENOM_PLACEHOLDER}, bilan bien reçu. On ne touche à rien.`);
		});
	} finally {
		fetchMock.restore();
	}
});

test('Aucun nom de modèle écrit en dur dans le fournisseur du brouillon', () => {
	const providerSource = read('src/convex/ai/provider.ts');
	assert.ok(!/gpt-|o4-mini|claude|gemini/i.test(providerSource), 'aucun modèle nommé dans provider.ts');
	assert.ok(providerSource.includes(COACH_DRAFT_MODEL_ENV), 'variable du modèle lue');
	assert.ok(!/from\s+['"]\$env/.test(providerSource), 'jamais $env SvelteKit côté Convex');
	const openaiSource = read('src/lib/server/openai.ts');
	assert.ok(openaiSource.includes('generateCoachDraftText'), 'client repas réutilisé pour le brouillon');
	const draftFn = openaiSource.slice(openaiSource.indexOf('export async function generateCoachDraftText'));
	assert.ok(draftFn.includes('callOpenAiCore'), 'même cœur d’appel que l’analyse des repas');
	assert.ok(draftFn.includes("role: 'system'"), 'consignes système en tête d’appel');
});

test('Appel uniquement côté serveur : le fournisseur n’entre jamais dans le bundle navigateur', () => {
	const offenders = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			if (statSync(p).isDirectory()) walk(p);
			else if (/\.(svelte|ts)$/.test(name)) {
				const source = readFileSync(p, 'utf8');
				const relative = p.slice(root.length + 1);
				if (relative.startsWith('src/convex/') || relative.startsWith('src/lib/server/')) return;
				if (source.includes('ai/provider') || source.includes('generateCoachDraftText') || source.includes('server/openai')) {
					offenders.push(relative);
				}
			}
		}
	};
	walk(join(root, 'src'));
	assert.deepEqual(offenders, [], 'aucun import fournisseur hors serveur');
});

/* ═════════════════ 5) ARRÊT D’URGENCE ET MESSAGES CLAIRS ═════════════════ */

test('Arrêt d’urgence AI_COACH_DRAFT_DISABLED prioritaire : aucun appel, même avec la variable du modèle', async () => {
	const fetchMock = mockFetch(() => {
		throw new Error('fetch ne doit jamais être appelé');
	});
	try {
		await assert.rejects(
			generateText({
				feature: 'coach_draft',
				env: { AI_COACH_DRAFT_DISABLED: '1', [COACH_DRAFT_MODEL_ENV]: 'modele-simule-m3' },
				system: 's',
				prompt: 'p',
			}),
			/momentanément désactivée/,
			'arrêt d’urgent explicite'
		);
		assert.equal(fetchMock.calls.length, 0, 'aucun appel réseau quand le coupe-circuit est actif');
	} finally {
		fetchMock.restore();
	}
});

test('Erreur fournisseur → message clair, sans détail technique ni clé', async () => {
	const fetchMock = mockFetch(jsonResponse({ error: { message: 'quota dépassé' } }, 429));
	try {
		await withFakeKey(async () => {
			await assert.rejects(
				generateText({
					feature: 'coach_draft',
					env: { [COACH_DRAFT_MODEL_ENV]: 'modele-simule-m3' },
					system: 's',
					prompt: 'p',
				}),
				(error) => {
					assert.ok(/Service IA indisponible/.test(error.message), 'message clair');
					assert.ok(!error.message.includes('cle-de-test-simulee'), 'jamais la clé');
					return true;
				}
			);
		});
	} finally {
		fetchMock.restore();
	}

	// Panne réseau → même discipline.
	const down = mockFetch(() => {
		throw Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' });
	});
	try {
		await withFakeKey(async () => {
			await assert.rejects(
				generateText({
					feature: 'coach_draft',
					env: { [COACH_DRAFT_MODEL_ENV]: 'modele-simule-m3' },
					system: 's',
					prompt: 'p',
				}),
				/momentanément indisponible|dépassé le délai/
			);
		});
	} finally {
		down.restore();
	}

	// Côté coach : le message du BFF annonce le repli manuel, sans jargon.
	const route = read('src/routes/api/coach/draft/+server.ts');
	assert.ok(route.includes('écrire ton retour à la main comme avant'), 'repli manuel annoncé');
	assert.ok(route.includes('trop de temps'), 'délai dépassé expliqué en clair');
});

/* ═════════════════ 6) SUIVI DES COÛTS — JAMAIS LE CONTENU ═════════════════ */

test('Chaque brouillon est tracé : modèle, tokens lus/écrits/mis en cache, durée', () => {
	const source = read('src/convex/coachDraft.ts');
	const entries = [...source.matchAll(/runMutation\(internal\.aiLog\.record as never, \{([\s\S]*?)\} as never\)/g)].map(
		(m) => m[1]
	);
	assert.equal(entries.length, 2, 'succès ET erreur tracés');
	for (const entry of entries) {
		assert.ok(entry.includes('kind: "coach_draft"'), 'trace du brouillon');
		assert.ok(!/\bprompt\b|\btext\b|\bfeedback\b|\bprenom\b/.test(entry), 'jamais le contenu dans la trace');
	}
	const okEntry = entries.find((entry) => entry.includes('status: "ok"'));
	assert.ok(okEntry, 'trace de succès présente');
	for (const field of ['model:', 'inputTokens:', 'outputTokens:', 'cachedInputTokens:', 'durationMs:']) {
		assert.ok(okEntry.includes(field), `champ de coût absent : ${field}`);
	}
	const errorEntry = entries.find((entry) => entry.includes('status: "error"'));
	assert.ok(errorEntry, 'trace d’erreur présente');
	assert.ok(errorEntry.includes('failReason'), 'raison d’échec courte tracée');
	assert.ok(errorEntry.includes('durationMs:'), 'durée tracée même en échec');
});

test('aiUsageLog accepte coach_draft et les tokens mis en cache — aucun champ de contenu', () => {
	const logModule = read('src/convex/aiLog.ts');
	const schema = read('src/convex/schema.ts');
	const tableBlock = schema.slice(schema.indexOf('aiUsageLog: defineTable'), schema.indexOf('by_kind'));
	for (const [file, source] of [['src/convex/aiLog.ts', logModule], ['schema.ts (aiUsageLog)', tableBlock]]) {
		assert.ok(source.includes('coach_draft'), `kind coach_draft absent de ${file}`);
		assert.ok(source.includes('cachedInputTokens'), `tokens mis en cache absents de ${file}`);
		assert.ok(!/\b(prompt|content|feedback|text)\s*:\s*v\./.test(source), `champ de contenu dans ${file}`);
	}
});
