/**
 * Tests MISSION C3-ter-b — AFFICHAGE SELON LA PHASE.
 *
 * 1. Jauge du Journal : perte de gras strictement inchangée (filet, marqueur,
 *    rouge) ; maintenance / surplus = une seule cible, aucun filet, aucun
 *    marqueur, jamais de rouge ;
 * 2. Libellé « Phase : … » sous la jauge (rien en perte de gras) ;
 * 3. Soldes Performance / Accueil (déficit, surplus, écart maintenance) ;
 * 4. Source des écrans (JournalDay, Performance, Accueil, Vision 360) ;
 * 5. Prompt du brouillon : phase transmise ; règles de déficit réservées à
 *    la perte de gras (section 11, filet du guide, 15 %, perte au ralenti).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	DEPASSEMENT_NEUTRE_PCT,
	etatJauge,
	kgDepuisKcal,
	libellePhaseJauge,
	phaseDesObjectifs,
	soldeMaintenance
} from '../src/lib/phaseAffichage.ts';
import {
	buildCoachDraftPrompt,
	consignesPhase,
	guideStylePourPhase,
	methodePourPhase
} from '../src/convex/coachDraftPrompt.ts';
import { COACH_DRAFT_STYLE_GUIDE } from '../src/lib/data/coachDraftStyleGuide.ts';
import { COACH_DRAFT_METHOD_REFERENCE } from '../src/convex/ai/methodeGflux.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const journalDay = read('src/lib/components/JournalDay.svelte');
const perfPage = read('src/routes/espace/performance/+page.svelte');
const homePage = read('src/routes/espace/+page.svelte');
const adminPage = read('src/routes/admin/+page.svelte');
const coachDraftSource = read('src/convex/coachDraft.ts');

/* ─────────────── 1) Jauge : perte de gras inchangée ─────────────── */

test('perte_gras : filet, marqueur et rouge historique strictement inchangés', () => {
	const sous = etatJauge('perte_gras', { total: 1500, objectifKcal: 1700, maintenanceKcal: 2000 });
	assert.equal(sous.cibleKcal, 2000, 'échelle = maintenance (zone filet comprise)');
	assert.equal(sous.filetActif, true);
	assert.equal(sous.marqueurObjectif, true);
	assert.equal(sous.depasse, false);
	assert.equal(sous.ton, 'brand');
	assert.equal(sous.depassementKcal, 0);

	const filet = etatJauge('perte_gras', { total: 1850, objectifKcal: 1700, maintenanceKcal: 2000 });
	assert.equal(filet.depasse, true);
	assert.equal(filet.ton, 'warn', 'dépassement sous la maintenance = orange');
	assert.equal(filet.depassementKcal, 150);

	const auDela = etatJauge('perte_gras', { total: 2100, objectifKcal: 1700, maintenanceKcal: 2000 });
	assert.equal(auDela.ton, 'danger', 'au-delà de la maintenance = rouge');
	assert.equal(auDela.depasseMaintenance, true);
	assert.equal(auDela.depassementKcal, 100, 'dépassement affiché par rapport à la maintenance');

	// Sans maintenance > objectif : comportement historique conservé.
	const sansFilet = etatJauge('perte_gras', { total: 1800, objectifKcal: 1700, maintenanceKcal: null });
	assert.equal(sansFilet.cibleKcal, 1700);
	assert.equal(sansFilet.filetActif, false);
	assert.equal(sansFilet.marqueurObjectif, false);
	assert.equal(sansFilet.ton, 'warn');
	assert.equal(sansFilet.depassementKcal, 100);
});

/* ─────────────── 2) Maintenance / surplus : une seule cible ─────────────── */

