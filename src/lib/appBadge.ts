/**
 * Badge PWA de l'icône installée (Badging API).
 *
 * Progressif et purement cosmétique : la source de vérité reste les badges
 * internes G-FLUX (dashboard.badges). Si la plateforme ne supporte pas la
 * Badging API (iOS Safari, Firefox…), cet appel ne fait rien — l'app continue
 * de fonctionner normalement et affiche ses propres compteurs.
 *
 * - Android Chrome / Samsung Internet : badge numérique (ou point système
 *   selon le launcher) quand navigator.setAppBadge existe ;
 * - pas d'autorisation requise (contrairement aux Notifications) ;
 * - total === 0 → clearAppBadge (le badge disparaît).
 */
type BadgeNavigator = Navigator & {
	setAppBadge?: (contents?: number) => Promise<void>;
	clearAppBadge?: () => Promise<void>;
};

export function setAppBadgeFor(total: number): void {
	if (typeof navigator === 'undefined') return;
	try {
		const nav = navigator as BadgeNavigator;
		const n = Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0;
		if (n > 0) {
			if (typeof nav.setAppBadge === 'function') {
				void nav.setAppBadge(n).catch(() => {});
			}
		} else if (typeof nav.clearAppBadge === 'function') {
			void nav.clearAppBadge().catch(() => {});
		}
	} catch {
		/* plateforme sans Badging API : silencieux */
	}
}
