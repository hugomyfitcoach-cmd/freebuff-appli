/**
 * MISSION 2 — CRM Vision 360.
 *
 *   A. Carte « PROTÉINES / JOUR » (à côté d'Hydratation) : moyenne glissante
 *      des protéines RÉELLEMENT consommées sur les 7 dernières journées
 *      civiles terminées (J-7 → J-1, Europe/Paris) — MÊME garde-fou que les
 *      moyennes caloriques du CRM (jours exploitables), jamais figée au
 *      dernier bilan hebdomadaire.
 *   B. Navigation des cartes « Poids actuel » / « Mensurations » : clic carte
 *      → onglet « Poids & mesures » (bonne section) ; clic « + » → formulaire
 *      de saisie rapide existant, propagation stoppée.
 *   C. Notifications « Nouveau poids » : tendance factuelle vs la pesée
 *      chronologiquement PRÉCÉDENTE (dates effectives, pas l'ordre
 *      d'affichage) — verte ↓ / grise → / orange ↑ / neutre (1re pesée).
 *
 * Tests unitaires sur les modules PURS (garde-fou, tendance) + vérifications
 * de contrat sur les sources (backend Convex, UI) — aucun backend requis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foodAverages, isExploitableDay, exploitabilityThresholdKcal } from '../src/lib/vision360.ts';
import { weightTrend, weightTrendUi, previousWeighInKg } from '../src/lib/notifications.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const admin = read('src/routes/admin/+page.svelte');
const notifPage = read('src/routes/admin/notifications/+page.svelte');
const libNotif = read('src/lib/notifications.ts');
const coach = read('src/convex/coach.ts');
const metrics = read('src/convex/metrics.ts');
const convexNotif = read('src/convex/notifications.ts');
const schema = read('src/convex/schema.ts');
const icon = read('src/lib/components/Icon.svelte');

const D7 = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'];

/* ═══════════════ A — CARTE PROTÉINES / JOUR ═══════════════ */

test('A — garde-fou : moyenne protéines sur EXACTEMENT les jours exploitables des calories (4/7 → ÷4)', () => {
	// Objectif 2000 kcal → seuil = max(800, 60 % × 2000) = 1200 kcal.
	assert.equal(exploitabilityThresholdKcal(2000), 1200);
	const totals = new Map([
		['2026-10-01', { kcal: 1500, protein: 100 }],
		['2026-10-02', { kcal: 1600, protein: 110 }],
		['2026-10-03', { kcal: 1700, protein: 120 }],
		['2026-10-04', { kcal: 1800, protein: 130 }],
		['2026-10-05', { kcal: 500, protein: 30 }], // PARTIELLE → exclue des DEUX
		// 06 & 07 absentes : jamais comptées comme 0 g.
	]);
	const r = foodAverages(totals, D7, 2000);
	assert.equal(r.breakdown.exploitableDays, 4);
	assert.equal(r.breakdown.partialDays, 1);
	assert.equal(r.breakdown.absentDays, 2);
	// 4 journées exploitables sur 7 = moyenne sur CES QUATRE uniquement.
	assert.equal(r.proteinAvg, 115); // (100+110+120+130)/4 — ni 30 g ni 0 g inventés
	assert.equal(r.kcalAvg, 1650);
	// Une journée exclue des calories l'est aussi des protéines (même dénominateur).
	assert.ok(isExploitableDay(1500, 2000));
	assert.ok(!isExploitableDay(500, 2000));
	assert.ok(!isExploitableDay(null, 2000));
});

test('A — journées absentes jamais comptées comme 0 g (dénominateur = jours exploitables)', () => {
	const totals = new Map([
		['2026-10-01', { kcal: 1500, protein: 90 }],
		['2026-10-02', { kcal: 1600, protein: 110 }],
	]);
	const r = foodAverages(totals, D7, 1750); // seuil = max(800, 1050) = 1050
	assert.equal(r.proteinAvg, 100); // (90+110)/2 — PAS 200/7 ≈ 28,6
	assert.equal(r.breakdown.exploitableDays, 2);
	// Aucune journée exploitable → « — » (null), jamais 0 g.
	const none = foodAverages(new Map([['2026-10-01', { kcal: 400, protein: 20 }]]), D7, 2000);
	assert.equal(none.proteinAvg, null);
});

