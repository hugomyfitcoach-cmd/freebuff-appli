/**
 * Tests MISSION T5 — entraînement : jour sélectionné, sans étape « Commencer »,
 * séries modifiables, charges pré-remplies, adhérence et durée justes.
 *
 * 1. /espace/entrainement : cliquer un jour affiche SES séances (ou Repos) et
 *    chaque séance prévue a un bouton « Faire cette séance » ;
 * 2. Accueil : « Mercredi · Haut du corps » (majuscule, espaces autour du ·) ;
 * 3. logSet sans startedAt le pose (la première série cochée démarre la séance) ;
 * 4. Une série cochée reste modifiable ; le guidé peut décocher la série revue ;
 * 5. kg masqué pour « Poids du corps » / « Élastiques » sans charge cible coach ;
 * 6. Pré-remplissage = série cochée la plus récente par date puis setOrder ;
 * 7. Une séance réalisée en avance compte dans l'adhérence ;
 * 8. Durée coach = durée cliente (corrigée si elle existe, sinon chronométrée).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { trainingAdherence } from '../src/lib/trainingProgress.ts';
import { sessionDurationMin } from '../src/lib/trainingWeeks.ts';
import { equipmentFamily } from '../src/lib/exerciseEquipment.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(join(root, 'src/routes/espace/entrainement/+page.svelte'), 'utf8');
const home = readFileSync(join(root, 'src/routes/espace/+page.svelte'), 'utf8');
const runner = readFileSync(join(root, 'src/lib/components/SessionRunner.svelte'), 'utf8');
const convexClient = readFileSync(join(root, 'src/convex/trainingClient.ts'), 'utf8');
const convexAssign = readFileSync(join(root, 'src/convex/trainingAssign.ts'), 'utf8');
const panel = readFileSync(join(root, 'src/lib/components/TrainingPanel.svelte'), 'utf8');

/* ─── 1) Jour sélectionné ─── */

test('1 · un jour sélectionné affiche ses séances (ou Repos), pas la prochaine séance', () => {
	assert.ok(page.includes('let selectedDay = $state('), 'état = jour sélectionné');
	assert.ok(page.includes('selectedDay = iso'), 'cliquer un jour sélectionne CE jour');
	assert.ok(/sessionsOn\(selectedDay\)/.test(page), 'la liste du jour est bornée au jour sélectionné');
	assert.ok(page.includes('>Repos</p>') && page.includes('Aucune séance prévue ce jour-là.'), 'jour vide → carte Repos');
	assert.ok(!/selected = daySessions\[0\]/.test(page), 'plus de sélection « première séance du jour »');
	assert.ok(!page.includes('selectedIso'), 'aucun reste de l’ancien état');
	assert.ok(page.includes('Faire cette séance'), 'chaque séance a son bouton « Faire cette séance »');
	assert.ok(/selectedDay = today >= weekStart/.test(page), 'par défaut : aujourd’hui (ou le lundi affiché)');
});

/* ─── 2) Libellé accueil ─── */

test('2 · accueil : « Mercredi · Haut du corps » (majuscule, espaces autour du ·)', () => {
	assert.ok(/replace\(\/\^\.\/, \(c\) => c\.toUpperCase\(\)\)/.test(home), 'initiale du jour en majuscule');
	assert.ok(home.includes('} · {trainingWeek.nextSession.name}'), 'espace avant et après le point médian');
});

/* ─── 3) Première série cochée = démarrage ─── */

test('3 · logSet sans startedAt le pose, et le renvoie au front', () => {
	const body = convexClient.slice(convexClient.indexOf('export const logSet'), convexClient.indexOf('/* ═══════════ Gestion du calendrier'));
	assert.ok(body.includes('const startedAt = s.startedAt ?? (done ? Date.now() : null)'), 'done démarre la séance');
	assert.ok(body.includes('await ctx.db.patch(scheduledId, { startedAt: startedAt as number })'), 'startedAt persisté backend');
	assert.ok(/return \{ logId: prev\._id, startedAt \}/.test(body), 'startedAt renvoyé à la mise à jour');
	assert.ok(/return \{ logId, startedAt \}/.test(body), 'startedAt renvoyé à la création');
	assert.ok(runner.includes("if (done && r?.startedAt && !sessionStarted)"), 'le front reprend l’horodatage serveur');
	assert.ok(!runner.includes('> Commencer la séance') && !runner.includes('Commencer la séance\n'), 'bouton « Commencer la séance » retiré');
	assert.ok(runner.includes('Passer en mode guidé'), 'lien vers le mode guidé conservé');
	assert.ok(/sessionStarted \|\| hasCheckedSet/.test(runner), '« Terminer » visible dès une série cochée');
});

/* ─── 4) Séries modifiables ─── */

