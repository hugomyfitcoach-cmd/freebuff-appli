/**
 * FAMILLES DE MATÉRIEL — source unique de la règle d'affichage.
 *
 * La base contient des libellés hétérogènes (anglais d'import, français du
 * mapping G-FLUX, variantes « sled / leverage machine / lever / Traîneau »).
 * L'UI ne montre JAMAIS ces variantes : elle montre la FAMILLE. Aucune donnée
 * n'est modifiée — tout se fait à l'affichage et au filtrage.
 *
 * Règle (mission T-ED) :
 *  - sled / leverage machine / lever / Traîneau → « Machine » ;
 *  - smith machine → « Machine Smith » ; cable → « Poulies » ;
 *  - band / resistance band / mini-bande → « Élastiques » ;
 *  - body weight → « Poids du corps » ; dumbbell → « Haltères » ;
 *  - barbell / olympic barbell / ez barbell → « Barre » ;
 *  - kettlebell → « Kettlebell » ; weighted → « Lesté » ;
 *  - stability ball → « Swiss ball » ;
 *  - tout matériel non reconnu → « Autre » (jamais d'exercice sans famille).
 */

export const EQUIPMENT_FAMILIES = [
	'Machine',
	'Machine Smith',
	'Poulies',
	'Élastiques',
	'Poids du corps',
	'Haltères',
	'Barre',
	'Kettlebell',
	'Lesté',
	'Swiss ball',
	'Autre',
] as const;

export type EquipmentFamily = (typeof EQUIPMENT_FAMILIES)[number];

/** Minuscules, sans accents, espaces normalisés (les règles restent lisibles). */
function normalizeEquipment(raw: string | null | undefined): string {
	return (raw ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[’']/g, ' ')
		.replace(/[-_]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Famille d'affichage d'un matériel brut (jamais vide : « Autre »). */
export function equipmentFamily(raw: string | null | undefined): EquipmentFamily {
	const v = normalizeEquipment(raw);
	if (!v) return 'Autre';
	// L'ordre compte : « smith machine » avant les règles « machine ».
	if (v.includes('smith')) return 'Machine Smith';
	if (v.includes('cable') || v.includes('poulie')) return 'Poulies';
	if (v.includes('stability ball') || v.includes('swiss ball')) return 'Swiss ball';
	if (v.includes('band') || v.includes('elastique')) return 'Élastiques';
	if (v.includes('body weight') || v.includes('bodyweight') || v.includes('poids du corps')) return 'Poids du corps';
	if (v.includes('dumbbell') || v.includes('haltere')) return 'Haltères';
	if (v.includes('barbell') || v.includes('barre')) return 'Barre';
	if (v.includes('kettlebell')) return 'Kettlebell';
	if (v === 'weighted' || v === 'leste' || v === 'lestee') return 'Lesté';
	// Sled / lever / leverage machine / Traîneau / Machine (assistée comprise).
	if (v.includes('sled') || v.includes('lever') || v.includes('traineau') || v.includes('machine')) return 'Machine';
	return 'Autre';
}

/** Vrai si un matériel brut appartient à la famille filtrée. */
export function isEquipmentFamily(raw: string | null | undefined, family: string): boolean {
	return equipmentFamily(raw) === family;
}

/**
 * Facettes par famille : somme des comptes bruts, familles vides omises.
 * La somme rendue est TOUJOURS égale au total des exercices fournis —
 * aucun exercice ne peut être absent de tous les filtres.
 */
export function equipmentFacets(
	rows: readonly (readonly [string | null | undefined, number])[]
): { family: EquipmentFamily; count: number }[] {
	const counts = new Map<EquipmentFamily, number>();
	for (const [raw, count] of rows) {
		const family = equipmentFamily(raw);
		counts.set(family, (counts.get(family) ?? 0) + count);
	}
	return EQUIPMENT_FAMILIES.filter((family) => (counts.get(family) ?? 0) > 0).map((family) => ({
		family,
		count: counts.get(family) ?? 0,
	}));
}
