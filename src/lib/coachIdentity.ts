/**
 * Identité coach d'affichage — 100 % frontend (aucun backend touché).
 *
 * La session expose `prenom` + `email` (SessionUser) ; or le compte de test
 * de la Preview s'appelle littéralement « Coach », ce qui donnait un hero
 * « Bonjour Coach 👋 ». Ici : si le prénom de session n'est pas exploitable,
 * on affiche un coach fictif réaliste pour la démo ; sinon les vraies valeurs.
 */
export type CoachUserLike = {
	prenom?: string | null;
	nom?: string | null;
	email?: string | null;
};

/** Coach fictif réaliste — utilisé uniquement en repli (Preview / démo). */
export const DEMO_COACH = {
	prenom: 'Hugo',
	nom: 'Debré',
	email: 'hugo.debre@g-flux.fr',
};

export type CoachIdentityResolved = { prenom: string; nom: string; email: string };

/**
 * Résout l'identité à afficher : prénom réel de session s'il est présent et
 * différent de « Coach », sinon l'identité de démonstration.
 */
export function coachIdentity(user?: CoachUserLike | null): CoachIdentityResolved {
	const rawPrenom = user?.prenom?.trim() ?? '';
	const usable = rawPrenom.length > 0 && !/^coach$/i.test(rawPrenom);
	if (usable) {
		return {
			prenom: rawPrenom,
			nom: user?.nom?.trim() ?? '',
			email: user?.email?.trim() ?? '',
		};
	}
	return { ...DEMO_COACH };
}
