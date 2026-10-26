/**
 * MISSION M5 — CONSENTEMENT IA, LIEN DE CONFIDENTIALITÉ, ERREURS EXPLICITES.
 *
 * Aucun appel réseau réel, aucune donnée réelle, aucune écriture Convex :
 * seule une base simulée (`ctx.db` minimal) est utilisée, comme dans les
 * missions M2/M4. Couverture demandée :
 *  - sans consentement → génération refusée côté serveur (aucun appel IA) ;
 *  - avec consentement → autorisée ;
 *  - une cliente ne peut pas modifier son propre consentement IA ;
 *  - chaque cause d'échec tracée (401, 429, modèle, timeout, désactivé,
 *    autre) → le bon message lisible ;
 *  - lien « Politique de confidentialité » présent dans Paramètres.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { updateClient } from '../src/convex/coach.ts';
import { DRAFT_RATE_LIMIT_MS, generate, hasAiConsent, recentSuccessfulDraft } from '../src/convex/coachDraft.ts';
import { anonymizePrenom, buildDraftPreview, PRENOM_PLACEHOLDER } from '../src/convex/coachDraftPrompt.ts';
import { hashToken } from '../src/convex/helpers.ts';
import { FAIL_PARAM_MAX_LENGTH, sanitizeFailParam } from '../src/lib/server/openai.ts';
import {
	COACH_DRAFT_CONSENT_MISSING,
	DRAFT_CAUSE_DISABLED,
	DRAFT_CAUSE_INCOMPLETE,
	DRAFT_CAUSE_INVALID_KEY,
	DRAFT_CAUSE_MODEL_REFUSED,
	DRAFT_CAUSE_NO_CREDIT,
	DRAFT_CAUSE_TIMEOUT,
	DRAFT_CAUSE_UNEXPECTED,
	DRAFT_RATE_LIMITED,
	draftErrorCause,
	draftFailReason,
} from '../src/lib/coachDraftError.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const fixture = JSON.parse(read('tests/fixtures/coach-draft/progression.context.json'));

/* ═════════════ 1) BASE CONVEX SIMULÉE (lecture + patch) ═════════════ */

function makeDb(tables) {
	const query = (table) => {
		let rows = (tables[table] ?? []).map((r) => ({ ...r }));
		const chain = {
			withIndex(_name, builder) {
				const constraints = [];
				const recorder = {};
				for (const op of ['eq', 'gte', 'lte', 'gt', 'lt']) {
					recorder[op] = (field, value) => {
						constraints.push([field, op, value]);
						return recorder;
					};
				}
				builder(recorder);
				rows = rows.filter((r) =>
					constraints.every(([field, op, value]) => {
						const v = r[field];
						if (op === 'eq') return v === value;
						if (op === 'gte') return v >= value;
						if (op === 'lte') return v <= value;
						if (op === 'gt') return v > value;
						return v < value;
					})
				);
				return chain;
			},
			order(dir) {
				rows = [...rows].sort((a, b) => (a._creationTime - b._creationTime) * (dir === 'desc' ? -1 : 1));
				return chain;
			},
			collect: async () => rows,
			first: async () => rows[0] ?? null,
			unique: async () => rows[0] ?? null,
		};
		return chain;
	};
	return {
		query,
		async get(id) {
			for (const rows of Object.values(tables)) {
				const found = rows.find((r) => r._id === id);
				if (found) return { ...found };
			}
			return null;
		},
		async patch(id, patch) {
			for (const rows of Object.values(tables)) {
				const row = rows.find((r) => r._id === id);
				if (!row) continue;
				for (const [key, value] of Object.entries(patch)) {
					if (value === undefined) delete row[key];
					else row[key] = value;
				}
				return;
			}
			throw new Error(`patch : ligne introuvable ${id}`);
		},
	};
}

const coach = { _id: 'coach1', _creationTime: 1, email: 'hugo@coaching.test', prenom: 'Hugo', role: 'coach', passwordHash: 'x' };

function clientRow(extra = {}) {
	return {
		_id: 'client1',
		_creationTime: 2,
		email: 'lea@cliente.test',
		prenom: 'Léa',
		role: 'client',
		passwordHash: 'x',
		createdBy: 'coach1',
		...extra,
	};
}

const checkin = {
	_id: 'checkin1',
	_creationTime: 100,
	userId: 'client1',
	weekStart: '2026-10-05',
	weekLabel: 'S41 - 05 oct. 2026',
	status: 'nouveau',
	answers: {},
};

