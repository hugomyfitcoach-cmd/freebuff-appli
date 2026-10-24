/**
 * Mission C1-bis · 2 — ALIGNEMENT DU CATALOGUE SPORTIF SUR LE BARÈME.
 *
 * Le catalogue et ses calculs tiennent désormais leurs coefficients du module
 * de calibrage (barème G-FLUX kcal/kg/heure) :
 *   musculation récréative 2,2 · intensive 4,4 · séance G-FLUX 3,3 ·
 *   cardio par zone : <130 BPM 3,8 ; 130–150 5,5 ; 150–160 6,6 ;
 *   160–180 7,7 ; >180 8,8 (plafond).
 *
 * Repères dorés de la mission : 60 kg, 3 séances de musculation intensive
 * d'1 h + 1 h 30 de cardio 140 BPM → 1 287 kcal ; 60 kg, 3 séances G-FLUX
 * d'1 h → 594 kcal.
 *
 * Les lignes ANTÉRIEURES au barème (v1, MET du Compendium) restent calculées
 * par leur propre modèle (`depenseLegacyMet`) — aucune n'est recalculée.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const cal = await import(new URL('../src/lib/calibrage.ts', import.meta.url).href);
const sport = await import(new URL('../src/convex/sportCatalog.ts', import.meta.url).href);

/* ── 1 · Catalogue : barème et choix ── */

test('Chaque activité relève d’un barème et propose les bons choix', () => {
	assert.ok(sport.SPORT_CATALOG.length >= 20, 'catalogue complet');
	const zones = cal.BANDES_CARDIO.map((z) => z.id);
	for (const a of sport.SPORT_CATALOG) {
		assert.ok(['musculation', 'douce', 'cardio'].includes(a.bareme), `${a.id} : barème connu`);
		const choix = sport.choixValides(a);
		if (a.bareme === 'musculation') {
			assert.deepEqual(choix, ['recreative', 'moderee', 'intensive'], `${a.id} : récréative / modérée / intensive`);
		} else if (a.bareme === 'douce') {
			assert.deepEqual(choix, ['legere', 'moderee', 'elevee'], `${a.id} : intensités douces`);
		} else {
			assert.deepEqual(choix, zones, `${a.id} : les 5 zones cardio`);
		}
	}
	/* Marche quotidienne toujours exclue, marche inclinée toujours autorisée. */
	assert.equal(sport.isDailyWalkingBlocked('marche'), true);
	assert.equal(sport.isDailyWalkingBlocked('promenade'), true, '« promenade » est bien bloquée');
	assert.equal(sport.isDailyWalkingBlocked('randonnee'), true, 'randonnée exclue elle aussi');
});

test('La marche inclinée sur tapis reste une séance cardio volontaire autorisée', () => {
	assert.equal(sport.isDailyWalkingBlocked(sport.WALKING_SUGGESTION_ID), false);
	assert.equal(sport.getSportEntry(sport.WALKING_SUGGESTION_ID)?.bareme, 'cardio');
	assert.equal(
		sport.resolveSportCoefficient(sport.WALKING_SUGGESTION_ID, '130-150').coefficientKcalKgH,
		5.5
	);
});

test('Version du catalogue incrémentée : v2 (barème) alors que v1 = MET du Compendium', () => {
	assert.equal(sport.SPORT_CATALOG_VERSION, '2');
	assert.equal(sport.SPORT_CATALOG_VERSION_LEGACY, '1');
	assert.equal(sport.KCAL_PAR_H_PAR_MET, 1.05);
});

/* ── 2 · Coefficients du barème (source unique : calibrage) ── */

test('Musculation : récréative 2,2 et intensive 4,4 (valeurs du barème)', () => {
	assert.equal(sport.resolveSportCoefficient('musculation', 'recreative').coefficientKcalKgH, 2.2);
	assert.equal(sport.resolveSportCoefficient('musculation', 'intensive').coefficientKcalKgH, 4.4);
	assert.equal(cal.COUT_SPORT.musculationRecreative, 2.2);
	assert.equal(cal.COUT_SPORT.musculationIntensive, 4.4);
});

test('Cardio : chaque zone rend le coût du barème (3,8 · 5,5 · 6,6 · 7,7 · 8,8)', () => {
	const attendu = { 'sous-130': 3.8, '130-150': 5.5, '150-160': 6.6, '160-180': 7.7, 'plus-180': 8.8 };
	for (const [zone, cout] of Object.entries(attendu)) {
		assert.equal(sport.resolveSportCoefficient('course-tapis', zone).coefficientKcalKgH, cout, zone);
	}
	/* Les zones et leurs coûts viennent du calibrage, pas d'une table parallèle
	   (décimales françaises à l'affichage : 3,8 et non 3.8). */
	for (const z of cal.BANDES_CARDIO) {
		assert.equal(
			sport.SPORT_ZONES_CARDIO.find((x) => x.id === z.id)?.hint.includes(String(z.defaut).replace('.', ',')),
			true
		);
	}
});

