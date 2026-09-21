/**
 * Préchauffage du miroir des miniatures alimentaires — fire-and-forget.
 *
 * Appelé quand une cliente SÉLECTIONNE un aliment (ouverture de la feuille
 * de quantité) ou l'AJOUTE au Journal : la miniature OFF 100 px du produit
 * est téléchargée UNE fois et stockée côté G-FLUX, pour que le Journal (et
 * toutes les autres clientes) la trouvent ensuite déjà en miroir.
 *
 * JAMAIS dans le chemin critique : `void warmFoodImages(...)` — aucun await,
 * aucune erreur remontée, l'ajout au Journal ne attend jamais la photo.
 */

type WarmCandidate = { offId?: string; imageUrl?: string; thumbUrl?: string };

let warmInFlight = new Set<string>();

/** POST /api/food-image/warm — silencieux en cas d'échec (OFF lent/absent). */
export function warmFoodImages(items: WarmCandidate[]): void {
	if (typeof window === 'undefined') return;
	const candidates = items
		.filter((it): it is { offId: string; imageUrl: string; thumbUrl?: string } => !!it.offId && !!it.imageUrl && !it.thumbUrl)
		.filter((it) => {
			if (warmInFlight.has(it.offId)) return false;
			warmInFlight.add(it.offId);
			return true;
		})
		.slice(0, 12);
	if (!candidates.length) return;
	try {
		void fetch('/api/food-image/warm', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ images: candidates.map(({ offId, imageUrl }) => ({ offId, imageUrl })) }),
			keepalive: true,
		})
			.catch(() => {})
			.finally(() => {
				for (const { offId } of candidates) warmInFlight.delete(offId);
			});
	} catch {
		for (const { offId } of candidates) warmInFlight.delete(offId);
	}
}
