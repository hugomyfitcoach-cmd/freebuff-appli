/**
 * Source Ciqual pour l'ajout au journal / aux repas (additif, jamais destructif).
 *
 * Une fiche Ciqual est transmise par le client via son LIBELLÉ officiel exact
 * (`ciqualLabel`) — jamais de valeurs nutritionnelles : le serveur résout
 * kcal/macros /100 g depuis la table embarquée. Aucune donnée OFF n'est lue,
 * modifiée ou fusionnée ; l'entrée stockée est un snapshot classique du journal.
 */
import { resolveCiqualLabel } from "./ciqual";

/** Structure « fiche source » (mêmes champs utiles que la table `foods`). */
export type CiqualFoodSource = {
	name: string;
	brand: string | undefined;
	imageUrl: string | undefined;
	kcal100: number;
	carbs100: number;
	protein100: number;
	fat100: number;
};

/**
 * Construit la « fiche » source au format des autres sources (`foods`) :
 * mêmes champs, valeurs Ciqual /100 g résolues côté serveur. Retourne null si
 * le libellé n'existe pas (exact) dans la table embarquée.
 */
export function ciqualFoodSource(label: string): CiqualFoodSource | null {
	const ref = resolveCiqualLabel(label);
	if (!ref) return null;
	return {
		name: ref.label,
		brand: undefined,
		imageUrl: undefined,
		kcal100: ref.kcal,
		carbs100: ref.carbs ?? 0,
		protein100: ref.protein ?? 0,
		fat100: ref.fat ?? 0,
	};
}
