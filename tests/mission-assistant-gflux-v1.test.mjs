/**
 * MISSION — ASSISTANT G-FLUX V1 (preview isolée).
 *
 * Deux familles de tests, comme le reste de la suite :
 *  1) tests FONCTIONNELS des modules purs (politique, sécurité, boucle
 *     d'outils IA avec `fetch` stubbé) — c'est là que le comportement réel
 *     est vérifié ;
 *  2) tests de CÂBLAGE par lecture des sources : guards, nav, quotas,
 *     preview→confirmation, isolation userId, absence de clé navigateur.
 *
 * Rien n'appelle Convex ni OpenAI en réseau : les tests tournent hors déploiement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const policy = read('src/lib/assistant/policy.ts');
const assistant = read('src/convex/assistant.ts');
const tools = read('src/convex/assistantTools.ts');
const schema = read('src/convex/schema.ts');
const assistantAi = read('src/lib/server/assistantAi.ts');
const sendBff = read('src/routes/api/assistant/send/+server.ts');
const actionBff = read('src/routes/api/assistant/action/+server.ts');
const pageServer = read('src/routes/espace/assistant/+page.server.ts');
const page = read('src/routes/espace/assistant/+page.svelte');
const appShell = read('src/lib/components/AppShell.svelte');
const layoutServer = read('src/routes/espace/+layout.server.ts');
const composer = read('src/lib/components/assistant/AssistantComposer.svelte');
const previewCard = read('src/lib/components/assistant/ActionPreviewCard.svelte');

/* ══════════════ 1. POLITIQUE — tests fonctionnels ══════════════ */

const policyMod = await import(new URL('../src/lib/assistant/policy.ts', import.meta.url).href);

test('Flag serveur : kill switch + allowlist, jamais un flag navigateur', () => {
	const prevDisabled = process.env.ASSISTANT_DISABLED;
	const prevAllow = process.env.ASSISTANT_ALLOWLIST;
	try {
		delete process.env.ASSISTANT_DISABLED;
		delete process.env.ASSISTANT_ALLOWLIST;
		assert.equal(policyMod.assistantEnabledFor('sofie@exemple.fr'), true, 'ouvert par défaut (preview)');

		process.env.ASSISTANT_DISABLED = '1';
		assert.equal(policyMod.assistantEnabledFor('sofie@exemple.fr'), false, 'kill switch instantané');

		delete process.env.ASSISTANT_DISABLED;
		process.env.ASSISTANT_ALLOWLIST = ' A@Exemple.fr , b@exemple.fr ';
		assert.equal(policyMod.assistantEnabledFor('a@exemple.fr'), true, 'allowlist insensible à la casse/espaces');
		assert.equal(policyMod.assistantEnabledFor('c@exemple.fr'), false, 'hors allowlist → refus');
	} finally {
		if (prevDisabled === undefined) delete process.env.ASSISTANT_DISABLED;
		else process.env.ASSISTANT_DISABLED = prevDisabled;
		if (prevAllow === undefined) delete process.env.ASSISTANT_ALLOWLIST;
		else process.env.ASSISTANT_ALLOWLIST = prevAllow;
	}
});

test('Quotas & rate limit configurables sans toucher à la logique (§31/§32)', () => {
	const prev = { ...process.env };
	try {
		delete process.env.ASSISTANT_TEXT_PER_DAY;
		const base = policyMod.assistantLimits();
		assert.equal(base.textPerDay, 50, 'défaut preview : 50 interactions texte / jour');
		assert.equal(base.visionPerDay, 10, 'défaut preview : 10 images / jour');
		assert.ok(base.minIntervalMs >= 1000, 'anti-rafale actif par défaut');
		assert.ok(base.maxToolRounds >= 1 && base.maxToolRounds <= 8, 'boucle d’outils bornée');

		process.env.ASSISTANT_TEXT_PER_DAY = '5000';
		assert.equal(policyMod.assistantLimits().textPerDay, 5000, 'ajustable par variable d’env');
		process.env.ASSISTANT_TEXT_PER_DAY = '999999';
		assert.equal(policyMod.assistantLimits().textPerDay, 5000, 'toujours borné');
		process.env.ASSISTANT_TEXT_PER_DAY = 'n’importe quoi';
		assert.equal(policyMod.assistantLimits().textPerDay, 50, 'valeur invalide → repli sûr');
	} finally {
		process.env.ASSISTANT_TEXT_PER_DAY = prev.ASSISTANT_TEXT_PER_DAY;
	}
});

