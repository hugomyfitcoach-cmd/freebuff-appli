/**
 * MISSION M1-bis — BADGE « Brouillon IA — à relire » PERSISTANT + UI DU BROUILLON.
 *
 * Aucun appel réseau, aucune donnée réelle, aucune écriture Convex :
 *  - les règles pures (badge, persistance, retrait côté cliente) sont testées
 *    directement depuis `src/lib/coachDraftUi.ts` ;
 *  - le câblage schéma / mutation / BFF / interface est vérifié par lecture de
 *    source, comme les autres missions du dépôt.
 *
 * Couverture demandée : persistance du badge après sauvegarde et rechargement,
 * disparition à la première modification et à la publication, aucune donnée de
 * badge exposée côté cliente, annulation de la confirmation qui préserve le
 * texte, champ auto-extensible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	aiDraftActive,
	aiDraftBadgeFromCheckin,
	aiDraftFormFlag,
	aiDraftStillCurrent,
	nextFeedbackAiDraft,
	publicCheckin,
} from '../src/lib/coachDraftUi.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const schemaSource = read('src/convex/schema.ts');
const coachSource = read('src/convex/coach.ts');
const checkinsSource = read('src/convex/checkins.ts');
const draftSource = read('src/convex/coachDraft.ts');
const recapSource = read('src/lib/components/RecapBilan.svelte');
const adminServerSource = read('src/routes/admin/+page.server.ts');
const cardSource = read('src/lib/components/BilanCard.svelte');
const dialogSource = read('src/lib/components/ConfirmDialog.svelte');

/* ═══════════════ 1) BADGE PERSISTANT ═══════════════ */

test('Le badge survit au rechargement : il suit le drapeau serveur du brouillon', () => {
	// Bilan rechargé depuis Convex après « Sauvegarder le brouillon ».
	assert.equal(
		aiDraftBadgeFromCheckin({
			status: 'nouveau',
			feedback: 'Merci pour cette semaine…',
			feedbackAiDraft: true,
		}),
		true
	);
	// Rétrocompatibilité : les bilans existants n'ont pas le champ → pas de badge.
	assert.equal(
		aiDraftBadgeFromCheckin({ status: 'nouveau', feedback: 'Texte écrit à la main' }),
		false
	);
	// Jamais de badge sans texte (brouillon vide).
	assert.equal(
		aiDraftBadgeFromCheckin({ status: 'nouveau', feedback: '   ', feedbackAiDraft: true }),
		false
	);
	// Publication : plus de badge, même si l'ancien drapeau traînait.
	assert.equal(
		aiDraftBadgeFromCheckin({
			status: 'retour_envoye',
			feedback: 'Retour publié',
			feedbackAiDraft: true,
		}),
		false
	);
});

test('Le badge disparaît à la PREMIÈRE modification du texte', () => {
	const generated = 'Bravo pour ta régularité cette semaine.';
	assert.equal(aiDraftStillCurrent(generated, generated), true);
	assert.equal(aiDraftStillCurrent(generated, `${generated} `), false, 'un espace suffit');
	assert.equal(aiDraftStillCurrent(generated, generated.replace('Bravo', 'Super')), false);
	assert.equal(aiDraftStillCurrent(generated, generated.slice(0, -1)), false, 'suppression');
	assert.equal(aiDraftStillCurrent(null, generated), false, 'aucun brouillon IA en cours');
	assert.equal(aiDraftStillCurrent('', ''), false, 'texte de référence vide');
	// Dès la PREMIÈRE frappe, le badge reste éteint même si le coach revient
	// exactement au texte d'origine (annuler une saisie ne le rallume pas).
	assert.equal(aiDraftActive(generated, generated, true), false);
	assert.equal(aiDraftActive(generated, generated, false), true);
});

test('Le champ caché aiDraft ne vaut 1 que pour un texte IA inchangé et non publié', () => {
	const text = 'Texte préparé par l’IA.';
	assert.equal(aiDraftFormFlag(text, text, false), true);
	assert.equal(aiDraftFormFlag(text, `${text}!`, false), false);
	assert.equal(aiDraftFormFlag(text, text, true), false, 'jamais de badge sur un retour publié');
	assert.equal(aiDraftFormFlag(null, text, false), false);
	assert.equal(aiDraftFormFlag(text, text, false, true), false, 'texte déjà touché');
});

test('À l’enregistrement : drapeau conservé sur brouillon inchangé, retiré sinon', () => {
	// Sauvegarde d'un brouillon IA non modifié → persistance du badge.
	assert.equal(nextFeedbackAiDraft({ status: 'nouveau', feedback: 'Brouillon IA', aiDraft: true }), true);
	// Texte modifié, texte vide ou saisie manuelle → aucun drapeau.
	assert.equal(nextFeedbackAiDraft({ status: 'nouveau', feedback: 'Texte modifié', aiDraft: false }), undefined);
	assert.equal(nextFeedbackAiDraft({ status: 'nouveau', feedback: '   ', aiDraft: true }), undefined);
	// Publication → champ retiré (undefined = suppression dans le patch Convex).
	assert.equal(nextFeedbackAiDraft({ status: 'retour_envoye', feedback: 'Brouillon IA', aiDraft: true }), undefined);
});

