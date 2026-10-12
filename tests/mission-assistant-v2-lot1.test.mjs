/**
 * MISSION — ASSISTANT G-FLUX V2, LOT 1 (prompt + markdown sûr).
 *
 * Non-régression sur :
 *  1) le nouveau system prompt à 3 niveaux d'autonomie (fin des refus
 *     injustifiés, règle positive « outil avant chiffre », capacités photo,
 *     réserve du coach explicitement cadrée) ;
 *  2) le rendu markdown SÛR des bulles (parseur pur, SANS {@html}, XSS
 *     neutralisé par construction) ;
 *  3) la préservation de TOUTES les sécurités V1 (resolveAction, types
 *     d'écriture fermés, détresse, quotas, hard lock Billing).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const policySrc = read('src/lib/assistant/policy.ts');
const page = read('src/routes/espace/assistant/+page.svelte');
const schema = read('src/convex/schema.ts');
const assistantSrc = read('src/convex/assistant.ts');
const actionBff = read('src/routes/api/assistant/action/+server.ts');

/* ══════════════ 1. PROMPT — 3 niveaux d'autonomie ══════════════ */

const policyMod = await import(new URL('../src/lib/assistant/policy.ts', import.meta.url).href);

test('Prompt : les 3 niveaux d’autonomie sont explicitement structurés', () => {
	const p = policyMod.assistantSystemPrompt('nutrition', '2026-10-08');
	assert.ok(p.includes('NIVEAU 1'), 'niveau 1 (analyse/conseil libre) doit être nommé');
	assert.ok(p.includes('NIVEAU 2'), 'niveau 2 (écritures confirmées) doit être nommé');
	assert.ok(p.includes('NIVEAU 3'), 'niveau 3 (réserve du coach) doit être nommé');
	assert.ok(p.includes('prepareCoachQuestion'), 'escalade = préparation de synthèse pour Hugo');
});