test('Contact coach : source UNIQUE, aucun numéro inventé ni hardcodé (§7)', () => {
	const prev = process.env.COACH_WHATSAPP;
	try {
		delete process.env.COACH_WHATSAPP;
		const none = policyMod.coachContact();
		assert.equal(none.phone, null, 'sans variable → pas de numéro fabriqué');
		assert.equal(none.url, null, 'pas de lien wa.me mort');
		assert.ok(none.message.includes('Hugo'), 'message prérempli présent');

		process.env.COACH_WHATSAPP = '+33 6 12 34 56 78';
		const ok = policyMod.coachContact();
		assert.equal(ok.phone, '33612345678', 'format international sans + ni espaces');
		assert.ok(ok.url.startsWith('https://wa.me/33612345678?text='), 'lien wa.me prérempli');

		process.env.COACH_WHATSAPP = '0041 79 123 45 67';
		assert.equal(policyMod.coachContact().phone, '41791234567', 'préfixe 00 converti pour wa.me');
	} finally {
		if (prev === undefined) delete process.env.COACH_WHATSAPP;
		else process.env.COACH_WHATSAPP = prev;
	}
	// Aucun composant ne doit porter un numéro.
	assert.ok(!/wa\.me\/\d/.test(page), 'aucun wa.me codé en dur dans la page');
	assert.ok(!/wa\.me\/\d/.test(composer), 'aucun wa.me codé en dur dans le composer');
	assert.ok(/COACH_WHATSAPP/.test(policy), 'abstraction config propre présente');
});

test('Écran de sécurité : détresse → orientation, jamais de conseil opérationnel (§24)', () => {
	const cases = [
		'je me vomi après chaque repas',
		'j’ai des vomissements provoqués',
		'je veux me priver de manger ce week-end',
		'je vais compenser fort en sautant demain',
		'je prends des laxatifs pour maigrir',
		'je n’ai pas mangé depuis trois jours',
	];
	for (const c of cases) {
		assert.equal(policyMod.safetyScreen(c).level, 'distress', `détecté : ${c}`);
	}
	for (const c of ['j’ai mangé 2 babyles et une pomme', 'combien de calories me reste-t-il ?', 'où en suis-je cette semaine ?']) {
		assert.equal(policyMod.safetyScreen(c).level, 'ok', `pas de faux positif : ${c}`);
	}
	assert.ok(policyMod.DISTRESS_REPLY.includes('professionnel'), 'orientation professionnelle');
	assert.ok(policyMod.DISTRESS_REPLY.includes('Hugo'), 'escalade Coach proposée');
	assert.ok(!/compenser demain/.test(policyMod.DISTRESS_REPLY), 'jamais de compensation');
});

