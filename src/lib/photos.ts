/** Libellés des moments photo — miroir client de `src/convex/photos.ts`. */
export const PHOTO_STEPS = ['demarrage', 'mois1', 'mois2', 'mois3', 'mois4', 'mois5', 'mois6'] as const;
export type PhotoStep = (typeof PHOTO_STEPS)[number];

export const PHOTO_STEP_LABELS: Record<PhotoStep, string> = {
	demarrage: 'Démarrage',
	mois1: 'Mois 1',
	mois2: 'Mois 2',
	mois3: 'Mois 3',
	mois4: 'Mois 4',
	mois5: 'Mois 5',
	mois6: 'Mois 6'
};

/**
 * Tri CRM des photos de suivi : les plus RÉCENTES en haut, les plus anciennes
 * (Démarrage) en bas — par date de RÉCEPTION (`createdAt`) décroissante, puis
 * par date de dépôt (`date`) en cas d'égalité. Ne modifie jamais la liste reçue.
 */
export function sortPhotosNewestFirst<T extends { createdAt?: number | null; date?: string | null }>(
	rows: readonly T[]
): T[] {
	return [...rows].sort((a, b) => {
		const ca = typeof a.createdAt === 'number' ? a.createdAt : 0;
		const cb = typeof b.createdAt === 'number' ? b.createdAt : 0;
		if (ca !== cb) return cb - ca;
		return (b.date ?? '').localeCompare(a.date ?? '');
	});
}