async function tables({ aiConsentAt } = {}) {
	return {
		users: [coach, clientRow(aiConsentAt === undefined ? {} : { aiConsentAt })],
		sessions: [
			{
				_id: 's-coach',
				_creationTime: 1,
				tokenHash: await hashToken('tok-coach'),
				userId: 'coach1',
				expiresAt: Date.now() + 86_400_000,
			},
			{
				_id: 's-client',
				_creationTime: 2,
				tokenHash: await hashToken('tok-client'),
				userId: 'client1',
				expiresAt: Date.now() + 86_400_000,
			},
		],
		checkins: [checkin],
		aiUsageLog: [],
	};
}

/* ═════════════ 2) CONSENTEMENT CÔTÉ COACH (fiche cliente) ═════════════ */

test('Le champ aiConsentAt est FACULTATIF et additif sur la fiche cliente (users)', () => {
	const schema = read('src/convex/schema.ts');
	const users = schema.slice(schema.indexOf('users: defineTable({'), schema.indexOf('sessions: defineTable({'));
	assert.ok(users.includes('aiConsentAt: v.optional(v.number())'), 'champ optionnel sur users');
	assert.ok(!schema.includes('aiConsentAt: v.required'), 'aucun champ obligatoire ajouté');
});

test('Coach : cocher enregistre la date du jour, décocher retire le consentement', async () => {
	const t = await tables();
	const ctx = { db: makeDb(t) };

	await updateClient._handler(ctx, { sessionToken: 'tok-coach', userId: 'client1', aiConsent: true });
	const granted = t.users.find((u) => u._id === 'client1');
	assert.equal(typeof granted.aiConsentAt, 'number', 'date enregistrée');
	const firstDate = granted.aiConsentAt;
	assert.ok(Math.abs(Date.now() - firstDate) < 60_000, 'date du jour');

	// Réenregistrer la fiche ne repousse pas la date d'origine.
	await updateClient._handler(ctx, { sessionToken: 'tok-coach', userId: 'client1', aiConsent: true });
	assert.equal(t.users.find((u) => u._id === 'client1').aiConsentAt, firstDate, 'date d’origine conservée');

	await updateClient._handler(ctx, { sessionToken: 'tok-coach', userId: 'client1', aiConsent: false });
	assert.equal(
		t.users.find((u) => u._id === 'client1').aiConsentAt,
		undefined,
		'consentement retiré (champ supprimé)'
	);
});

test('Une cliente ne peut PAS modifier son propre consentement IA', async () => {
	const t = await tables();
	const ctx = { db: makeDb(t) };
	await assert.rejects(
		() => updateClient._handler(ctx, { sessionToken: 'tok-client', userId: 'client1', aiConsent: true }),
		/Accès réservé au coach/
	);
	assert.equal(t.users.find((u) => u._id === 'client1').aiConsentAt, undefined, 'aucune écriture');
	// Un appel sans session est refusé de la même manière.
	await assert.rejects(
		() => updateClient._handler(ctx, { userId: 'client1', aiConsent: true }),
		/Session invalide/
	);
});

/* ═════════════ 3) GÉNÉRATION : CONSENTEMENT OBLIGATOIRE ═════════════ */

/**
 * ctx d'action : les queries appelées dans l'ordre de l'action (session →
 * consentement → contexte) + une trace des écritures. Les références Convex
 * générées sont des proxys : on ordonne donc les réponses.
 */
function actionCtx(t, { consent, recentDraft = false }) {
	const logs = [];
	let queryIndex = 0;
	return {
		logs,
		ctx: {
			runQuery: async (_ref, _args) => {
				queryIndex += 1;
				if (queryIndex === 1) return { _id: 'coach1', role: 'coach' }; // checkSession
				if (queryIndex === 2) return consent; // hasAiConsent
				if (queryIndex === 3) return recentDraft; // recentSuccessfulDraft
				if (queryIndex === 4) return fixture; // loadContext
				throw new Error('query inattendue');
			},
			runMutation: async (_ref, args) => {
				logs.push(args);
				return { ok: true };
			},
		},
	};
}

