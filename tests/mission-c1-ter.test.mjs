/**
 * Mission C1-ter — ACTIVITÉS DOUCES HORS ZONES CARDIO + NON-RÉGRESSION DU
 * CATALOGUE.
 *
 * Règles vérifiées :
 *  - le catalogue se répartit en trois barèmes : musculation (récréative 2,2 /
 *    modérée 3,3 / intensive 4,4), douce (légère 2,2 / modérée 2,2 / élevée 3,3) et cardio
 *    (zones 3,8 · 5,5 · 6,6 · 7,7 · plafond 8,8) ;
 *  - yoga, Pilates, aquagym, étirements et mobilité sont DOUX : aucune zone
 *    cardio ne leur est proposée ;
 *  - une FC moyenne RÉELLEMENT mesurée choisit la zone pour toutes les
 *    activités, y compris douces et musculation ;
 *  - chaque activité du catalogue est figée ci-dessous (catégorie + kcal pour
 *    1 h à 60 kg à chaque intensité) : une future activité non déclarée fait
 *    échouer le test — elle ne peut pas échapper au barème.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const cal = await import(new URL('../src/lib/calibrage.ts', import.meta.url).href);
const sport = await import(new URL('../src/convex/sportCatalog.ts', import.meta.url).href);

/* ── 1 · Tableau de référence : 1 h à 60 kg (kcal), par activité ── */

const CARDIO = {
	'sous-130': 228, // 3,8 × 60
	'130-150': 330, // 5,5 × 60
	'150-160': 396, // 6,6 × 60
	'160-180': 462, // 7,7 × 60
	'plus-180': 528 // 8,8 × 60
};
const DOUCE = { legere: 132, moderee: 132, elevee: 198 }; // 2,2 / 2,2 / 3,3 × 60
const MUSCULATION = { recreative: 132, moderee: 198, intensive: 264 }; // 2,2 / 3,3 / 4,4 × 60

const REFERENCE = {
	musculation: { bareme: 'musculation', kcal: MUSCULATION },
	// ── Cardio & salle ──
	'marche-inclinee-tapis': { bareme: 'cardio', kcal: CARDIO },
	'course-tapis': { bareme: 'cardio', kcal: CARDIO },
	'velo-exterieur': { bareme: 'cardio', kcal: CARDIO },
	'velo-indoor': { bareme: 'cardio', kcal: CARDIO },
	elliptique: { bareme: 'cardio', kcal: CARDIO },
	rameur: { bareme: 'cardio', kcal: CARDIO },
	escalier: { bareme: 'cardio', kcal: CARDIO },
	// ── Natation & eau ──
	natation: { bareme: 'cardio', kcal: CARDIO },
	aquagym: { bareme: 'douce', kcal: DOUCE },
	// ── Cours & douceurs ──
	pilates: { bareme: 'douce', kcal: DOUCE },
	yoga: { bareme: 'douce', kcal: DOUCE },
	etirements: { bareme: 'douce', kcal: DOUCE },
	mobilite: { bareme: 'douce', kcal: DOUCE },
	danse: { bareme: 'cardio', kcal: CARDIO },
	// ── HIIT & circuits ──
	hiit: { bareme: 'cardio', kcal: CARDIO },
	'circuit-training': { bareme: 'cardio', kcal: CARDIO },
	'cross-training': { bareme: 'cardio', kcal: CARDIO },
	// ── Sports de raquette ──
	tennis: { bareme: 'cardio', kcal: CARDIO },
	padel: { bareme: 'cardio', kcal: CARDIO },
	badminton: { bareme: 'cardio', kcal: CARDIO },
	// ── Sports collectifs ──
	football: { bareme: 'cardio', kcal: CARDIO },
	basket: { bareme: 'cardio', kcal: CARDIO },
	// ── Glisse & hiver ──
	ski: { bareme: 'cardio', kcal: CARDIO },
	// ── Autres ──
	'corde-a-sauter': { bareme: 'cardio', kcal: CARDIO }
};

test('Non-régression : chaque activité a une catégorie et une valeur à chaque intensité', () => {
	/* Aucune activité du catalogue ne peut manquer au tableau de référence. */
	const idsCatalogue = sport.SPORT_CATALOG.map((a) => a.id).sort();
	assert.deepEqual(idsCatalogue, Object.keys(REFERENCE).sort(), 'catalogue figé (activité ajoutée = test à mettre à jour)');

	for (const entree of sport.SPORT_CATALOG) {
		const attendu = REFERENCE[entree.id];
		assert.equal(entree.bareme, attendu.bareme, `${entree.id} : catégorie`);
		const choix = sport.choixValides(entree);
		assert.deepEqual(
			[...choix].sort(),
			Object.keys(attendu.kcal).sort(),
			`${entree.id} : intensités proposées`
		);
		for (const intensite of choix) {
			const est = sport.estimateSportActivity({
				activityId: entree.id,
				intensity: intensite,
				durationMinutes: 60,
				weightKg: 60
			});
			assert.equal(
				est.estimatedCalories,
				attendu.kcal[intensite],
				`${entree.id}/${intensite} : 1 h à 60 kg`
			);
			/* Le coût stocké est exactement la valeur du barème. */
			assert.equal(
				est.coutHoraireKcalKgH,
				attendu.kcal[intensite] / 60,
				`${entree.id}/${intensite} : coût horaire`
			);
		}
	}
});

