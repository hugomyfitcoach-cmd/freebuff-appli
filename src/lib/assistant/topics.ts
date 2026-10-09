/**
 * CATÉGORIES DE L'ASSISTANT (§8/§9) — métadonnées d'affichage uniquement.
 *
 * Module PUR côté navigateur (aucune lecture d'environnement) : les valeurs
 * `assistantTopic` envoyées au backend sont exactement celles déclarées dans
 * `lib/assistant/policy.ts` — une seule liste de sujets pour tout le système.
 *
 * Une seule catégorie est sélectionnée à la fois ; la card de suggestions se
 * met à jour au changement (jamais 4 cards simultanées).
 */

export type TopicId = 'nutrition' | 'weight_steps' | 'recipes' | 'checkin' | 'coach_question';

export type TopicDef = {
	id: TopicId;
	label: string;
	/** Nom d'icône G-FLUX (système Lucide de Icon.svelte). */
	icon: string;
	/** Sous-titre discret de la card. */
	subtitle: string;
	/** Suggestions compactes — un tap envoie le message. */
	suggestions: string[];
	/** Suggestion qui ouvre WhatsApp au lieu d'envoyer un message. */
	whatsappSuggestion?: string;
};

export const TOPICS: TopicDef[] = [
	{
		id: 'nutrition',
		label: 'Alimentation',
		icon: 'utensils',
		subtitle: 'Gère facilement tes repas et tes apports.',
		suggestions: [
			'Ajouter ce que j’ai mangé',
			'Que manger maintenant ?',
			'Combien de calories me reste-t-il ?',
			'Corriger un aliment',
			'Remplacer un aliment',
			'Analyser ma journée',
		],
	},
	{
		id: 'weight_steps',
		label: 'Poids & pas',
		icon: 'footprints',
		subtitle: 'Suis ton poids, tes pas et ta semaine.',
		suggestions: [
			'Saisir mon poids',
			'Saisir mes pas',
			'Où j’en suis cette semaine ?',
			'Voir mon récap',
			'Comparer mes derniers jours',
		],
	},
	{
		id: 'recipes',
		label: 'Recettes',
		icon: 'chefHat',
		subtitle: 'Des idées simples, adaptées à tes restes et tes calories.',
		suggestions: [
			'Idée avec mes restes',
			'Adapter une recette',
			'Trouver une recette selon mes calories restantes',
			'Préparer mes dîners',
			'Générer une liste de courses',
		],
	},
	{
		id: 'checkin',
		label: 'Bilan',
		icon: 'clipboardPen',
		subtitle: 'Le factuel de ta période, prêt pour ton bilan.',
		suggestions: ['Récap de ma journée', 'Récap de ma semaine', 'Préparer mon prochain bilan'],
	},
	{
		id: 'coach_question',
		label: 'Hugo',
		icon: 'messageCircle',
		subtitle: 'Hugo garde la main sur ton suivi.',
		suggestions: [
			'Noter une question pour Hugo',
			'Ajouter cette question à mon prochain bilan',
			'Écrire à Hugo sur WhatsApp',
		],
		whatsappSuggestion: 'Écrire à Hugo sur WhatsApp',
	},
];

export function topicDef(id: string): TopicDef {
	return TOPICS.find((t) => t.id === id) ?? TOPICS[0];
}