test('Sans consentement, la génération est REFUSÉE côté serveur (aucun appel IA)', async () => {
	const t = await tables();
	const { ctx, logs } = actionCtx(t, { consent: false });
	const realFetch = globalThis.fetch;
	let fetched = false;
	globalThis.fetch = async () => {
		fetched = true;
		throw new Error('aucun appel réseau attendu');
	};
	try {
		await assert.rejects(
			() => generate._handler(ctx, { sessionToken: 'tok-coach', checkinId: 'checkin1' }),
			/Consentement IA non enregistré pour cette cliente/
		);
		assert.equal(fetched, false, 'OpenAI jamais appelé');
		assert.equal(logs.length, 0, 'aucune trace de coût IA');
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('Avec consentement, la génération est autorisée (fournisseur factice, aucun réseau)', async () => {
	const t = await tables({ aiConsentAt: Date.now() });
	const { ctx } = actionCtx(t, { consent: true });
	const env = { ...process.env };
	const realFetch = globalThis.fetch;
	let fetched = false;
	process.env.AI_PROVIDER_COACH_DRAFT = 'fake';
	delete process.env.AI_MODEL_COACH_DRAFT;
	delete process.env.AI_COACH_DRAFT_DISABLED;
	globalThis.fetch = async () => {
		fetched = true;
		throw new Error('aucun appel réseau attendu');
	};
	try {
		const text = await generate._handler(ctx, { sessionToken: 'tok-coach', checkinId: 'checkin1' });
		assert.equal(typeof text, 'string');
		assert.ok(text.trim().length > 0, 'texte préparé');
		assert.equal(fetched, false, 'fournisseur factice : aucun appel réseau');
	} finally {
		globalThis.fetch = realFetch;
		process.env = env;
	}
});

test('La query de consentement est réservée au coach de la cliente', async () => {
	const t = await tables({ aiConsentAt: Date.now() });
	const db = makeDb(t);
	await assert.rejects(
		() => hasAiConsent._handler({ db }, { sessionToken: 'tok-client', checkinId: 'checkin1' }),
		/Accès réservé au coach/
	);
	assert.equal(await hasAiConsent._handler({ db }, { sessionToken: 'tok-coach', checkinId: 'checkin1' }), true);
});

/* ═════════════ 4) ERREURS EXPLICITES (aiUsageLog.failReason) ═════════════ */

test('Chaque cause d’échec donne le message lisible attendu', () => {
	const cases = [
		['Service IA indisponible (HTTP 401) — Incorrect API key provided.', DRAFT_CAUSE_INVALID_KEY],
		['Service IA indisponible (HTTP 429) — Rate limit reached.', DRAFT_CAUSE_NO_CREDIT],
		['Service IA indisponible (HTTP 429) — insufficient_quota', DRAFT_CAUSE_NO_CREDIT],
		['Service IA indisponible (HTTP 404) — model gpt-4o-mini does not exist', DRAFT_CAUSE_MODEL_REFUSED],
		['Service IA indisponible (HTTP 400) — unsupported model', DRAFT_CAUSE_MODEL_REFUSED],
		["L'analyse IA a dépassé le délai.", DRAFT_CAUSE_TIMEOUT],
		['draft-timeout', DRAFT_CAUSE_TIMEOUT],
		['AI_COACH_DRAFT_DISABLED', DRAFT_CAUSE_DISABLED],
		['Service IA momentanément indisponible.', DRAFT_CAUSE_UNEXPECTED],
		[null, DRAFT_CAUSE_UNEXPECTED],
		['', DRAFT_CAUSE_UNEXPECTED],
	];
	for (const [reason, expected] of cases) {
		assert.equal(draftErrorCause(reason), expected, `cause ${String(reason)}`);
	}
	// Libellés EXACTS exigés par la mission.
	assert.equal(DRAFT_CAUSE_INVALID_KEY, 'Clé OpenAI invalide ou expirée');
	assert.equal(DRAFT_CAUSE_NO_CREDIT, 'Crédit OpenAI épuisé ou limite atteinte');
	assert.equal(DRAFT_CAUSE_MODEL_REFUSED, 'Modèle refusé par OpenAI');
	assert.equal(DRAFT_CAUSE_TIMEOUT, 'Délai dépassé, réessaie');
	assert.equal(DRAFT_CAUSE_DISABLED, 'Assistant désactivé');
	assert.equal(DRAFT_CAUSE_UNEXPECTED, 'Erreur inattendue');
	assert.equal(COACH_DRAFT_CONSENT_MISSING, 'Consentement IA non enregistré pour cette cliente');
});

test('Le bandeau coach affiche la cause du serveur, sans jamais de contenu client', () => {
	const route = read('src/routes/api/coach/draft/+server.ts');
	assert.ok(route.includes('draftErrorCause'), 'la route traduit la cause tracée');
	assert.ok(route.includes('api.coachDraft.lastDraftFailure'), 'source : aiUsageLog.failReason');
	assert.ok(route.includes('since: startedAt'), 'seuls les échecs de CET appel comptent');
	// Aucun message dynamique du fournisseur n’est renvoyé tel quel.
	assert.ok(!route.includes('error: e.message'), 'jamais le message brut dans la réponse');

	const card = read('src/lib/components/BilanCard.svelte');
	assert.ok(card.includes('draftServerMessage'), 'cause serveur reprise dans le bandeau');
	assert.ok(card.includes('{draftError}'), 'bandeau affiché');
	assert.ok(card.includes('bg-warn-light'), 'bandeau orange conservé');
	assert.ok(card.includes('Ton texte actuel est conservé'));
});

/* ═════════════ 4 bis) RÉPONSE INCOMPLÈTE (JAMAIS DE TEXTE TRONQUÉ) ═════════════ */

/**
 * Réponse OpenAI simulée : un fetch factice renvoie le JSON fourni et on
 * garde le corps de la requête pour vérifier la limite de sortie envoyée.
 * Aucun appel réseau réel.
 */
async function withOpenAiStub(payload, run) {
	const saved = {
		model: process.env.OPENAI_COACH_DRAFT_MODEL,
		key: process.env.OPENAI_API_KEY,
		disabled: process.env.AI_COACH_DRAFT_DISABLED,
	};
	const requests = [];
	const realFetch = globalThis.fetch;
	process.env.OPENAI_COACH_DRAFT_MODEL = 'gpt-6.1-sol';
	process.env.OPENAI_API_KEY = 'cle-de-test';
	delete process.env.AI_COACH_DRAFT_DISABLED;
	globalThis.fetch = async (_url, init) => {
		requests.push(JSON.parse(init.body));
		return new Response(JSON.stringify(payload), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	};
	try {
		return await run(requests);
	} finally {
		globalThis.fetch = realFetch;
		for (const [key, value] of [
			['OPENAI_COACH_DRAFT_MODEL', saved.model],
			['OPENAI_API_KEY', saved.key],
			['AI_COACH_DRAFT_DISABLED', saved.disabled],
		]) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test('Réponse incomplète : aucun texte affiché, cause « incomplete » tracée', async () => {
	const t = await tables({ aiConsentAt: Date.now() });
	const { ctx, logs } = actionCtx(t, { consent: true });
	await withOpenAiStub(
		{
			status: 'incomplete',
			incomplete_details: { reason: 'max_output_tokens' },
			// Texte bien présent mais COUPÉ en pleine phrase : il ne doit jamais
			// ressortir, même partiellement.
			output_text: 'Camille, cette semaine tu as été très régulière sur tes pas et',
			usage: { input_tokens: 900, output_tokens: 2000 },
		},
		async () => {
			await assert.rejects(
				() => generate._handler(ctx, { sessionToken: 'tok-coach', checkinId: 'checkin1' }),
				/brouillon n'a pas pu être préparé/,
				'aucun texte renvoyé au coach'
			);
		}
	);
	assert.equal(logs.length, 1, 'une seule trace IA');
	assert.equal(logs[0].status, 'error');
	assert.equal(logs[0].failReason, 'incomplete', 'cause courte tracée dans aiUsageLog');
	// Le bandeau orange reçoit le libellé exact via la cause traduite.
	assert.equal(draftErrorCause(logs[0].failReason), "Réponse incomplète de l'IA, réessaie");
	assert.equal(DRAFT_CAUSE_INCOMPLETE, "Réponse incomplète de l'IA, réessaie");
	assert.equal(draftErrorCause('incomplete'), DRAFT_CAUSE_INCOMPLETE);
});

test('Réponse complète : le texte est affiché et la limite envoyée vaut 2 000 tokens', async () => {
	const t = await tables({ aiConsentAt: Date.now() });
	const { ctx, logs } = actionCtx(t, { consent: true });
	const complet = 'Camille, merci pour ce bilan : tu as tenu ta régularité sur les repas. On garde une seule priorité simple pour la semaine prochaine.';
	let requests;
	await withOpenAiStub(
		{
			status: 'completed',
			output_text: complet,
			usage: { input_tokens: 900, output_tokens: 320 },
		},
		async (seen) => {
			const text = await generate._handler(ctx, { sessionToken: 'tok-coach', checkinId: 'checkin1' });
			requests = seen;
			assert.equal(text, complet, 'texte complet affiché tel quel');
		}
	);
	assert.equal(logs.length, 1);
	assert.equal(logs[0].status, 'ok', 'aucune erreur tracée pour une réponse complète');
	assert.equal(requests.length, 1, 'un seul appel fournisseur');
	assert.equal(requests[0].max_output_tokens, 2000, 'limite de sortie portée à 2 000 tokens');
	assert.equal(requests[0].reasoning.effort, 'minimal', 'effort de raisonnement au minimum');
});

/* ═════════════ 5) BOUTON DÉSACTIVÉ SANS CONSENTEMENT ═════════════ */

test('Sans consentement, le bouton de génération est désactivé avec le texte exigé', () => {
	const card = read('src/lib/components/BilanCard.svelte');
	assert.ok(card.includes('draftConsent'), 'prop de consentement');
	assert.ok(card.includes('{#if draftConsent}'), 'bouton actif seulement si consentement');
	assert.ok(card.includes('aria-disabled="true"'), 'bouton désactivé sinon');
	assert.ok(card.includes('{COACH_DRAFT_CONSENT_MISSING}'), 'texte « Consentement IA non enregistré »');

	const admin = read('src/routes/admin/+page.svelte');
	assert.ok(admin.includes('Consentements'), 'section « Consentements » de la fiche');
	assert.ok(admin.includes('Consentement assistant IA'), 'case dédiée');
	assert.ok(admin.includes('name="aiConsent"'), 'champ transmis à la fiche');
	assert.ok(admin.includes('Accordé le'), 'date d’accord affichée');
	assert.ok(admin.includes('draftConsent={!!selected.user.aiConsentAt}'), 'consentement passé à la carte');
});

/* ═════════════ 6) PARAMÈTRES CLIENTE : LIEN CONFIDENTIALITÉ ═════════════ */

test('Paramètres cliente : lien « Politique de confidentialité » vers le site, nouvel onglet', () => {
	const page = read('src/routes/espace/parametres/+page.svelte');
	assert.ok(page.includes('Politique de confidentialité'), 'lien présent');
	assert.ok(page.includes('https://myfit-coach.fr/confidentialite'), 'URL exacte');
	assert.ok(page.includes('target="_blank"'), 'nouvel onglet');
	assert.ok(page.includes('rel="noopener noreferrer"'), 'ouverture sûre');
});

/* ═════════════ 7) M5-ter — REVUE : CODES, CONFIDENTIALITÉ, APPARTENANCE ═════════════ */

/** Fetch fournisseur simulé (statut et corps imposés) — aucun appel réseau. */
async function withProviderResponse(status, payload, run) {
	const saved = {
		model: process.env.OPENAI_COACH_DRAFT_MODEL,
		key: process.env.OPENAI_API_KEY,
		disabled: process.env.AI_COACH_DRAFT_DISABLED,
	};
	const realFetch = globalThis.fetch;
	process.env.OPENAI_COACH_DRAFT_MODEL = 'gpt-6.1-sol';
	process.env.OPENAI_API_KEY = 'cle-de-test';
	delete process.env.AI_COACH_DRAFT_DISABLED;
	globalThis.fetch = async () =>
		new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
	try {
		return await run();
	} finally {
		globalThis.fetch = realFetch;
		for (const [key, value] of [
			['OPENAI_COACH_DRAFT_MODEL', saved.model],
			['OPENAI_API_KEY', saved.key],
			['AI_COACH_DRAFT_DISABLED', saved.disabled],
		]) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test('Erreur fournisseur : seul un code court est tracé, jamais le message ni la clé', async () => {
	const t = await tables({ aiConsentAt: Date.now() });
	const { ctx, logs } = actionCtx(t, { consent: true });
	await withProviderResponse(
		401,
		{ error: { message: 'Incorrect API key provided: sk-abc' } },
		async () => {
			await assert.rejects(
				() => generate._handler(ctx, { sessionToken: 'tok-coach', checkinId: 'checkin1' }),
				/brouillon n'a pas pu être préparé/,
				'aucun détail fournisseur renvoyé au coach'
			);
		}
	);
	assert.equal(logs.length, 1, 'une seule trace IA');
	assert.equal(logs[0].failReason, 'http_401', 'code court stabilisé');
	assert.ok(!logs[0].failReason.includes('sk-'), 'aucune clé dans failReason');
	assert.ok(!logs[0].failReason.includes('Incorrect'), 'aucun message fournisseur dans failReason');
	assert.equal(draftErrorCause(logs[0].failReason), DRAFT_CAUSE_INVALID_KEY);
});

test('Codes courts : traduction constante et classement sans message brut', () => {
	const cases = [
		['http_401', DRAFT_CAUSE_INVALID_KEY],
		['http_429', DRAFT_CAUSE_NO_CREDIT],
		['quota', DRAFT_CAUSE_NO_CREDIT],
		['model', DRAFT_CAUSE_MODEL_REFUSED],
		['timeout', DRAFT_CAUSE_TIMEOUT],
		['incomplete', DRAFT_CAUSE_INCOMPLETE],
		['disabled', DRAFT_CAUSE_DISABLED],
		['consent', COACH_DRAFT_CONSENT_MISSING],
		['unknown', DRAFT_CAUSE_UNEXPECTED],
	];
	for (const [code, expected] of cases) {
		assert.equal(draftErrorCause(code), expected, `code ${code}`);
	}
	assert.equal(draftFailReason('Incorrect API key provided: sk-abc'), 'http_401');
	assert.equal(draftFailReason('HTTP 429 — Rate limit reached.'), 'http_429');
	assert.equal(draftFailReason('HTTP 429 — insufficient_quota'), 'quota');
	assert.equal(draftFailReason('HTTP 404 — model gpt-x does not exist'), 'model');
	assert.equal(draftFailReason("L'analyse IA a dépassé le délai."), 'timeout');
	assert.equal(draftFailReason('Consentement IA non enregistré pour cette cliente.'), 'consent');
	assert.equal(draftFailReason(''), 'unknown');
	// Aucun message brut ne peut être persisté : la source le prouve aussi.
	const draftSource = read('src/convex/coachDraft.ts');
	assert.ok(draftSource.includes('draftFailReason('), 'classement par code');
	assert.ok(!draftSource.includes('failReason: (error instanceof Error'), 'message brut interdit');
});

test('Prénom anonymisé sans tenir compte de la casse ni des accents, bornes de mot', () => {
	assert.equal(
		anonymizePrenom('marie, MARIE et Marie.', 'Marie'),
		'{{prenom}}, {{prenom}} et {{prenom}}.',
		'casse ignorée'
	);
	assert.equal(anonymizePrenom('Mariette écrit à marie', 'Marie'), 'Mariette écrit à {{prenom}}', 'bornes de mot');
	assert.equal(anonymizePrenom('léa et LÉA', 'Léa'), '{{prenom}} et {{prenom}}', 'accents ignorés');
	assert.equal(anonymizePrenom('Camille est là', ''), 'Camille est là', 'prénom vide : texte intact');
});

test('Panneau « données envoyées » : {{prenom}} partout, jamais le prénom réel', () => {
	const preview = buildDraftPreview(fixture);
	assert.equal(preview.prenom, PRENOM_PLACEHOLDER, 'champ prénom remplacé');
	const serialized = JSON.stringify(preview);
	assert.ok(serialized.includes(PRENOM_PLACEHOLDER), 'marqueur présent');
	assert.ok(!serialized.toLowerCase().includes(fixture.prenom.toLowerCase()), 'aucune occurrence du prénom réel');
});

test('Un autre coach ne peut pas modifier la fiche d’une cliente', async () => {
	const t = await tables();
	t.users.push({ _id: 'coach2', _creationTime: 3, email: 'autre@coaching.test', prenom: 'Zoé', role: 'coach', passwordHash: 'x' });
	t.sessions.push({
		_id: 's-coach2',
		_creationTime: 3,
		tokenHash: await hashToken('tok-coach2'),
		userId: 'coach2',
		expiresAt: Date.now() + 86_400_000,
	});
	const ctx = { db: makeDb(t) };
	await assert.rejects(
		() => updateClient._handler(ctx, { sessionToken: 'tok-coach2', userId: 'client1', prenom: 'Piraté' }),
		/coach de cette cliente/
	);
	assert.equal(t.users.find((u) => u._id === 'client1').prenom, 'Léa', 'fiche intacte');
});

test('Deuxième génération pour le même bilan en moins de 30 s : refusée côté serveur', async () => {
	const t = await tables({ aiConsentAt: Date.now() });
	const { ctx, logs } = actionCtx(t, { consent: true, recentDraft: true });
	const realFetch = globalThis.fetch;
	let fetched = false;
	globalThis.fetch = async () => {
		fetched = true;
		throw new Error('aucun appel fournisseur attendu');
	};
	try {
		await assert.rejects(
			() => generate._handler(ctx, { sessionToken: 'tok-coach', checkinId: 'checkin1' }),
			/vient d'être préparé/
		);
		assert.equal(fetched, false, 'fournisseur jamais appelé');
		assert.equal(logs.length, 0, 'aucun coût tracé pour un refus');
	} finally {
		globalThis.fetch = realFetch;
	}
	// Fenêtre réelle : 30 secondes, et seuls les succès comptent.
	assert.equal(DRAFT_RATE_LIMIT_MS, 30_000);
	const now = Date.now();
	const db = makeDb({
		...t,
		aiUsageLog: [
			{ _id: 'log-old', _creationTime: 1, kind: 'coach_draft', status: 'ok', checkinId: 'checkin1', createdAt: now - 40_000 },
			{ _id: 'log-err', _creationTime: 2, kind: 'coach_draft', status: 'error', checkinId: 'checkin1', createdAt: now - 5_000 },
		],
	});
	assert.equal(
		await recentSuccessfulDraft._handler({ db }, { sessionToken: 'tok-coach', checkinId: 'checkin1', since: now - DRAFT_RATE_LIMIT_MS }),
		false,
		'succès hors fenêtre et échec récent ignorés'
	);
	const dbFresh = makeDb({
		...t,
		aiUsageLog: [
			{ _id: 'log-fresh', _creationTime: 3, kind: 'coach_draft', status: 'ok', checkinId: 'checkin1', createdAt: now - 2_000 },
		],
	});
	assert.equal(
		await recentSuccessfulDraft._handler({ db: dbFresh }, { sessionToken: 'tok-coach', checkinId: 'checkin1', since: now - DRAFT_RATE_LIMIT_MS }),
		true,
		'succès récent détecté'
	);
});

/* ═════════════ 8) M5-quater — REPLI DE PARAMÈTRES ET failParam ═════════════ */

/**
 * Fetch fournisseur simulé sur une SÉQUENCE de réponses : chaque appel
 * consomme la suivante (la dernière est répétée). Corps capturés dans l'ordre.
 * Aucun réseau, aucune clé réelle.
 */
async function withProviderSequence(responses, run) {
	const saved = {
		model: process.env.OPENAI_COACH_DRAFT_MODEL,
		key: process.env.OPENAI_API_KEY,
		disabled: process.env.AI_COACH_DRAFT_DISABLED,
	};
	const requests = [];
	const realFetch = globalThis.fetch;
	process.env.OPENAI_COACH_DRAFT_MODEL = 'gpt-6.1-sol';
	process.env.OPENAI_API_KEY = 'cle-de-test';
	delete process.env.AI_COACH_DRAFT_DISABLED;
	let index = 0;
	globalThis.fetch = async (_url, init) => {
		requests.push(JSON.parse(init.body));
		const next = responses[Math.min(index, responses.length - 1)];
		index += 1;
		return new Response(JSON.stringify(next.body), {
			status: next.status,
			headers: { 'Content-Type': 'application/json' },
		});
	};
	try {
		return await run(requests);
	} finally {
		globalThis.fetch = realFetch;
		for (const [key, value] of [
			['OPENAI_COACH_DRAFT_MODEL', saved.model],
			['OPENAI_API_KEY', saved.key],
			['AI_COACH_DRAFT_DISABLED', saved.disabled],
		]) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

/** Refus OpenAI typique d'un réglage non supporté par le modèle. */
const REASONING_400 = {
	status: 400,
	body: {
		error: {
			message: "Unsupported value: 'minimal' is not supported with this model.",
			type: 'invalid_request_error',
			param: 'reasoning.effort',
			code: 'unsupported_value',
		},
	},
};

test('HTTP 400 sur reasoning : UN réessai sans reasoning renvoie le texte', async () => {
	const t = await tables({ aiConsentAt: Date.now() });
	const { ctx, logs } = actionCtx(t, { consent: true });
	const complet =
		'Camille, merci pour ce bilan : ta régularité sur les repas est là. On garde une priorité simple pour la semaine prochaine.';
	await withProviderSequence(
		[
			REASONING_400,
			{ status: 200, body: { status: 'completed', output_text: complet, usage: { input_tokens: 900, output_tokens: 320 } } },
		],
		async (requests) => {
			const text = await generate._handler(ctx, { sessionToken: 'tok-coach', checkinId: 'checkin1' });
			assert.equal(text, complet, 'texte réel renvoyé après repli');
			assert.equal(requests.length, 2, 'un seul réessai');
			assert.equal(requests[0].reasoning.effort, 'minimal', 'premier essai : effort demandé');
			assert.equal(requests[1].reasoning, undefined, 'second essai : reasoning retiré');
			assert.equal(requests[1].temperature, 0.3, 'température conservée au second essai');
			assert.equal(requests[1].max_output_tokens, 2000, 'limite de sortie conservée (2 000)');
		}
	);
	assert.equal(logs.length, 1, 'une seule trace IA');
	assert.equal(logs[0].status, 'ok', 'génération réussie tracée');
});

test('Deux HTTP 400 : TROIS tentatives maximum, code « model » et failParam tracé', async () => {
	const t = await tables({ aiConsentAt: Date.now() });
	const { ctx, logs } = actionCtx(t, { consent: true });
	await withProviderSequence([REASONING_400, REASONING_400, REASONING_400, REASONING_400], async (requests) => {
		await assert.rejects(
			() => generate._handler(ctx, { sessionToken: 'tok-coach', checkinId: 'checkin1' }),
			/brouillon n'a pas pu être préparé/
		);
		assert.equal(requests.length, 3, 'trois tentatives au maximum — aucune autre boucle');
		assert.deepEqual(
			requests.map((r) => [r.reasoning !== undefined, r.temperature !== undefined]),
			[
				[true, true],
				[false, true],
				[false, false],
			],
			'ordre : nominal → sans reasoning → sans température'
		);
		for (const request of requests) {
			assert.equal(request.max_output_tokens, 2000, 'limite de sortie inchangée à chaque essai');
		}
	});
	assert.equal(logs.length, 1, 'une seule trace d’échec');
	assert.equal(logs[0].status, 'error');
	assert.equal(logs[0].failReason, 'model', 'code court stable');
	assert.equal(draftErrorCause(logs[0].failReason), DRAFT_CAUSE_MODEL_REFUSED);
	assert.equal(logs[0].failParam, 'reasoning.effort', 'paramètre refusé conservé pour le diagnostic');
});

test('failParam : jamais de clé ni de message libre, borné à 40 caractères', async () => {
	// Source unique du champ : le nettoyeur du client OpenAI.
	assert.equal(sanitizeFailParam('reasoning.effort'), 'reasoning.effort', 'nom de paramètre accepté');
	assert.equal(sanitizeFailParam('x'.repeat(80)).length, FAIL_PARAM_MAX_LENGTH, 'tronqué à 40');
	assert.equal(FAIL_PARAM_MAX_LENGTH, 40);
	assert.equal(sanitizeFailParam('sk-abc123'), undefined, 'jamais une clé');
	assert.equal(sanitizeFailParam('Incorrect API key provided: sk-abc'), undefined, 'jamais un message');
	assert.equal(sanitizeFailParam('some free text'), undefined, 'aucun texte libre');
	assert.equal(sanitizeFailParam(undefined), undefined);
	assert.equal(sanitizeFailParam(42), undefined);

	// 401 : le message porte une clé — seul le code technique est persisté.
	const t = await tables({ aiConsentAt: Date.now() });
	const { ctx, logs } = actionCtx(t, { consent: true });
	await withProviderSequence(
		[{ status: 401, body: { error: { message: 'Incorrect API key provided: sk-abc123', code: 'invalid_api_key' } } }],
		async () => {
			await assert.rejects(
				() => generate._handler(ctx, { sessionToken: 'tok-coach', checkinId: 'checkin1' }),
				/brouillon n'a pas pu être préparé/
			);
		}
	);
	assert.equal(logs[0].failReason, 'http_401');
	assert.equal(logs[0].failParam, 'invalid_api_key', 'code OpenAI conservé');
	assert.ok(!logs[0].failParam.includes('sk-'), 'aucune clé dans failParam');
	assert.ok(!/Incorrect|provided|cle/i.test(logs[0].failParam), 'aucun message libre dans failParam');
	assert.ok(logs[0].failParam.length <= 40, 'failParam borné');

	// Aucun paramètre ni code renvoyé : le champ reste absent (rien d’inventé).
	const t2 = await tables({ aiConsentAt: Date.now() });
	const second = actionCtx(t2, { consent: true });
	await withProviderSequence([{ status: 400, body: { error: { message: 'Bad request.' } } }], async () => {
		await assert.rejects(
			() => generate._handler(second.ctx, { sessionToken: 'tok-coach', checkinId: 'checkin1' }),
			/brouillon n'a pas pu être préparé/
		);
	});
	assert.equal(second.logs[0].failParam, undefined, 'aucun failParam inventé');
});

test('Refus de consentement : 403 avec le code consent et le message dédié', async () => {
	assert.equal(draftErrorCause('consent'), COACH_DRAFT_CONSENT_MISSING);
	const route = read('src/routes/api/coach/draft/+server.ts');
	assert.ok(route.includes('api.coachDraft.hasAiConsent'), 'consentement vérifié avant génération');
	assert.ok(route.includes("code: 'consent'"), 'code consent renvoyé');
	assert.ok(route.includes('status: 403'), 'statut 403');
	assert.ok(route.includes('COACH_DRAFT_CONSENT_MISSING'), 'message dédié constant');
	assert.equal(COACH_DRAFT_CONSENT_MISSING, 'Consentement IA non enregistré pour cette cliente');
	assert.ok(DRAFT_RATE_LIMITED.includes('vient d’être préparé') || DRAFT_RATE_LIMITED.includes("vient d'être préparé"));
	const card = read('src/lib/components/BilanCard.svelte');
	assert.ok(card.includes('{draftError}'), 'bandeau affiche le message du serveur');
});