for (const phase of ['maintenance', 'surplus']) {
	test(`${phase} : une seule cible (objectif), aucun filet ni marqueur, jamais de rouge`, () => {
		const sous = etatJauge(phase, { total: 1900, objectifKcal: 2000, maintenanceKcal: 2000 });
		assert.equal(sous.cibleKcal, 2000, 'cible = objectif');
		assert.equal(sous.filetActif, false, 'pas de zone filet');
		assert.equal(sous.marqueurObjectif, false, 'pas de marqueur maintenance / objectif');
		assert.equal(sous.depasse, false);
		assert.equal(sous.ton, 'brand');

		const leger = etatJauge(phase, { total: 2100, objectifKcal: 2000, maintenanceKcal: 2000 });
		assert.equal(leger.depasse, true);
		assert.equal(leger.ton, 'neutre', 'dépassement sous +10 % : ton neutre');

		const fort = etatJauge(phase, { total: 2300, objectifKcal: 2000, maintenanceKcal: 2000 });
		assert.equal(fort.ton, 'warn', 'dépassement marqué : sobre, jamais rouge');
		assert.notEqual(fort.ton, 'danger');
	});
}

test('borne des +10 % : neutre jusqu’à la borne incluse, sobre au-delà', () => {
	assert.equal(DEPASSEMENT_NEUTRE_PCT, 10);
	const pile = etatJauge('surplus', { total: 2200, objectifKcal: 2000 });
	assert.equal(pile.ton, 'neutre', '+10 % pile = neutre');
	const apres = etatJauge('surplus', { total: 2201, objectifKcal: 2000 });
	assert.equal(apres.ton, 'warn');
});

test('libellé de phase sous la jauge : rien en perte de gras', () => {
	assert.equal(libellePhaseJauge('perte_gras'), null);
	assert.equal(libellePhaseJauge('maintenance'), 'Phase : maintenance');
	assert.equal(libellePhaseJauge('surplus'), 'Phase : surplus');
	assert.equal(phaseDesObjectifs({ phase: 'surplus' }), 'surplus');
	assert.equal(phaseDesObjectifs({}), 'perte_gras');
});

/* ─────────────── 3) Soldes cumulés ─────────────── */

test('solde maintenance : mangé − maintenance × jours, null sans maintenance', () => {
	assert.equal(soldeMaintenance({ mangeKcal: 14_700, jours: 7, maintenanceKcal: 2000 }), 700);
	assert.equal(soldeMaintenance({ mangeKcal: 13_300, jours: 7, maintenanceKcal: 2000 }), -700);
	assert.equal(soldeMaintenance({ mangeKcal: 5000, jours: 0, maintenanceKcal: 2000 }), null);
	assert.equal(soldeMaintenance({ mangeKcal: 5000, jours: 5, maintenanceKcal: null }), null);
	assert.equal(Math.round(kgDepuisKcal(7700) * 100) / 100, 1);
	assert.equal(kgDepuisKcal(3850), 0.5);
});

/* ─────────────── 4) Écrans ─────────────── */

test('JournalDay : phase lue par phaseEffective, jauge partagée, libellé sous la jauge', () => {
	assert.ok(journalDay.includes("import {\n\tetatJauge,\n\tlibellePhaseJauge,\n\tphaseDesObjectifs"), 'helpers importés');
	assert.match(journalDay, /const phase = \$derived\(phaseDesObjectifs\(day\.goals\)\)/);
	assert.ok(journalDay.includes('jauge.depassementKcal'), 'valeur de dépassement issue du helper');
	assert.ok(journalDay.includes('{phaseJaugeLabel}'), 'libellé de phase affiché');
	assert.ok(journalDay.includes("{#if maintenanceKcal}"), 'filet / Maint. conditionnés au filet (perte de gras)');
	assert.ok(journalDay.includes("ton: 'neutre'") || journalDay.includes('neutre:'), 'ton neutre disponible');
});

