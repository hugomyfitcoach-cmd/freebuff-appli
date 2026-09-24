/**
 * Tests ciblés MISSION — modules purs :
 *  - lib/averages.ts     : moyenne 7 journées terminées J-7 → J-1 (pas & calories)
 *  - lib/labelColumns.ts : résolution colonnes étiquette 100 g vs portion (A–D)
 *  - fenêtre mensurations : échéance avec tolérance anticipée de 2 jours
 *    (réimplémentation EXACTE de la formule dashboard.ts pour rester testable
 *    sans Convex — la formule est simple et commentée des deux côtés).
 *
 * Exécution : npm test (node --test tests/*.test.mjs)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* Charge un module TS du projet : node >= 22.6 gère --experimental-strip-types
   directement (aucune transpilation manuelle nécessaire). */
async function loadTs(relPath) {
	const mod = await import(new URL('..' + relPath.slice(1), import.meta.url).href);
	return mod;
}

const averages = await loadTs('./src/lib/averages.ts');
const labelColumns = await loadTs('./src/lib/labelColumns.ts');

/* ────────────── helper : fenêtre mensurations (miroir dashboard.ts) ────────────── */
const PERIOD = 15;
const TOLERANCE = 2;
function shift(iso, days) {
	const d = new Date(iso + 'T12:00:00');
	d.setDate(d.getDate() + days);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/**
 * Miroir EXACT de dashboard.ts : le rappel s'affiche à partir de l'échéance
 * (J15), la fenêtre de comptage des relevés acceptés est élargie de 2 jours
 * en arrière (J13). Retourne la fenêtre si le rappel est DÛ, sinon null.
 * daysSince = jours ENTIERs écoulés depuis startDate (comme daysBetweenISO).
 */
function measurementsWindow(day, startDate) {
	const ms = new Date(day + 'T12:00:00') - new Date(startDate + 'T12:00:00');
	const daysSince = Math.floor(ms / 86400000 + 1e-9); // J0 = jour de démarrage
	if (daysSince < PERIOD) return null;
	const period = Math.floor(daysSince / PERIOD);
	return { period, daysSince, windowStart: shift(startDate, period * PERIOD - TOLERANCE), dueAt: shift(startDate, period * PERIOD) };
}

/* ═══════════════ MOYENNES — J-7 → J-1 ═══════════════ */

test('moyenne pas : la fenêtre est J-7 → J-1 (aujourd\'hui exclu)', () => {
	// Référence : jeudi 24/09/2026 → fenêtre jeudi 17/09 → mercredi 23/09.
	const r = averages.avgLast7Completed(
		[{ date: '2026-09-16', value: 1 }, { date: '2026-09-17', value: 1000 }, { date: '2026-09-23', value: 2000 }, { date: '2026-09-24', value: 9999 }],
		'2026-09-24'
	);
	assert.deepEqual(r.window, [
		'2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23',
	]);
	// Le 16 (hors fenêtre) et le 24 (aujourd'hui) ne comptent JAMAIS.
	assert.equal(r.trackedDays, 2);
	assert.equal(r.avg, 1500);
});

test('moyenne calories : la journée partielle d\'aujourd\'hui n\'enfonce jamais la moyenne', () => {
	// Exemple de la mission : il est midi, 300 kcal saisis aujourd'hui.
	// 6 jours terminés à 2000 kcal + aujourd'hui 300 → moyenne reste 2000.
	const days = ['2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23'];
	const points = days.map((d) => ({ date: d, value: 2000 }));
	points.push({ date: '2026-09-24', value: 300 }); // aujourd'hui, partiel
	const r = averages.avgLast7Completed(points, '2026-09-24');
	assert.equal(r.avg, 2000);
	assert.equal(r.trackedDays, 7);
});

test('journées manquantes : jamais comptées comme zéro (dénominateur réduit)', () => {
	// 3 jours renseignés sur 7, les 4 autres absents → moyenne sur 3, pas /7.
	const r = averages.avgLast7Completed(
		[
			{ date: '2026-09-17', value: 900 },
			{ date: '2026-09-18', value: null }, // absent
			{ date: '2026-09-19', value: 1500 },
			{ date: '2026-09-20', value: 2400 },
		],
		'2026-09-24'
	);
	assert.equal(r.trackedDays, 3);
	assert.equal(r.avg, 1600);
});

test('toutes les journées vides → moyenne null (jamais 0, jamais NaN)', () => {
	const r = averages.avgLast7Completed([], '2026-09-24');
	assert.equal(r.avg, null);
	assert.equal(r.trackedDays, 0);
});

test('changement de date autour de minuit : aucune dérive timezone (clés ISO locales)', () => {
	// La fenêtre est construite par décalage de CLÉS ISO (midi local, anti-DST),
	// jamais par conversion UTC : le 24 à 00 h 41 (Paris) reste le 24.
	const r = averages.avgLast7Completed(
		[{ date: '2026-09-17', value: 100 }, { date: '2026-09-23', value: 300 }],
		'2026-09-24'
	);
	assert.deepEqual(r.window[0], '2026-09-17');
	assert.deepEqual(r.window[6], '2026-09-23');
	assert.equal(r.avg, 200);
	// shiftISO reste stable de part et d'autre de minuit (pas de ±1 jour UTC).
	assert.equal(averages.shiftISO('2026-01-01', -1), '2025-12-31');
	assert.equal(averages.shiftISO('2026-03-29', -1), '2026-03-28'); // passage heure d'été
	assert.equal(averages.shiftISO('2026-10-25', -1), '2026-10-24'); // retour heure d'hiver
});

test('un 0 explicite reste un jour renseigné (0 ≠ absence)', () => {
	const r = averages.avgLast7Completed([{ date: '2026-09-20', value: 0 }], '2026-09-24');
	assert.equal(r.trackedDays, 1);
	assert.equal(r.avg, 0);
});

/* ═══════════════ ÉTIQUETTE IA — cas A–D de la mission ═══════════════ */

test('A. 100 g + portion 30 g : la colonne 100 g est EXCLUSIVE, aucune valeur mélangée', () => {
	const r = labelColumns.resolveLabel100({
		per100: { grams: 100, kcal: 250, carbs: 30, protein: 10, fat: 8 },
		serving: { grams: 30, kcal: 75, carbs: 9, protein: 3, fat: 2.4 },
	});
	assert.equal(r.kcal, 250); // PAS 75 ni 833
	assert.equal(r.carbs, 30);
	assert.equal(r.protein, 10);
	assert.equal(r.fat, 8);
	assert.equal(r.servingQty, 30);
	assert.equal(r.fromPer100, true);
	assert.equal(r.convertedFromServing, undefined);
});

test('A-bis. kcal 100 g mais macros portion (mélange IA) : le garde-fou refuse la fiche incohérente', () => {
	// kcal de la portion (75) + macros du 100 g → kcal incompatibles avec les macros.
	const r = labelColumns.resolveLabel100({
		per100: { grams: 100, kcal: 75, carbs: 30, protein: 10, fat: 8 },
		serving: { grams: 30, kcal: 250 },
	});
	assert.equal(r.kcal, undefined);
	assert.equal(r.carbs, undefined);
	assert.equal(r.reason.includes('incohérente'), true);
});

test('B. 100 g + portion sans valeurs : le 100 g reste la référence, la portion sert d\'info', () => {
	const r = labelColumns.resolveLabel100({
		per100: { grams: 100, kcal: 420, carbs: 60, protein: 5, fat: 15 },
		serving: { grams: 40, kcal: null, carbs: null, protein: null, fat: null },
	});
	assert.equal(r.kcal, 420);
	assert.equal(r.protein, 5);
	assert.equal(r.servingQty, 40);
});

test('C. portion seule (complète) : conversion PROPRE vers /100 g', () => {
	const r = labelColumns.resolveLabel100({
		per100: null,
		serving: { grams: 30, kcal: 75, carbs: 9, protein: 3, fat: 2.4 },
	});
	assert.equal(r.convertedFromServing, true);
	assert.equal(r.kcal, 250); // 75 × 100/30
	assert.equal(r.carbs, 30);
	assert.equal(r.protein, 10);
	assert.equal(r.fat, 8);
	assert.equal(r.servingQty, 30);
});

test('C-bis. portion seule incomplète : on n\'invente RIEN', () => {
	const r = labelColumns.resolveLabel100({
		per100: null,
		serving: { grams: 30, kcal: 75, carbs: null, protein: null, fat: null },
	});
	assert.equal(r.kcal, undefined);
	assert.equal(r.carbs, undefined);
	assert.equal(r.reason.includes('refusée'), true);
});

test('C-ter. portion sans poids connu (1 cookie) : conversion impossible, valeurs vides', () => {
	const r = labelColumns.resolveLabel100({
		per100: null,
		serving: { grams: null, kcal: 180, carbs: 20, protein: 4, fat: 9 },
	});
	assert.equal(r.kcal, undefined);
	assert.equal(r.reason.includes('impossible'), true);
});

test('D. plusieurs colonnes mais valeurs incomplètes : partiel 100 g publié, jamais comblé par la portion', () => {
	const r = labelColumns.resolveLabel100({
		per100: { grams: 100, kcal: 250, carbs: 30, protein: null, fat: 8 },
		serving: { grams: 30, kcal: 75, carbs: 9, protein: 3, fat: 2.4 },
	});
	// kcal + macros LUS du 100 g restent publiés (partiel cohérent)…
	assert.equal(r.kcal, 250);
	assert.equal(r.fat, 8);
	assert.equal(r.carbs, 30);
	// …mais la protéine manquante n'est JAMAIS comblée par la portion (3 g).
	assert.equal(r.protein, undefined);
	assert.equal(r.fromPer100, true);
});

test('D-bis. kcal kJ seulement dans la colonne 100 g : conversion kJ propre', () => {
	const r = labelColumns.resolveLabel100({
		per100: { grams: 100, kcal: null, kj: 1046, carbs: 30, protein: 10, fat: 8 },
		serving: null,
	});
	assert.equal(r.kcalFromKj, true);
	assert.equal(r.kcal, 250); // 1046 / 4,184 = 250
});

test('liquide : 100 ml joue le rôle du 100 g', () => {
	const r = labelColumns.resolveLabel100({
		per100: { grams: 100, isLiquid: true, kcal: 42, carbs: 5, protein: 1, fat: 2 },
		serving: { grams: 250, isLiquid: true, kcal: 105 },
	});
	assert.equal(r.kcal, 42);
	assert.equal(r.servingQty, 250);
});

test('rien d\'exploitable du tout : champs vides, raison explicite', () => {
	const r = labelColumns.resolveLabel100({ per100: null, serving: null });
	assert.equal(r.kcal, undefined);
	assert.equal(r.carbs, undefined);
	assert.equal(r.protein, undefined);
	assert.equal(r.fat, undefined);
});

/* ═══════════════ MENSURATIONS — tolérance anticipée 2 jours ═══════════════ */

test('mensurations J13 : aucun rappel à J15 (tolérance anticipée de 2 jours)', () => {
	// Démarrage 2026-09-01 (J0) → J13 = 14/09, échéance J15 = 16/09.
	const win = measurementsWindow('2026-09-16', '2026-09-01');
	assert.equal(win.period, 1); // première échéance = 1 × 15 jours depuis l'ancre
	assert.equal(win.windowStart, '2026-09-14'); // 15 − 2 = J13
	// Une mensuration saisie le 13/09 (J12) : AVANT la fenêtre → cycle dû à J15.
	const dueAvant = !['2026-09-13'].some((d) => d >= win.windowStart);
	assert.equal(dueAvant, true);
	// Une mensuration saisie le 14/09 (J13, dans la tolérance) :
	// cycle effectué → aucun badge/rappel à J15.
	const mensDates = ['2026-09-14'];
	const due = !mensDates.some((d) => d >= win.windowStart);
	assert.equal(due, false);
});

test('mensurations : la tolérance ne décale PAS la cadence des cycles suivants', () => {
	// Ancre 01/09 : cycles attendus aux 16/09, 01/10, 16/10… quelle que soit la
	// date réelle des relevés anticipés. La fenêtre reste arrondie au multiple.
	assert.equal(measurementsWindow('2026-10-01', '2026-09-01').windowStart, '2026-09-29'); // 30 − 2
	assert.equal(measurementsWindow('2026-10-01', '2026-09-01').dueAt, '2026-10-01'); // 15 × 2
	assert.equal(measurementsWindow('2026-10-16', '2026-09-01').dueAt, '2026-10-16'); // 15 × 3
});

test('mensurations : le rappel n\'apparaît PAS avant l\'échéance (J14 ≠ rappel)', () => {
	// La tolérance accepte une SAISIE en avance (J13) — elle n'avance jamais
	// l'affichage du rappel : à J13/J14 le rappel n'est pas montré.
	assert.equal(measurementsWindow('2026-09-13', '2026-09-01'), null);
	assert.equal(measurementsWindow('2026-09-14', '2026-09-01'), null);
	assert.equal(measurementsWindow('2026-09-15', '2026-09-01'), null);
	// Exactement J15 (2026-09-16) : échéance → fenêtre ouverte.
	assert.equal(measurementsWindow('2026-09-16', '2026-09-01').period, 1);
});
