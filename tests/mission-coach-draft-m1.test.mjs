/**
 * MISSION M1 — CHAÎNE DU BROUILLON DE RETOUR AVEC UN FOURNISSEUR FACTICE.
 *
 * Aucun appel réseau, aucune donnée réelle, aucune écriture Convex :
 *  - le fournisseur `fake` est testé directement (déterminisme, délai, usage) ;
 *  - le câblage action / route / interface est vérifié par lecture de source,
 *    comme les autres missions du dépôt.
 *
 * Couverture demandée : accès réservé au coach, aucune écriture dans
 * `checkins`, confirmation de remplacement, texte préservé en cas d'erreur,
 * arrêt d'urgence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	FAKE_PROVIDER_DELAY_MS,
	buildFakeDraftText,
	generateText,
	isAiFeatureDisabled,
	resolveAiConfig,
} from '../src/convex/ai/provider.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const providerSource = read('src/convex/ai/provider.ts');
const actionSource = read('src/convex/coachDraft.ts');
const routeSource = read('src/routes/api/coach/draft/+server.ts');
const cardSource = read('src/lib/components/BilanCard.svelte');
const adminServerSource = read('src/routes/admin/+page.server.ts');
const adminPageSource = read('src/routes/admin/+page.svelte');

/* ═══════════════ 1) FOURNISSEUR GÉNÉRIQUE ═══════════════ */

