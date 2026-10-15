/* Retour du header pour les sous-pages de « Ma progression » (détail d'une mesure,
   masse grasse, guide). Renseigné par la page Progression tant qu'une sous-page
   est ouverte ; lu par AppShell pour remplacer la pilule « Accueil » par « Retour ». */
export const progressionBack = $state<{ close: (() => void) | null }>({ close: null });
