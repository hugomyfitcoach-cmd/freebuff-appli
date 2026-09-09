/**
 * Suivi de cycle — LOGIQUE PARTAGÉE (une seule source de vérité).
 *
 * Consommé par :
 *  - l'Accueil cliente (carte « Cycle », édition des informations) ;
 *  - la Vision 360 du CRM coach (carte « Cycle » en lecture seule).
 *
 * La formule de phase (`getCyclePhase`) et les libellés des phases sont repris
 * À L'IDENTIQUE de l'outil historique « Cycle » (Outils & calibrage) — on ne
 * réécrit ni la formule, ni les tranches, ni le questionnaire.
 */

export type CycleContra = 'none' | 'iud-hormonal' | 'hormonal';

/** Configuration persistée d'une cliente (champ `users.cycle` côté Convex). */
export type CycleConfig = {
	contra: CycleContra;
	/** « Je n'ai plus de règles régulières » — aucune estimation affichée. */
	noDate: boolean;
	/** Premier jour des dernières règles "yyyy-mm-dd" (absent si hormonal / irrégulier). */
	lmp?: string | null;
	/** Durée moyenne du cycle en jours, 21–32 (absente si hormonal / irrégulier). */
	len?: number | null;
	updatedAt: number;
};

export type CyclePhaseKey = 'menses' | 'follicular' | 'ovulation' | 'luteal-early' | 'luteal-late';

/** Libellés et textes courts des phases — textes identiques à l'outil original. */
export const PHASES: Record<CyclePhaseKey, { label: string; blurb: string }> = {
	menses: {
		label: 'Menstruations',
		blurb: 'Ton corps entame un nouveau cycle. Faim et énergie sont généralement proches de la normale.',
	},
	follicular: {
		label: 'Phase folliculaire',
		blurb: 'Période généralement stable sur la faim, l’énergie et l’entraînement.',
	},
	ovulation: {
		label: 'Ovulation estimée',
		blurb: 'Tu es probablement proche de ton pic ovulatoire estimé — pas une certitude, une estimation.',
	},
	'luteal-early': {
		label: 'Phase lutéale précoce',
		blurb: 'La température corporelle peut légèrement augmenter. Rien à changer si tu te sens bien.',
	},
	'luteal-late': {
		label: 'Phase lutéale tardive',
		blurb: 'Faim, rétention d’eau et sommeil peuvent être plus marqués chez certaines femmes. Ce n’est pas automatique.',
	},
};

/** Messages « sans estimation » — formulés comme dans l'outil original. */
export const CYCLE_NO_ESTIMATE_MSGS = {
	hormonal:
		'Sous ce type de contraception, ton cycle hormonal naturel est mis en pause — il n’y a pas de vraies phases à identifier, et t’en montrer une serait te donner une fausse précision.',
	irregular:
		'Sans date de règles fiable, une estimation de phase ne serait pas fiable non plus — mieux vaut ne pas t’en donner une plutôt que de te donner une fausse précision.',
} as const;

/** Durées proposées (sélecteur) — mêmes valeurs que l'outil d'origine : 21 à 32 jours. */
export const CYCLE_LENGTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 21);

/* ————— Contenu détaillé par phase — repris À L'IDENTIQUE de l'outil historique
       « Cycle » (Outils & calibrage) : cartes « dims », avertissement, « Pourquoi ? ». ————— */
export type PhaseDim = { t: string; s: 'normal' | 'up' | 'watch'; x: string };
export type PhaseContent = {
	label: string;
	blurb: string;
	dims: PhaseDim[];
	warn: string | null;
	why: string;
};