test('Performance : surplus cumulé, prise estimée et objectif poids stable', () => {
	assert.ok(perfPage.includes('phaseEffective(week.goals)'), 'phase effective, jamais recalculée');
	assert.ok(perfPage.includes('soldeMaintenance('), 'solde mangé − maintenance × jours');
	assert.ok(perfPage.includes('Surplus cumulé'), 'libellé surplus');
	assert.ok(perfPage.includes('Prise de poids estimée'), 'tuile surplus');
	assert.ok(perfPage.includes('une partie peut être du muscle'), 'mention théorique');
	assert.ok(perfPage.includes('Objectif : poids stable'), 'tuile maintenance');
	assert.ok(perfPage.includes('Écart à la maintenance'), 'libellé maintenance');
	// Le bloc de perte de gras reste sous sa garde historique.
	const perte = perfPage.indexOf("phase === 'perte_gras'");
	assert.ok(perte > 0 && perfPage.indexOf('theoreticalFatKg !== null && maintenance') > perte);
});

test('Accueil : libellés Déficit cumulé / Surplus cumulé / Écart à la maintenance', () => {
	assert.ok(homePage.includes('phaseDesObjectifs'), 'phase lue par le helper');
	assert.ok(homePage.includes('soldeMaintenance('), 'solde partagé');
	assert.ok(homePage.includes("'Surplus cumulé'"), 'surplus cumulé');
	assert.ok(homePage.includes("'Écart à la maintenance'"), 'écart maintenance');
	assert.ok(homePage.includes("'Déficit cumulé'"), 'déficit conservé');
	assert.ok(homePage.includes('{perfSoldeLabel}'), 'libellé dynamique affiché');
});

test('Vision 360 (admin) : tuile perte / prise / poids stable selon la phase', () => {
	assert.ok(adminPage.includes("phaseClient === 'surplus'"), 'branche surplus');
	assert.ok(adminPage.includes("label: 'Prise estimée'"), 'libellé prise');
	assert.ok(adminPage.includes("label: 'Objectif', value: 'Poids stable'"), 'libellé maintenance');
	assert.ok(adminPage.includes("label: 'Perte estimée'"), 'libellé perte inchangé');
	assert.ok(adminPage.includes('phaseEffective(view?.goals'), 'phase effective de la fiche');
});

/* ─────────────── 5) Prompt du brouillon ─────────────── */

const context = (phase) => ({
	prenom: 'Camille',
	phase,
	weekStart: '2026-09-14',
	weekLabel: 'S38',
	answers: {},
	goals: { kcal: 1800, protein: 110, stepGoal: null },
	formule: 'coaching',
	cycle: null,
	appointments: { lastCallDate: null, daysSinceLastCall: null, nextAppointmentDate: null },
	stats: {
		week: {
			start: '2026-09-07',
			end: '2026-09-13',
			days: [],
			food: {
				kcalAvg: 1800,
				proteinAvg: 110,
				goalKcal: 1800,
				goalProtein: 110,
				thresholdKcal: 1080,
				exploitableDays: 7,
				partialDays: 0,
				absentDays: 0,
				daysWithData: 7,
				completeness: 'complete'
			},
			weight: { avg: 60, count: 3, last: null, prevLast: null, delta: null },
			steps: { avg: 9000, goal: 9000, trackedDays: 7, completeness: 'complete' },
			sport: { activities: 3, durationMin: 180, kcal: 700, metMinutes: 1200 },
			photoAi: { kcalSharePct: null, aiKcal: 0, totalKcal: 0, mealsWithAi: 0, mealsLogged: 0 }
		},
		previousWeek: {
			start: '2026-08-31',
			end: '2026-09-06',
			days: [],
			food: {
				kcalAvg: 1800,
				proteinAvg: 110,
				goalKcal: 1800,
				goalProtein: 110,
				thresholdKcal: 1080,
				exploitableDays: 7,
				partialDays: 0,
				absentDays: 0,
				daysWithData: 7,
				completeness: 'complete'
			},
			weight: { avg: 60, count: 2, last: null, prevLast: null, delta: null },
			steps: { avg: 9000, goal: 9000, trackedDays: 7, completeness: 'complete' },
			sport: { activities: 2, durationMin: 120, kcal: 500, metMinutes: 900 },
			photoAi: { kcalSharePct: null, aiKcal: 0, totalKcal: 0, mealsWithAi: 0, mealsLogged: 0 }
		},
		deltas: {
			kcalAvg: 0,
			proteinAvg: 0,
			weightAvg: 0,
			stepsAvg: 0,
			sportDurationMin: 60,
			sportKcal: 200
		},
		mensurations: null,
		mensurationsAttenduesNonSaisies: false,
		mensurationsHorsFenetre: false,
		peseeRecenteAbsente: false,
		ouvertureFactuelle: false,
		weightTrend: { last: null, previous: null, gapKg: null, prevCheckin: null }
	},
	examples: []
});