test('Le fournisseur et le modèle sont réglables PAR FONCTIONNALITÉ', () => {
	// Aucune variable → fournisseur factice, modèle factice (M1).
	assert.deepEqual(resolveAiConfig('coach_draft', {}), {
		provider: 'fake',
		model: 'fake-deterministic-v1',
	});
	// Variables dédiées au brouillon de retour.
	assert.deepEqual(
		resolveAiConfig('coach_draft', {
			AI_PROVIDER_COACH_DRAFT: 'openai',
			AI_MODEL_COACH_DRAFT: 'gpt-4o-mini',
		}),
		{ provider: 'openai', model: 'gpt-4o-mini' }
	);
	// Les noms de variables sont EXPLICITES dans le module.
	for (const name of ['AI_PROVIDER_COACH_DRAFT', 'AI_MODEL_COACH_DRAFT', 'AI_COACH_DRAFT_DISABLED']) {
		assert.ok(providerSource.includes(name), `variable absente : ${name}`);
	}
	assert.ok(providerSource.includes('process.env'), 'lit process.env (jamais $env SvelteKit)');
	assert.ok(!/from\s+['"]\$env/.test(providerSource), 'aucun import $env SvelteKit côté Convex');
});

test('Arrêt d’urgence AI_COACH_DRAFT_DISABLED — actif sur 1/true/yes/on', () => {
	assert.equal(isAiFeatureDisabled('coach_draft', {}), false);
	for (const value of ['1', 'true', 'TRUE', ' yes ', 'on']) {
		assert.equal(
			isAiFeatureDisabled('coach_draft', { AI_COACH_DRAFT_DISABLED: value }),
			true,
			`valeur active non reconnue : ${value}`
		);
	}
	for (const value of ['', '0', 'false', 'off', 'non']) {
		assert.equal(
			isAiFeatureDisabled('coach_draft', { AI_COACH_DRAFT_DISABLED: value }),
			false,
			`valeur inactive mal interprétée : ${value}`
		);
	}
});

test('Le fournisseur factice est DÉTERMINISTE et construit depuis le contexte', () => {
	const facts = { prenom: 'Léa', weekLabel: 'S41 - 12 octobre 2026' };
	const first = buildFakeDraftText(facts);
	const second = buildFakeDraftText(facts);
	assert.equal(first, second, 'mêmes entrées → même texte');
	assert.ok(first.includes('Léa'), 'prénom présent');
	assert.ok(first.includes(facts.weekLabel), 'semaine présente');
	assert.ok(!/\d+\s*(kcal|pas|kg)/i.test(first), 'aucun chiffre inventé');
	assert.notEqual(buildFakeDraftText({ prenom: 'Nina', weekLabel: 'S42' }), first);
});

test('generateText (fake) simule un court délai et renvoie le texte seul + usage', async () => {
	const saved = {
		provider: process.env.AI_PROVIDER_COACH_DRAFT,
		model: process.env.AI_MODEL_COACH_DRAFT,
	};
	delete process.env.AI_PROVIDER_COACH_DRAFT;
	delete process.env.AI_MODEL_COACH_DRAFT;
	try {
		const started = Date.now();
		const result = await generateText({
			feature: 'coach_draft',
			system: 'consigne système',
			prompt: 'prompt complet',
			maxTokens: 400,
			fakeFacts: { prenom: 'Léa', weekLabel: 'S41' },
		});
		const elapsed = Date.now() - started;
		assert.ok(elapsed >= FAKE_PROVIDER_DELAY_MS - 50, `délai simulé trop court (${elapsed} ms)`);
		assert.equal(typeof result.text, 'string');
		assert.ok(result.text.includes('Léa'));
		assert.equal(result.usage.provider, 'fake');
		assert.equal(result.usage.model, 'fake-deterministic-v1');
		assert.equal(result.usage.estimatedCostUsd, 0);
		assert.ok(result.usage.inputTokens > 0 && result.usage.outputTokens > 0);
	} finally {
		if (saved.provider === undefined) delete process.env.AI_PROVIDER_COACH_DRAFT;
		else process.env.AI_PROVIDER_COACH_DRAFT = saved.provider;
		if (saved.model === undefined) delete process.env.AI_MODEL_COACH_DRAFT;
		else process.env.AI_MODEL_COACH_DRAFT = saved.model;
	}
});

test('Les fournisseurs openai et anthropic sont des emplacements vides (M2/M4)', async () => {
	const saved = process.env.AI_PROVIDER_COACH_DRAFT;
	try {
		for (const provider of ['openai', 'anthropic']) {
			process.env.AI_PROVIDER_COACH_DRAFT = provider;
			await assert.rejects(
				generateText({ feature: 'coach_draft', system: 's', prompt: 'p' }),
				/pas encore disponible/,
				`le fournisseur ${provider} ne doit pas être implémenté en M1`
			);
		}
		process.env.AI_PROVIDER_COACH_DRAFT = 'autre-chose';
		await assert.rejects(
			generateText({ feature: 'coach_draft', system: 's', prompt: 'p' }),
			/non configuré/
		);
	} finally {
		if (saved === undefined) delete process.env.AI_PROVIDER_COACH_DRAFT;
		else process.env.AI_PROVIDER_COACH_DRAFT = saved;
	}
});

/* ═══════════════ 2) ACTION CONVEX coachDraft.generate ═══════════════ */

test('coachDraft.generate est une action réservée au coach', () => {
	assert.ok(actionSource.includes('export const generate = action({'), 'action publique generate');
	assert.ok(actionSource.includes('api.journal.checkSession'), 'session re-vérifiée dans l’action');
	assert.ok(actionSource.includes('session.role !== "coach"'), 'garde coach explicite');
	assert.ok(actionSource.includes('user.role !== "coach"'), 'garde coach de loadContext conservée');
	assert.ok(actionSource.includes('Accès réservé au coach.'));
});

test('coachDraft.generate enchaîne loadContext → prompt → fournisseur et renvoie le texte seul', () => {
	assert.ok(actionSource.includes('internal.coachDraft.loadContext'), 'contexte M0 réutilisé');
	assert.ok(actionSource.includes('buildCoachDraftPrompt'), 'prompt M0 réutilisé');
	assert.ok(actionSource.includes('generateText('), 'fournisseur générique unique');
	assert.ok(actionSource.includes('return text;'), 'texte brut seul (pas d’objet, pas de statut)');
	assert.ok(actionSource.includes('isAiFeatureDisabled("coach_draft")'), 'arrêt d’urgence dans l’action');
});

test('La génération n’écrit RIEN dans checkins et ne déclenche aucun effet cliente', () => {
	// Le module ne peut pas écrire : aucune mutation, aucun patch/insert/delete.
	assert.ok(!/\b(?:internal)?[mM]utation\(/.test(actionSource), 'aucune mutation Convex');
	assert.ok(!/runMutation|ctx\.db\.(?:insert|patch|delete)/.test(actionSource), 'aucune écriture');
	assert.ok(!/recordClientEvent|sendPush|notifications/.test(actionSource), 'aucun événement/push/badge');
	assert.ok(
		!/api\.coach\.setFeedback|coach\.setFeedback\s*\(/.test(actionSource),
		'seul coach.setFeedback écrit le retour'
	);
});

test('coachDraft.status expose uniquement le kill switch, au coach', () => {
	const statusStart = actionSource.indexOf('export const status = query({');
	const statusBlock = actionSource.slice(
		statusStart,
		actionSource.indexOf('});', actionSource.indexOf('return { enabled:', statusStart)) + 3
	);
	assert.ok(statusBlock.includes('await requireCoach(ctx, sessionToken)'));
	assert.ok(statusBlock.includes('enabled: !isAiFeatureDisabled("coach_draft")'));
	assert.ok(!statusBlock.includes('text'), 'aucune donnée de brouillon dans la query d’état');
});

/* ═══════════════ 3) ROUTE BFF ═══════════════ */

test('La route /api/coach/draft est réservée au coach', () => {
	assert.ok(routeSource.includes("requireRole(event, 'coach')"));
	assert.ok(routeSource.includes('SESSION_COOKIE'));
});

test('La route applique un timeout de 40 s et appelle l’action, pas la base', () => {
	assert.ok(routeSource.includes('40_000'), 'timeout 40 s');
	assert.ok(routeSource.includes('convex.action(api.coachDraft.generate'));
	assert.ok(!routeSource.includes('convex.mutation'), 'aucune écriture BFF');
	assert.ok(!routeSource.includes('setFeedback'));
	assert.ok(routeSource.includes('return json({ text: text.trim() })'));
});

test('Les erreurs sont sobres — aucun détail technique dans la réponse', () => {
	assert.ok(routeSource.includes('DRAFT_ERROR'));
	assert.ok(!routeSource.includes('errMsg'), 'pas de message Convex brut');
	const responseBlocks = [...routeSource.matchAll(/json\(\{\s*error:\s*([^}]+)\}/g)].map((m) => m[1]);
	assert.ok(responseBlocks.length > 0);
	for (const value of responseBlocks) {
		assert.ok(
			!/errMsg|stack|CONVEX|Server Error|provider|timeout/i.test(value),
			`message technique exposé : ${value}`
		);
	}
});

test('La route refuse l’appel quand AI_COACH_DRAFT_DISABLED est actif', () => {
	assert.ok(routeSource.includes('convex.query(api.coachDraft.status'));
	assert.ok(routeSource.includes('if (!status?.enabled)'));
	assert.ok(routeSource.includes('DRAFT_DISABLED'));
	assert.ok(
		routeSource.indexOf('if (!status?.enabled)') <
			routeSource.indexOf('convex.action(api.coachDraft.generate'),
		'le kill switch est vérifié AVANT l’appel'
	);
});

/* ═══════════════ 4) INTERFACE CRM ═══════════════ */

test('Le bouton n’apparaît que si le brouillon est autorisé (kill switch)', () => {
	assert.ok(cardSource.includes('draftEnabled'));
	assert.ok(cardSource.includes('{#if draftEnabled}'));
	assert.ok(adminServerSource.includes('api.coachDraft.status'));
	assert.ok(adminServerSource.includes('coachDraftEnabled: coachDraftStatus?.enabled === true'));
	assert.ok(adminPageSource.includes('draftEnabled={data.coachDraftEnabled}'));
});

test('BilanCard expose le cycle complet : préparer, préparer…, injecter, régénérer, badge', () => {
	assert.ok(cardSource.includes('Préparer un brouillon'));
	assert.ok(cardSource.includes('Préparation…'));
	assert.ok(cardSource.includes('Régénérer'));
	assert.ok(cardSource.includes('Brouillon IA — à relire'));
	assert.ok(cardSource.includes("fetch('/api/coach/draft'"));
	assert.ok(cardSource.includes('bind:value={feedback}'), 'texte injecté dans le champ modifiable');
	assert.ok(cardSource.includes('feedback = data.text.trim()'), 'injection après succès');
});

test('Un texte existant n’est remplacé qu’après confirmation', () => {
	assert.ok(cardSource.includes('window.confirm('));
	assert.ok(cardSource.includes('if (feedback.trim())'));
	const confirmAt = cardSource.indexOf('window.confirm(');
	const fetchAt = cardSource.indexOf("fetch('/api/coach/draft'");
	assert.ok(confirmAt >= 0 && fetchAt > confirmAt, 'confirmation avant tout appel');
});

test('En cas d’erreur, le texte existant est préservé', () => {
	const errorBlock = cardSource.slice(
		cardSource.indexOf('} catch {'),
		cardSource.indexOf('} finally {')
	);
	assert.ok(errorBlock.includes('Ton texte actuel est conservé'));
	assert.ok(!errorBlock.includes('feedback ='), 'le catch ne touche jamais au texte');
	assert.ok(cardSource.includes('disabled={draftLoading}'), 'bouton désactivé pendant l’appel');
});

test('Les boutons existants restent les SEULS à écrire le retour', () => {
	assert.ok(cardSource.includes('value="nouveau"'));
	assert.ok(cardSource.includes('value="retour_envoye"'));
	assert.ok(cardSource.includes('method="POST"'));
	assert.ok(!cardSource.includes('coach.setFeedback'), 'le composant ne parle jamais à Convex');
	assert.ok(!cardSource.includes('convex.action'), 'aucun appel Convex direct');
});