/* ── 2 · Les activités douces ne passent plus par les zones cardio ── */

test('Yoga, Pilates, aquagym, étirements et mobilité : barème doux, aucune zone cardio', () => {
	for (const id of ['yoga', 'pilates', 'aquagym', 'etirements', 'mobilite']) {
		const entree = sport.getSportEntry(id);
		assert.equal(entree?.bareme, 'douce', `${id} : activité douce`);
		for (const zone of cal.ZONES_CARDIO_IDS) {
			assert.throws(
				() => sport.resolveSportCoefficient(id, zone),
				/invalide/,
				`${id} : la zone « ${zone} » n'est plus acceptée`
			);
		}
	}
	/* Repères : 1 h de yoga à 60 kg → 132 kcal (légère/modérée) et 198 (élevée). */
	assert.equal(sport.resolveSportCoefficient('yoga', 'legere').coefficientKcalKgH, 2.2);
	assert.equal(sport.resolveSportCoefficient('yoga', 'moderee').coefficientKcalKgH, 2.2);
	assert.equal(sport.resolveSportCoefficient('yoga', 'elevee').coefficientKcalKgH, 3.3);
});

test('Les zones cardio restent réservées aux activités cardio et aux sports', () => {
	for (const id of ['course-tapis', 'padel', 'natation', 'danse']) {
		assert.throws(() => sport.resolveSportCoefficient(id, 'elevee'), /invalide/, `${id} : pas d'intensité douce`);
	}
	assert.equal(sport.resolveSportCoefficient('padel', '130-150').coefficientKcalKgH, 5.5);
});

/* ── 3 · Une FC moyenne réelle choisit la zone pour TOUTES les activités ── */

test('FC moyenne mesurée : elle choisit la zone, même sur une activité douce ou de musculation', () => {
	/* 140 BPM → zone 130–150 → 5,5 kcal/kg/h → 330 kcal (1 h à 60 kg). */
	const yoga = sport.estimateSportActivity({
		activityId: 'yoga',
		durationMinutes: 60,
		weightKg: 60,
		bpmMoyen: 140
	});
	assert.equal(yoga.estimatedCalories, 330);
	assert.equal(yoga.intensity, '130-150', 'la zone mesurée est stockée sur la ligne');
	assert.equal(yoga.bpmMoyen, 140);
	assert.equal(yoga.coutHoraireKcalKgH, 5.5);

	const musculation = sport.estimateSportActivity({
		activityId: 'musculation',
		intensity: 'intensive', // ignorée : la FC mesurée prime
		durationMinutes: 60,
		weightKg: 60,
		bpmMoyen: 140
	});
	assert.equal(musculation.estimatedCalories, 330);
	assert.equal(musculation.intensity, '130-150');

	/* 170 BPM → zone 160–180 → 7,7 → 462 kcal. */
	assert.equal(
		sport.estimateSportActivity({
			activityId: 'course-tapis',
			intensity: 'sous-130',
			durationMinutes: 60,
			weightKg: 60,
			bpmMoyen: 170
		}).estimatedCalories,
		462
	);
	/* Une FC hors bornes plausibles est refusée (30 à 240 BPM). */
	assert.throws(
		() => sport.estimateSportActivity({ activityId: 'yoga', durationMinutes: 60, weightKg: 60, bpmMoyen: 300 }),
		/Fréquence cardiaque/
	);
});

/* ── 4 · Le barème reste la source unique ── */

test('C1-ter : les constantes du barème sont celles du module de calibrage', () => {
	assert.equal(cal.COUT_SPORT.activiteDouce, 2.2);
	assert.equal(cal.COUT_SPORT.activiteDouceElevee, 3.3);
	assert.deepEqual([...cal.INTENSITES_DOUCES], ['legere', 'moderee', 'elevee']);
	assert.equal(cal.coutSportif({ sport: 'douce', intensite: 'moderee' }).coefficientKcalKgH, 2.2);
	assert.equal(cal.coutSportif({ sport: 'douce', intensite: 'elevee' }).coefficientKcalKgH, 3.3);
	assert.throws(() => cal.coutSportif({ sport: 'douce', intensite: 'intense' }), /activité douce inconnue/i);
});
