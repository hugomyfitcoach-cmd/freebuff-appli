import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole, clearSessionCookie } from '$lib/server/session';
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
	// FACTURATION réservée au mode Autonomie (décision produit) : une cliente en
	// coaching n'a aucune page Facturation — redirection côté serveur, pas un
	// simple masquage d'onglet.
	if ((billing?.coachingMode ?? user.coachingMode) === 'coaching') {
		throw redirect(303, '/espace');
	}
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
		// Parcours web classique (Stripe dans le même contexte) : le retour de
		// Checkout revient ICI. Le paramètre n'est qu'une commodité de navigation
		// — JAMAIS traité comme une preuve de paiement (webhook = source de vérité).
		// En PWA (ouverture navigateur externe) et via le Portal, le retour passe
		// par la page dédiée /facturation/retour.
		checkout: event.url.searchParams.get('checkout'),
		billingReady: billingConfigured(),
	};
};

/**
 * Déconnexion — page facturation = SEULE page ouverte pendant le hard lock :
 * la sortie de session doit y rester possible (décision produit). Même handler
 * que le menu profil.
 */
export const actions: Actions = {
	logout: async ({ cookies, url }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (token) {
			try {
				await convex.mutation(api.users.signOut, { sessionToken: token });
			} catch {
				// session déjà expirée : on nettoie le cookie quand même
			}
		}
		clearSessionCookie({ cookies, url });
		throw redirect(303, '/connexion');
	},
};
