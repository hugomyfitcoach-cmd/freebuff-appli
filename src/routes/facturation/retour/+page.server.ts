import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { planForPriceId } from '$lib/server/stripe';

/**
 * PAGE DE RETOUR STRIPE (UX V1) — /facturation/retour.
 *
 * Ouverte par Stripe après un Checkout réussi (success_url) et au retour du
 * Customer Portal (return_url). HORS de /espace : volontaire, pour rester
 * disponible à une cliente BLOQUÉE (hard lock) sans élargir la faille du
 * guard à tout /espace/facturation/*.
 *
 * RÈGLE DE VÉRITÉ : le paramètre d'URL ne prouve RIEN. Un `?checkout=success`
 * n'est qu'une commodité de navigation — la source de vérité reste l'état
 * DÉRIVÉ de la base (canAccessApp, écrit par le webhook Stripe). La page
 * affiche donc l'état réel :
 *  - accès confirmé (abonnement actif, période payée, complimentary…) →
 *    « Tout est à jour ✓ » (conforme au libellé produit demandé) ;
 *  - sinon → message HONNÊTE « mise à jour en cours de confirmation » :
 *    on ne dit JAMAIS « paiement validé » sur la seule foi de l'URL.
 *
 * Accessible au navigateur externe comme dans le contexte PWA (les deux
 * parcours sont supportés). Cliente en Coaching : jamais concernée par la
 * facturation → redirection vers /espace (cohérent avec /espace/facturation).
 */
export const load: PageServerLoad = async (event) => {
	const user = await requireRole(event, 'client', { next: '/espace' });
	const token = event.cookies.get(SESSION_COOKIE);
	const billing = await convex.query(api.billing.accessState, { sessionToken: token }).catch(() => null);
	// Coaching : aucune page facturation (même décision que /espace/facturation).
	if ((billing?.coachingMode ?? user.coachingMode) === 'coaching') {
		throw redirect(303, '/espace');
	}
	const subscription = billing?.subscription ?? null;
	return {
		profile: { prenom: user.prenom },
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
		// Simple commodité de navigation — JAMAIS traitée comme une preuve de paiement.
		checkout: event.url.searchParams.get('checkout'),
	};
};