test('Prompt : plus de règle de refus généralisée « décision de coaching »', () => {
	// La V1 répondait un refus à TOUTE demande perçue comme « stratégie » —
	// la formule générique est retirée au profit d'une analyse + synthèse Hugo.
	assert.ok(
		!/Quand une décision de coaching est nécessaire[^`]*Ça mérite une décision de coaching\./.test(
			policySrc
		),
		'la règle V1 de renvoi systématique doit avoir disparu du prompt'
	);
	const p = policyMod.assistantSystemPrompt('nutrition', '2026-10-08');
	assert.ok(
		p.includes('Ne réponds à AUCUNE de ces demandes\n  par un renvoi vers Hugo'),
		'interdiction explicite du renvoi automatique vers Hugo'
	);
});

test('Prompt : règle POSITIVE — outil avant chiffre, jamais de calcul de tête', () => {
	const p = policyMod.assistantSystemPrompt('nutrition', '2026-10-08');
	assert.ok(p.includes('getToday'), 'getToday cité dans la règle positive');
	assert.ok(p.includes('getPeriodRecap'), 'getPeriodRecap cité');
	assert.ok(
		/TOUTE question chiffrée/.test(p),
		'déclencheur explicite pour l’appel d’outil'
	);
});

test('Prompt : capacités photo décrites (fin des « je ne peux pas analyser des photos »)', () => {
	const p = policyMod.assistantSystemPrompt('nutrition', '2026-10-08');
	assert.ok(/PHOTOS :/.test(p), 'section photos présente');
	assert.ok(
		/N'annonce JAMAIS que tu "ne peux pas analyser\nde photo"|ne peux pas analyser/.test(p),
		'interdiction de la réponse « je ne peux pas analyser des photos »'
	);
	assert.ok(p.includes('≈ Estimation'), 'estimation photo marquée comme telle');
});

test('Prompt : la réserve du coach reste EXPLICITE et exhaustive', () => {
	const p = policyMod.assistantSystemPrompt('nutrition', '2026-10-08');
	for (const must of [
		'calories objectif',
		'protéines/glucides/lipides',
		'objectif de pas',
		'stratégie de déficit',
		'protocole de recomposition',
		'planning',
	]) {
		assert.ok(p.includes(must), `réserve coach : « ${must} » doit rester interdit`);
	}assert.ok(
			/n['’]envisage PAS d'utiliser un outil d'écriture/.test(p),
			'niveau 3 : aucune écriture, même si la cliente demande'
		);
});

test('Prompt : données absentes → question ou limite, jamais d’invention', () => {
	const p = policyMod.assistantSystemPrompt('nutrition', '2026-10-08');
	assert.ok(/n'inventes JAMAIS une donnée absente/.test(p));
	assert.ok(/pose UNE question précise/.test(p));
});

test('Prompt : santé — orientation médicale quand nécessaire, sans refus sec', () => {
	const p = policyMod.assistantSystemPrompt('nutrition', '2026-10-08');
	assert.ok(/avis médical/.test(p));
	assert.ok(/Symptôme persistant/.test(p), 'soif/fatigue/douleur : écoute + orientation');
	assert.ok(/Aucun diagnostic, aucune prescription/.test(p), 'garde médicale conservée');
	assert.ok(/Grossesse/.test(p), 'règle grossesse conservée');
});

test('Prompt : sécurité détresse conservée à l’identique (module + réponse)', () => {
	assert.ok(typeof policyMod.safetyScreen === 'function');
	assert.ok(typeof policyMod.DISTRESS_REPLY === 'string' && policyMod.DISTRESS_REPLY.includes('15 ou le 112'));
	const v = policyMod.safetyScreen("je n'ai pas mangé depuis trois jours");
	assert.equal(v.level, 'distress');
	const ok = policyMod.safetyScreen("Comment atteindre mes protéines restantes ?");
	assert.equal(ok.level, 'ok', 'un conseil nutritionnel normal ne doit PAS déclencher la détresse');
});

/* ══════════════ 2. MARKDOWN SÛR — tests fonctionnels ══════════════ */

const md = await import(new URL('../src/lib/assistant/markdown.ts', import.meta.url).href);

test('Markdown : gras, italique, code, listes et paragraphes', () => {
	const b = md.parseRichText(
		'Voici **Poids** en gras et *léger* plus `55 kg`.\n\n- **Pomme** : 52 kcal\n- **Riz** : 130 kcal\n\n1. Un\n2. Deux'
	);
	assert.equal(b.length, 3);
	assert.equal(b[0].type, 'paragraph');
	const parts = b[0].parts;
	assert.deepEqual(
		parts.map((x) => x.type),
		['text', 'bold', 'text', 'italic', 'text', 'code', 'text']
	);
	assert.equal(parts.find((x) => x.type === 'bold').text, 'Poids');
	assert.equal(b[1].type, 'ul');
	assert.equal(b[1].items.length, 2);
	assert.equal(b[1].items[0][0].type, 'bold');
	assert.equal(b[2].type, 'ol');
});

test('Markdown : `---` seul est ignoré (pas de hr)', () => {
	const b = md.parseRichText('avant\n\n---\n\naprès');
	assert.equal(b.length, 2);
	assert.equal(b[0].type, 'paragraph');
	assert.equal(b[1].type, 'paragraph');
});

test('Markdown XSS : <script> reste du TEXTE, jamais un élément', () => {
	const b = md.parseRichText('<script>alert(1)</script>');
	assert.equal(b.length, 1);
	assert.equal(b[0].type, 'paragraph');
	assert.ok(b[0].parts.every((p) => p.type === 'text'), 'aucun type spécial produit');
	assert.ok(b[0].parts.map((p) => p.text).join('').includes('<script>alert(1)</script>'));
});

test('Markdown XSS : <img onerror> et javascript: restent inertes', () => {
	const img = md.parseRichText('<img src=x onerror="alert(1)">');
	assert.ok(img[0].parts.every((p) => p.type === 'text'));
	const link = md.parseRichText('[clique](javascript:alert(1))');
	const flat = JSON.stringify(link);
	assert.ok(!flat.includes('"type":"link"'), 'aucun type lien dans l’AST');
	assert.ok(!flat.includes('href'), 'aucun href produit — les [] restent du texte');
});

test('Markdown XSS : pas de HTML/attribut possible par construction', () => {
	assert.ok(!policySrc.includes('{@html}'));
	const componentCode = read('src/lib/components/assistant/RichText.svelte').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
assert.ok(!/[{]@html/.test(componentCode), 'le composant n’utilise JAMAIS {@html}');
assert.ok(!/<a\s/.test(componentCode), 'aucune balise <a> (pas de lien depuis le modèle)');
assert.ok(!/<img\s/.test(componentCode), 'aucune balise <img> construite depuis le modèle');
});

test('Markdown : bornes anti-abus (entrée, blocs, items)', () => {
	const long = Array.from({ length: 200 }, (_, i) => `ligne ${i}`).join('\n');
	const b = md.parseRichText(long);
	assert.ok(b.length <= 40, 'nombre de blocs borné');
	const bigList = md.parseRichText(Array.from({ length: 50 }, (_, i) => `- item ${i}`).join('\n'));
	assert.ok(bigList[0].items.length <= 12, 'items de liste bornés');
	const huge = md.parseRichText('x'.repeat(9000));
	assert.ok(JSON.stringify(huge).length < 2000, 'entrée tronquée');
});

/* ══════════════ 3. CÂBLAGE UI — la bulle utilise le rendu sûr ══════════════ */

test('UI : la bulle Assistant rend via RichText (plus de texte brut)', () => {
	assert.ok(page.includes("import RichText from '$lib/components/assistant/RichText.svelte'"));
	assert.ok(page.includes('<RichText text={msg.content} />'));
	assert.ok(!page.includes('whitespace-pre-line">{msg.content}'), 'l’ancien rendu brut a disparu');
});

/* ══════════════ 4. PRÉSERVATION DES SÉCURITÉS V1 ══════════════ */

test('Sécurités : resolveAction (confirm/cancel/undo) inchangé — seul chemin d’écriture', () => {
	assert.ok(assistantSrc.includes('export const resolveAction = mutation('));
	for (const d of ['confirm', 'cancel', 'undo']) {
		assert.ok(assistantSrc.includes(`v.literal("${d}")`), `décision « ${d} » toujours acceptée`);
	}
	assert.ok(assistantSrc.includes("doc.userId !== user._id"), 'isolation propriétaire toujours en place');
	assert.ok(assistantSrc.includes('doc.expiresAt < now'), 'TTL des actions toujours en place');
});

test('Sécurités : liste fermée des écritures (schema) NON étendue', () => {
	assert.ok(schema.includes('assistantActionType'));
	// Les types autorisés restent exactement les 6 de la V1 :
	const m = schema.match(/assistantActionType[\s\S]{0,600}/);
	assert.ok(m, 'bloc assistantActionType présent');
	for (const t of ['journal_add', 'journal_remove', 'steps', 'weight', 'measurement', 'coach_question']) {
		assert.ok(m[0].includes(`"${t}"`), `type « ${t} » conservé`);
	}
	assert.ok(!m[0].includes('goal'), 'AUCUN type d’écriture sur les objectifs');
});

test('Sécurités : BFF action — le client n’envoie toujours QUE actionId + décision', () => {
	assert.ok(actionBff.includes("body.actionId === 'string'"));
	assert.ok(actionBff.includes('requireClientAccess'));
	assert.ok(actionBff.includes('resolveAction'));
});

test('Sécurités : hard lock Billing et anti-double-submit toujours câblés', () => {
	assert.ok(assistantSrc.includes('accessStateForUser'), 'hard lock recalculé côté Convex');
	assert.ok(assistantSrc.includes('INFLIGHT_TIMEOUT_MS'), 'verrou anti-double-submit conservé');
	assert.ok(assistantSrc.includes('minIntervalMs'), 'anti-rafale conservé');
});