test('A — coach.ts : protéines servies par foodAverages (mêmes jours exploitables que les calories, consommé uniquement)', () => {
	const cockpitBlock = coach.slice(coach.lastIndexOf('protein: {'));
	assert.match(cockpitBlock, /avg: food360\.proteinAvg/);
	assert.match(cockpitBlock, /trackedDays: food360\.breakdown\.exploitableDays/);
	// Une SEULE source de vérité : calories ET protéines sortent du même foodAverages.
	assert.equal((coach.match(/foodAverages\(/g) ?? []).length, 1);
	// Totaux alimentaires = journal CONSOMMÉ (diaryEntries) — les aliments
	// simplement planifiés n'y figurent jamais.
	assert.match(coach, /ctx\.db\.query\("diaryEntries"\)/);
	const totalsLoop = coach.slice(coach.indexOf('const foodTotals'), coach.indexOf('const weight360'));
	assert.match(totalsLoop, /for \(const e of entries\)/);
	assert.doesNotMatch(totalsLoop, /planifi/i);
});

test('A — carte « PROTÉINES / JOUR » posée À CÔTÉ d’Hydratation, design/dimensions kpi-crm identiques', () => {
	const iProt = admin.indexOf('Protéines / jour');
	const iHyd = admin.indexOf('<!-- HYDRATATION');
	assert.ok(iProt > 0, 'carte présente');
	assert.ok(iProt < iHyd, 'posée juste avant Hydratation dans la même grille');
	const card = admin.slice(iProt, iHyd);
	assert.match(card, /kpi-num-crm text-\[1\.65rem\]/); // mêmes dimensions que les cartes existantes
	assert.match(card, /proteinCard\.avg !== null \? `\$\{fmtVal\(proteinCard\.avg\)\} g` : '—'/); // grammes + « — » si aucun jour exploitable
	assert.match(card, /objectif \{fmtVal\(proteinCard\.goal\)\} g/); // objectif quotidien
	assert.match(card, /\{proteinCard\.trackedDays\}\/7 jours exploitables/); // « X/7 jours exploitables »
	// Légende de la carte (commentaire juste avant le titre) : moyenne
	// glissante des 7 journées terminées, pas un bilan figé.
	const legend = admin.slice(admin.indexOf('<!-- PROTÉINES / JOUR'), iHyd);
	assert.match(legend, /moyenne GLISSANTE des protéines réellement/);
	assert.match(legend, /jamais figée sur le dernier bilan hebdomadaire/);
});

test('A — non-régression : les autres cartes de la Vision 360 sont intactes', () => {
	for (const keep of ['Poids actuel', 'Mensurations', 'Calories / jour', 'Cycle', 'Dépense sportive', 'Hydratation']) {
		assert.ok(admin.includes(keep), `carte « ${keep} » conservée`);
	}
});

/* ═══════════ B — NAVIGATION CARTES POIDS / MENSURATIONS ═══════════ */

test('B — carte « Poids actuel » : clic carte → onglet Poids & mesures, section Poids', () => {
	assert.match(admin, /onclick=\{\(\) => openCorpsSection\('poids'\)\}/);
	const fn = admin.slice(admin.indexOf('async function openCorpsSection'));
	assert.match(fn, /section = 'corps'/); // onglet « Poids & mesures »
	assert.match(fn, /corpsDetail = target === 'poids' \? \{ kind: 'metric', key: 'weightKg' \} : null/); // section Poids (vue détaillée)
	assert.match(fn, /'bm-form-weightKg'/); // ancrage sur la section Poids
});

test('B — carte « Mensurations » : clic carte → onglet Poids & mesures, section Mensurations', () => {
	assert.match(admin, /onclick=\{\(\) => openCorpsSection\('mensurations'\)\}/);
	const fn = admin.slice(admin.indexOf('async function openCorpsSection'));
	assert.match(fn, /'bm-card-waistCm'/); // ancrage grille des mensurations
	assert.match(admin, /id=\{`bm-card-\$\{meta\.key\}`\}/); // ancres par métrique
});

test('B — le petit « + » ouvre UNIQUEMENT le formulaire rapide, sans propagation à la carte', () => {
	assert.match(admin, /onclick=\{\(e\) => \{\s*e\.stopPropagation\(\);\s*openQuickSheet\('weight'\);/);
	assert.match(admin, /onclick=\{\(e\) => \{\s*e\.stopPropagation\(\);\s*openQuickSheet\('mensurations'\);/);
	// Les deux cibles sont distinctes : le « + » est un vrai bouton imbriqué.
	assert.equal((admin.match(/e\.stopPropagation\(\);\n\t\t\t\t\t\t\t\t\topenQuickSheet\(/g) ?? []).length, 2);
});

test('B — non-régression : formulaires rapides et logique de saisie inchangés', () => {
	assert.match(admin, /function openQuickSheet\(kind: QuickSheetKind\)/);
	assert.match(admin, /async function saveQuickWeight\(\)/);
	assert.match(admin, /async function saveQuickMesures\(\)/);
	// Le clic carte n'ouvre plus la saisie rapide : navigation seule.
	assert.doesNotMatch(admin, /onclick=\{\(\) => openQuickSheet\(/);
});

/* ═════════ C — TENDANCE « NOUVEAU POIDS » ═════════ */

test('C — tendance factuelle (unit) : basse verte, stable grise, haute orange, 1re pesée neutre', () => {
	assert.equal(weightTrend('62.3', '63.1'), 'down'); // inférieur → flèche descendante verte
	assert.equal(weightTrend('63.1', '63.1'), 'flat'); // identique → flèche horizontale grise
	assert.equal(weightTrend('63.5', '63.1'), 'up'); // supérieur → flèche montante orange
	assert.equal(weightTrend('59.4', null), 'first'); // première pesée → neutre
	assert.equal(weightTrend('59.4', undefined), 'first'); // historique absent → neutre
	assert.equal(weightTrend(null, '60'), 'first');
	assert.equal(weightTrend(62.4, 62.4), 'flat'); // nombres acceptés
	assert.equal(weightTrend('62,3', '63,1'), 'down'); // virgule française
	assert.deepEqual(weightTrendUi('down'), { icon: 'trendingDown', tile: 'bg-brand-light text-brand-deep' });
	assert.deepEqual(weightTrendUi('up'), { icon: 'trendingUp', tile: 'bg-warn-light text-warn' });
	assert.deepEqual(weightTrendUi('flat'), { icon: 'minus', tile: 'bg-soft text-mist' });
	assert.deepEqual(weightTrendUi('first'), { icon: 'scale', tile: 'bg-soft text-mist' });
});

test('C — pesée précédente = la plus récente strictement antérieure par DATE EFFECTIVE (pas l’ordre d’insertion)', () => {
	const rows = [
		{ date: '2026-10-08', weightKg: 62.4 }, // insérée EN DERNIER (rétrodatée)
		{ date: '2026-10-01', weightKg: 63.0 },
		{ date: '2026-10-05', weightKg: 62.7 },
		{ date: '2026-10-03', weightKg: undefined }, // ligne sans poids : ignorée
	];
	assert.equal(previousWeighInKg(rows, '2026-10-05'), 63.0); // 01/10 malgré l'ordre d'insertion
	assert.equal(previousWeighInKg(rows, '2026-10-08'), 62.7); // 05/10
	assert.equal(previousWeighInKg(rows, '2026-10-10'), 62.4); // 08/10 rétrodatée bien placée
	assert.equal(previousWeighInKg(rows, '2026-10-01'), null); // première pesée
	assert.equal(previousWeighInKg([], '2026-10-05'), null); // historique absent
	// Correction de date : la pesée du 05/10 replacée au 02/10 → bonne précédente.
	const corrected = rows.map((r) => (r.date === '2026-10-05' ? { ...r, date: '2026-10-02' } : r));
	assert.equal(previousWeighInKg(corrected, '2026-10-02'), 63.0);
	assert.equal(previousWeighInKg(corrected, '2026-10-08'), 62.7); // 02/10 devient la précédente du 08/10
	// Pesées multiples le même jour impossible (1 ligne/date) : la ligne mise à
	// jour ne se compare jamais à elle-même (strictement antérieure exigée).
	assert.equal(previousWeighInKg([{ date: '2026-10-05', weightKg: 62.7 }], '2026-10-05'), null);
});

test('C — enregistrement : recordCoachNotifs compare par date et stocke poids + pesée précédente', () => {
	assert.match(metrics, /import \{ previousWeighInKg \} from "\.\.\/lib\/notifications";/);
	assert.match(metrics, /previousWeighInKg\(\s*rows\.map\(\(r\) => \(\{ date: r\.date, weightKg: r\.weightKg \?\? null \}\)\),\s*date\s*\)/);
	assert.match(metrics, /poids: String\(weightKg\),/);
	assert.match(metrics, /\.\.\.\(prev !== null \? \{ poidsPrecedent: String\(prev\) \} : \{\}\)/);
	// Les DEUX écritures clientes (ajout + correction) passent la date — la
	// comparaison se fait sur les dates effectives, jamais l'ordre d'affichage.
	assert.equal((metrics.match(/recordCoachNotifs\(ctx, user\._id, date, patch\)/g) ?? []).length, 2);
});

test('C — schéma et journal : champs additifs poids/poidsPrecedent exposés au CRM', () => {
	assert.match(schema, /poids: v\.optional\(v\.string\(\)\),/); // additif, aucun champ existant modifié
	assert.match(schema, /poidsPrecedent: v\.optional\(v\.string\(\)\),/);
	assert.match(convexNotif, /\.\.\.\(opts\?\.poids \? \{ poids: opts\.poids \} : \{\}\)/);
	assert.match(convexNotif, /\.\.\.\(opts\?\.poidsPrecedent \? \{ poidsPrecedent: opts\.poidsPrecedent \} : \{\}\)/);
	assert.match(convexNotif, /poids: r\.poids \?\? null,\s*poidsPrecedent: r\.poidsPrecedent \?\? null,/);
});

test('C — affichage : tendance par ligne (À consulter + Vu), libellé et design conservés', () => {
	assert.match(notifPage, /const rowStyle = \(row: Row\) =>/);
	assert.match(
		notifPage,
		/row\.kind === 'nouveau_poids' \? weightTrendUi\(weightTrend\(row\.poids, row\.poidsPrecedent\)\) : uiStyle\(row\.kind\)/
	);
	assert.equal((notifPage.match(/\{@const st = rowStyle\(row\)\}/g) ?? []).length, 2); // deux sections
	assert.match(libNotif, /nouveau_poids: 'Nouveau poids'/); // texte « Nouveau poids » conservé
	assert.match(icon, /trendingDown: TrendingDown/); // flèche descendante (registre d'icônes)
	assert.match(icon, /minus: Minus/); // flèche horizontale
	assert.match(icon, /trendingUp: TrendingUp/); // flèche montante (déjà en place)
});

test('C — non-régression : les autres notifications gardent leur libellé et leur style', () => {
	for (const [kind, icone] of [
		['nouvelles_mesures', 'ruler'],
		['nouvelles_photos', 'camera'],
		['bilan_envoye', 'clipboardCheck'],
		['rdv_pris', 'calendarCheck'],
		['rdv_annule', 'calendarX'],
		['inactivite', 'bellOff'],
	]) {
		assert.match(notifPage, new RegExp(`${kind}: \\{ icon: '${icone}'`), `style ${kind} conservé`);
		assert.match(libNotif, new RegExp(`${kind}: '`), `libellé ${kind} conservé`);
	}
});
