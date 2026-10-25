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
import { generate, hasAiConsent } from '../src/convex/coachDraft.ts';
import { hashToken } from '../src/convex/helpers.ts';
import {
	COACH_DRAFT_CONSENT_MISSING,
	DRAFT_CAUSE_DISABLED,
	DRAFT_CAUSE_INVALID_KEY,
	DRAFT_CAUSE_MODEL_REFUSED,
	DRAFT_CAUSE_NO_CREDIT,
	DRAFT_CAUSE_TIMEOUT,
	DRAFT_CAUSE_UNEXPECTED,
	draftErrorCause,
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
function actionCtx(t, { consent }) {
	const logs = [];
	let queryIndex = 0;
	return {
		logs,
		ctx: {
			runQuery: async (_ref, _args) => {
				queryIndex += 1;
				if (queryIndex === 1) return { _id: 'coach1', role: 'coach' }; // checkSession
				if (queryIndex === 2) return consent; // hasAiConsent
				if (queryIndex === 3) return fixture; // loadContext
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