export const PHASE_CONTENT: Record<CyclePhaseKey, PhaseContent> = {
	menses: {
		label: 'Menstruations',
		blurb: 'Ton corps entame un nouveau cycle. Faim et énergie sont généralement proches de la normale.',
		dims: [
			{ t: 'Faim', s: 'normal', x: 'Normale, parfois légèrement diminuée.' },
			{ t: 'Dépense énergétique', s: 'normal', x: 'Dans la normale.' },
			{ t: 'Poids / rétention d’eau', s: 'normal', x: 'La rétention accumulée en fin de cycle précédent redescend généralement.' },
			{ t: 'Douleurs / crampes', s: 'up', x: "Fréquentes en tout début de règles, liées aux prostaglandines. N'indique rien sur ta progression." },
			{ t: 'Entraînement', s: 'normal', x: 'Aucune restriction. Adapte seulement si crampes ou fatigue marquée.' },
			{ t: 'Digestion', s: 'up', x: 'Ballonnements et transit modifié fréquents à cette période.' },
		],
		warn: null,
		why: 'Au tout début des règles, l’œstrogène et la progestérone sont tous les deux au plus bas du cycle — c’est justement la chute de la progestérone qui déclenche les règles. Les deux hormones recommencent à remonter progressivement dans les jours qui suivent.',
	},
	follicular: {
		label: 'Phase folliculaire',
		blurb: "Période généralement stable sur la faim, l'énergie et l'entraînement.",
		dims: [
			{ t: 'Faim', s: 'normal', x: 'Normale et stable pour la majorité des femmes.' },
			{ t: 'Dépense énergétique', s: 'normal', x: 'Dans la normale, phase de référence basse du cycle.' },
			{ t: 'Poids / rétention d’eau', s: 'normal', x: 'Généralement au plus bas du cycle.' },
			{ t: 'Entraînement', s: 'normal', x: 'Aucune restriction particulière liée au cycle.' },
			{ t: 'Température', s: 'normal', x: 'Basse et stable.' },
		],
		warn: null,
		why: "L'œstrogène augmente progressivement, produit par les follicules en développement dans l'ovaire. La progestérone, elle, reste basse pendant toute cette phase.",
	},
	ovulation: {
		label: 'Ovulation estimée',
		blurb: 'Tu es probablement proche de ton pic ovulatoire estimé — pas une certitude, une estimation.',
		dims: [
			{ t: 'Faim', s: 'normal', x: 'Normale ; une légère baisse est parfois rapportée.' },
			{ t: 'Dépense énergétique', s: 'normal', x: 'Dans la normale.' },
			{ t: 'Poids / rétention d’eau', s: 'normal', x: 'Stable.' },
			{ t: 'Entraînement', s: 'normal', x: 'Aucune restriction. Certaines femmes rapportent un pic d’énergie, non garanti.' },
			{ t: 'Température', s: 'watch', x: 'Début de la légère hausse post-ovulatoire.' },
		],
		warn: null,
		why: "L'œstrogène atteint son pic juste avant l'ovulation, ce qui déclenche la libération de l'hormone LH et l'ovulation elle-même. Juste après, la progestérone commence tout juste à augmenter.",
	},
	'luteal-early': {
		label: 'Phase lutéale précoce',
		blurb: 'La température corporelle peut légèrement augmenter. Rien à changer si tu te sens bien.',
		dims: [
			{ t: 'Faim', s: 'normal', x: 'Peut commencer à augmenter légèrement chez certaines femmes.' },
			{ t: 'Dépense énergétique', s: 'up', x: 'Peut très légèrement augmenter (quelques dizaines de kcal, parfois rien).' },
			{ t: 'Poids / rétention d’eau', s: 'up', x: 'Début de rétention possible chez certaines femmes.' },
			{ t: 'Entraînement', s: 'normal', x: 'Aucune restriction si tu te sens bien. Ajuste au ressenti, pas à la date.' },
			{ t: 'Température', s: 'up', x: 'Plus élevée qu’en folliculaire — tu peux avoir plus chaud à l’effort.' },
		],
		warn: null,
		why: "La progestérone continue de monter, sécrétée par le follicule qui vient de libérer l'ovule. L'œstrogène remonte aussi, plus modérément. C'est la première fois du cycle où les deux hormones sont élevées en même temps.",
	},
	'luteal-late': {
		label: 'Phase lutéale tardive',
		blurb: "Faim, rétention d'eau et sommeil peuvent être plus marqués chez certaines femmes. Ce n'est pas automatique.",
		dims: [
			{ t: 'Faim', s: 'up', x: 'Souvent en hausse — de l’ordre de 100 à 300 kcal/j chez beaucoup de femmes, parfois plus, parfois pas du tout.' },
			{ t: 'Dépense énergétique', s: 'up', x: 'Légèrement plus élevée, mais bien moins que la hausse de la faim.' },
			{ t: 'Poids / rétention d’eau', s: 'watch', x: 'Rétention la plus marquée du cycle — en moyenne modérée, parfois 2 à 3 kg chez certaines. C’est de l’eau, pas de la graisse.' },
			{ t: 'Humeur', s: 'up', x: "Irritabilité et sensibilité émotionnelle plus marquées chez certaines femmes. Ce n'est pas un manque de contrôle." },
			{ t: 'Entraînement', s: 'normal', x: 'Si fatigue, crampes ou sommeil dégradé : autorégule (charge -5 à -10 % si besoin). Sinon, rien à changer.' },
			{ t: 'Sommeil', s: 'up', x: 'Souvent le moment le plus propice aux perturbations du sommeil.' },
			{ t: 'Digestion', s: 'up', x: 'Ballonnements et transit modifié fréquents.' },
			{ t: 'Cravings', s: 'up', x: 'Les plus fréquents du cycle. Une portion planifiée plutôt qu’une interdiction totale.' },
		],
		warn: 'Ne modifie pas ton plan alimentaire uniquement parce que la balance augmente pendant quelques jours, et ne réduis pas brutalement tes calories : une variation rapide du poids n’est pas une variation de masse grasse.',
		why: "L'œstrogène et la progestérone atteignent leur pic puis chutent nettement dans les derniers jours si aucune grossesse ne débute. C'est cette chute — plus que le niveau élevé qui précède — qui est associée à la plupart des symptômes prémenstruels : faim, sommeil, humeur, rétention d'eau.",
	},
};

