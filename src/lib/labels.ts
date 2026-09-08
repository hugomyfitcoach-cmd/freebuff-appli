import type { Doc } from '../convex/_generated/dataModel.js';

type Checkin = Doc<'checkins'>;

/**
 * Libellés lisibles des options — texte brut (aucun emoji ni pictogramme dans
 * les données). Les indicateurs de couleur / icônes sont rendus par l'UI.
 */
export const OPTION_LABELS: Record<string, Record<string, string>> = {
	adherence: {
		oui: 'Oui, de façon régulière',
		partiel: 'Partiellement (écarts / repas non maîtrisés)',
		non: 'Non, pas du tout',
	},
	deficit_annule: {
		non: 'Non, restée en déficit',
		'peut-etre': 'Peut-être, je ne sais pas trop',
		oui: 'Oui, déficit probablement annulé',
	},
	faim: { oui: 'Oui', non: 'Non' },
	hydratation: {
		suffisante: 'Suffisante et régulière',
		variable: 'Variable / irrégulière',
		insuffisante: 'Insuffisante',
	},
	digestion: {
		ok: 'OK',
		perturbee: 'Un peu perturbée',
		ballonnements: 'Ballonnements / inconfort fréquents',
	},
	pas: {
		moins5000: 'Moins de 5 000',
		'5000-8000': '5 000 – 8 000',
		'8000-10000': '8 000 – 10 000',
		plus10000: '10 000+',
	},
	cycle: {
		regles: 'Règles (J1 à J4–5)',
		folliculaire: 'Phase folliculaire (J5 à J14)',
		ovulation: 'Ovulation (J14–J16)',
		luteale: 'Phase lutéale (J15 à J28)',
		menopause: 'Ménopause / péri-ménopause',
		pilule: 'Pilule / contraception hormonale',
		'sais-pas': 'Je ne sais pas / peu de repères',
	},
	evolution: {
		baisse: 'En baisse / amélioration',
		stable: 'Stable',
		hausse: 'En hausse / sensation de stagnation',
	},
	mensurations: { oui: 'Oui', non: 'Non' },
	photos: { oui: 'Oui', non: 'Non' },
	besoin_retour: {
		rien: 'Rien, tout va bien',
		ecrit: 'Un retour écrit / vidéo',
		appel: 'Réserver un appel',
	},
	categorie_retour: {
		alimentation: 'Alimentation',
		sport: 'Sport',
		motivation: 'Motivation',
		autre: 'Autre',
	},
};

type FieldKey =
	| 'motivation'
	| 'adherence'
	| 'deficit_annule'
	| 'faim'
	| 'hydratation'
	| 'digestion'
	| 'pas'
	| 'cycle'
	| 'evolution'
	| 'mensurations'
	| 'photos'
	| 'besoin_retour'
	| 'categorie_retour'
	| 'point_retour'
	| 'victoire';

const FIELD_HEADERS: Array<[FieldKey, string]> = [
	['motivation', 'Motivation'],
	['adherence', 'Adhérence au plan'],
	['deficit_annule', 'Écarts → déficit annulé ?'],
	['faim', 'Faim / envies difficiles'],
	['hydratation', 'Hydratation'],
	['digestion', 'Digestion'],
	['pas', 'Pas moyen / jour'],
	['cycle', 'Phase de cycle'],
	['evolution', 'Évolution perçue'],
	['mensurations', 'Semaine de mensurations'],
	['photos', 'Semaine de photos'],
	['besoin_retour', 'Besoin de ma part'],
	['categorie_retour', 'Retour sur'],
	['point_retour', 'Précision'],
	['victoire', 'Victoire / fierté'],
];

export function labelFor(key: string, value: string): string {
	const table = OPTION_LABELS[key];
	if (table && value in table) return table[value];
	return value;
}

export function answerLines(checkin: Checkin): Array<{ key: FieldKey; header: string; text: string }> {
	const a = checkin.answers;
	const lines: Array<{ key: FieldKey; header: string; text: string }> = [];
	for (const [key, header] of FIELD_HEADERS) {
		const raw = (a as Record<string, unknown>)[key];
		if (raw === undefined || raw === null) continue;
		if (key === 'motivation') {
			lines.push({ key, header, text: `${raw}/5` });
		} else if (key === 'categorie_retour' && Array.isArray(raw) && raw.length > 0) {
			lines.push({ key, header, text: raw.map((v) => labelFor(key, String(v))).join(' · ') });
		} else if (key === 'point_retour' || key === 'victoire') {
			const text = String(raw).trim();
			if (text) lines.push({ key, header, text });
		} else {
			lines.push({ key, header, text: labelFor(key, String(raw)) });
		}
	}
	return lines;
}

/** Récap prêt à coller sur WhatsApp. */
export function buildRecap(checkin: Checkin, clientName: string): string {
	const lines: string[] = [`Bilan ${checkin.weekLabel} — ${clientName}`, ''];
	for (const { header, text } of answerLines(checkin)) {
		lines.push(`• ${header} : ${text}`);
	}
	return lines.join('\n');
}