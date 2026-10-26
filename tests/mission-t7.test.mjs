/**
 * Tests MISSION T7 — retours du test sur téléphone (Preview #25).
 *
 * 1. Menu ••• rendu en FEUILLE basse, au-dessus de la barre de navigation
 *    (fond assombri, même animation que la carte « Poids », fermeture dehors) ;
 * 2. Minuteur de repos affiché dans la carte après une série cochée quand un
 *    repos est prescrit — jamais après la dernière série de la dernière séance ;
 * 3. Cartes d'exercice repliables/dépliables dans les DEUX sens (chevron) ;
 * 4. Séance commencée par erreur : 0 série → « Prévue » ; « Annuler la séance »
 *    → séries décochées, aucune ligne supprimée, séance « Prévue » ; une autre
 *    cliente ne peut pas l'annuler ; une séance terminée n'est pas modifiable ;
 * 5. « 1 exercice sur 5 » (singulier pour 0 et 1) et « Programme · <nom> ».
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runner = readFileSync(join(root, 'src/lib/components/SessionRunner.svelte'), 'utf8');
const page = readFileSync(join(root, 'src/routes/espace/entrainement/+page.svelte'), 'utf8');
const convexClient = readFileSync(join(root, 'src/convex/trainingClient.ts'), 'utf8');
const route = readFileSync(join(root, 'src/routes/api/training/session/[id]/+server.ts'), 'utf8');

const libre = runner.slice(
	runner.indexOf('<!-- ═══════════ MODE LIBRE'),
	runner.indexOf('<!-- ═══════════ MODE GUIDÉ')
);
const toggle = runner.slice(runner.indexOf('async function toggleFreeSet'), runner.indexOf('/* ── Navigation guidée ──'));
const abandon = convexClient.slice(convexClient.indexOf('export const abandonMySession'));

/* ─── 1) Menu ••• en feuille, au-dessus de la navigation ─── */

test('1 · menu ••• en feuille basse au-dessus de la barre de navigation', () => {
	assert.ok(page.includes("import { fade, fly } from 'svelte/transition'"), 'transitions Svelte réutilisées');
	assert.ok(page.includes("import { sheetFade, sheetFly } from '$lib/sheetMotion'"), 'même animation que la carte Poids');
	assert.ok(/transition:fade=\{sheetFade\(\)\}/.test(page), 'fond assombri en fondu (carte Poids)');
	assert.ok(/transition:fly=\{sheetFly\(\)\}/.test(page), 'feuille qui monte du bas (carte Poids)');
	assert.ok(page.includes('flex items-end justify-center bg-ink/45 backdrop-blur-sm'), 'feuille ancrée en bas + fond sombre');
	assert.ok(
		page.includes('margin-bottom: calc(env(safe-area-inset-bottom) + 5.25rem)'),
		'la feuille se pose AU-DESSUS de la barre de navigation'
	);
	assert.ok(/if \(e\.target === e\.currentTarget\) menuFor = null/.test(page), 'fermeture au toucher extérieur');
	assert.ok(page.includes('role="dialog"') && page.includes('aria-modal="true"'), 'feuille accessible');
	for (const label of ['Déplacer', 'Dupliquer', 'Supprimer']) {
		assert.ok(page.includes(label), `action ${label} conservée`);
	}
	assert.ok(!page.includes('bottom-24'), 'plus de menu flottant masquant la navigation');
});

/* ─── 2) Minuteur de repos ─── */

test('2 · repos affiché après une série cochée quand un repos est prévu', () => {
	// Le bandeau existe dans la carte de l'exercice concerné.
	assert.ok(/restExId === ex\._id && timerKind === 'rest'/.test(libre), 'bandeau dans SA carte');
	assert.ok(libre.includes('Repos · ') && libre.includes('→ 0:00') && libre.includes('Passer'), 'bandeau sombre « Repos · … · Passer »');
	// Le repos démarre APRÈS la validation de la série (et le bandeau est posé
	// après startTimer, qui remet restExId à zéro).
	const startRest = toggle.indexOf("startTimer('rest', rest)");
	const setRest = toggle.indexOf('restExId = ex._id');
	assert.ok(startRest > 0, 'repos automatique après une série cochée');
	assert.ok(setRest > startRest, 'restExId posé après startTimer (sinon le bandeau ne s’affiche jamais)');
	assert.ok(toggle.includes('const rest = ex.sets[setOrder]?.restSeconds ?? 0'), 'repos de la série prescrite');
	assert.ok(toggle.includes('!(isLastSet && isLastEx) && rest > 0'), 'jamais après la dernière série du dernier exercice');
	assert.ok(toggle.includes('stopTimer();'), 'une autre série cochée sans repos coupe le bandeau');
	assert.ok(/function stopTimer\(\)[\s\S]*?timerKind = null;[\s\S]*?restExId = '';/.test(runner), 'repos à 0 ou « Passer » → disparition');
	assert.ok(libre.includes('onclick={stopTimer}'), 'bouton « Passer » opérationnel');
});

/* ─── 3) Cartes repliables ─── */