const build = (phase) =>
	buildCoachDraftPrompt({
		context: context(phase),
		styleGuide: COACH_DRAFT_STYLE_GUIDE,
		methodReference: COACH_DRAFT_METHOD_REFERENCE,
		examples: []
	});

test('perte_gras : prompt strictement inchangé (section 11, filet, 15 %, aucune phase injectée)', () => {
	const prompt = build('perte_gras');
	assert.ok(prompt.includes(COACH_DRAFT_METHOD_REFERENCE.trim()), 'méthode intégrale');
	assert.ok(prompt.includes(COACH_DRAFT_STYLE_GUIDE.trim()), 'guide intégral');
	assert.ok(prompt.includes('aucun déficit supérieur à 15 %'), 'règle de déficit conservée');
	assert.ok(!prompt.includes('Phase nutritionnelle :'), 'aucune ligne de phase en perte de gras');
	assert.ok(prompt.includes('filet de sécurité'), 'filet conservé');
	assert.equal(consignesPhase('perte_gras').length, 0);
});

test('maintenance et surplus : règles de déficit retirées, consigne courte dédiée', () => {
	for (const phase of ['maintenance', 'surplus']) {
		const prompt = build(phase);
		assert.ok(!prompt.includes('## 11. Calculs de référence'), `section 11 retirée (${phase})`);
		assert.ok(!prompt.includes('**Le filet de sécurité**'), `filet retiré (${phase})`);
		assert.ok(!prompt.includes('aucun déficit supérieur à 15 %'), `15 % retiré (${phase})`);
		assert.ok(prompt.includes(`Phase nutritionnelle : ${phase === 'maintenance' ? 'Maintenance' : 'Surplus'}.`));
		assert.ok(prompt.includes('perte au ralenti'), 'la règle est explicitement écartée');
	}
	const maintenance = build('maintenance');
	assert.ok(maintenance.includes('stabilité et la régularité'), 'consigne maintenance');
	const surplus = build('surplus');
	assert.ok(surplus.includes('priorité aux protéines et à l’entraînement') || surplus.includes("priorité aux protéines et à l'entraînement"), 'consigne surplus');
	assert.ok(surplus.includes('objectif calorique'));
});

test('sources : le contexte porte la phase et le filtre est appliqué par phase', () => {
	assert.ok(coachDraftSource.includes('const phase = phaseEffective(goalsRow)'), 'loadContext lit la phase');
	assert.ok(coachDraftSource.includes('phase,\n\t\t\tgoals:'), 'phase transmise au contexte');
	assert.ok(coachDraftSource.includes('phase === "perte_gras" ? appointments.daysSinceLastCall : null'), 'perte au ralenti conditionnée');
	const slice = COACH_DRAFT_METHOD_REFERENCE.slice(0, 40);
	assert.ok(methodePourPhase(COACH_DRAFT_METHOD_REFERENCE, 'perte_gras').startsWith(slice));
	assert.ok(!methodePourPhase(COACH_DRAFT_METHOD_REFERENCE, 'surplus').includes('## 11. Calculs de référence'));
	assert.ok(guideStylePourPhase(COACH_DRAFT_STYLE_GUIDE, 'perte_gras').includes('**Le filet de sécurité**'));
	assert.ok(!guideStylePourPhase(COACH_DRAFT_STYLE_GUIDE, 'maintenance').includes('**Le filet de sécurité**'));
});