test('Aller-retour complet : générer → sauvegarder → recharger → modifier → publier', () => {
	const generated = 'Bravo pour cette semaine, on garde le cap ensemble.';

	// 1) Génération puis « Sauvegarder le brouillon » sans toucher au texte.
	const firstSave = nextFeedbackAiDraft({
		status: 'nouveau',
		feedback: generated,
		aiDraft: aiDraftFormFlag(generated, generated, false),
	});
	assert.equal(firstSave, true, 'drapeau persisté');

	// 2) Rechargement de la page : le badge revient depuis le serveur.
	assert.equal(
		aiDraftBadgeFromCheckin({ status: 'nouveau', feedback: generated, feedbackAiDraft: firstSave }),
		true
	);

	// 3) Première modification du coach : le badge disparaît immédiatement.
	const edited = `${generated} Et un mot de plus.`;
	assert.equal(aiDraftFormFlag(generated, edited, false), false);
	assert.equal(aiDraftStillCurrent(generated, edited), false);

	// 4) Sauvegarde du texte modifié : le drapeau est retiré définitivement.
	const secondSave = nextFeedbackAiDraft({
		status: 'nouveau',
		feedback: edited,
		aiDraft: aiDraftFormFlag(generated, edited, false),
	});
	assert.equal(secondSave, undefined);
	assert.equal(
		aiDraftBadgeFromCheckin({ status: 'nouveau', feedback: edited, feedbackAiDraft: secondSave }),
		false
	);

	// 5) Publication : aucun badge, quoi qu'il arrive.
	const afterPublish = nextFeedbackAiDraft({
		status: 'retour_envoye',
		feedback: generated,
		aiDraft: true,
	});
	assert.equal(
		aiDraftBadgeFromCheckin({ status: 'retour_envoye', feedback: generated, feedbackAiDraft: afterPublish }),
		false
	);
});

/* ═══════════════ 2) CÔTÉ SERVEUR ═══════════════ */

test('Le schéma ajoute un champ OPTIONNEL et additif sur checkins', () => {
	const checkinsTable = schemaSource.slice(
		schemaSource.indexOf('\tcheckins: defineTable({'),
		schemaSource.indexOf('/* ════ Journal alimentaire')
	);
	assert.ok(checkinsTable.includes('feedbackAiDraft: v.optional(v.boolean())'), 'champ optionnel');
	assert.ok(checkinsTable.includes('aucune'), 'ajout documenté sans migration destructive');
	// Aucun index modifié : ajout purement additif.
	assert.ok(checkinsTable.includes('.index("by_user_week", ["userId", "weekStart"])'));
	assert.ok(checkinsTable.includes('.index("by_weekStart", ["weekStart"])'));
});

test('coach.setFeedback persiste le badge via la règle partagée et le retire à la publication', () => {
	assert.ok(coachSource.includes('import { nextFeedbackAiDraft }'));
	assert.ok(coachSource.includes('aiDraft: v.optional(v.boolean())'));
	assert.ok(coachSource.includes('patch.feedbackAiDraft = nextFeedbackAiDraft({'));
	assert.ok(coachSource.includes('aiDraft: aiDraft === true'));
	// Les boutons existants restent les seuls à écrire le retour.
	assert.ok(coachSource.includes('export const setFeedback = mutation({'));
});

test('Le BFF transmet aiDraft sans jamais lire de donnée côté cliente', () => {
	assert.ok(adminServerSource.includes("form.get('aiDraft') === '1'"));
	assert.ok(adminServerSource.includes('\n\t\t\t\taiDraft,'));
	// Toujours les deux boutons existants comme seuls points d'écriture.
	assert.ok(adminServerSource.includes("const isPublish = status === 'retour_envoye'"));
});

/* ═══════════════ 3) RIEN POUR LA CLIENTE ═══════════════ */

test('myCheckins retire le drapeau du badge avant de répondre à la cliente', () => {
	assert.ok(checkinsSource.includes('import { publicCheckin }'));
	assert.ok(checkinsSource.includes('return rows.map(publicCheckin)'));
	const row = {
		_id: 'checkin1',
		userId: 'user1',
		status: 'nouveau',
		feedback: 'Brouillon en cours',
		feedbackAiDraft: true,
	};
	const out = publicCheckin(row);
	assert.equal('feedbackAiDraft' in out, false, 'drapeau absent de la réponse cliente');
	assert.equal(out.feedback, 'Brouillon en cours', 'le texte du brouillon reste intact');
	assert.equal(row.feedbackAiDraft, true, 'la copie ne mute pas la ligne d’origine');
});

test('Le contexte IA et l’historique cliente n’exposent jamais le badge', () => {
	assert.ok(!draftSource.includes('feedbackAiDraft'), 'loadContext ne lit pas le drapeau');
	assert.ok(!recapSource.includes('Brouillon IA'), 'aucun badge IA dans la vue cliente');
	assert.ok(!recapSource.includes('feedbackAiDraft'));
	// La requête d’état du brouillon reste limitée au kill switch.
	assert.ok(draftSource.includes('enabled: !isAiFeatureDisabled("coach_draft")'));
});