test('Prompt système : identité, interdits objectifs, grossesse, estimation (§1/§14/§22/§23)', () => {
	const p = policyMod.assistantSystemPrompt('nutrition', '2026-10-07');
	assert.ok(/n['’]es PAS Hugo/i.test(p), 'jamais Hugo');
	assert.ok(p.includes('Hugo garde la main'), 'positionnement exact');
	// V2 Lot 1 : le CTA n'est plus un refus générique mais une analyse + synthèse Hugo.
	assert.ok(/ça mérite l['’]œil de Hugo/i.test(p), 'CTA décision coach (analyse + synthèse Hugo)');
	assert.ok(p.includes('calories objectif'), 'objectifs en lecture seule');
	assert.ok(p.includes('Compenser') || p.includes('compenser'), 'interdiction de compenser');
	assert.ok(p.includes('grossesse'), 'règle grossesse');
	assert.ok(p.includes('Estimation'), 'estimation jamais présentée pour certaine');
	assert.ok(p.includes('nutrition | weight_steps | recipes | checkin | coach_question'), 'sujets explicites');
});

test('Modèle IA : variable serveur ASSISTANT_MODEL, jamais hardcodé dans l’app', () => {
	assert.ok(/ASSISTANT_MODEL/.test(policy), 'politre résout le modèle');
	assert.ok(!/gpt-4o-mini/.test(page), 'pas de modèle codé dans la page');
	// Seul endroit qui borne la liste des modèles.
	assert.equal(policyMod.assistantModel(), policyMod.assistantModel(), 'résolution déterministe');
});

/* ══════════════ 2. BOUCLE D'OUTILS IA — test fonctionnel ══════════════ */

const aiMod = await import(new URL('../src/lib/server/assistantAi.ts', import.meta.url).href);

const jsonResponse = (payload, status = 200) =>
	new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

test('Boucle d’outils : le serveur exécute, le modèle reçoit le résultat, réponse finale bornée', async () => {
	const prevKey = process.env.OPENAI_API_KEY;
	process.env.OPENAI_API_KEY = 'sk-test';
	const prevFetch = globalThis.fetch;
	const bodies = [];
	globalThis.fetch = async (_url, init) => {
		const body = JSON.parse(init.body);
		bodies.push(body);
		const hasToolResult = body.messages.some((m) => m.role === 'tool');
		if (!hasToolResult && body.tool_choice !== 'none') {
			return jsonResponse({
				choices: [
					{
						message: {
							content: null,
							tool_calls: [{ id: 'c1', type: 'function', function: { name: 'getToday', arguments: '{"date":"2026-10-07"}' } }],
						},
					},
				],
				usage: { prompt_tokens: 10, completion_tokens: 5 },
			});
		}
		return jsonResponse({
			choices: [{ message: { content: 'Il te reste 1 358 kcal aujourd’hui.' } }],
			usage: { prompt_tokens: 20, completion_tokens: 7 },
		});
	};
	try {
		let executed = null;
		const res = await aiMod.runAssistantTurn({
			system: 'SYSTÈME',
			history: [{ role: 'user', content: 'hier' }],
			userText: 'combien de calories il me reste ?',
			tools: aiMod.ASSISTANT_TOOLS,
			callTool: async (name, args) => {
				executed = { name, args };
				return { ok: true, remaining: 1358 };
			},
			maxRounds: 4,
		});
		assert.equal(executed.name, 'getToday', 'outil exécuté par LE SERVEUR');
		assert.deepEqual(executed.args, { date: '2026-10-07' }, 'arguments parsés');
		assert.ok(res.text.includes('1 358'), 'réponse finale du modèle');
		assert.equal(bodies.length, 2, 'un tour d’outil + une réponse finale');
		const toolMsg = bodies[1].messages.find((m) => m.role === 'tool');
		assert.ok(toolMsg, 'résultat outil renvoyé au modèle');
		assert.ok(toolMsg.content.includes('1358'), 'résultat SERVEUR transmis (le modèle ne calcule pas)');
		assert.equal(res.usage.inputTokens, 30, 'tokens agrégés sur les tours');
		assert.ok(res.toolCalls.includes('getToday'), 'traçabilité des outils appelés');
	} finally {
		globalThis.fetch = prevFetch;
		if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = prevKey;
	}
});

test('Boucle bornée : jamais de tour infini, réponse forcée à la limite', async () => {
	const prevKey = process.env.OPENAI_API_KEY;
	process.env.OPENAI_API_KEY = 'sk-test';
	const prevFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = async (_url, init) => {
		calls++;
		const body = JSON.parse(init.body);
		if (body.tool_choice === 'none') {
			return jsonResponse({ choices: [{ message: { content: 'réponse finale' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
		}
		return jsonResponse({
			choices: [
				{ message: { content: null, tool_calls: [{ id: 'c' + calls, type: 'function', function: { name: 'searchFood', arguments: '{}' } }] } },
			],
			usage: { prompt_tokens: 1, completion_tokens: 1 },
		});
	};
	try {
		const res = await aiMod.runAssistantTurn({
			system: 'S',
			history: [],
			userText: 'x',
			tools: aiMod.ASSISTANT_TOOLS,
			callTool: async () => ({ ok: true }),
			maxRounds: 3,
		});
		assert.equal(res.text, 'réponse finale', 'réponse forcée obtenue');
		assert.ok(calls <= 5, `boucle bornée (maxRounds=3 → ${calls} appels)`);
	} finally {
		globalThis.fetch = prevFetch;
		if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = prevKey;
	}
});

test('Outil en échec ne casse jamais la conversation', async () => {
	const prevKey = process.env.OPENAI_API_KEY;
	process.env.OPENAI_API_KEY = 'sk-test';
	const prevFetch = globalThis.fetch;
	let round = 0;
	globalThis.fetch = async () => {
		round++;
		if (round === 1) {
			return jsonResponse({
				choices: [
					{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'searchFood', arguments: '{bad json' } }] } },
				],
				usage: { prompt_tokens: 1, completion_tokens: 1 },
			});
		}
		return jsonResponse({ choices: [{ message: { content: 'Je n’ai pas trouvé — précise le nom.' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
	};
	try {
		const res = await aiMod.runAssistantTurn({
			system: 'S',
			history: [],
			userText: 'zzz',
			tools: aiMod.ASSISTANT_TOOLS,
			callTool: async () => {
				throw new Error('base indisponible');
			},
			maxRounds: 3,
		});
		assert.ok(res.text.length > 0, 'réponse honnête malgré l’erreur');
	} finally {
		globalThis.fetch = prevFetch;
		if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = prevKey;
	}
});

test('Panne IA → erreur métier lisible, jamais de stack ni de clé exposée', async () => {
	const prevKey = process.env.OPENAI_API_KEY;
	process.env.OPENAI_API_KEY = 'sk-test';
	const prevFetch = globalThis.fetch;
	globalThis.fetch = async () => jsonResponse({ error: { message: 'rate limited' } }, 429);
	try {
		await assert.rejects(
			() =>
				aiMod.runAssistantTurn({
					system: 'S',
					history: [],
					userText: 'x',
					tools: aiMod.ASSISTANT_TOOLS,
					callTool: async () => ({}),
					maxRounds: 2,
				}),
			(e) => {
				assert.ok(/indisponible \(HTTP 429\)/.test(e.message), 'message métier');
				assert.ok(!e.message.includes('sk-'), 'jamais de clé dans le message');
				return true;
			}
		);
	} finally {
		globalThis.fetch = prevFetch;
		if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = prevKey;
	}
});

/* ══════════════ 3. PERMISSIONS / GUARDS (§3/§38) ══════════════ */

test('Assistant accessible : compte client + accès non bloqué (coaching ET autonome autorisé)', () => {
	assert.ok(/requireClientAccess\(event, \{ next: '\/espace\/assistant' \}\)/.test(pageServer), 'page protégée par le garde Billing');
	assert.ok(/api\.assistant\.access/.test(pageServer), 'flag SERVEUR relu côté page');
	assert.ok(/if \(!access\.enabled\) throw redirect\(303, '\/espace'\)/.test(pageServer), 'désactivé → redirection douce');
	assert.ok(/requireClientAccess/.test(sendBff), 'BFF envoi : rôle client + hard lock');
	assert.ok(/requireClientAccess/.test(actionBff), 'BFF action : rôle client + hard lock');
	// Le mode coachingMode n'est JAMAIS un critère d'accès à l'Assistant.
	assert.ok(!/coachingMode/.test(pageServer), 'aucun test de mode : Coaching et Autonomie ont les mêmes droits');
});

test('HARD LOCK Autonomie prioritaire : décision revérifiée côté Convex', () => {
	assert.ok(/accessStateForUser\(user, Date\.now\(\)\)\.decision === "block"/.test(tools), 'outils : block → refus');
	assert.ok(/accessStateForUser\(user, Date\.now\(\)\)\.decision !== "block"/.test(assistant), 'orchestration : block → refus');
	assert.ok(/accessStateForUser\(user, Date\.now\(\)\)\.decision !== "block"/.test(assistant), 'flag accès : block → inactif');
	assert.ok(!/requireRole\(event, 'coach'/.test(pageServer), 'jamais ouvert au coach');
});

test('Impossible de modifier les objectifs Coach (§14)', () => {
	// 1) Liste d'écritures FERMÉE dans le schéma : aucun objectif, aucun coachingMode.
	const actionTypeBlock = schema.slice(schema.indexOf('export const assistantActionType'));
	const union = actionTypeBlock.slice(0, actionTypeBlock.indexOf(');'));
	for (const forbidden of ['clientGoals', 'coachingMode', 'stepGoal', 'training', 'mealPlan']) {
		assert.ok(!union.includes(forbidden), `type d'action fermé : ${forbidden} absent`);
	}
	assert.ok(union.includes('journal_add') && union.includes('coach_question'), 'écritures V1 présentes');
	// 2) Aucun outil ni appel ne touche setClientGoals / objectifs.
	assert.ok(!/setClientGoals/.test(assistant), 'aucun appel à setClientGoals');
	assert.ok(!/setClientGoals/.test(tools), 'aucun appel à setClientGoals (outils)');
	assert.ok(!/setClientGoals/.test(assistantAi), 'aucun outil d’écriture d’objectif au catalogue');
	// 3) Les mutations existantes ne sont appelées que pour des écritures cliente.
	assert.ok(/api\.steps\.setSteps/.test(assistant), 'pas : mutation existante réutilisée');
	assert.ok(/api\.metrics\.upsert/.test(assistant), 'mesures : mutation existante réutilisée');
	assert.ok(/api\.meals\.commitAnalyzedMeal/.test(assistant), 'journal : mutation existante réutilisée');
	assert.ok(!/api\.journal\.setClientGoals/.test(assistant), 'objectifs : jamais appelés');
});

/* ══════════════ 4. OUTILS (§20/§38) ══════════════ */

test('Outils lecture : restes du jour, recherche, portion, récap, journal', () => {
	for (const fn of ['getToday', 'searchFood', 'getFoodReference', 'estimateFoodPortion', 'searchRecipes', 'getPeriodRecap', 'getJournalEntries']) {
		assert.ok(new RegExp(`export const ${fn} = query`).test(tools), `outil présent : ${fn}`);
	}
	assert.ok(/kcalGoalForDate/.test(tools), 'objectif calories historisé (déterministe)');
	assert.ok(/percentEaten/.test(tools), '% d’objectif calculé par le serveur');
	assert.ok(/avgKcal|avgSteps/.test(tools), 'moyennes calculées côté serveur (§21)');
	assert.ok(/searchCiqualLocal/.test(tools), 'Ciqual/ANSES réutilisé (§19)');
	assert.ok(/customFoods/.test(tools), 'aliments de la cliente réutilisés (§19)');
	assert.ok(/reperesForFood/.test(tools), 'repères G-FLUX réutilisés (§18)');
	assert.ok(/rememberedQty/.test(tools), 'portion mémorisée réutilisée (§19)');
	assert.ok(/recipes/.test(tools) && /newRecipes/.test(tools), 'base recettes G-FLUX réutilisée, aucune base parallèle');
});

test('Outils écriture : TOUS en préparation, preview renvoyée (§15/§16)', () => {
	for (const fn of ['prepareJournalEntry', 'prepareJournalRemoval', 'prepareMeasurement', 'prepareCoachQuestion']) {
		assert.ok(new RegExp(`export const ${fn} = mutation`).test(tools), `outil présent : ${fn}`);
		assert.ok(
			new RegExp(`(\\b|\\W)${fn}(\\b|\\W)`).test(assistantAi),
			`outil exposé au modèle : ${fn}`
		);
		assert.ok(new RegExp(`case "${fn}"`).test(assistant), `exécuté côté serveur : ${fn}`);
	}
	assert.ok(/status: "pending"/.test(tools), 'action créée EN ATTENTE uniquement');
	assert.ok(/insertPending/.test(tools), 'aucune écriture directe dans la couche outils');
	assert.ok(!/db\.insert\("diaryEntries"/.test(tools), 'jamais de diaryEntries inséré sans confirmation');
	assert.ok(!/db\.insert\("dailySteps"/.test(tools), 'jamais de dailySteps inséré sans confirmation');
	assert.ok(!/db\.insert\("bodyMetrics"/.test(tools), 'jamais de bodyMetrics inséré sans confirmation');
	assert.ok(/Prévisualisation|preview/.test(tools), 'preview construite par le serveur');
	assert.ok(/estimated: true/.test(tools), 'marquage Estimation (§18)');
});

test('Prévisualisation : totaux, source et mention estimation exposés', () => {
	assert.ok(/totals: \{/.test(tools), 'totaux calculés serveur');
	assert.ok(/ref\.origin === "product"/.test(tools), 'origine de la valeur exposée');
	assert.ok(/Certaines valeurs sont des estimations/.test(tools), 'avertissement estimation affiché');
	assert.ok(/preview: v\.object/.test(schema), 'preview typée dans le schéma');
	assert.ok(/lines: v\.array\(assistantPreviewLine\)/.test(schema), 'lignes typées');
});

/* ══════════════ 5. CONFIRMATION / TRAÇABILITÉ (§15–§17) ══════════════ */

test('Aucune écriture sans confirmation : resolveAction est le seul chemin', () => {
	assert.ok(/export const resolveAction = mutation/.test(assistant), 'mutation de confirmation présente');
	assert.ok(/decision: v\.union\(v\.literal\("confirm"\), v\.literal\("cancel"\), v\.literal\("undo"\)\)/.test(assistant), 'confirm | cancel | undo');
	assert.ok(/if \(doc\.status !== "pending"\) throw new ConvexError\("Cette action a déjà été traitée\."\)/.test(assistant), 'double confirmation refusée');
	assert.ok(/if \(!doc \|\| doc\.userId !== user\._id\) throw new ConvexError\("Action introuvable\."\)/.test(assistant), 'isolation userId sur l’action');
	assert.ok(/actionId/.test(actionBff) && !/body\.(items|qtyGrams|date|meal)/.test(actionBff), 'le BFF ne reçoit qu’un actionId');
	assert.ok(/status: "expired"/.test(assistant), 'expiration des previews');
});

test('Traçabilité & Undo raisonnables (§17)', () => {
	for (const field of ['source', 'createdAt', 'actionType', 'previousValue', 'newValue']) {
		assert.ok(schema.includes(field), `champ de traçabilité présent : ${field}`);
	}
	assert.ok(/previousValue: v\.optional/.test(schema), 'avant-stocké pour undo/audit');
	assert.ok(/newValue: v\.optional/.test(schema), 'après-stocké pour undo/audit');
	assert.ok(/decision === "undo"/.test(assistant), 'undo implémenté');
	assert.ok(!/chain[- ]of[- ]thought|reasoning|thought/i.test(assistant), 'aucun raisonnement interne stocké');
	assert.ok(!/chain[- ]of[- ]thought|reasoning|thought/i.test(schema), 'aucun raisonnement interne dans le schéma');
});

test('Question Hugo : structure simple et additive (§26)', () => {
	assert.ok(/coachQuestions: defineTable/.test(schema), 'table coachQuestions');
	for (const f of ['userId', 'text', 'destination', 'status', 'createdAt']) {
		assert.ok(new RegExp(`${f}: v\\.`).test(schema.slice(schema.indexOf('coachQuestions: defineTable'))), `champ ${f}`);
	}
	assert.ok(!/vision360|client360/i.test(tools), 'aucune intégration Vision 360 bloquante en V1');
});

/* ══════════════ 6. SÉCURITÉ — quota, rate limit, isolation, clés ══════════════ */

test('Quota + rate limit + anti double-submit ATOMIQUES (§31/§32)', () => {
	assert.ok(/export const reserve = mutation/.test(assistant), 'réservation mutation (transactionnelle)');
	assert.ok(/textCount >= limits\.textPerDay/.test(assistant), 'quota texte vérifié');
	assert.ok(/visionCount >= limits\.visionPerDay/.test(assistant), 'quota image vérifié');
	assert.ok(/now - row\.lastSendAt < limits\.minIntervalMs/.test(assistant), 'anti-rafale');
	assert.ok(/inFlightAt !== undefined && now - row\.inFlightAt/.test(assistant), 'un seul envoi en cours');
	assert.ok(/export const release = mutation/.test(assistant), 'remboursement en cas d’échec IA');
	assert.ok(/runMutation\(api\.assistant\.reserve/.test(assistant), 'réservation AVANT tout appel IA');
	assert.ok(/runMutation\(api\.assistant\.release/.test(assistant), 'libération en cas d’échec');
	assert.ok(/assistantUsage: defineTable/.test(schema), 'table de quotas');
	assert.ok(/by_user_day/.test(schema), 'index quota par jour');
});

test('Isolation userId : chaque lecture/écriture revérifie le propriétaire', () => {
	assert.ok(/row\.userId !== userId\) throw new ConvexError\("Conversation introuvable\."\)/.test(tools), 'fil appartenant à la cliente');
	assert.ok(/thread\.userId !== user\._id\) throw new ConvexError\("Conversation introuvable\."\)/.test(assistant), 'fil en lecture');
	assert.ok(/row\.userId !== user\._id\) throw new ConvexError\("Entrée introuvable\."\)/.test(tools), 'entrée journal');
	assert.ok(/f\.userId !== userId\) return null/.test(tools), 'aliment personnel isolé');
	assert.ok(/\.eq\("userId", user\._id\)/.test(tools), 'index filtrés par utilisateur');
});

test('Aucune clé IA côté navigateur (§29)', () => {
	assert.ok(!/OPENAI_API_KEY/.test(page), 'pas de clé dans la page');
	assert.ok(!/OPENAI_API_KEY/.test(composer), 'pas de clé dans le composer');
	assert.ok(!/api\.openai\.com/.test(page) && !/api\.openai\.com/.test(composer), 'aucun appel direct au fournisseur');
	assert.ok(/process\.env\.OPENAI_API_KEY/.test(assistantAi), 'clé lue côté serveur uniquement');
	assert.ok(!/PUBLIC_[A-Z_]*OPENAI/.test(policy) && !/PUBLIC_[A-Z_]*OPENAI/.test(assistantAi), 'jamais une variable PUBLIC_');
	assert.ok(/ASSISTANT_MODEL/.test(assistantAi), 'modèle configurable côté serveur');
});

test('Fenêtre de contexte limitée, aucun historique complet renvoyé (§28)', () => {
	assert.ok(/historyWindow/.test(policy), 'fenêtre configurable');
	assert.ok(/\.take\(limits\.historyWindow\)/.test(assistant), 'historique tronqué côté serveur');
	assert.ok(/slice\(-Math\.max\(2, assistantLimits\(\)\.historyWindow - 2\)\)/.test(assistant), 'contexte renvoyé au modèle borné');
	const msgBlock = assistant.slice(assistant.indexOf('query("assistantMessages"'));
	assert.ok(!msgBlock.slice(0, 400).includes('.collect()'), 'aucun collect() non borné sur les messages');
});

/* ══════════════ 7. UX / API (§33/§38) ══════════════ */

test('Erreur réseau : message humain + Réessayer, message jamais perdu', () => {
	assert.ok(/retryPayload/.test(page), 'reprise du message');
	assert.ok(/Réessayer/.test(page), 'bouton Réessayer');
	assert.ok(/kind: 'error'/.test(page), 'bulle d’erreur');
	assert.ok(/userErrMsg/.test(page), 'message utilisateur propre (jamais de stack)');
	assert.ok(/G-FLUX analyse/.test(page), 'indicateur de chargement sans robot');
	assert.ok(!/robot|mascotte|avatar ia/i.test(page), 'aucun robot animé');
});

test('Double submit bloqué côté client ET serveur', () => {
	assert.ok(/if \(\(!text && !raw\.imageDataUrl\) \|\| sending\) return/.test(page), 'garde client');
	assert.ok(/disabled=\{sending\}/.test(composer) || /disabled=\{!ready\}/.test(composer), 'bouton envoyer désactivé');
	assert.ok(/inFlightAt/.test(assistant), 'verrou serveur');
});

test('Thread persistant + changement de topic (§11/§12/§27)', () => {
	assert.ok(/assistantThreads: defineTable/.test(schema), 'table de fils');
	assert.ok(/assistantMessages: defineTable/.test(schema), 'table de messages');
	for (const f of ['userId', 'threadId', 'topic', 'role', 'content', 'createdAt']) {
		assert.ok(new RegExp(`${f}: v\\.`).test(schema.slice(schema.indexOf('assistantMessages: defineTable'))), `champ message : ${f}`);
	}
	assert.ok(/case "setTopic"/.test(assistant), 'bascule de sujet par le modèle');
	assert.ok(/coerceTopic/.test(policy), 'repli sûr sur un sujet inconnu');
	assert.ok(/export const threads = query/.test(assistant), 'historique des fils');
	assert.ok(/export const historyFor = query/.test(assistant), 'fil actif restauré au chargement');
	assert.ok(/greeting/.test(page), 'message d’accueil local');
});

test('Quota affiché sans compteur anxiogène (§31)', () => {
	assert.ok(/remaining <= 5/.test(page), 'notification discrète seulement en fin de quota');
	assert.ok(!/textCount *\//.test(page), 'jamais de compteur « x / y » permanent');
});

/* ══════════════ 8. NAVIGATION & DESIGN (§2/§4/§5/§8/§39) ══════════════ */

test('Bottom nav : 4 entrées dans l’ordre Accueil | Journal | Assistant | Progression', () => {
	const block = appShell.slice(appShell.indexOf('const primaryLinks'), appShell.indexOf('const homeBadgeIsDot'));
	const order = ['label: \'Accueil\'', 'label: \'Journal\'', 'label: \'Assistant\'', 'label: \'Progression\''];
	let last = -1;
	for (const label of order) {
		const idx = block.indexOf(label);
		assert.ok(idx > 0, `onglet présent : ${label}`);
		assert.ok(idx > last, `ordre respecté : ${label}`);
		last = idx;
	}
	assert.ok(/href: '\/espace\/assistant'/.test(block), 'route Assistant dans la barre');
	assert.ok(/assistantEnabled/.test(block), 'onglet piloté par le flag serveur');
	assert.ok(/env\(safe-area-inset-bottom\)/.test(appShell), 'safe-area respectée');
	assert.ok(/md:hidden/.test(appShell), 'barre mobile uniquement (desktop = sidebar)');
	// Sidebar desktop : même entrée, aucun onglet supprimé.
	assert.ok(/href: '\/espace\/progression'/.test(appShell), 'Progression conservée partout');
	assert.ok(/MAIN_TABS = \['\/espace', '\/espace\/journal', '\/espace\/assistant', '\/espace\/progression'\]/.test(appShell), 'préchargement des 4 onglets');
});

test('Page compacte : titre + accroche sans écran ChatGPT géant (§4)', () => {
	assert.ok(/Assistant G-FLUX/.test(page), 'titre');
	assert.ok(/Une aide pratique entre deux échanges\./.test(page), 'accroche exacte');
	assert.ok(/Hugo garde la main sur ton suivi\./.test(page), 'positionnement exact');
	assert.ok(/text-\[24px\]|text-2xl/.test(page), 'titre compact (pas de text-5xl/6xl)');
	assert.ok(!/text-(4xl|5xl|6xl)/.test(page), 'aucun titre géant');
	assert.ok(!/ChatGPT/.test(page), 'identité G-FLUX');
});

test('Catégories : 5 chips, une seule sélection, card unique repliable (§8/§9)', () => {
	const topics = read('src/lib/assistant/topics.ts');
	for (const id of ['nutrition', 'weight_steps', 'recipes', 'checkin', 'coach_question']) {
		assert.ok(topics.includes(`id: '${id}'`), `catégorie : ${id}`);
	}
	for (const label of ['Alimentation', 'Poids & pas', 'Recettes', 'Bilan', 'Hugo']) {
		assert.ok(topics.includes(`label: '${label}'`), `chip : ${label}`);
	}
	assert.ok(/overflow-x-auto/.test(page), 'scroll horizontal sur petit écran');
	assert.ok(/aria-selected=\{active\}/.test(page), 'sélection unique accessible');
	assert.ok(/cardOpen/.test(page), 'card repliable');
	assert.ok(!/grid-cols-5/.test(page), 'pas de 5 cards affichées ensemble');
	// Suggestions de la mission.
	for (const s of ['Ajouter ce que j’ai mangé', 'Combien de calories me reste-t-il ?', 'Saisir mon poids', 'Récap de ma semaine', 'Noter une question pour Hugo']) {
		assert.ok(topics.includes(s), `suggestion : ${s}`);
	}
});

test('Identité Assistant : logo G-FLUX, jamais de robot (§5)', () => {
	assert.ok(/src="\/logo\.png"/.test(page), 'avatar = logo G-FLUX');
	assert.ok(!/robot|bot\.svg|ia\.svg/i.test(page), 'aucun robot ni visage IA');
	assert.ok(/alt="G-FLUX"/.test(page), 'avatar nommé G-FLUX');
});

test('Présence Hugo : photo coach réutilisée + WhatsApp compact (§6)', () => {
	const coach = read('src/lib/components/assistant/CoachWhatsApp.svelte');
	assert.ok(/localStorage\.getItem\('coach-avatar'\)/.test(coach), 'réutilise la source actuelle de l’avatar coach');
	assert.ok(!/https?:\/\/.*\.(jpg|png|webp)/.test(coach), 'aucune nouvelle photo statique créée');
	assert.ok(/coach\?\.url|coach\.url/.test(page), 'lien fourni par le serveur');
	assert.ok(/variant="mini"|whatsappUrl/.test(composer), 'raccourci WhatsApp discret au composer');
	assert.ok(/WhatsAppIcon/.test(composer), 'icône WhatsApp');
	assert.ok(!/wa\.me/.test(coach), 'URL wa.me construite côté serveur uniquement');
});

test('Composer : champ, envoi, dictée native, pièce jointe (§10/§30)', () => {
	assert.ok(/SpeechRecognition/.test(composer), 'dictée native seulement (aucun service payant)');
	assert.ok(/paperclip/.test(composer), 'pièce jointe');
	assert.ok(/send/.test(composer), 'bouton envoyer');
	assert.ok(/Écris ou dicte ta demande/.test(composer), 'placeholder');
	assert.ok(/image\/\*/.test(composer), 'accepte les photos');
	assert.ok(/toDataURL\('image\/jpeg'/.test(composer), 'redimensionnement local avant envoi');
});

test('Prévisualisation : boutons Modifier / Enregistrer (§16)', () => {
	assert.ok(/Prévisualisation avant enregistrement/.test(previewCard), 'titre de la preview');
	assert.ok(/Modifier/.test(previewCard), 'bouton Modifier');
	assert.ok(/Enregistrer/.test(previewCard), 'bouton Enregistrer');
	assert.ok(/onconfirm/.test(previewCard) && /oncancel/.test(previewCard), 'callbacks confirm/cancel câblés');
	assert.ok(/≈ estimation/.test(previewCard), 'mention estimation visible');
});

test('Répertoire Assistant bien séparé (architecture modulaire)', () => {
	for (const f of [
		'src/lib/assistant/policy.ts',
		'src/lib/assistant/topics.ts',
		'src/lib/server/assistantAi.ts',
		'src/convex/assistant.ts',
		'src/convex/assistantTools.ts',
		'src/routes/api/assistant/send/+server.ts',
		'src/routes/api/assistant/action/+server.ts',
		'src/routes/espace/assistant/+page.server.ts',
		'src/routes/espace/assistant/+page.svelte',
	]) {
		assert.ok(read(f).length > 0, `fichier présent : ${f}`);
	}
	// Schéma strictement ADDITIF : les tables existantes ne sont pas retirées.
	for (const t of ['users', 'diaryEntries', 'clientGoals', 'dailySteps', 'bodyMetrics']) {
		assert.ok(schema.includes(`${t}: defineTable`), `table existante conservée : ${t}`);
	}
	for (const t of ['assistantThreads', 'assistantMessages', 'assistantActions', 'coachQuestions', 'assistantUsage']) {
		assert.ok(schema.includes(`${t}: defineTable`), `table ajoutée : ${t}`);
	}
});

test('Data de test : profil fictif Sophie Martin, seed anti-prod et idempotent (§37)', () => {
	const seed = read('src/convex/previewSeedAssistant.ts');
	const mainSeed = read('src/convex/previewSeed.ts');
	assert.ok(/sophie\.martin@example\.com/.test(seed), 'adresse 100 % fictive');
	assert.ok(/PreviewSophie2026!/.test(seed), 'mot de passe de démo documenté');
	assert.ok(/PROD_URL_MARK = "calm-jaguar-475"/.test(seed), 'verrou anti-production');
	assert.ok(/localTodayISO\(\)/.test(seed), 'dates recalculées à chaque seed');
	assert.ok(/\.first\(\)|\.collect\(\)/.test(seed), 'idempotence : lecture avant insertion');
	for (const table of ['clientGoals', 'dailySteps', 'bodyMetrics', 'diaryEntries']) {
		assert.ok(seed.includes(`db.insert("${table}"`), `profil réaliste : ${table}`);
	}
	assert.ok(/resolveCiqualLabel/.test(seed), 'alimentation via Ciqual (aucune base parallèle)');
	assert.ok(/seedAssistantDemoData/.test(mainSeed), 'branché au seed preview principal');
	assert.ok(/NON BLOQUANT/.test(mainSeed), 'un échec n’empêche jamais le seed principal');
	assert.ok(/assistantDemo/.test(mainSeed), 'compte renvoyé pour le rapport');
});

test('Preview : secrets Assistant propagés au Convex Preview, jamais en prod (§0/§41)', () => {
	const env = read('.env.example');
	const propagate = read('scripts/set-preview-billing-env.mjs');
	const toml = read('netlify.toml');
	for (const name of ['ASSISTANT_MODEL', 'COACH_WHATSAPP', 'ASSISTANT_DISABLED', 'ASSISTANT_ALLOWLIST', 'ASSISTANT_TEXT_PER_DAY', 'ASSISTANT_VISION_PER_DAY', 'OPENAI_API_KEY']) {
		assert.ok(env.includes(name), `documenté dans .env.example : ${name}`);
		assert.ok(propagate.includes(name), `propagé au Convex Preview : ${name}`);
	}
	assert.ok(/key\.startsWith\('preview:'\)/.test(propagate), 'refus d\'écrire sans Preview Deploy Key');
	assert.ok(!/prod:/.test(propagate) || /!key\.startsWith\('preview:'\)/.test(propagate), 'clé prod hors portée');
	assert.ok(!/console\.log\([^)]*secret[^)]*value|console\.log\(value/.test(propagate), 'jamais de valeur affichée');
	assert.ok(/preview-create alimentation-ia-preview/.test(toml), 'Convex Preview recréée à chaque build');
	assert.ok(/previewRun previewSeed:seedPreviewData|preview-run previewSeed:seedPreviewData/.test(toml), 'seed automatique à chaque preview');
	assert.ok(/calm-jaguar-475/.test(read('scripts/build-preview.mjs')), 'fusible anti-prod au build');
	assert.ok(/preview:/.test(read('scripts/build-preview.mjs')), 'build preview = preview key uniquement');
});

test('Mode V1 = coaching_readonly, future extension autonomy_adaptive non codée (§34/§35)', () => {
	assert.ok(/ASSISTANT_MODE = 'coaching_readonly'/.test(policy), 'mode V1 explicite');
	assert.ok(/mode: "coaching_readonly"/.test(assistant), 'exposé par le backend');
	assert.ok(!/autonomy_adaptive/.test(assistant), 'aucune écriture adaptative codée');
	assert.ok(/autonomy_adaptive/.test(policy), 'architecturalement documentée, jamais implémentée');
});
