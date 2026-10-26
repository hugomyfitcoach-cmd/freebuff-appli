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

test('1 · menu ••• compact ancré au bouton, jamais sur la barre de navigation', () => {
	assert.ok(page.includes('getBoundingClientRect()'), 'ancrage calculé sur le bouton •••');
	assert.ok(
		/if \(menuFor === s\._id\) \{[\s\S]*?closeMenu\(\);/.test(page),
		'un second toucher sur ••• referme le menu'
	);
	assert.ok(page.includes('right: Math.max(8, window.innerWidth - rect.right)'), 'aligné sur le bord droit du bouton');
	assert.ok(page.includes('top: {menuAnchor.top}px; right: {menuAnchor.right}px'), 'positionné au pixel du bouton');
	assert.ok(page.includes('style="top: {menuAnchor.top}px; right: {menuAnchor.right}px; width: {MENU_WIDTH}px;"'), 'carte compacte (220 px)');
	assert.ok(/const MENU_WIDTH = 220;/.test(page), 'largeur ~220 px');
	assert.ok(page.includes('origin-top-right') && page.includes('origin-bottom-right'), 'agrandissement depuis le coin du bouton');
	assert.ok(
		/spaceBelow < MENU_HEIGHT \+ 16 && rect\.top > MENU_HEIGHT \+ 24/.test(page),
		'place insuffisante en bas → ouverture AU-DESSUS du bouton'
	);
	assert.ok(
		/top: Math\.max\(8, Math\.min\(rawTop, window\.innerHeight - NAV_RESERVED - MENU_HEIGHT\)\)/.test(page),
		'jamais hors écran ni au-dessus de la barre de navigation'
	);
	assert.ok(/class="flex h-11 w-full items-center gap-2\.5/.test(page), 'lignes de 44 px : icône + libellé');
	assert.ok(/text-\[15px\]/.test(page), 'texte 15 px');
	assert.ok(page.includes('divide') || page.includes('border-t border-line/60'), 'séparateurs fins');
	assert.ok(page.includes('bg-ink/10') && !page.includes('backdrop-blur'), 'fond très légèrement assombri, sans flou');
	assert.ok(page.includes('onclick={closeMenu}'), 'fermeture au toucher extérieur');
	assert.ok(page.includes("if (e.key === 'Escape' && menuFor) closeMenu();"), 'fermeture avec la touche Échap');
	assert.ok(page.includes('firstMenuAction?.focus()'), 'focus sur la première action à l’ouverture');
	assert.ok(page.includes('@media (prefers-reduced-motion: reduce)'), 'règle prefers-reduced-motion présente');
	assert.ok(page.includes('prefersReducedMotion()'), 'animation réduite respectée (fondu seul)');
	assert.ok(/duration: reduced \? 120 : direction === 'in' \? 160 : 120/.test(page), 'ouverture 160 ms, fermeture 120 ms');
	for (const label of ['Déplacer', 'Dupliquer', 'Supprimer']) {
		assert.ok(page.includes(label), `action ${label} conservée`);
	}
	assert.ok(!/>\s*Fermer\s*</.test(page), 'plus de bouton « Fermer »');
	assert.ok(!page.includes('margin-bottom: calc(env(safe-area-inset-bottom) + 5.25rem)'), 'plus de feuille basse pleine largeur');
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
