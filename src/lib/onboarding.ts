/**
 * Questionnaire de démarrage G-FLUX — source unique des questions.
 *
 * Reconstruit depuis l'ancien formulaire (utilisé comme SOURCE uniquement) :
 *  - les écrans d'introduction / bienvenue sont ignorés ;
 *  - Prénom & Nom sont supprimés : l'identité vient du compte connecté ;
 *  - le contenu des questions et leurs choix sont conservés.
 *
 * Utilisé par le wizard cliente (/espace/demarrage) et par la lecture coach
 * (onglet Démarrage du CRM) — un seul endroit à faire évoluer.
 */

export type Choice = { value: string; label: string; hint?: string };
export type FieldKind = 'choice' | 'text' | 'number' | 'textarea' | 'scale';

export type Question = {
	id: string;
	kind: FieldKind;
	label: string;
	required?: boolean;
	placeholder?: string;
	options?: Choice[];
	/** Affichée uniquement quand cette question vaut cette valeur. */
	showWhen?: { field: string; value: string };
	/** Pour kind 'scale'. */
	min?: number;
	max?: number;
	hint?: string;
};

export type Section = {
	id: string;
	step: number;
	title: string;
	icon: string;
	subtitle?: string;
	questions: Question[];
};

export const ONBOARDING_SECTIONS: Section[] = [
	{
		id: 'profil',
		step: 1,
		title: 'Ton profil de base',
		icon: 'clipboardList',
		subtitle: 'Quelques infos pour bien démarrer.',
		questions: [
			{ id: 'age', kind: 'number', label: 'Âge', required: true, placeholder: 'Ex. 28' },
			{ id: 'heightCm', kind: 'number', label: 'Taille (cm)', required: true, placeholder: 'Ex. 165' },
			{ id: 'profession', kind: 'text', label: 'Profession / activité principale', required: true, placeholder: 'Ex. infirmière, commerciale, étudiante…' },
			{ id: 'fastingWeight', kind: 'number', label: 'Poids à jeun (kg)', required: true, placeholder: 'Ex. 67,5' },
		],
	},
	{
		id: 'composition',
		step: 2,
		title: 'Composition corporelle',
		icon: 'activity',
		subtitle: 'Situe-toi dans la grille ci-dessous — au plus proche de ta réalité actuelle.',
		questions: [
			{
				id: 'silhouette',
				kind: 'choice',
				label: 'Où te situes-tu aujourd’hui ?',
				required: true,
				options: [
					{ value: 'A', label: '12 – 14 %' },
					{ value: 'B', label: '15 – 17 %' },
					{ value: 'C', label: '18 – 20 %' },
					{ value: 'D', label: '21 – 23 %' },
					{ value: 'E', label: '24 – 26 %' },
					{ value: 'F', label: '27 – 29 %' },
					{ value: 'G', label: '30 – 35 %' },
					{ value: 'H', label: '36 – 40 %' },
					{ value: 'I', label: '50 % et +' },
				],
			},
			{
				id: 'mainGoal',
				kind: 'choice',
				label: 'Objectif principal',
				required: true,
				options: [
					{ value: 'perte_rapide', label: 'Perte de gras rapide', hint: 'Plus agressif, court terme' },
					{ value: 'perte_douce', label: '⏳ Perte de gras douce et progressive', hint: 'Rythme tenable dans la durée' },
					{ value: 'recomp', label: 'Recomposition corporelle', hint: 'Moins de gras + plus de muscle' },
				],
			},
		],
	},
	{
		id: 'metabolique',
		step: 3,
		title: 'Historique métabolique',
		icon: 'search',
		subtitle: 'Ces 3 questions sont clés pour calibrer ton plan dès le départ.',
		questions: [
			{
				id: 'stagnation',
				kind: 'choice',
				label: 'Depuis combien de temps tu stagnes ?',
				required: true,
				options: [
					{ value: 'lt3', label: 'Moins de 3 mois' },
					{ value: '3to6', label: '3 à 6 mois' },
					{ value: '6to12', label: '6 mois à 1 an' },
					{ value: 'gt12', label: 'Plus d’1 an' },
					{ value: 'no', label: 'Je ne stagne pas vraiment' },
				],
			},
			{
				id: 'regimes',
				kind: 'choice',
				label: 'Tu as déjà fait des régimes restrictifs ou des périodes de restriction calorique ?',
				required: true,
				options: [
					{ value: 'jamais', label: 'Non, jamais' },
					{ value: 'quelques', label: 'Oui, quelques tentatives' },
					{ value: 'plusieurs', label: 'Oui, plusieurs régimes sur plusieurs années' },
					{ value: 'constant', label: 'Oui, je suis quasi toujours en restriction' },
				],
			},
			{
				id: 'comptage',
				kind: 'choice',
				label: 'Tu as déjà compté tes calories ou suivi tes macros ?',
				required: true,
				options: [
					{ value: 'jamais', label: 'Non jamais' },
					{ value: 'brievement', label: 'Oui brièvement' },
					{ value: 'regulierement', label: 'Oui régulièrement' },
				],
			},
		],
	},
	{
		id: 'approche',
		step: 4,
		title: 'Approche nutritionnelle',
		icon: 'apple',
		subtitle: 'Quelle approche te parle le plus ? On ajustera ensemble selon ton évolution.',
		questions: [
			{
				id: 'approche',
				kind: 'choice',
				label: 'Quelle approche te parle le plus ?',
				required: true,
				options: [
					{ value: 'compter', label: 'Compter les calories et les macros', hint: 'Flexible, précis. On adapte ensemble selon tes préférences.' },
					{ value: 'instinctif', label: 'Sans compter les calories', hint: 'Plus instinctif. Demande plus de rigueur sur la qualité et les quantités.' },
					{ value: 'plan', label: 'Plan alimentaire structuré', hint: 'Cadre clair et précis. Tu suis, on ajuste.' },
				],
			},
		],
	},
	{
		id: 'sommeil',
		step: 5,
		title: 'Sommeil & rythme de vie',
		icon: 'moon',
		questions: [
			{
				id: 'sleepHours',
				kind: 'choice',
				label: 'Heures de sommeil par nuit',
				required: true,
				options: [
					{ value: 'lt7', label: '- de 7 h' },
					{ value: '7to9', label: '7 à 9 h' },
					{ value: 'gt9', label: '9 h et +' },
				],
			},
			{ id: 'regularHours', kind: 'choice', label: 'Horaires réguliers ?', required: true, options: [{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }] },
			{ id: 'tiredWake', kind: 'choice', label: 'Tu te réveilles souvent fatiguée ?', required: true, options: [{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }] },
		],
	},
	{
		id: 'sante',
		step: 6,
		title: 'Santé & traitements',
		icon: 'heartPulse',
		questions: [
			{
				id: 'healthIssues',
				kind: 'choice',
				label: 'Soucis de santé ou traitements en cours ?',
				required: true,
				options: [
					{ value: 'oui', label: 'Oui' },
					{ value: 'non', label: 'Non' },
				],
			},
			{ id: 'healthDetail', kind: 'text', label: 'Précise', placeholder: 'Explique en quelques mots…', showWhen: { field: 'healthIssues', value: 'oui' } },
			{
				id: 'supplements',
				kind: 'choice',
				label: 'Médicaments ou compléments alimentaires ?',
				required: true,
				options: [
					{ value: 'oui', label: 'Oui' },
					{ value: 'non', label: 'Non' },
				],
			},
			{ id: 'supplementsList', kind: 'text', label: 'Liste', placeholder: 'Lesquels ?', showWhen: { field: 'supplements', value: 'oui' } },
		],
	},
	{
		id: 'alimentation',
		step: 7,
		title: 'Alimentation',
		icon: 'utensils',
		questions: [
			{
				id: 'mealsPerDay',
				kind: 'choice',
				label: 'Nombre de repas / collations par jour',
				required: true,
				options: [
					{ value: '1', label: '1' },
					{ value: '2', label: '2' },
					{ value: '3', label: '3' },
					{ value: '4', label: '4' },
					{ value: '5plus', label: '5 +' },
				],
			},
			{ id: 'typicalDay', kind: 'textarea', label: 'Journée type dans ton assiette', required: true, placeholder: 'Décris une journée habituelle : petit-déjeuner, déjeuner, dîner, collations…' },
			{ id: 'favFoods', kind: 'text', label: 'Aliments préférés (même ceux que tu penses « pas sains »)', placeholder: 'Ex. pain, fromage, chocolat…' },
			{
				id: 'dietPlan',
				kind: 'choice',
				label: 'Régime particulier ?',
				required: true,
				options: [
					{ value: 'oui', label: 'Oui' },
					{ value: 'non', label: 'Non' },
				],
			},
			{ id: 'dietPlanDetail', kind: 'text', label: 'Précise', placeholder: 'Lequel ? (végétarien, sans gluten…)', showWhen: { field: 'dietPlan', value: 'oui' } },
			{ id: 'dislikedFoods', kind: 'text', label: 'Aliments que tu ne supportes pas / n’aimes pas', placeholder: 'Ex. poisson, courgettes…' },
			{
				id: 'biggestMeal',
				kind: 'choice',
				label: 'Ton plus gros repas ?',
				required: true,
				options: [
					{ value: 'matin', label: 'Matin' },
					{ value: 'midi', label: 'Midi' },
					{ value: 'soir', label: 'Soir' },
					{ value: 'reparti', label: 'Tout réparti' },
				],
			},
		],
	},
	{
		id: 'hydratation',
		step: 8,
		title: 'Hydratation & boissons',
		icon: 'droplet',
		questions: [
			{
				id: 'waterLiters',
				kind: 'choice',
				label: 'Litres d’eau par jour',
				required: true,
				options: [
					{ value: 'lt1', label: '- de 1 L' },
					{ value: '1to15', label: '1 à 1,5 L' },
					{ value: '15to2', label: '1,5 à 2 L' },
					{ value: 'gt2', label: '2 L et +' },
				],
			},
			{
				id: 'sugaryDrinks',
				kind: 'choice',
				label: 'Boissons sucrées ou sodas (light inclus) ?',
				required: true,
				options: [
					{ value: 'non', label: 'Non' },
					{ value: 'occasionnel', label: 'Occasionnellement' },
					{ value: 'souvent', label: 'Souvent' },
				],
			},
		],
	},
	{
		id: 'sport',
		step: 9,
		title: 'Sport & activité physique',
		icon: 'dumbbell',
		questions: [
			{
				id: 'sport',
				kind: 'choice',
				label: 'Tu pratiques du sport actuellement ?',
				required: true,
				options: [
					{ value: 'oui', label: 'Oui' },
					{ value: 'non', label: 'Non' },
				],
			},
			{ id: 'sportsDetail', kind: 'text', label: 'Quel(s) sport(s) ?', placeholder: 'Ex. running, musculation, danse…', showWhen: { field: 'sport', value: 'oui' } },
			{
				id: 'sportFrequency',
				kind: 'choice',
				label: 'Fréquence par semaine ?',
				required: true,
				showWhen: { field: 'sport', value: 'oui' },
				options: [
					{ value: '1x', label: '1×' },
					{ value: '2x', label: '2×' },
					{ value: '3x', label: '3×' },
					{ value: '4x', label: '4×' },
					{ value: '5x', label: '5× et +' },
				],
			},
			{
				id: 'treadmill',
				kind: 'choice',
				label: 'Tapis de marche / course à la maison ?',
				required: true,
				options: [
					{ value: 'oui', label: 'Oui' },
					{ value: 'non', label: 'Non' },
				],
			},
			{
				id: 'smartwatch',
				kind: 'choice',
				label: 'Montre connectée / podomètre ?',
				required: true,
				options: [
					{ value: 'oui', label: 'Oui' },
					{ value: 'non', label: 'Non' },
				],
			},
			{
				id: 'dailySteps',
				kind: 'choice',
				label: 'Nombre de pas moyen par jour',
				required: true,
				options: [
					{ value: '1000', label: '≈ 1 000' },
					{ value: '2000', label: '≈ 2 000' },
					{ value: '3000', label: '≈ 3 000' },
					{ value: '4000', label: '≈ 4 000' },
					{ value: '5000', label: '≈ 5 000' },
					{ value: '8000', label: '≈ 8 000' },
					{ value: '10000', label: '≈ 10 000' },
					{ value: '12000', label: '≈ 12 000 et +' },
				],
			},
		],
	},
	{
		id: 'stress',
		step: 10,
		title: 'Stress, émotions & dernières infos',
		icon: 'brain',
		questions: [
			{
				id: 'stressLevel',
				kind: 'scale',
				label: 'Niveau de stress général',
				min: 0,
				max: 10,
				required: true,
				hint: '0 = zen / 10 = permanent',
			},
			{
				id: 'stressEating',
				kind: 'choice',
				label: 'Tu manges différemment sous stress ?',
				required: true,
				options: [
					{ value: 'oui', label: 'Oui' },
					{ value: 'non', label: 'Non' },
				],
			},
			{
				id: 'foodRelation',
				kind: 'choice',
				label: 'Ton rapport à l’alimentation',
				required: true,
				options: [
					{ value: 'neutre', label: 'Neutre, pas de problème particulier' },
					{ value: 'culpabilite', label: 'Culpabilité fréquente après les écarts' },
					{ value: 'emotions', label: 'Tendance à manger sous l’effet des émotions' },
					{ value: 'complexe', label: 'Relation complexe, difficile à définir' },
				],
			},
			{ id: 'extra', kind: 'textarea', label: 'Autres infos à partager ?', placeholder: 'Tout ce qui peut m’aider à mieux te comprendre…' },
		],
	},
];