test('Choix absent ou hors barème : refus explicite (jamais de zone implicite)', () => {
	assert.throws(() => sport.resolveSportCoefficient('padel'), /requise/);
	assert.throws(() => sport.resolveSportCoefficient('padel', 'moderee'), /invalide/);
	assert.throws(() => sport.resolveSportCoefficient('musculation', 'sous-130'), /invalide/);
	assert.throws(() => sport.resolveSportCoefficient('inconnu', 'sous-130'), /inconnue/);
});

/* ── 3 · Estimation v2 (barème) ── */

test('Musculation intensive 60 kg 1 h → 264 kcal, MET dérivé 4,19 · version « 2 »', () => {
	const est = sport.estimateSportActivity({
		activityId: 'musculation',
		intensity: 'intensive',
		durationMinutes: 60,
		weightKg: 60
	});
	assert.equal(est.estimatedCalories, 264); // 4,4 × 60 × 1
	assert.equal(est.coutHoraireKcalKgH, 4.4);
	assert.equal(est.metValue, 4.19); // 4,4 ÷ 1,05 = 4,1904…
	assert.equal(est.metMinutes, 251); // 4,19 × 60
	assert.equal(est.coefficientVersion, '2');
	assert.equal(est.coefficientSource, 'gflux_table');
	assert.equal(est.intensity, 'intensive');
});

test('Cardio 140 BPM (zone 130-150) 60 kg 1 h 30 → 495 kcal', () => {
	const est = sport.estimateSportActivity({
		activityId: 'course-tapis',
		intensity: '130-150',
		durationMinutes: 90,
		weightKg: 60
	});
	assert.equal(est.estimatedCalories, 495); // 5,5 × 60 × 1,5
	assert.equal(est.coutHoraireKcalKgH, 5.5);
});

test('Repère doré : 3 × musculation intensive 1 h + cardio 140 1 h 30 (60 kg) → 1 287 kcal', () => {
	const seances = [
		...Array.from({ length: 3 }, () =>
			sport.estimateSportActivity({
				activityId: 'musculation',
				intensity: 'intensive',
				durationMinutes: 60,
				weightKg: 60
			})
		),
		sport.estimateSportActivity({
			activityId: 'course-tapis',
			intensity: '130-150',
			durationMinutes: 90,
			weightKg: 60
		})
	];
	assert.equal(cal.sportSemaineKcal(seances.map((s) => s.estimatedCalories ?? 0)), 1287);
});

test('Repère doré : 3 séances G-FLUX d’1 h (60 kg) → 594 kcal à 3,3 kcal/kg/h', () => {
	const seances = Array.from({ length: 3 }, () =>
		sport.estimateGfluxSportActivity({ durationMinutes: 60, weightKg: 60 })
	);
	assert.deepEqual(
		seances.map((s) => s.estimatedCalories),
		[198, 198, 198]
	);
	assert.equal(cal.sportSemaineKcal(seances.map((s) => s.estimatedCalories ?? 0)), 594);
	assert.equal(seances[0].coutHoraireKcalKgH, 3.3);
	assert.equal(seances[0].intensity, 'gflux');
	assert.equal(seances[0].activityId, 'musculation', 'séance G-FLUX portée par l’activité musculation');
});

test('Sans pesée : aucune kcal inventée, MET-minutes conservées', () => {
	const est = sport.estimateSportActivity({
		activityId: 'course-tapis',
		intensity: 'sous-130',
		durationMinutes: 60,
		weightKg: null
	});
	assert.equal(est.estimatedCalories, undefined);
	assert.equal(est.metMinutes, Math.round((3.8 / 1.05) * 60));
	assert.equal(est.coutHoraireKcalKgH, 3.8);
	assert.throws(
		() => sport.estimateSportActivity({ activityId: 'course-tapis', durationMinutes: 60, weightKg: 60 }),
		/requise/
	);
});

/* ── 4 · Lignes historiques (v1) jamais rebasculées ── */

test('depenseLegacyMet conserve le modèle MET (durée seule recalculée)', () => {
	/* Padel 60 min « modérée » (MET 5,5 de la v1) à 67,8 kg → 373 kcal */
	const volume = sport.depenseLegacyMet({ metValue: 5.5, durationMinutes: 60, weightKg: 67.8 });
	assert.equal(volume.metMinutes, 330);
	assert.equal(volume.estimatedCalories, 373); // l'ancienne valeur reste identique
	/* 30 min au même MET → 186 kcal, toujours avec le MET d'origine. */
	assert.equal(
		sport.depenseLegacyMet({ metValue: 5.5, durationMinutes: 30, weightKg: 67.8 }).estimatedCalories,
		186
	);
	/* Sans poids : MET-minutes seules. */
	const sansPoids = sport.depenseLegacyMet({ metValue: 4, durationMinutes: 45, weightKg: null });
	assert.equal(sansPoids.metMinutes, 180);
	assert.equal(sansPoids.estimatedCalories, undefined);
});

test('Le libellé d’une ligne historique reste lisible après bascule du catalogue', () => {
	for (const ancien of ['legere', 'moderee', 'intense']) {
		assert.ok(sport.SPORT_INTENSITY_LABELS[ancien], `${ancien} garde son libellé`);
	}
	assert.equal(sport.SPORT_INTENSITY_LABELS['130-150'], 'Modérée');
	assert.equal(sport.SPORT_INTENSITY_LABELS.gflux, 'Séance G-FLUX');
});
