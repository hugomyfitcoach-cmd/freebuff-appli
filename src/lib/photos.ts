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