/* ═══════════════ 4) INTERFACE DU BROUILLON ═══════════════ */

test('BilanCard affiche le badge depuis le serveur et envoie le drapeau au formulaire', () => {
	assert.ok(cardSource.includes("from '../coachDraftUi.js'"));
	assert.ok(cardSource.includes('aiDraftBadgeFromCheckin(checkin)'), 'état initial lu côté serveur');
	assert.ok(cardSource.includes('const aiDraftBadge = $derived(!published && aiDraftActive('));
	assert.ok(cardSource.includes('{#if aiDraftBadge}'));
	// Première frappe : le badge ne peut plus revenir, même après un « annuler ».
	assert.ok(cardSource.includes('if (aiDraftSource !== null && text !== aiDraftSource) aiDraftTouched = true;'));
	assert.ok(cardSource.includes('aiDraftTouched = false;'), 'nouveau brouillon = état neuf');
	assert.ok(cardSource.includes('Brouillon IA — à relire'));
	assert.ok(cardSource.includes('<input type="hidden" name="aiDraft"'), 'drapeau transmis au POST');
	assert.ok(cardSource.includes("value={aiDraftFlag ? '1' : '0'}"));
	// Le texte de référence est celui réellement injecté (succès uniquement).
	assert.ok(cardSource.includes('aiDraftSource = feedback;'));
});

test('Le champ de retour s’auto-extend entre 96 et 320 px puis défile en interne', () => {
	assert.ok(cardSource.includes('const FEEDBACK_MIN_PX = 96;'));
	assert.ok(cardSource.includes('const FEEDBACK_MAX_PX = 320;'));
	assert.ok(cardSource.includes('el.scrollHeight'));
	assert.ok(cardSource.includes("el.style.overflowY = el.scrollHeight > FEEDBACK_MAX_PX ? 'auto' : 'hidden'"));
	assert.ok(cardSource.includes('oninput={fitFeedback}'), 'frappe prise en compte');
	assert.ok(cardSource.includes('bind:this={feedbackEl}'));
	assert.ok(cardSource.includes('resize-none'), 'pas de poignée manuelle');
	assert.ok(cardSource.includes('max-h-[320px]'));
	// Mesure + application dans la même tâche : aucun saut de mise en page.
	const fit = cardSource.slice(
		cardSource.indexOf('function fitFeedback()'),
		cardSource.indexOf('$effect(() => {')
	);
	assert.ok(fit.includes("el.style.height = 'auto'"));
	assert.ok(fit.includes('el.style.height = `${next}px`'));
});

test('La confirmation de remplacement est une modale G-FLUX, plus de confirm natif', () => {
	assert.ok(!cardSource.includes('window.confirm('));
	assert.ok(cardSource.includes('<ConfirmDialog'));
	assert.ok(cardSource.includes('confirmLabel="Remplacer"'));
	assert.ok(cardSource.includes('cancelLabel="Annuler"'));
	assert.ok(cardSource.includes('onCancel={cancelReplace}'));
	assert.ok(cardSource.includes('onConfirm={confirmReplace}'));

	// La modale réutilise le motif de feuille de l'application.
	assert.ok(dialogSource.includes('role="dialog"'));
	assert.ok(dialogSource.includes('aria-modal="true"'));
	assert.ok(dialogSource.includes("from '../sheetMotion.js'"));
	assert.ok(dialogSource.includes('bg-brand'));
	assert.ok(dialogSource.includes('{cancelLabel}'));
	assert.ok(dialogSource.includes('{confirmLabel}'));
	// Échap et clic sur le fond annulent.
	assert.ok(dialogSource.includes("event.key === 'Escape'"));
	assert.ok(dialogSource.includes('if (event.target === event.currentTarget) onCancel();'));
});

test('Annuler la confirmation préserve le texte existant', () => {
	const cancelBlock = cardSource.slice(
		cardSource.indexOf('function cancelReplace()'),
		cardSource.indexOf('function confirmReplace()')
	);
	assert.ok(cancelBlock.length > 0);
	assert.ok(!cancelBlock.includes('feedback ='), 'annuler ne touche jamais au texte');
	assert.ok(cancelBlock.includes('replaceOpen = false'));
	// La génération ne remplace le texte qu'après confirmation et succès.
	const confirmBlock = cardSource.slice(
		cardSource.indexOf('function confirmReplace()'),
		cardSource.indexOf('async function generateDraft()')
	);
	assert.ok(confirmBlock.includes('void generateDraft()'));
	assert.ok(cardSource.includes('feedback = data.text.trim()'));
});

test('Les deux boutons existants restent les seuls à écrire le retour', () => {
	assert.ok(cardSource.includes('method="POST"'));
	assert.ok(cardSource.includes('value="nouveau"'));
	assert.ok(cardSource.includes('value="retour_envoye"'));
	assert.ok(cardSource.includes('name="feedback"'));
	assert.ok(!cardSource.includes('coach.setFeedback'));
	assert.ok(!cardSource.includes('convex.mutation'));
});
