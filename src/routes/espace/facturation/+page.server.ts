import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { billingConfigured, planForPriceId } from '$lib/server/stripe';
import { AUTONOMY_MONTHLY_PRICE_EUR, AUTONOMY_YEARLY_PRICE_EUR } from '../../../convex/billing.js';

/**
 * FACTURATION / PAYWALL (mission §6) — page TOUJOURS accessible, même cliente
 * bloquée (c'est ici qu'elle souscrit). Le layout /espace l'exempte du garde
 * requireClientAccess côté serveur : aucune règle d'accès côté navigateur.
 *
 * L'état affiché est l'état DÉRIVÉ (canAccessApp côté Convex) : décision,
 * mode, accès offert, abonnement (statut, échéance, grâce, plan mensuel/annuel
 * via mapping priceId). Sans Stripe TEST configuré (preview), le paywall
 * l'indique honnêtement au lieu de promettre un paiement impossible.
 */
export const load: PageServerLoad = async (event) => {
	const user = await requireRole(event, 'client', { next: '/espace' });
	const token = event.cookies.get(SESSION_COOKIE);
	const billing = await convex.query(api.billing.accessState, { sessionToken: token }).catch(() => null);
	const subscription = billing?.subscription ?? null;
	return {
		profile: { prenom: user.prenom, email: user.email },
		billing: {
			decision: billing?.decision ?? 'allow',
			coachingMode: billing?.coachingMode ?? user.coachingMode,
			billingAccessOverride: billing?.billingAccessOverride ?? null,
			subscription: subscription
				? {
						status: subscription.status,
						cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
						currentPeriodEnd: subscription.currentPeriodEnd,
						graceUntil: subscription.graceUntil,
						plan: planForPriceId(subscription.priceId),
					}
				: null,
		},
		prices: { monthly: AUTONOMY_MONTHLY_PRICE_EUR, yearly: AUTONOMY_YEARLY_PRICE_EUR },
		checkout: event.url.searchParams.get('checkout'),
		billingReady: billingConfigured(),
	};
};