test('4 · une série cochée reste modifiable (reps, kg, durée) et le guidé peut la décocher', () => {
	assert.ok(!runner.includes('disabled={d.done}'), 'champs plus désactivés après coche');
	assert.ok(/onchange=\{\(\) => updateFreeSet\(ex, st\.order\)\}/.test(runner), 'modification → mise à jour de la série');
	const update = runner.slice(runner.indexOf('async function updateFreeSet'), runner.indexOf('/* ── Navigation guidée ──'));
	assert.ok(update.includes('if (!d.done) return;'), 'mise à jour seulement d’une série déjà cochée');
	assert.ok(update.includes('draftPayload(ex, d, setOrder), true'), 'réenregistre la série cochée');
	assert.ok(runner.includes('Décocher cette série'), 'guidé : décocher la série revue');
	assert.ok(/async function unvalidateGuidedSet/.test(runner), 'mutation guidée de décochage');
	assert.ok(/saveSet\(gEx, gSetIdx, guidedPayload\(\), false\)/.test(runner), 'décochage = done:false, valeurs conservées');
});

/* ─── 5) Masquage du kg ─── */

test('5 · kg masqué pour poids du corps / élastiques, sauf charge cible coach', () => {
	assert.equal(equipmentFamily('body weight'), 'Poids du corps');
	assert.equal(equipmentFamily('band'), 'Élastiques');
	assert.equal(equipmentFamily('dumbbell'), 'Haltères');
	assert.ok(runner.includes("family !== 'Poids du corps' && family !== 'Élastiques'"), 'familles sans charge');
	assert.ok(runner.includes('return ex.sets.some((st) => st.targetWeight != null);'), 'exception : charge cible fixée par le coach');
	assert.ok(/\{#if showWeight\(ex\)\}/.test(runner), 'champ kg libre conditionnel');
	assert.ok(/\{#if showWeight\(gEx\)\}/.test(runner), 'champ kg guidé conditionnel');
});

/* ─── 6) Pré-remplissage ─── */

test('6 · pré-remplissage = série cochée la plus récente par DATE puis setOrder', () => {
	const body = convexClient.slice(convexClient.indexOf('export const scheduledSession'), convexClient.indexOf("/* ═══════════ Écriture d'une série"));
	assert.ok(body.includes('.filter((r) => r.done)'), 'seules les séries cochées comptent');
	assert.ok(
		body.includes('b.date.localeCompare(a.date) || b.setOrder - a.setOrder'),
		'tri explicite date DESC puis setOrder DESC — jamais l’ordre de la base'
	);
	assert.ok(!/\.order\("desc"\)\s*\.first\(\)/.test(body), 'plus de « premier log inséré »');
	assert.ok(body.includes('suggestedWeight: last?.weightKg ?? sets[0]?.targetWeight ?? null'), 'charge pré-remplie = dernière charge cochée');
});

/* ─── 7) Adhérence : séance faite en avance ─── */

test('7 · une séance réalisée compte même si sa date prévue est future', () => {
	const TODAY = '2026-10-25';
	const session = (over) => ({ status: 'planned', date: '2026-10-01', skippedAt: null, startedAt: null, ...over });
	const a = trainingAdherence(
		[
			session({ status: 'completed', date: '2026-10-20' }),
			session({ status: 'completed', date: '2026-11-05' }), // faite en avance
			session({ status: 'planned', date: '2026-11-10' }), // future non faite
			session({ status: 'planned', date: '2026-10-10' }), // manquée
			session({ status: 'cancelled', date: '2026-10-15' }),
		],
		TODAY
	);
	assert.equal(a.past, 3, 'passées + future réalisée (annulée et future prévue exclues)');
	assert.equal(a.done, 2, 'réalisée passée + réalisée en avance');
	assert.equal(a.percent, 67);
});

/* ─── 8) Durée coach = durée cliente ─── */

test('8 · durée coach = durée cliente (corrigée si elle existe, sinon chronométrée)', () => {
	assert.equal(sessionDurationMin({ durationMin: 52, startedAt: 1000, completedAt: 60 * 60000 }), 52, 'valeur cliente prioritaire');
	assert.equal(sessionDurationMin({ durationMin: null, startedAt: 1000, completedAt: 42 * 60000 }), 42, 'sinon chrono');
	assert.equal(sessionDurationMin({ durationMin: null, startedAt: null, completedAt: null }), null, 'aucune info → null');
	assert.ok(convexAssign.includes('durationMin: s.durationMin ?? null'), 'le détail d’assignation expose la durée cliente');
	assert.ok(/durationMin: number \| null;/.test(panel), 'le panneau coach typé avec durationMin');
	assert.ok(panel.includes('const min = sessionDurationMin(s);'), 'le coach utilise la même fonction de durée');
});