export const ONBOARDING_TOTAL_STEPS = ONBOARDING_SECTIONS.length;

function question(id: string): Question | undefined {
	for (const s of ONBOARDING_SECTIONS) {
		const q = s.questions.find((x) => x.id === id);
		if (q) return q;
	}
	return undefined;
}

/** Réponse lisible d'une valeur brute (code → libellé ; sinon texte). */
export function readableAnswer(id: string, value: unknown): string {
	const q = question(id);
	if (value == null) return '—';
	if (q?.kind === 'choice') {
		const opt = q.options?.find((o) => o.value === value);
		return opt ? opt.label : String(value);
	}
	if (q?.kind === 'scale') return String(value);
	return String(value);
}

/** Toutes les questions visibles quand les réponses ci-dessous sont appliquées. */
export function visibleQuestions(answers: Record<string, unknown>): { section: Section; question: Question }[] {
	const out: { section: Section; question: Question }[] = [];
	for (const s of ONBOARDING_SECTIONS) {
		for (const q of s.questions) {
			if (q.showWhen && answers[q.showWhen.field] !== q.showWhen.value) continue;
			out.push({ section: s, question: q });
		}
	}
	return out;
}

/** Nombre de questions requises du questionnaire complet (aides wizard). */
export function requiredCountOf(questions: Question[]): number {
	return questions.filter((q) => q.required).length;
}