test('3 · carte repliable/dépliable dans les deux sens, exercice en cours déplié', () => {
	assert.ok(/function isExpanded\(ex: Ex\): boolean/.test(runner), 'état de repli par exercice');
	assert.ok(runner.includes('if (override !== undefined) return override;'), 'le toucher impose l’inverse du défaut');
	assert.ok(/function toggleCard\(ex: Ex\) \{\s*expandedEx\[ex\._id\] = !isExpanded\(ex\);/.test(runner), 'bascule dans les deux sens');
	assert.ok(/onclick=\{\(\) => toggleCard\(ex\)\}/.test(libre), 'en-tête cliquable (miniature + nom)');
	assert.ok(runner.includes('aria-expanded={expanded}'), 'état exposé aux lecteurs d’écran');
	assert.ok(runner.includes("name={expanded ? 'chevronUp' : 'chevronDown'}"), 'chevron haut/bas à droite du compteur');
	assert.ok(/return ex\._id === currentExId \|\| ex\.loggedSets\.some\(\(l\) => l\.done\);/.test(runner), 'exercice en cours déplié par défaut');
	assert.ok(runner.includes('ev.stopPropagation()'), 'la miniature ouvre l’aperçu sans replier la carte');
	assert.ok(runner.includes('expandedEx[ex._id] = true;'), 'une série cochée déplie sa carte (repos visible)');
});

/* ─── 4) Séance commencée par erreur ─── */

test('4a · fermer avec 0 série cochée → la séance redevient « Prévue »', () => {
	assert.ok(/if \(setsChecked === 0\) \{\s*const ok = await abandonSession\(\);/.test(runner), 'fermeture sans série → annulation');
	assert.ok(runner.includes('onclick={requestClose}'), 'la croix passe par la logique d’annulation');
	assert.ok(/async function requestClose\(\)/.test(runner), 'fermeture unifiée');
	assert.ok(abandon.includes('startedAt: undefined'), 'startedAt retiré → « Prévue »');
	assert.ok(abandon.includes('status: "planned"'), 'statut planned');
	const uncheck = toggle.slice(toggle.indexOf('} else {', toggle.indexOf('if (next) {')));
	assert.ok(uncheck.includes('if (!anyLeft) await abandonSession();'), 'toutes les séries décochées → « Prévue »');
});

test('4b · « Annuler la séance » : séries décochées, aucune ligne supprimée, séance Prévue', () => {
	const dialogStart = runner.indexOf('<ConfirmDialog');
	const dialog = runner.slice(dialogStart, runner.indexOf('/>', dialogStart) + 2);
	assert.ok(dialog.includes('title="Quitter la séance ?"'), 'confirmation « Quitter la séance ? »');
	assert.ok(dialog.includes('cancelLabel="Garder en cours"'), 'garder en cours = comportement actuel');
	assert.ok(dialog.includes('confirmLabel="Annuler la séance"'), 'annuler la séance disponible');
	assert.ok(/oncancel=\{keepRunning\}/.test(dialog) && /onconfirm=\{cancelSession\}/.test(dialog), 'deux issues distinctes');
	assert.ok(/function keepRunning\(\)[\s\S]*?onFinished\?\.\(\);/.test(runner), 'garder en cours quitte sans rien écrire');
	assert.ok(runner.includes("body: JSON.stringify({ abandon: true })"), 'annulation via la mutation cliente');
	assert.ok(!abandon.includes('ctx.db.delete'), 'aucune ligne supprimée');
	assert.ok(/for \(const l of logs\) \{\s*if \(!l\.done\) continue;\s*await ctx\.db\.patch\(l\._id, \{ done: false \}\);/.test(abandon), 'done:false, valeurs conservées');
	assert.ok(route.includes('body.abandon === true') && route.includes('abandonMySession'), 'route BFF câblée');
});

test('4c · une autre cliente ne peut pas annuler la séance', () => {
	assert.ok(abandon.includes('const user = await requireClient(ctx, sessionToken);'), 'session obligatoire');
	assert.ok(abandon.includes('if (!s || s.userId !== user._id) throw new ConvexError("Séance introuvable.");'), 'propriétaire uniquement');
});

test('4d · une séance terminée n’est jamais modifiable', () => {
	assert.ok(abandon.includes('if (s.status === "completed") throw new ConvexError("Une séance terminée ne peut pas être annulée.");'), 'séance terminée refusée');
	assert.ok(/if \(!data \|\| alreadyCompleted \|\| mode === 'recap'\) \{\s*closeRunner\(\);/.test(runner), 'le runner ne propose rien sur une séance terminée');
});

/* ─── 5) Libellés ─── */

test('5 · « 1 exercice sur 5 » au singulier (0 et 1) et « Programme · <nom> »', () => {
	assert.ok(
		runner.includes("{exercisesStarted} exercice{exercisesStarted > 1 ? 's' : ''} sur {data.exercises.length}"),
		'exercice au singulier pour 0 et 1'
	);
	assert.ok(page.includes("{headerProgram ? `Programme · ${headerProgram}` : 'Programme'}"), 'espace de chaque côté du point médian');
});