/**
 * Jour du cycle + phase estimée — MÊME formule que l'outil original
 * (aucune réécriture) : jour = (jours écoulés depuis les règles mod durée) + 1,
 * ovulation estimée = max(durée − 14, 8), phases menstruations → folliculaire →
 * ovulation → lutéale précoce → lutéale tardive.
 */
export function getCyclePhase(lmpStr: string, cycleLength: number, ref?: Date) {
	const today = ref ? new Date(ref) : new Date();
	today.setHours(0, 0, 0, 0);
	const lmp = new Date(lmpStr + 'T00:00:00');
	const diffDays = Math.floor((today.getTime() - lmp.getTime()) / 86400000);
	const cycleDay = (((diffDays % cycleLength) + cycleLength) % cycleLength) + 1;

	const ovulationDay = Math.max(cycleLength - 14, 8);
	const mensesEnd = 5;
	const lutealLength = cycleLength - ovulationDay;
	const lutealMid = ovulationDay + Math.round(lutealLength / 2);

	let key: CyclePhaseKey;
	if (cycleDay <= mensesEnd) key = 'menses';
	else if (cycleDay < ovulationDay - 2) key = 'follicular';
	else if (cycleDay <= ovulationDay + 1) key = 'ovulation';
	else if (cycleDay <= lutealMid) key = 'luteal-early';
	else key = 'luteal-late';

	return { cycleDay, cycleLength, key, ovulationDay };
}

/**
 * Plages de jours par phase (alignées sur la formule ci-dessus) — sert à
 * dessiner la mini-jauge de position sur l'Accueil.
 */
export function phaseRanges(cycleLength: number, ovulationDay: number) {
	const lutealLength = cycleLength - ovulationDay;
	const lutealMid = ovulationDay + Math.round(lutealLength / 2);
	return [
		{ key: 'menses', from: 1, to: Math.min(5, cycleLength) },
		{ key: 'follicular', from: 6, to: Math.max(6, ovulationDay - 3) },
		{ key: 'ovulation', from: Math.max(6, ovulationDay - 2), to: Math.min(cycleLength, ovulationDay + 1) },
		{ key: 'luteal-early', from: Math.min(cycleLength, ovulationDay + 2), to: Math.min(cycleLength, lutealMid) },
		{ key: 'luteal-late', from: Math.min(cycleLength, lutealMid + 1), to: cycleLength },
	] as const;
}

/** État dérivé affichable d'une configuration — même lecture côté cliente et côté coach. */
export type CycleState =
	| { kind: 'empty' }
	| { kind: 'hormonal' }
	| { kind: 'nodate' }
	| {
			kind: 'tracked';
			cycleDay: number;
			cycleLength: number;
			ovulationDay: number;
			key: CyclePhaseKey;
			label: string;
			blurb: string;
	  };

export function cycleState(cfg: CycleConfig | null | undefined, ref?: Date): CycleState {
	if (!cfg) return { kind: 'empty' };
	if (cfg.contra === 'hormonal') return { kind: 'hormonal' };
	if (cfg.noDate || !cfg.lmp || !cfg.len) return { kind: 'nodate' };
	const r = getCyclePhase(cfg.lmp, cfg.len, ref);
	return {
		kind: 'tracked',
		cycleDay: r.cycleDay,
		cycleLength: r.cycleLength,
		ovulationDay: r.ovulationDay,
		key: r.key,
		label: PHASES[r.key].label,
		blurb: PHASES[r.key].blurb,
	};
}
